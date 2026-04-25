import { Injectable, NotFoundException } from '@nestjs/common';
import { BalanceRepository, BalanceRow } from '../persistence/balance.repository';
import { LedgerRepository } from '../persistence/ledger.repository';
import { HcmClient } from '../hcm/hcm.client';
import { AuditService } from '../audit/audit.service';
import { available, setAbsolute } from '../domain/balance';
import { LedgerEntryType, LedgerSource } from '../domain/ledger';
import { BalanceDto } from './dto/balance.dto';

@Injectable()
export class BalanceService {
  constructor(
    private readonly balances: BalanceRepository,
    private readonly ledger: LedgerRepository,
    private readonly hcm: HcmClient,
    private readonly audit: AuditService,
  ) {}

  async getBalance(employeeId: string, locationId: string): Promise<BalanceDto> {
    const row = await this.balances.findOne(employeeId, locationId);
    if (!row) {
      throw new NotFoundException(
        `No balance found for employee=${employeeId} location=${locationId}`,
      );
    }
    return this.toDto(row, 'LOCAL');
  }

  async refreshFromHcm(
    employeeId: string,
    locationId: string,
    actor: string,
  ): Promise<BalanceDto> {
    const hcmBalance = await this.hcm.getBalance(employeeId, locationId);
    const row = await this.balances.withTx(async (manager) => {
      const current = await this.balances.findOneTx(manager, employeeId, locationId);
      const state = current ?? {
        employeeId,
        locationId,
        balanceDays: 0,
        reservedDays: 0,
        version: 0,
        lastHcmSyncAt: null,
        updatedAt: new Date().toISOString(),
      };
      const { next, delta } = setAbsolute(state, hcmBalance.balance);
      const updated: BalanceRow = {
        employeeId,
        locationId,
        balanceDays: next.balanceDays,
        reservedDays: next.reservedDays,
        version: state.version,
        lastHcmSyncAt: hcmBalance.asOf,
        updatedAt: new Date().toISOString(),
      };
      await this.balances.upsertTx(manager, updated);
      if (delta !== 0 || !current) {
        await this.ledger.insertTx(manager, {
          employeeId,
          locationId,
          delta,
          type: LedgerEntryType.HCM_SYNC_ADJUST,
          source: LedgerSource.HCM_REALTIME,
          requestId: null,
          actor,
          reason: `Refresh from HCM realtime (asOf ${hcmBalance.asOf})`,
          occurredAt: new Date().toISOString(),
          hcmIdempotencyKey: null,
        });
      }
      await this.audit.record(
        {
          actor,
          action: 'balance.refresh',
          entityType: 'balance',
          entityId: `${employeeId}/${locationId}`,
          before: current,
          after: updated,
        },
        manager,
      );
      return updated;
    });
    return this.toDto(row, 'HCM_REFRESH');
  }

  private toDto(row: BalanceRow, source: 'LOCAL' | 'HCM_REFRESH'): BalanceDto {
    return {
      employeeId: row.employeeId,
      locationId: row.locationId,
      balanceDays: row.balanceDays,
      reservedDays: row.reservedDays,
      availableDays: available(row),
      lastHcmSyncAt: row.lastHcmSyncAt,
      source,
    };
  }
}
