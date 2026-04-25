import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { BalanceRepository } from '../persistence/balance.repository';
import { HcmClient } from '../hcm/hcm.client';
import { RequestsService } from '../requests/requests.service';
import { LedgerSource } from '../domain/ledger';
import { BatchIngestDto, BatchIngestResultDto } from './dto/batch-ingest.dto';
import { AppConfig } from '../config/config.schema';

export interface ReconciliationResult {
  scanned: number;
  drifted: number;
  flaggedRequestIds: string[];
  errors: number;
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private readonly cronEnabled: boolean;

  constructor(
    private readonly config: ConfigService<AppConfig>,
    private readonly balances: BalanceRepository,
    private readonly hcm: HcmClient,
    private readonly requestsService: RequestsService,
  ) {
    this.cronEnabled = config.get<boolean>('RECONCILE_CRON_ENABLED', { infer: true }) ?? false;
  }

  async ingestBatch(dto: BatchIngestDto, actor: string): Promise<BatchIngestResultDto> {
    let changed = 0;
    const flagged: string[] = [];
    await this.balances.withTx(async (manager) => {
      for (const entry of dto.entries) {
        const { delta, flaggedRequestIds } = await this.requestsService.handleHcmAbsoluteBalance(
          manager,
          entry.employeeId,
          entry.locationId,
          entry.balance,
          LedgerSource.HCM_BATCH,
          actor,
          dto.asOf,
        );
        if (delta !== 0) changed += 1;
        flagged.push(...flaggedRequestIds);
      }
    });
    this.logger.log(
      `Batch ${dto.batchId}: processed ${dto.entries.length} entries, ${changed} changed, flagged ${flagged.length} requests`,
    );
    return {
      batchId: dto.batchId,
      processedCount: dto.entries.length,
      changedCount: changed,
      flaggedRequestIds: flagged,
    };
  }

  async reconcile(actor: string): Promise<ReconciliationResult> {
    const all = await this.balances.listAll();
    const result: ReconciliationResult = { scanned: 0, drifted: 0, flaggedRequestIds: [], errors: 0 };
    for (const row of all) {
      result.scanned += 1;
      try {
        const hcm = await this.hcm.getBalance(row.employeeId, row.locationId);
        if (Math.round(hcm.balance * 10) !== Math.round(row.balanceDays * 10)) {
          await this.balances.withTx(async (manager) => {
            const { delta, flaggedRequestIds } = await this.requestsService.handleHcmAbsoluteBalance(
              manager,
              row.employeeId,
              row.locationId,
              hcm.balance,
              LedgerSource.HCM_REALTIME,
              actor,
              hcm.asOf,
            );
            if (delta !== 0) result.drifted += 1;
            result.flaggedRequestIds.push(...flaggedRequestIds);
          });
        }
      } catch (err) {
        this.logger.warn(
          `reconcile failed for ${row.employeeId}/${row.locationId}: ${(err as Error).message}`,
        );
        result.errors += 1;
      }
    }
    return result;
  }

  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'reconcileCron' })
  async scheduled(): Promise<void> {
    if (!this.cronEnabled) return;
    await this.reconcile('system:cron').catch((err) =>
      this.logger.error(`scheduled reconcile failed: ${(err as Error).message}`),
    );
  }
}
