import { OutboxService } from '@timeoff/outbox/outbox.service';
import { OutboxStatus } from '@timeoff/persistence/entities/outbox-event.entity';
import { OutboxEventType } from '@timeoff/outbox/outbox.types';

function buildService(repo: Record<string, jest.Mock>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new OutboxService(repo as any);
}

function managerStub(opts: { findOne?: jest.Mock; throwOnFind?: boolean }) {
  return {
    getRepository: () => ({
      findOne: opts.throwOnFind
        ? jest.fn(() => {
            throw new Error('repo missing');
          })
        : opts.findOne ?? jest.fn().mockResolvedValue(null),
    }),
  };
}

describe('OutboxService', () => {
  it('enqueueTx returns existing row when idempotency key already present', async () => {
    const existing = {
      id: 'OB-existing',
      aggregateType: 'request',
      aggregateId: 'R-1',
      eventType: 'HCM_DEBIT',
      payload: '{}',
      status: OutboxStatus.PENDING,
      attempts: 0,
      nextAttemptAt: 't',
      lastError: null,
      idempotencyKey: 'reused-key',
      createdAt: 't',
      updatedAt: 't',
    };
    const repo = {
      insertTx: jest.fn(),
      findDue: jest.fn(),
      listAll: jest.fn(),
      update: jest.fn(),
      findById: jest.fn(),
    };
    const svc = buildService(repo);
    const manager = managerStub({ findOne: jest.fn().mockResolvedValue(existing) });
    const result = await svc.enqueueTx(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manager as any,
      {
        aggregateType: 'request',
        aggregateId: 'R-1',
        eventType: OutboxEventType.HCM_DEBIT,
        payload: { x: 1 },
        idempotencyKey: 'reused-key',
      },
    );
    expect(result.id).toBe('OB-existing');
    expect(repo.insertTx).not.toHaveBeenCalled();
  });

  it('enqueueTx swallows findOne errors (sync or async) and falls through to insert', async () => {
    const repo = {
      insertTx: jest.fn().mockResolvedValue({ id: 'OB-new', idempotencyKey: 'k' }),
      findDue: jest.fn(),
      listAll: jest.fn(),
      update: jest.fn(),
      findById: jest.fn(),
    };
    const svc = buildService(repo);

    // case 1: sync throw from findOne (e.g., entity name not registered)
    const syncManager = managerStub({ throwOnFind: true });
    const r1 = await svc.enqueueTx(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      syncManager as any,
      {
        aggregateType: 'request', aggregateId: 'R-1',
        eventType: OutboxEventType.HCM_DEBIT,
        payload: { x: 1 }, idempotencyKey: 'k1',
      },
    );
    expect(r1.id).toBe('OB-new');

    // case 2: async rejection from findOne (e.g., DB error)
    const asyncManager = managerStub({ findOne: jest.fn().mockRejectedValue(new Error('db down')) });
    repo.insertTx.mockResolvedValueOnce({ id: 'OB-new-2', idempotencyKey: 'k2' });
    const r2 = await svc.enqueueTx(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      asyncManager as any,
      {
        aggregateType: 'request', aggregateId: 'R-2',
        eventType: OutboxEventType.HCM_DEBIT,
        payload: { x: 2 }, idempotencyKey: 'k2',
      },
    );
    expect(r2.id).toBe('OB-new-2');
    expect(repo.insertTx).toHaveBeenCalledTimes(2);
  });

  it('markDone sets status to DONE and clears lastError', async () => {
    const repo = {
      update: jest.fn().mockImplementation(async (r) => r),
      insertTx: jest.fn(),
      findDue: jest.fn(),
      listAll: jest.fn(),
      findById: jest.fn(),
    };
    const svc = buildService(repo);
    await svc.markDone({
      id: 'OB-1', aggregateType: 'r', aggregateId: 'a',
      eventType: 'HCM_DEBIT', payload: '{}',
      status: OutboxStatus.PROCESSING, attempts: 1,
      nextAttemptAt: 't', lastError: 'old',
      idempotencyKey: 'k', createdAt: 't', updatedAt: 't',
    });
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: OutboxStatus.DONE, lastError: null }),
    );
  });

  it('markFailed promotes to DEAD when attempts reach maxAttempts', async () => {
    const repo = {
      update: jest.fn().mockResolvedValue(undefined),
      insertTx: jest.fn(), findDue: jest.fn(), listAll: jest.fn(), findById: jest.fn(),
    };
    const svc = buildService(repo);
    const row = {
      id: 'OB-1', aggregateType: 'r', aggregateId: 'a',
      eventType: 'HCM_DEBIT', payload: '{}',
      status: OutboxStatus.PROCESSING, attempts: 2, // already at 2; maxAttempts=3 → after this call, becomes 3 → DEAD
      nextAttemptAt: 't', lastError: null,
      idempotencyKey: 'k', createdAt: 't', updatedAt: 't',
    };
    await svc.markFailed(row, new Error('boom'), new Date(), 3);
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: OutboxStatus.DEAD, attempts: 3 }),
    );
  });

  it('markFailed keeps status PENDING when below maxAttempts', async () => {
    const repo = {
      update: jest.fn().mockResolvedValue(undefined),
      insertTx: jest.fn(), findDue: jest.fn(), listAll: jest.fn(), findById: jest.fn(),
    };
    const svc = buildService(repo);
    const row = {
      id: 'OB-1', aggregateType: 'r', aggregateId: 'a',
      eventType: 'HCM_DEBIT', payload: '{}',
      status: OutboxStatus.PROCESSING, attempts: 0,
      nextAttemptAt: 't', lastError: null,
      idempotencyKey: 'k', createdAt: 't', updatedAt: 't',
    };
    await svc.markFailed(row, new Error('first'), new Date(), 5);
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: OutboxStatus.PENDING, attempts: 1, lastError: 'Error: first' }),
    );
  });
});
