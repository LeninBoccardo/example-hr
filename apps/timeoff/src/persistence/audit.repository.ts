import { Injectable } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogEntity } from './entities/audit-log.entity';

export interface AuditRow {
  id?: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson: string | null;
  afterJson: string | null;
  occurredAt: string;
}

@Injectable()
export class AuditRepository {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repo: Repository<AuditLogEntity>,
  ) {}

  async insert(row: AuditRow): Promise<AuditRow> {
    return this.repo.save(row as AuditLogEntity);
  }

  async insertTx(manager: EntityManager, row: AuditRow): Promise<AuditRow> {
    return manager.getRepository(AuditLogEntity).save(row as AuditLogEntity);
  }

  async listForEntity(entityType: string, entityId: string): Promise<AuditRow[]> {
    return this.repo.find({
      where: { entityType, entityId },
      order: { occurredAt: 'ASC' },
    });
  }

  async listAll(): Promise<AuditRow[]> {
    return this.repo.find({ order: { occurredAt: 'DESC' } });
  }
}
