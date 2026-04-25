import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OutboxRepository, OutboxRow } from '../persistence/outbox.repository';
import { OutboxEventEntity, OutboxStatus } from '../persistence/entities/outbox-event.entity';
import { OutboxEventType } from './outbox.types';

@Injectable()
export class OutboxService {
  constructor(private readonly repo: OutboxRepository) {}

  async enqueueTx<T>(
    manager: EntityManager,
    args: {
      aggregateType: string;
      aggregateId: string;
      eventType: OutboxEventType;
      payload: T;
      idempotencyKey: string;
    },
  ): Promise<OutboxRow> {
    const now = new Date().toISOString();
    let existing: OutboxRow | null = null;
    try {
      existing = (await manager
        .getRepository(OutboxEventEntity)
        .findOne({ where: { idempotencyKey: args.idempotencyKey } })) as OutboxRow | null;
    } catch {
      existing = null;
    }
    if (existing) {
      return existing;
    }
    return this.repo.insertTx(manager, {
      aggregateType: args.aggregateType,
      aggregateId: args.aggregateId,
      eventType: args.eventType,
      payload: JSON.stringify(args.payload),
      status: OutboxStatus.PENDING,
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
      idempotencyKey: args.idempotencyKey,
      createdAt: now,
      updatedAt: now,
    });
  }

  async markDone(row: OutboxRow): Promise<void> {
    await this.repo.update({
      ...row,
      status: OutboxStatus.DONE,
      lastError: null,
      updatedAt: new Date().toISOString(),
    });
  }

  async markFailed(row: OutboxRow, err: Error, nextAttemptAt: Date, maxAttempts: number): Promise<void> {
    const attempts = row.attempts + 1;
    const status = attempts >= maxAttempts ? OutboxStatus.DEAD : OutboxStatus.PENDING;
    await this.repo.update({
      ...row,
      attempts,
      status,
      lastError: `${err.name}: ${err.message}`,
      nextAttemptAt: nextAttemptAt.toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async markProcessing(row: OutboxRow): Promise<void> {
    await this.repo.update({
      ...row,
      status: OutboxStatus.PROCESSING,
      updatedAt: new Date().toISOString(),
    });
  }

  async findDue(limit = 25, now: Date = new Date()): Promise<OutboxRow[]> {
    return this.repo.findDue(now, limit);
  }

  async listAll(): Promise<OutboxRow[]> {
    return this.repo.listAll();
  }
}
