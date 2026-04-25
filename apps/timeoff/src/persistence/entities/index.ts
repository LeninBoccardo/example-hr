import { BalanceSnapshotEntity } from './balance-snapshot.entity';
import { LedgerEntryEntity } from './ledger-entry.entity';
import { TimeOffRequestEntity } from './time-off-request.entity';
import { OutboxEventEntity } from './outbox-event.entity';
import { AuditLogEntity } from './audit-log.entity';
import { IdempotencyRecordEntity } from './idempotency-record.entity';

export {
  BalanceSnapshotEntity,
  LedgerEntryEntity,
  TimeOffRequestEntity,
  OutboxEventEntity,
  AuditLogEntity,
  IdempotencyRecordEntity,
};

export const entities = [
  BalanceSnapshotEntity,
  LedgerEntryEntity,
  TimeOffRequestEntity,
  OutboxEventEntity,
  AuditLogEntity,
  IdempotencyRecordEntity,
];
