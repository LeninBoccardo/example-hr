import { Injectable } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { LedgerEntryEntity } from './entities/ledger-entry.entity';
import { LedgerEntryType, LedgerSource } from '../domain/ledger';

export interface LedgerRow {
  id?: string;
  employeeId: string;
  locationId: string;
  delta: number;
  type: LedgerEntryType;
  source: LedgerSource;
  requestId: string | null;
  actor: string | null;
  reason: string | null;
  occurredAt: string;
  hcmIdempotencyKey: string | null;
}

@Injectable()
export class LedgerRepository {
  constructor(
    @InjectRepository(LedgerEntryEntity)
    private readonly repo: Repository<LedgerEntryEntity>,
  ) {}

  async insert(row: LedgerRow): Promise<LedgerRow> {
    const saved = await this.repo.save(row);
    return saved;
  }

  async insertTx(manager: EntityManager, row: LedgerRow): Promise<LedgerRow> {
    return manager.getRepository(LedgerEntryEntity).save(row);
  }

  async listByRequest(requestId: string): Promise<LedgerRow[]> {
    return this.repo.find({ where: { requestId }, order: { occurredAt: 'ASC' } });
  }

  async listByEmployeeLocation(employeeId: string, locationId: string): Promise<LedgerRow[]> {
    return this.repo.find({
      where: { employeeId, locationId },
      order: { occurredAt: 'ASC' },
    });
  }

  async existsWithIdempotencyKey(key: string): Promise<boolean> {
    const count = await this.repo.count({ where: { hcmIdempotencyKey: key } });
    return count > 0;
  }
}
