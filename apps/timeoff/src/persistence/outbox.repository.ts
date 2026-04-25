import { Injectable } from '@nestjs/common';
import { EntityManager, LessThanOrEqual, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { OutboxEventEntity, OutboxStatus } from './entities/outbox-event.entity';

export interface OutboxRow {
  id?: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: string;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class OutboxRepository {
  constructor(
    @InjectRepository(OutboxEventEntity)
    private readonly repo: Repository<OutboxEventEntity>,
  ) {}

  async insert(row: OutboxRow): Promise<OutboxRow> {
    return this.repo.save(row as OutboxEventEntity);
  }

  async insertTx(manager: EntityManager, row: OutboxRow): Promise<OutboxRow> {
    return manager.getRepository(OutboxEventEntity).save(row as OutboxEventEntity);
  }

  async findDue(now: Date, limit = 25): Promise<OutboxRow[]> {
    return this.repo.find({
      where: { status: OutboxStatus.PENDING, nextAttemptAt: LessThanOrEqual(now.toISOString()) },
      order: { nextAttemptAt: 'ASC' },
      take: limit,
    });
  }

  async findByIdempotencyKey(key: string): Promise<OutboxRow | null> {
    return this.repo.findOne({ where: { idempotencyKey: key } });
  }

  async listAll(): Promise<OutboxRow[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async update(row: OutboxRow): Promise<OutboxRow> {
    return this.repo.save(row as OutboxEventEntity);
  }

  async findById(id: string): Promise<OutboxRow | null> {
    return this.repo.findOne({ where: { id } });
  }
}
