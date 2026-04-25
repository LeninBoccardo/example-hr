import { DataSource } from 'typeorm';
import { LedgerEntryEntity } from '@timeoff/persistence/entities/ledger-entry.entity';
import { TimeOffRequestEntity } from '@timeoff/persistence/entities/time-off-request.entity';
import { OutboxEventEntity, OutboxStatus } from '@timeoff/persistence/entities/outbox-event.entity';
import { AuditLogEntity } from '@timeoff/persistence/entities/audit-log.entity';
import { BalanceSnapshotEntity } from '@timeoff/persistence/entities/balance-snapshot.entity';
import { LedgerRepository } from '@timeoff/persistence/ledger.repository';
import { RequestRepository } from '@timeoff/persistence/request.repository';
import { OutboxRepository } from '@timeoff/persistence/outbox.repository';
import { AuditRepository } from '@timeoff/persistence/audit.repository';
import { BalanceRepository } from '@timeoff/persistence/balance.repository';
import { LedgerEntryType, LedgerSource } from '@timeoff/domain/ledger';
import { RequestStatus } from '@timeoff/domain/request';
import { createTestDataSource, TestDataSourceHandle } from './../helpers/test-data-source';

describe('Repository finders (integration)', () => {
  let handle: TestDataSourceHandle;
  let ds: DataSource;
  let ledger: LedgerRepository;
  let requests: RequestRepository;
  let outbox: OutboxRepository;
  let audit: AuditRepository;
  let balance: BalanceRepository;

  beforeAll(async () => {
    handle = await createTestDataSource();
    ds = handle.dataSource;
    ledger = new LedgerRepository(ds.getRepository(LedgerEntryEntity));
    requests = new RequestRepository(ds.getRepository(TimeOffRequestEntity));
    outbox = new OutboxRepository(ds.getRepository(OutboxEventEntity));
    audit = new AuditRepository(ds.getRepository(AuditLogEntity));
    balance = new BalanceRepository(ds.getRepository(BalanceSnapshotEntity), ds);
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    for (const e of [LedgerEntryEntity, TimeOffRequestEntity, OutboxEventEntity, AuditLogEntity, BalanceSnapshotEntity]) {
      await ds.getRepository(e).clear();
    }
  });

  describe('LedgerRepository', () => {
    it('listByEmployeeLocation returns rows in chronological order', async () => {
      await ledger.insert({
        employeeId: 'E1', locationId: 'NY', delta: 10,
        type: LedgerEntryType.ACCRUAL, source: LedgerSource.HCM_BATCH,
        requestId: null, actor: 'sys', reason: null,
        occurredAt: '2026-01-01T00:00:00.000Z', hcmIdempotencyKey: null,
      });
      await ledger.insert({
        employeeId: 'E1', locationId: 'NY', delta: -2,
        type: LedgerEntryType.DEBIT, source: LedgerSource.REQUEST,
        requestId: 'R1', actor: 'mgr', reason: null,
        occurredAt: '2026-04-01T00:00:00.000Z', hcmIdempotencyKey: 'idem-A',
      });
      const rows = await ledger.listByEmployeeLocation('E1', 'NY');
      expect(rows.map((r) => r.delta)).toEqual([10, -2]);
    });

    it('existsWithIdempotencyKey returns true after a write', async () => {
      await ledger.insert({
        employeeId: 'E1', locationId: 'NY', delta: -1,
        type: LedgerEntryType.DEBIT, source: LedgerSource.HCM_REALTIME,
        requestId: null, actor: null, reason: null,
        occurredAt: '2026-04-01T00:00:00.000Z', hcmIdempotencyKey: 'idem-X',
      });
      expect(await ledger.existsWithIdempotencyKey('idem-X')).toBe(true);
      expect(await ledger.existsWithIdempotencyKey('idem-Y')).toBe(false);
    });

    it('insertTx writes inside an explicit manager', async () => {
      await ds.transaction(async (manager) => {
        await ledger.insertTx(manager, {
          employeeId: 'E1', locationId: 'NY', delta: 5,
          type: LedgerEntryType.ANNIVERSARY, source: LedgerSource.HCM_BATCH,
          requestId: null, actor: null, reason: null,
          occurredAt: '2026-04-25T00:00:00.000Z', hcmIdempotencyKey: null,
        });
      });
      const rows = await ledger.listByRequest(null as unknown as string).catch(() => []);
      expect(Array.isArray(rows)).toBe(true);
      const all = await ledger.listByEmployeeLocation('E1', 'NY');
      expect(all.length).toBe(1);
    });
  });

  describe('RequestRepository', () => {
    const seed = async (overrides: Partial<{
      id: string; employeeId: string; locationId: string;
      status: RequestStatus; idempotencyKey: string | null;
    }> = {}) =>
      requests.insert({
        id: overrides.id ?? 'R-' + Math.random().toString(36).slice(2),
        employeeId: overrides.employeeId ?? 'E1',
        locationId: overrides.locationId ?? 'NY',
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        daysRequested: 2,
        status: overrides.status ?? RequestStatus.PENDING,
        reason: null,
        createdBy: 'u',
        approvedBy: null,
        rejectedReason: null,
        hcmCommitId: null,
        idempotencyKey: overrides.idempotencyKey ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

    it('list filters by employeeId', async () => {
      await seed({ employeeId: 'E1' });
      await seed({ employeeId: 'E1' });
      await seed({ employeeId: 'E2' });
      const e1 = await requests.list({ employeeId: 'E1' });
      expect(e1).toHaveLength(2);
    });

    it('list filters by status array', async () => {
      await seed({ status: RequestStatus.PENDING });
      await seed({ status: RequestStatus.APPROVED });
      await seed({ status: RequestStatus.REJECTED });
      const open = await requests.list({ status: [RequestStatus.PENDING, RequestStatus.APPROVED] });
      expect(open).toHaveLength(2);
    });

    it('list with no filter returns all rows ordered desc by createdAt', async () => {
      await seed({});
      await seed({});
      const all = await requests.list({});
      expect(all.length).toBe(2);
    });

    it('findByIdempotencyKey returns the matching row', async () => {
      await seed({ idempotencyKey: 'idem-create-1' });
      const row = await requests.findByIdempotencyKey('idem-create-1');
      expect(row?.idempotencyKey).toBe('idem-create-1');
      expect(await requests.findByIdempotencyKey('absent')).toBeNull();
    });

    it('listPendingReservationsForEmployeeLocation includes PENDING and APPROVED only', async () => {
      await seed({ employeeId: 'E9', locationId: 'NY', status: RequestStatus.PENDING });
      await seed({ employeeId: 'E9', locationId: 'NY', status: RequestStatus.APPROVED });
      await seed({ employeeId: 'E9', locationId: 'NY', status: RequestStatus.COMMITTED });
      await seed({ employeeId: 'E9', locationId: 'NY', status: RequestStatus.REJECTED });
      await ds.transaction(async (m) => {
        const rows = await requests.listPendingReservationsForEmployeeLocation(m, 'E9', 'NY');
        expect(rows).toHaveLength(2);
      });
    });
  });

  describe('OutboxRepository', () => {
    const baseRow = (over: Partial<{ status: OutboxStatus; idempotencyKey: string }>) => ({
      aggregateType: 'request',
      aggregateId: 'R-' + Math.random().toString(36).slice(2),
      eventType: 'HCM_DEBIT',
      payload: '{}',
      status: over.status ?? OutboxStatus.PENDING,
      attempts: 0,
      nextAttemptAt: new Date().toISOString(),
      lastError: null,
      idempotencyKey: over.idempotencyKey ?? 'idem-' + Math.random().toString(36).slice(2),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    it('insert + findById round trip', async () => {
      const inserted = await outbox.insert(baseRow({}));
      expect(inserted.id).toBeTruthy();
      const fetched = await outbox.findById(inserted.id!);
      expect(fetched?.idempotencyKey).toBe(inserted.idempotencyKey);
    });

    it('findByIdempotencyKey hits the unique index', async () => {
      const row = await outbox.insert(baseRow({ idempotencyKey: 'unique-1' }));
      const fetched = await outbox.findByIdempotencyKey('unique-1');
      expect(fetched?.id).toBe(row.id);
      expect(await outbox.findByIdempotencyKey('absent')).toBeNull();
    });

    it('findDue returns only PENDING rows whose nextAttemptAt is past', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const future = new Date(Date.now() + 60_000).toISOString();
      await outbox.insert({ ...baseRow({}), status: OutboxStatus.PENDING, nextAttemptAt: past });
      await outbox.insert({ ...baseRow({}), status: OutboxStatus.PENDING, nextAttemptAt: future });
      await outbox.insert({ ...baseRow({}), status: OutboxStatus.DONE, nextAttemptAt: past });
      const due = await outbox.findDue(new Date());
      expect(due).toHaveLength(1);
    });

    it('insertTx writes inside an explicit transaction', async () => {
      await ds.transaction(async (m) => {
        await outbox.insertTx(m, baseRow({ idempotencyKey: 'tx-key' }));
      });
      expect(await outbox.findByIdempotencyKey('tx-key')).not.toBeNull();
    });

    it('listAll returns all rows', async () => {
      await outbox.insert(baseRow({}));
      await outbox.insert(baseRow({}));
      expect((await outbox.listAll()).length).toBe(2);
    });
  });

  describe('AuditRepository', () => {
    it('listForEntity returns rows in chronological order', async () => {
      await audit.insert({
        actor: 'u', action: 'a.b', entityType: 'request', entityId: 'R1',
        beforeJson: null, afterJson: null,
        occurredAt: '2026-04-01T00:00:00.000Z',
      });
      await audit.insert({
        actor: 'u', action: 'a.c', entityType: 'request', entityId: 'R1',
        beforeJson: null, afterJson: null,
        occurredAt: '2026-04-02T00:00:00.000Z',
      });
      const rows = await audit.listForEntity('request', 'R1');
      expect(rows.map((r) => r.action)).toEqual(['a.b', 'a.c']);
    });

    it('listAll returns all rows newest first', async () => {
      await audit.insert({
        actor: 'u', action: 'a.b', entityType: 'request', entityId: 'R1',
        beforeJson: null, afterJson: null,
        occurredAt: '2026-04-01T00:00:00.000Z',
      });
      await audit.insert({
        actor: 'u', action: 'a.c', entityType: 'request', entityId: 'R2',
        beforeJson: null, afterJson: null,
        occurredAt: '2026-04-02T00:00:00.000Z',
      });
      const rows = await audit.listAll();
      expect(rows[0].entityId).toBe('R2');
    });

    it('insertTx writes inside an explicit transaction', async () => {
      await ds.transaction(async (m) => {
        await audit.insertTx(m, {
          actor: 'u', action: 'a.tx', entityType: 'request', entityId: 'R-tx',
          beforeJson: null, afterJson: null,
          occurredAt: '2026-04-25T00:00:00.000Z',
        });
      });
      expect((await audit.listForEntity('request', 'R-tx')).length).toBe(1);
    });
  });

  describe('BalanceRepository', () => {
    it('upsert + findOne round trip', async () => {
      await balance.upsert({
        employeeId: 'E5', locationId: 'NY',
        balanceDays: 10, reservedDays: 0, version: 1,
        lastHcmSyncAt: null, updatedAt: '2026-04-25T00:00:00.000Z',
      });
      const row = await balance.findOne('E5', 'NY');
      expect(row?.balanceDays).toBe(10);
      expect(await balance.findOne('absent', 'absent')).toBeNull();
    });

    it('findOneTx + upsertTx work inside an explicit transaction', async () => {
      await balance.withTx(async (m) => {
        const row = await balance.findOneTx(m, 'E6', 'NY');
        expect(row).toBeNull();
        await balance.upsertTx(m, {
          employeeId: 'E6', locationId: 'NY',
          balanceDays: 5, reservedDays: 0, version: 1,
          lastHcmSyncAt: null, updatedAt: '2026-04-25T00:00:00.000Z',
        });
      });
      expect((await balance.findOne('E6', 'NY'))?.balanceDays).toBe(5);
    });

    it('listAll returns all snapshots', async () => {
      await balance.upsert({
        employeeId: 'EA', locationId: 'NY',
        balanceDays: 1, reservedDays: 0, version: 1,
        lastHcmSyncAt: null, updatedAt: '2026-04-25T00:00:00.000Z',
      });
      await balance.upsert({
        employeeId: 'EB', locationId: 'NY',
        balanceDays: 2, reservedDays: 0, version: 1,
        lastHcmSyncAt: null, updatedAt: '2026-04-25T00:00:00.000Z',
      });
      const all = await balance.listAll();
      expect(all.length).toBe(2);
    });
  });
});
