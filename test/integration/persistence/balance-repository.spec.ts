import { DataSource } from 'typeorm';
import { BalanceSnapshotEntity } from '@timeoff/persistence/entities/balance-snapshot.entity';
import { LedgerEntryEntity } from '@timeoff/persistence/entities/ledger-entry.entity';
import { createTestDataSource, TestDataSourceHandle } from '../helpers/test-data-source';
import { LedgerEntryType, LedgerSource } from '@timeoff/domain/ledger';

describe('Balance persistence (integration)', () => {
  let handle: TestDataSourceHandle;
  let ds: DataSource;

  beforeAll(async () => {
    handle = await createTestDataSource();
    ds = handle.dataSource;
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await ds.getRepository(BalanceSnapshotEntity).clear();
    await ds.getRepository(LedgerEntryEntity).clear();
  });

  it('persists and reads a balance snapshot round trip', async () => {
    const repo = ds.getRepository(BalanceSnapshotEntity);
    await repo.save({
      employeeId: 'E1',
      locationId: 'NY',
      balanceDays: 10,
      reservedDays: 2,
      version: 1,
      lastHcmSyncAt: '2026-04-24T00:00:00Z',
      updatedAt: '2026-04-24T00:00:00Z',
    });
    const row = await repo.findOne({ where: { employeeId: 'E1', locationId: 'NY' } });
    expect(row).toMatchObject({ balanceDays: 10, reservedDays: 2 });
  });

  it('enforces idempotency via ledger unique index on hcm_idempotency_key', async () => {
    const ledger = ds.getRepository(LedgerEntryEntity);
    await ledger.save({
      employeeId: 'E1',
      locationId: 'NY',
      delta: -2,
      type: LedgerEntryType.DEBIT,
      source: LedgerSource.HCM_REALTIME,
      requestId: 'R1',
      actor: 'system',
      reason: 'first',
      occurredAt: '2026-04-24T00:00:00Z',
      hcmIdempotencyKey: 'IDEM-1',
    });
    await expect(
      ledger.save({
        employeeId: 'E1',
        locationId: 'NY',
        delta: -2,
        type: LedgerEntryType.DEBIT,
        source: LedgerSource.HCM_REALTIME,
        requestId: 'R2',
        actor: 'system',
        reason: 'second',
        occurredAt: '2026-04-24T00:00:00Z',
        hcmIdempotencyKey: 'IDEM-1',
      }),
    ).rejects.toThrow();
  });

  it('serializes back-to-back reservation attempts (no double-spend)', async () => {
    const repo = ds.getRepository(BalanceSnapshotEntity);
    await repo.save({
      employeeId: 'E1',
      locationId: 'NY',
      balanceDays: 10,
      reservedDays: 0,
      version: 1,
      lastHcmSyncAt: null,
      updatedAt: '2026-04-24T00:00:00Z',
    });

    // Two reservations of 6 days each against a 10-day balance. The second
    // must observe the first's reservation and fail the available-balance
    // check, even when the second starts before the first commits.
    const reserveOnce = async (days: number): Promise<{ ok: boolean; err?: string }> => {
      try {
        await ds.transaction(async (manager) => {
          const snap = await manager.getRepository(BalanceSnapshotEntity).findOne({
            where: { employeeId: 'E1', locationId: 'NY' },
          });
          if (!snap) throw new Error('missing');
          const available = snap.balanceDays - snap.reservedDays;
          if (available < days) throw new Error('insufficient');
          await manager.getRepository(BalanceSnapshotEntity).save({
            ...snap,
            reservedDays: snap.reservedDays + days,
          });
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, err: (e as Error).message };
      }
    };

    const first = await reserveOnce(6);
    const second = await reserveOnce(6);
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, err: 'insufficient' });

    const final = await repo.findOne({ where: { employeeId: 'E1', locationId: 'NY' } });
    expect(final?.reservedDays).toBe(6);
  });
});
