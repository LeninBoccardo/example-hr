import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('idempotency_records')
@Index('idx_idempotency_created', ['createdAt'])
export class IdempotencyRecordEntity {
  @PrimaryColumn({ name: 'key', type: 'text' })
  key!: string;

  @Column({ name: 'method', type: 'text' })
  method!: string;

  @Column({ name: 'path', type: 'text' })
  path!: string;

  @Column({ name: 'request_hash', type: 'text' })
  requestHash!: string;

  @Column({ name: 'response_status', type: 'integer' })
  responseStatus!: number;

  @Column({ name: 'response_body', type: 'text' })
  responseBody!: string;

  @Column({ name: 'created_at', type: 'text' })
  createdAt!: string;
}
