import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/config.schema';
import { OutboxService } from './outbox.service';
import { OutboxEventType, HcmDebitOutboxPayload } from './outbox.types';
import { HcmClient } from '../hcm/hcm.client';
import { BalanceRepository } from '../persistence/balance.repository';
import { LedgerRepository } from '../persistence/ledger.repository';
import { RequestRepository } from '../persistence/request.repository';
import { AuditService } from '../audit/audit.service';
import { commitReservation } from '../domain/balance';
import { RequestStatus, assertTransition, canTransition } from '../domain/request';
import { LedgerEntryType, LedgerSource } from '../domain/ledger';
import { HcmError } from '../hcm/hcm.errors';

@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly intervalMs: number;
  private readonly maxAttempts: number;
  private readonly enabled: boolean;

  constructor(
    config: ConfigService<AppConfig>,
    private readonly outbox: OutboxService,
    private readonly hcm: HcmClient,
    private readonly balances: BalanceRepository,
    private readonly ledger: LedgerRepository,
    private readonly requests: RequestRepository,
    private readonly audit: AuditService,
  ) {
    this.intervalMs = config.get<number>('OUTBOX_POLL_INTERVAL_MS', { infer: true })!;
    this.maxAttempts = config.get<number>('OUTBOX_MAX_ATTEMPTS', { infer: true })!;
    this.enabled = config.get<boolean>('OUTBOX_WORKER_ENABLED', { infer: true }) ?? true;
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Outbox worker disabled by config');
      return;
    }
    this.schedule();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      this.tick()
        .catch((err) => this.logger.error(`tick failed: ${(err as Error).message}`))
        .finally(() => {
          if (this.enabled) {
            this.schedule();
          }
        });
    }, this.intervalMs);
  }

  async drainOnce(): Promise<number> {
    return this.tick();
  }

  private async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await this.outbox.findDue(25);
      let processed = 0;
      for (const row of due) {
        await this.processOne(row);
        processed += 1;
      }
      return processed;
    } finally {
      this.running = false;
    }
  }

  private async processOne(row: import('../persistence/outbox.repository').OutboxRow): Promise<void> {
    await this.outbox.markProcessing(row);
    try {
      if (row.eventType === OutboxEventType.HCM_DEBIT) {
        await this.handleDebit(row, JSON.parse(row.payload) as HcmDebitOutboxPayload);
      } else {
        this.logger.warn(`unknown outbox event type: ${row.eventType}`);
      }
      await this.outbox.markDone(row);
    } catch (err) {
      // Terminal HCM errors (insufficient balance, invalid dimension) cannot
      // succeed on retry — fail the request immediately and stop the outbox
      // from looping until DEAD.
      if (err instanceof HcmError && !err.retryable) {
        await this.handleTerminalHcmFailure(row, err);
        this.logger.warn(
          `outbox ${row.id} terminal HCM failure (${err.code}): request marked FAILED`,
        );
        return;
      }
      const error = err as Error;
      const nextAttempt = new Date(Date.now() + this.backoffMs(row.attempts + 1));
      await this.outbox.markFailed(row, error, nextAttempt, this.maxAttempts);
      this.logger.warn(
        `outbox ${row.id} failed (attempt ${row.attempts + 1}/${this.maxAttempts}): ${error.message}`,
      );
    }
  }

  private backoffMs(attempt: number): number {
    return Math.min(60_000, 500 * Math.pow(2, attempt - 1));
  }

  private async handleDebit(
    row: import('../persistence/outbox.repository').OutboxRow,
    payload: HcmDebitOutboxPayload,
  ): Promise<void> {
    const result = await this.hcm.debit(
      payload.employeeId,
      payload.locationId,
      payload.days,
      row.idempotencyKey,
    );

    await this.balances.withTx(async (manager) => {
      const req = await this.requests.findByIdTx(manager, payload.requestId);
      if (!req) {
        throw new Error(`request ${payload.requestId} not found during outbox commit`);
      }
      if (!canTransition(req.status, RequestStatus.COMMITTED)) {
        // Already committed or cancelled — idempotent no-op on the local side.
        return;
      }
      assertTransition(req.status, RequestStatus.COMMITTED);

      const current = await this.balances.findOneTx(manager, payload.employeeId, payload.locationId);
      if (!current) {
        throw new Error('balance missing during commit');
      }
      const next = commitReservation(current, payload.days);
      await this.balances.upsertTx(manager, {
        ...current,
        balanceDays: next.balanceDays,
        reservedDays: next.reservedDays,
        updatedAt: new Date().toISOString(),
      });
      await this.ledger.insertTx(manager, {
        employeeId: payload.employeeId,
        locationId: payload.locationId,
        delta: -payload.days,
        type: LedgerEntryType.DEBIT,
        source: LedgerSource.HCM_REALTIME,
        requestId: payload.requestId,
        actor: payload.actor,
        reason: `HCM debit via outbox (commit ${result.commitId})`,
        occurredAt: new Date().toISOString(),
        hcmIdempotencyKey: row.idempotencyKey,
      });
      await this.requests.updateTx(manager, {
        ...req,
        status: RequestStatus.COMMITTED,
        hcmCommitId: result.commitId,
        updatedAt: new Date().toISOString(),
      });
      await this.audit.record(
        {
          actor: 'system:outbox',
          action: 'request.committed',
          entityType: 'request',
          entityId: payload.requestId,
          before: { status: req.status },
          after: { status: RequestStatus.COMMITTED, commitId: result.commitId },
        },
        manager,
      );
    });
  }

  /**
   * If HCM returns a terminal business error (insufficient, invalid dimension)
   * the outbox should stop retrying and mark the request FAILED.
   */
  async handleTerminalHcmFailure(
    row: import('../persistence/outbox.repository').OutboxRow,
    err: HcmError,
  ): Promise<void> {
    const payload = JSON.parse(row.payload) as HcmDebitOutboxPayload;
    await this.balances.withTx(async (manager) => {
      const req = await this.requests.findByIdTx(manager, payload.requestId);
      if (!req) return;
      if (canTransition(req.status, RequestStatus.FAILED)) {
        // release reservation + refund ledger
        const current = await this.balances.findOneTx(manager, payload.employeeId, payload.locationId);
        if (current) {
          const reservedUnits = Math.round(current.reservedDays * 10);
          const requestedUnits = Math.round(payload.days * 10);
          const newReserved = Math.max(0, reservedUnits - requestedUnits) / 10;
          await this.balances.upsertTx(manager, {
            ...current,
            reservedDays: newReserved,
            updatedAt: new Date().toISOString(),
          });
        }
        await this.requests.updateTx(manager, {
          ...req,
          status: RequestStatus.FAILED,
          rejectedReason: `HCM: ${err.code} ${err.message}`,
          updatedAt: new Date().toISOString(),
        });
        await this.audit.record(
          {
            actor: 'system:outbox',
            action: 'request.failed',
            entityType: 'request',
            entityId: payload.requestId,
            before: { status: req.status },
            after: { status: RequestStatus.FAILED, reason: err.code },
          },
          manager,
        );
      }
    });
    await this.outbox.markDone(row);
  }
}
