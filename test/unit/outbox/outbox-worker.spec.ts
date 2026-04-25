import { ConfigService } from '@nestjs/config';
import { OutboxWorker } from '@timeoff/outbox/outbox.worker';
import { OutboxEventType } from '@timeoff/outbox/outbox.types';
import { OutboxStatus } from '@timeoff/persistence/entities/outbox-event.entity';
import { HcmError } from '@timeoff/hcm/hcm.errors';
import { RequestStatus } from '@timeoff/domain/request';

type AnyFn = (...args: unknown[]) => unknown;

function configStub(values: Record<string, unknown>): ConfigService {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: ((key: string) => values[key]) as any,
  } as ConfigService;
}

describe('OutboxWorker (unit)', () => {
  const baseRow = () => ({
    id: 'OB-1',
    aggregateType: 'request',
    aggregateId: 'R-1',
    eventType: OutboxEventType.HCM_DEBIT,
    payload: JSON.stringify({
      requestId: 'R-1',
      employeeId: 'E1',
      locationId: 'NY',
      days: 2,
      actor: 'mgr-1',
    }),
    status: OutboxStatus.PENDING,
    attempts: 0,
    nextAttemptAt: new Date().toISOString(),
    lastError: null,
    idempotencyKey: 'idem-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  function buildWorker(opts: {
    config?: Record<string, unknown>;
    outbox?: Partial<Record<string, AnyFn>>;
    hcm?: Partial<Record<string, AnyFn>>;
    balances?: Partial<Record<string, AnyFn>>;
    ledger?: Partial<Record<string, AnyFn>>;
    requests?: Partial<Record<string, AnyFn>>;
    audit?: Partial<Record<string, AnyFn>>;
  }) {
    const config = configStub({
      OUTBOX_POLL_INTERVAL_MS: 50,
      OUTBOX_MAX_ATTEMPTS: 3,
      OUTBOX_WORKER_ENABLED: false,
      ...(opts.config ?? {}),
    });
    const outbox = {
      findDue: jest.fn().mockResolvedValue([]),
      markProcessing: jest.fn().mockResolvedValue(undefined),
      markDone: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      ...(opts.outbox ?? {}),
    };
    const hcm = {
      debit: jest.fn().mockResolvedValue({ commitId: 'HCM-1', newBalance: 8 }),
      ...(opts.hcm ?? {}),
    };
    const balances = {
      withTx: jest.fn(async (fn: AnyFn) => fn({} as never)),
      findOneTx: jest
        .fn()
        .mockResolvedValue({ employeeId: 'E1', locationId: 'NY', balanceDays: 10, reservedDays: 2 }),
      upsertTx: jest.fn().mockResolvedValue(undefined),
      ...(opts.balances ?? {}),
    };
    const ledger = {
      insertTx: jest.fn().mockResolvedValue(undefined),
      ...(opts.ledger ?? {}),
    };
    const requests = {
      findByIdTx: jest.fn().mockResolvedValue({ id: 'R-1', status: RequestStatus.APPROVED }),
      updateTx: jest.fn().mockImplementation(async (_m, r: unknown) => r),
      ...(opts.requests ?? {}),
    };
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
      ...(opts.audit ?? {}),
    };
    return new OutboxWorker(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      outbox as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hcm as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      balances as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ledger as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      requests as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audit as any,
    );
  }

  it('processes due rows: HCM ok → markDone, debit committed, request COMMITTED', async () => {
    const row = baseRow();
    const outbox = { findDue: jest.fn().mockResolvedValue([row]) };
    const requests = {
      findByIdTx: jest.fn().mockResolvedValue({
        id: 'R-1',
        employeeId: 'E1',
        locationId: 'NY',
        daysRequested: 2,
        status: RequestStatus.APPROVED,
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        reason: null,
        createdBy: 'u',
        approvedBy: 'mgr-1',
        rejectedReason: null,
        hcmCommitId: null,
        idempotencyKey: null,
        createdAt: 't',
        updatedAt: 't',
        version: 1,
      }),
      updateTx: jest.fn().mockImplementation(async (_m, r: unknown) => r),
    };
    const worker = buildWorker({ outbox, requests });

    const processed = await worker.drainOnce();
    expect(processed).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((worker as any).outbox.markDone).toHaveBeenCalledTimes(1);
    expect(requests.updateTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: RequestStatus.COMMITTED, hcmCommitId: 'HCM-1' }),
    );
  });

  it('retryable HCM error → row stays PENDING with attempts++', async () => {
    const row = baseRow();
    const outbox = {
      findDue: jest.fn().mockResolvedValue([row]),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const hcm = { debit: jest.fn().mockRejectedValue(HcmError.upstream('HCM 500', 500)) };
    const worker = buildWorker({ outbox, hcm });

    await worker.drainOnce();
    expect(outbox.markFailed).toHaveBeenCalledTimes(1);
    const [calledRow, err, , maxAttempts] = outbox.markFailed.mock.calls[0];
    expect(calledRow.id).toBe('OB-1');
    expect((err as Error).message).toContain('HCM 500');
    expect(maxAttempts).toBe(3);
  });

  it('terminal HCM error (INSUFFICIENT_BALANCE) routes to handleTerminalHcmFailure', async () => {
    const row = baseRow();
    const outbox = {
      findDue: jest.fn().mockResolvedValue([row]),
      markDone: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const hcm = {
      debit: jest.fn().mockRejectedValue(HcmError.insufficientBalance('HCM says nope')),
    };
    const requests = {
      findByIdTx: jest.fn().mockResolvedValue({
        id: 'R-1',
        employeeId: 'E1',
        locationId: 'NY',
        daysRequested: 2,
        status: RequestStatus.APPROVED,
        idempotencyKey: null,
      }),
      updateTx: jest.fn().mockImplementation(async (_m, r: unknown) => r),
    };
    const worker = buildWorker({ outbox, hcm, requests });

    await worker.drainOnce();

    expect(outbox.markFailed).not.toHaveBeenCalled();
    expect(outbox.markDone).toHaveBeenCalledTimes(1);
    expect(requests.updateTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: RequestStatus.FAILED,
        rejectedReason: expect.stringContaining('HCM:'),
      }),
    );
  });

  it('warns + markDone for unknown event types (no HCM call)', async () => {
    const row = { ...baseRow(), eventType: 'UNKNOWN_EVENT' };
    const outbox = {
      findDue: jest.fn().mockResolvedValue([row]),
      markDone: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const hcm = { debit: jest.fn() };
    const worker = buildWorker({ outbox, hcm });

    await worker.drainOnce();
    expect(hcm.debit).not.toHaveBeenCalled();
    expect(outbox.markDone).toHaveBeenCalledTimes(1);
    expect(outbox.markFailed).not.toHaveBeenCalled();
  });

  it('drainOnce returns 0 when no rows due', async () => {
    const worker = buildWorker({ outbox: { findDue: jest.fn().mockResolvedValue([]) } });
    expect(await worker.drainOnce()).toBe(0);
  });

  it('reentry guard: concurrent drainOnce calls do not double-process', async () => {
    const row = baseRow();
    let inFlight = false;
    let concurrentSeen = false;
    const outbox = {
      findDue: jest.fn(async () => {
        if (inFlight) {
          concurrentSeen = true;
          return [];
        }
        inFlight = true;
        await new Promise((r) => setImmediate(r));
        inFlight = false;
        return [row];
      }),
      markProcessing: jest.fn().mockResolvedValue(undefined),
      markDone: jest.fn().mockResolvedValue(undefined),
    };
    const worker = buildWorker({ outbox });
    const [a, b] = await Promise.all([worker.drainOnce(), worker.drainOnce()]);
    expect(a + b).toBe(1); // one of them returns 0 due to running guard
    // concurrentSeen is allowed (not asserted) — we only need to prove the guard prevents double-work
    expect(concurrentSeen).toBe(false);
  });

  it('skips lifecycle update when request is already terminal (idempotent commit)', async () => {
    const row = baseRow();
    const outbox = {
      findDue: jest.fn().mockResolvedValue([row]),
      markDone: jest.fn().mockResolvedValue(undefined),
    };
    const requests = {
      findByIdTx: jest.fn().mockResolvedValue({
        id: 'R-1',
        employeeId: 'E1',
        locationId: 'NY',
        daysRequested: 2,
        // already COMMITTED — second tick should be a no-op
        status: RequestStatus.COMMITTED,
      }),
      updateTx: jest.fn(),
    };
    const worker = buildWorker({ outbox, requests });

    await worker.drainOnce();
    expect(outbox.markDone).toHaveBeenCalledTimes(1);
    expect(requests.updateTx).not.toHaveBeenCalled();
  });

  it('throws when request row is missing during commit', async () => {
    const row = baseRow();
    const outbox = {
      findDue: jest.fn().mockResolvedValue([row]),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const requests = { findByIdTx: jest.fn().mockResolvedValue(null) };
    const worker = buildWorker({ outbox, requests });

    await worker.drainOnce();
    // The internal error becomes a generic retryable failure path
    expect(outbox.markFailed).toHaveBeenCalledTimes(1);
    expect(outbox.markFailed.mock.calls[0][1].message).toContain('not found');
  });

  it('schedules and tears down timer when worker is enabled', async () => {
    jest.useFakeTimers();
    try {
      const worker = buildWorker({
        config: { OUTBOX_WORKER_ENABLED: true, OUTBOX_POLL_INTERVAL_MS: 1000 },
      });
      worker.onModuleInit();
      // a timer should now be pending
      expect(jest.getTimerCount()).toBeGreaterThan(0);
      worker.onModuleDestroy();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not schedule when worker is disabled', () => {
    jest.useFakeTimers();
    try {
      const worker = buildWorker({ config: { OUTBOX_WORKER_ENABLED: false } });
      worker.onModuleInit();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
