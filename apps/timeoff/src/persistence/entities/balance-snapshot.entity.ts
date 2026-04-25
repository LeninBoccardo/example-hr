import { Column, Entity, Index, PrimaryColumn, VersionColumn } from 'typeorm';

@Entity('balance_snapshots')
@Index('idx_balance_last_sync', ['lastHcmSyncAt'])
export class BalanceSnapshotEntity {
  @PrimaryColumn({ name: 'employee_id', type: 'text' })
  employeeId!: string;

  @PrimaryColumn({ name: 'location_id', type: 'text' })
  locationId!: string;

  @Column({ name: 'balance_days', type: 'real', default: 0 })
  balanceDays!: number;

  @Column({ name: 'reserved_days', type: 'real', default: 0 })
  reservedDays!: number;

  @VersionColumn({ name: 'version' })
  version!: number;

  @Column({ name: 'last_hcm_sync_at', type: 'text', nullable: true })
  lastHcmSyncAt!: string | null;

  @Column({ name: 'updated_at', type: 'text' })
  updatedAt!: string;
}
