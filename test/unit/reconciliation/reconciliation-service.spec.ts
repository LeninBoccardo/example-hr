import { ConfigService } from '@nestjs/config';
import { ReconciliationService } from '@timeoff/reconciliation/reconciliation.service';

type AnyFn = (...args: unknown[]) => unknown;

function configStub(values: Record<string, unknown>): ConfigService {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: ((key: string) => values[key]) as any,
  } as ConfigService;
}

function build(opts: {
  config?: Record<string, unknown>;
  balances?: Partial<Record<string, AnyFn>>;
  hcm?: Partial<Record<string, AnyFn>>;
  requests?: Partial<Record<string, AnyFn>>;
}): ReconciliationService {
  const config = configStub({ RECONCILE_CRON_ENABLED: false, ...(opts.config ?? {}) });
  const balances = {
    withTx: jest.fn(async (fn: AnyFn) => fn({} as never)),
    listAll: jest.fn().mockResolvedValue([]),
    ...(opts.balances ?? {}),
  };
  const hcm = { getBalance: jest.fn(), ...(opts.hcm ?? {}) };
  const requests = {
    handleHcmAbsoluteBalance: jest.fn().mockResolvedValue({ delta: 0, flaggedRequestIds: [] }),
    ...(opts.requests ?? {}),
  };
  return new ReconciliationService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    balances as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hcm as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requests as any,
  );
}

describe('ReconciliationService.scheduled', () => {
  it('is a no-op when cron is disabled', async () => {
    const balances = { listAll: jest.fn().mockResolvedValue([]) };
    const svc = build({ config: { RECONCILE_CRON_ENABLED: false }, balances });
    await svc.scheduled();
    expect(balances.listAll).not.toHaveBeenCalled();
  });

  it('runs reconcile when cron is enabled', async () => {
    const balances = {
      listAll: jest.fn().mockResolvedValue([
        { employeeId: 'E1', locationId: 'NY', balanceDays: 10, reservedDays: 0,
          version: 1, lastHcmSyncAt: null, updatedAt: 't' },
      ]),
      withTx: jest.fn(async (fn: AnyFn) => fn({} as never)),
    };
    const hcm = { getBalance: jest.fn().mockResolvedValue({ balance: 10, asOf: 't' }) };
    const svc = build({ config: { RECONCILE_CRON_ENABLED: true }, balances, hcm });
    await svc.scheduled();
    expect(balances.listAll).toHaveBeenCalled();
  });

  it('swallows errors thrown by the underlying reconcile call', async () => {
    const balances = { listAll: jest.fn().mockRejectedValue(new Error('boom')) };
    const svc = build({ config: { RECONCILE_CRON_ENABLED: true }, balances });
    // Should not throw — errors are caught and logged
    await expect(svc.scheduled()).resolves.toBeUndefined();
  });
});

describe('ReconciliationService.reconcile', () => {
  it('skips writes when HCM balance matches local snapshot', async () => {
    const balances = {
      listAll: jest.fn().mockResolvedValue([
        { employeeId: 'E1', locationId: 'NY', balanceDays: 10, reservedDays: 0,
          version: 1, lastHcmSyncAt: null, updatedAt: 't' },
      ]),
      withTx: jest.fn(),
    };
    const hcm = { getBalance: jest.fn().mockResolvedValue({ balance: 10, asOf: 't' }) };
    const svc = build({ balances, hcm });
    const result = await svc.reconcile('admin');
    expect(result).toEqual({ scanned: 1, drifted: 0, flaggedRequestIds: [], errors: 0 });
    expect(balances.withTx).not.toHaveBeenCalled();
  });

  it('counts drifts when HCM disagrees, and propagates flagged requests', async () => {
    const balances = {
      listAll: jest.fn().mockResolvedValue([
        { employeeId: 'E1', locationId: 'NY', balanceDays: 10, reservedDays: 0,
          version: 1, lastHcmSyncAt: null, updatedAt: 't' },
      ]),
      withTx: jest.fn(async (fn: AnyFn) => fn({} as never)),
    };
    const hcm = { getBalance: jest.fn().mockResolvedValue({ balance: 7, asOf: 't' }) };
    const requests = {
      handleHcmAbsoluteBalance: jest.fn().mockResolvedValue({ delta: -3, flaggedRequestIds: ['R1'] }),
    };
    const svc = build({ balances, hcm, requests });
    const result = await svc.reconcile('admin');
    expect(result.drifted).toBe(1);
    expect(result.flaggedRequestIds).toEqual(['R1']);
  });

  it('counts errors when HCM throws and continues with the next row', async () => {
    const balances = {
      listAll: jest.fn().mockResolvedValue([
        { employeeId: 'E1', locationId: 'NY', balanceDays: 10, reservedDays: 0,
          version: 1, lastHcmSyncAt: null, updatedAt: 't' },
        { employeeId: 'E2', locationId: 'NY', balanceDays: 5, reservedDays: 0,
          version: 1, lastHcmSyncAt: null, updatedAt: 't' },
      ]),
      withTx: jest.fn(async (fn: AnyFn) => fn({} as never)),
    };
    const hcm = {
      getBalance: jest
        .fn()
        .mockRejectedValueOnce(new Error('HCM fell over'))
        .mockResolvedValueOnce({ balance: 5, asOf: 't' }),
    };
    const svc = build({ balances, hcm });
    const result = await svc.reconcile('admin');
    expect(result.errors).toBe(1);
    expect(result.scanned).toBe(2);
  });
});
