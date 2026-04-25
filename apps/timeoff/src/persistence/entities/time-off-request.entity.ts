import { Column, Entity, Index, PrimaryGeneratedColumn, VersionColumn } from 'typeorm';
import { RequestStatus } from '../../domain/request';

@Entity('time_off_requests')
@Index('idx_request_employee_status', ['employeeId', 'status'])
@Index('idx_request_status', ['status'])
export class TimeOffRequestEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ name: 'employee_id', type: 'text' })
  employeeId!: string;

  @Column({ name: 'location_id', type: 'text' })
  locationId!: string;

  @Column({ name: 'start_date', type: 'text' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'text' })
  endDate!: string;

  @Column({ name: 'days_requested', type: 'real' })
  daysRequested!: number;

  @Column({ name: 'status', type: 'text' })
  status!: RequestStatus;

  @Column({ name: 'reason', type: 'text', nullable: true })
  reason!: string | null;

  @Column({ name: 'created_by', type: 'text' })
  createdBy!: string;

  @Column({ name: 'approved_by', type: 'text', nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'rejected_reason', type: 'text', nullable: true })
  rejectedReason!: string | null;

  @Column({ name: 'hcm_commit_id', type: 'text', nullable: true })
  hcmCommitId!: string | null;

  @Column({ name: 'idempotency_key', type: 'text', nullable: true, unique: true })
  idempotencyKey!: string | null;

  @Column({ name: 'created_at', type: 'text' })
  createdAt!: string;

  @Column({ name: 'updated_at', type: 'text' })
  updatedAt!: string;

  @VersionColumn({ name: 'version' })
  version!: number;
}
