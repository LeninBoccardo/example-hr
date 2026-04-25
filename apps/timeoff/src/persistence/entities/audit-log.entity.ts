import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_log')
@Index('idx_audit_entity', ['entityType', 'entityId'])
@Index('idx_audit_occurred', ['occurredAt'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ name: 'actor', type: 'text' })
  actor!: string;

  @Column({ name: 'action', type: 'text' })
  action!: string;

  @Column({ name: 'entity_type', type: 'text' })
  entityType!: string;

  @Column({ name: 'entity_id', type: 'text' })
  entityId!: string;

  @Column({ name: 'before_json', type: 'text', nullable: true })
  beforeJson!: string | null;

  @Column({ name: 'after_json', type: 'text', nullable: true })
  afterJson!: string | null;

  @Column({ name: 'occurred_at', type: 'text' })
  occurredAt!: string;
}
