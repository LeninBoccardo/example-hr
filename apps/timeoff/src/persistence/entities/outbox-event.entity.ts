import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum OutboxStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  DONE = 'DONE',
  DEAD = 'DEAD',
}

@Entity('outbox_events')
@Index('idx_outbox_status_next', ['status', 'nextAttemptAt'])
@Index('idx_outbox_idempotency', ['idempotencyKey'], { unique: true })
export class OutboxEventEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ name: 'aggregate_type', type: 'text' })
  aggregateType!: string;

  @Column({ name: 'aggregate_id', type: 'text' })
  aggregateId!: string;

  @Column({ name: 'event_type', type: 'text' })
  eventType!: string;

  @Column({ name: 'payload', type: 'text' })
  payload!: string; // JSON-serialized

  @Column({ name: 'status', type: 'text', default: OutboxStatus.PENDING })
  status!: OutboxStatus;

  @Column({ name: 'attempts', type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'next_attempt_at', type: 'text' })
  nextAttemptAt!: string;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'idempotency_key', type: 'text' })
  idempotencyKey!: string;

  @Column({ name: 'created_at', type: 'text' })
  createdAt!: string;

  @Column({ name: 'updated_at', type: 'text' })
  updatedAt!: string;
}
