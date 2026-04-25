import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { BalanceRepository, BalanceRow } from '../persistence/balance.repository';
import { LedgerRepository } from '../persistence/ledger.repository';
import { RequestRepository, RequestRow } from '../persistence/request.repository';
import { HcmClient } from '../hcm/hcm.client';
import { HcmError } from '../hcm/hcm.errors';
import { OutboxService } from '../outbox/outbox.service';
import { OutboxEventType, HcmDebitOutboxPayload } from '../outbox/outbox.types';
import { AuditService } from '../audit/audit.service';
import {
  available,
  canReserve,
  commitReservation,
  releaseReservation,
  reserve,
} from '../domain/balance';
import {
  RequestStatus,
  assertTransition,
  countDaysInclusive,
  holdsReservation,
} from '../domain/request';
import { LedgerEntryType, LedgerSource } from '../domain/ledger';
import { CreateRequestDto } from './dto/create-request.dto';
import { RequestDto } from './dto/request.dto';
import { InsufficientBalanceError } from '../domain/errors';
import { Role } from '../common/auth/auth.types';

@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    private readonly balances: BalanceRepository,
    private readonly ledger: LedgerRepository,
    private readonly requests: RequestRepository,
    private readonly hcm: HcmClient,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actor: string,
    actorEmployeeId: string,
    dto: CreateRequestDto,
    idempotencyKey: string | null,
  ): Promise<RequestDto> {
    const days = countDaysInclusive(new Date(dto.startDate), new Date(dto.endDate));
    if (days <= 0) {
      throw new BadRequestException('daysRequested must be positive');
    }

    if (idempotencyKey) {
      const existing = await this.requests.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        return this.toDto(existing);
      }
    }

    const row = await this.balances.withTx(async (manager) => {
      const current = await this.balances.findOneTx(manager, actorEmployeeId, dto.locationId);
      if (!current) {
        throw new NotFoundException(
          `No balance found for employee=${actorEmployeeId} location=${dto.locationId}. Seed via HCM first.`,
        );
      }
      if (!canReserve(current, days)) {
        throw new InsufficientBalanceError(available(current), days);
      }
      const next = reserve(current, days);
      await this.balances.upsertTx(manager, {
        ...current,
        reservedDays: next.reservedDays,
        updatedAt: new Date().toISOString(),
      });

      const now = new Date().toISOString();
      const saved = await this.requests.insertTx(manager, {
        id: randomUUID(),
        employeeId: actorEmployeeId,
        locationId: dto.locationId,
        startDate: dto.startDate,
        endDate: dto.endDate,
        daysRequested: days,
        status: RequestStatus.PENDING,
        reason: dto.reason ?? null,
        createdBy: actor,
        approvedBy: null,
        rejectedReason: null,
        hcmCommitId: null,
        idempotencyKey,
        createdAt: now,
        updatedAt: now,
      });
      await this.audit.record(
        {
          actor,
          action: 'request.created',
          entityType: 'request',
          entityId: saved.id,
          after: saved,
        },
        manager,
      );
      return saved;
    });

    return this.toDto(row);
  }

  async approve(
    requestId: string,
    actor: string,
  ): Promise<RequestDto> {
    const existing = await this.requests.findById(requestId);
    if (!existing) throw new NotFoundException(`request ${requestId} not found`);
    if (existing.status !== RequestStatus.PENDING) {
      throw new ConflictException(`cannot approve request in status ${existing.status}`);
    }

    const approvedRow = await this.balances.withTx(async (manager) => {
      const req = await this.requests.findByIdTx(manager, requestId);
      if (!req) throw new NotFoundException(`request ${requestId} not found`);
      assertTransition(req.status, RequestStatus.APPROVED);
      const updated = await this.requests.updateTx(manager, {
        ...req,
        status: RequestStatus.APPROVED,
        approvedBy: actor,
        updatedAt: new Date().toISOString(),
      });
      await this.audit.record(
        {
          actor,
          action: 'request.approved',
          entityType: 'request',
          entityId: req.id,
          before: { status: req.status },
          after: { status: RequestStatus.APPROVED, approvedBy: actor },
        },
        manager,
      );
      return updated;
    });

    const idempotencyKey = `req-${approvedRow.id}`;
    try {
      const result = await this.hcm.debit(
        approvedRow.employeeId,
        approvedRow.locationId,
        approvedRow.daysRequested,
        idempotencyKey,
      );
      const committed = await this.balances.withTx(async (manager) => {
        const current = await this.balances.findOneTx(
          manager,
          approvedRow.employeeId,
          approvedRow.locationId,
        );
        if (!current) throw new Error('balance missing during commit');
        const next = commitReservation(current, approvedRow.daysRequested);
        await this.balances.upsertTx(manager, {
          ...current,
          balanceDays: next.balanceDays,
          reservedDays: next.reservedDays,
          updatedAt: new Date().toISOString(),
        });
        await this.ledger.insertTx(manager, {
          employeeId: approvedRow.employeeId,
          locationId: approvedRow.locationId,
          delta: -approvedRow.daysRequested,
          type: LedgerEntryType.DEBIT,
          source: LedgerSource.HCM_REALTIME,
          requestId: approvedRow.id,
          actor,
          reason: `HCM debit (commit ${result.commitId})`,
          occurredAt: new Date().toISOString(),
          hcmIdempotencyKey: idempotencyKey,
        });
        const finalRow = await this.requests.updateTx(manager, {
          ...approvedRow,
          status: RequestStatus.COMMITTED,
          hcmCommitId: result.commitId,
          updatedAt: new Date().toISOString(),
        });
        await this.audit.record(
          {
            actor,
            action: 'request.committed',
            entityType: 'request',
            entityId: approvedRow.id,
            before: { status: RequestStatus.APPROVED },
            after: { status: RequestStatus.COMMITTED, commitId: result.commitId },
          },
          manager,
        );
        return finalRow;
      });
      return this.toDto(committed);
    } catch (err) {
      if (err instanceof HcmError) {
        if (!err.retryable) {
          return this.toDto(await this.handleTerminalHcmFailure(approvedRow, err, actor));
        }
        await this.enqueueRetryableDebit(approvedRow, idempotencyKey, actor);
        this.logger.warn(
          `HCM debit for request ${approvedRow.id} failed retryably (${err.code}); queued to outbox`,
        );
        return this.toDto(approvedRow);
      }
      throw err;
    }
  }

  async reject(requestId: string, actor: string, reason?: string): Promise<RequestDto> {
    const updated = await this.balances.withTx(async (manager) => {
      const req = await this.requests.findByIdTx(manager, requestId);
      if (!req) throw new NotFoundException(`request ${requestId} not found`);
      assertTransition(req.status, RequestStatus.REJECTED);
      await this.releaseReservationTx(manager, req);
      const finalRow = await this.requests.updateTx(manager, {
        ...req,
        status: RequestStatus.REJECTED,
        rejectedReason: reason ?? null,
        updatedAt: new Date().toISOString(),
      });
      await this.audit.record(
        {
          actor,
          action: 'request.rejected',
          entityType: 'request',
          entityId: req.id,
          before: { status: req.status },
          after: { status: RequestStatus.REJECTED, reason },
        },
        manager,
      );
      return finalRow;
    });
    return this.toDto(updated);
  }

  async cancel(
    requestId: string,
    actor: string,
    actorEmployeeId: string,
    actorRole: Role,
  ): Promise<RequestDto> {
    const updated = await this.balances.withTx(async (manager) => {
      const req = await this.requests.findByIdTx(manager, requestId);
      if (!req) throw new NotFoundException(`request ${requestId} not found`);
      const canCancelAsPrivileged = actorRole === Role.MANAGER || actorRole === Role.ADMIN;
      if (!canCancelAsPrivileged && req.employeeId !== actorEmployeeId) {
        throw new NotFoundException(`request ${requestId} not found`);
      }
      assertTransition(req.status, RequestStatus.CANCELLED);
      await this.releaseReservationTx(manager, req);
      const finalRow = await this.requests.updateTx(manager, {
        ...req,
        status: RequestStatus.CANCELLED,
        updatedAt: new Date().toISOString(),
      });
      await this.audit.record(
        {
          actor,
          action: 'request.cancelled',
          entityType: 'request',
          entityId: req.id,
          before: { status: req.status },
          after: { status: RequestStatus.CANCELLED },
        },
        manager,
      );
      return finalRow;
    });
    return this.toDto(updated);
  }

  async get(requestId: string): Promise<RequestDto> {
    const row = await this.requests.findById(requestId);
    if (!row) throw new NotFoundException(`request ${requestId} not found`);
    return this.toDto(row);
  }

  async list(filter: { employeeId?: string; status?: RequestStatus }): Promise<RequestDto[]> {
    const rows = await this.requests.list(filter);
    return rows.map((r) => this.toDto(r));
  }

  /**
   * Apply an absolute balance push from HCM. If the new balance drops below
   * currently-reserved pending requests, they are flagged FAILED to avoid
   * silent overbooking, and a refund ledger entry is written.
   */
  async handleHcmAbsoluteBalance(
    manager: EntityManager,
    employeeId: string,
    locationId: string,
    absoluteDays: number,
    source: LedgerSource,
    actor: string,
    asOf: string,
  ): Promise<{ delta: number; flaggedRequestIds: string[] }> {
    const current = (await this.balances.findOneTx(manager, employeeId, locationId)) ?? {
      employeeId,
      locationId,
      balanceDays: 0,
      reservedDays: 0,
      version: 0,
      lastHcmSyncAt: null,
      updatedAt: new Date().toISOString(),
    };
    const deltaUnits = Math.round((absoluteDays - current.balanceDays) * 10);
    const delta = deltaUnits / 10;
    const updated: BalanceRow = {
      ...current,
      balanceDays: absoluteDays,
      lastHcmSyncAt: asOf,
      updatedAt: new Date().toISOString(),
    };
    await this.balances.upsertTx(manager, updated);
    if (delta !== 0) {
      await this.ledger.insertTx(manager, {
        employeeId,
        locationId,
        delta,
        type: LedgerEntryType.HCM_SYNC_ADJUST,
        source,
        requestId: null,
        actor,
        reason: `HCM ${source} absolute sync (delta ${delta})`,
        occurredAt: new Date().toISOString(),
        hcmIdempotencyKey: null,
      });
    }

    const flaggedRequestIds: string[] = [];
    const pending = await this.requests.listPendingReservationsForEmployeeLocation(
      manager,
      employeeId,
      locationId,
    );
    const reservedUnits = pending
      .filter((r) => holdsReservation(r.status))
      .reduce((sum, r) => sum + Math.round(r.daysRequested * 10), 0);
    const absoluteUnits = Math.round(absoluteDays * 10);

    if (reservedUnits > absoluteUnits) {
      // Over-reserved: flag the newest pending requests until total reserved <= absolute.
      const sorted = [...pending].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      let overageUnits = reservedUnits - absoluteUnits;
      for (const req of sorted) {
        if (overageUnits <= 0) break;
        if (!holdsReservation(req.status)) continue;
        const reqUnits = Math.round(req.daysRequested * 10);
        await this.requests.updateTx(manager, {
          ...req,
          status: RequestStatus.FAILED,
          rejectedReason: `HCM absolute balance reduced below reservation`,
          updatedAt: new Date().toISOString(),
        });
        flaggedRequestIds.push(req.id);
        overageUnits -= reqUnits;
      }
      const flaggedSet = new Set(flaggedRequestIds);
      const newReservedUnits = pending
        .filter((r) => !flaggedSet.has(r.id) && holdsReservation(r.status))
        .reduce((sum, r) => sum + Math.round(r.daysRequested * 10), 0);
      await this.balances.upsertTx(manager, {
        ...updated,
        reservedDays: newReservedUnits / 10,
        updatedAt: new Date().toISOString(),
      });
    }

    return { delta, flaggedRequestIds };
  }

  private async enqueueRetryableDebit(
    req: RequestRow,
    idempotencyKey: string,
    actor: string,
  ): Promise<void> {
    await this.balances.withTx(async (manager) => {
      const payload: HcmDebitOutboxPayload = {
        requestId: req.id,
        employeeId: req.employeeId,
        locationId: req.locationId,
        days: req.daysRequested,
        actor,
      };
      await this.outbox.enqueueTx(manager, {
        aggregateType: 'request',
        aggregateId: req.id,
        eventType: OutboxEventType.HCM_DEBIT,
        payload,
        idempotencyKey,
      });
      await this.audit.record(
        {
          actor: 'system',
          action: 'request.outbox_enqueued',
          entityType: 'request',
          entityId: req.id,
          after: { status: req.status, idempotencyKey },
        },
        manager,
      );
    });
  }

  private async handleTerminalHcmFailure(
    req: RequestRow,
    err: HcmError,
    actor: string,
  ): Promise<RequestRow> {
    return this.balances.withTx(async (manager) => {
      const current = await this.balances.findOneTx(manager, req.employeeId, req.locationId);
      if (current) {
        const next = releaseReservation(current, req.daysRequested);
        await this.balances.upsertTx(manager, {
          ...current,
          reservedDays: next.reservedDays,
          updatedAt: new Date().toISOString(),
        });
      }
      const updated = await this.requests.updateTx(manager, {
        ...req,
        status: RequestStatus.FAILED,
        rejectedReason: `HCM: ${err.code} ${err.message}`,
        updatedAt: new Date().toISOString(),
      });
      // If HCM contradicts us on balance, record a refund ledger entry that reflects the correction
      if (err.code === 'INSUFFICIENT_BALANCE' && current) {
        await this.ledger.insertTx(manager, {
          employeeId: req.employeeId,
          locationId: req.locationId,
          delta: 0,
          type: LedgerEntryType.HCM_SYNC_ADJUST,
          source: LedgerSource.HCM_REALTIME,
          requestId: req.id,
          actor,
          reason: 'HCM rejected debit as insufficient; reservation released',
          occurredAt: new Date().toISOString(),
          hcmIdempotencyKey: null,
        });
      }
      await this.audit.record(
        {
          actor,
          action: 'request.failed',
          entityType: 'request',
          entityId: req.id,
          before: { status: req.status },
          after: { status: RequestStatus.FAILED, reason: err.code },
        },
        manager,
      );
      return updated;
    });
  }

  private async releaseReservationTx(manager: EntityManager, req: RequestRow): Promise<void> {
    const current = await this.balances.findOneTx(manager, req.employeeId, req.locationId);
    if (!current) return;
    const next = releaseReservation(current, req.daysRequested);
    await this.balances.upsertTx(manager, {
      ...current,
      balanceDays: current.balanceDays,
      reservedDays: next.reservedDays,
      updatedAt: new Date().toISOString(),
    });
  }

  private toDto(row: RequestRow): RequestDto {
    return {
      id: row.id,
      employeeId: row.employeeId,
      locationId: row.locationId,
      startDate: row.startDate,
      endDate: row.endDate,
      daysRequested: row.daysRequested,
      status: row.status,
      reason: row.reason,
      createdBy: row.createdBy,
      approvedBy: row.approvedBy,
      rejectedReason: row.rejectedReason,
      hcmCommitId: row.hcmCommitId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
