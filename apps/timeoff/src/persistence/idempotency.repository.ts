import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { IdempotencyRecordEntity } from './entities/idempotency-record.entity';

export interface IdempotencyRow {
  key: string;
  method: string;
  path: string;
  requestHash: string;
  responseStatus: number;
  responseBody: string;
  createdAt: string;
}

@Injectable()
export class IdempotencyRepository {
  constructor(
    @InjectRepository(IdempotencyRecordEntity)
    private readonly repo: Repository<IdempotencyRecordEntity>,
  ) {}

  async findByKey(key: string): Promise<IdempotencyRow | null> {
    return this.repo.findOne({ where: { key } });
  }

  async insert(row: IdempotencyRow): Promise<void> {
    await this.repo.save(row);
  }
}
