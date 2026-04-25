import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { LedgerEntryType, LedgerSource } from '../../domain/ledger';

@Entity('balance_ledger')
@Index('idx_ledger_employee_location', ['employeeId', 'locationId'])
@Index('idx_ledger_request', ['requestId'])
@Index('idx_ledger_idempotency', ['hcmIdempotencyKey'], { unique: true, where: 'hcm_idempotency_key IS NOT NULL' })
export class LedgerEntryEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ name: 'employee_id', type: 'text' })
  employeeId!: string;

  @Column({ name: 'location_id', type: 'text' })
  locationId!: string;

  @Column({ name: 'delta', type: 'real' })
  delta!: number;

  @Column({ name: 'type', type: 'text' })
  type!: LedgerEntryType;

  @Column({ name: 'source', type: 'text' })
  source!: LedgerSource;

  @Column({ name: 'request_id', type: 'text', nullable: true })
  requestId!: string | null;

  @Column({ name: 'actor', type: 'text', nullable: true })
  actor!: string | null;

  @Column({ name: 'reason', type: 'text', nullable: true })
  reason!: string | null;

  @Column({ name: 'occurred_at', type: 'text' })
  occurredAt!: string;

  @Column({ name: 'hcm_idempotency_key', type: 'text', nullable: true })
  hcmIdempotencyKey!: string | null;
}
