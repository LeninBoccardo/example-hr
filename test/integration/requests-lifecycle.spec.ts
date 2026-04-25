import request from 'supertest';
import { RequestsService } from '@timeoff/requests/requests.service';
import { BalanceService } from '@timeoff/balance/balance.service';
import { OutboxService } from '@timeoff/outbox/outbox.service';
import { LedgerRepository } from '@timeoff/persistence/ledger.repository';
import { AuditRepository } from '@timeoff/persistence/audit.repository';
import { RequestStatus } from '@timeoff/domain/request';
import { OutboxStatus } from '@timeoff/persistence/entities/outbox-event.entity';
import { HcmClient } from '@timeoff/hcm/hcm.client';
import { createTestApp, TestAppHandle } from './helpers/app-factory';
import { HcmMockFixture, startMockHcm } from './helpers/mock-hcm-fixture';

describe('Requests lifecycle (integration)', () => {
  let hcm: HcmMockFixture;
  let handle: TestAppHandle;

  beforeAll(async () => {
    hcm = await startMockHcm();
    handle = await createTestApp({ hcmBaseUrl: hcm.baseUrl, outboxWorkerEnabled: false });
  });

  afterAll(async () => {
    await handle.close();
    await hcm.close();
  });

  beforeEach(() => {
    hcm.mock.store.clear();
    hcm.mock.resetScenario();
    handle.app.get(HcmClient).getCircuit().reset();
  });

  const seedBalance = async (employeeId: string, locationId: string, balance: number) => {
    hcm.mock.store.setBalance(employeeId, locationId, balance);
    const balanceSvc = handle.app.get(BalanceService);
    await balanceSvc.refreshFromHcm(employeeId, locationId, 'system:seed');
  };

  it('happy path: create → approve → COMMITTED with correct ledger + audit', async () => {
    await seedBalance('E1', 'NY', 10);
    const employeeHeader = { Authorization: `Bearer ${handle.employeeToken('E1')}` };
    const managerHeader = { Authorization: `Bearer ${handle.managerToken()}` };

    const createRes = await request(handle.app.getHttpServer())
      .post('/api/v1/requests')
      .set(employeeHeader)
      .send({
        locationId: 'NY',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        reason: 'vacation',
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe(RequestStatus.PENDING);
    expect(createRes.body.daysRequested).toBe(3);

    const balAfterCreate = await request(handle.app.getHttpServer())
      .get('/api/v1/balances/E1/NY')
      .set(employeeHeader);
    expect(balAfterCreate.body).toMatchObject({ balanceDays: 10, reservedDays: 3, availableDays: 7 });

    const approveRes = await request(handle.app.getHttpServer())
      .post(`/api/v1/requests/${createRes.body.id}/approve`)
      .set(managerHeader)
      .send({});
    expect(approveRes.status).toBe(201);
    expect(approveRes.body.status).toBe(RequestStatus.COMMITTED);
    expect(approveRes.body.hcmCommitId).toMatch(/^HCM-/);

    const balAfterCommit = await request(handle.app.getHttpServer())
      .get('/api/v1/balances/E1/NY')
      .set(employeeHeader);
    expect(balAfterCommit.body).toMatchObject({ balanceDays: 7, reservedDays: 0, availableDays: 7 });

    const ledger = handle.app.get(LedgerRepository);
    const entries = await ledger.listByRequest(createRes.body.id);
    expect(entries.length).toBe(1);
    expect(entries[0].delta).toBe(-3);
    expect(entries[0].hcmIdempotencyKey).toBeTruthy();

    const audit = handle.app.get(AuditRepository);
    const logs = await audit.listForEntity('request', createRes.body.id);
    const actions = logs.map((l) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining(['request.created', 'request.approved', 'request.committed']),
    );
  });

  it('rejects creation when insufficient balance', async () => {
    await seedBalance('E2', 'NY', 2);
    const res = await request(handle.app.getHttpServer())
      .post('/api/v1/requests')
      .set({ Authorization: `Bearer ${handle.employeeToken('E2')}` })
      .send({ locationId: 'NY', startDate: '2026-06-01', endDate: '2026-06-05' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INSUFFICIENT_BALANCE');
  });

  it('prevents two overlapping requests from overbooking (hard reserve)', async () => {
    await seedBalance('E3', 'NY', 5);
    const tok = handle.employeeToken('E3');
    const r1 = await request(handle.app.getHttpServer())
      .post('/api/v1/requests')
      .set({ Authorization: `Bearer ${tok}` })
      .send({ locationId: 'NY', startDate: '2026-06-01', endDate: '2026-06-03' });
    expect(r1.status).toBe(201);
    const r2 = await request(handle.app.getHttpServer())
      .post('/api/v1/requests')
      .set({ Authorization: `Bearer ${tok}` })
      .send({ locationId: 'NY', startDate: '2026-06-10', endDate: '2026-06-13' });
    expect(r2.status).toBe(409);
  });

  it('cancel restores reservation', async () => {
    await seedBalance('E4', 'NY', 10);
    const tok = handle.employeeToken('E4');
    const r = await request(handle.app.getHttpServer())
      .post('/api/v1/requests')
      .set({ Authorization: `Bearer ${tok}` })
      .send({ locationId: 'NY', startDate: '2026-06-01', endDate: '2026-06-05' });
    expect(r.status).toBe(201);
    const bal1 = await request(handle.app.getHttpServer())
      .get('/api/v1/balances/E4/NY')
      .set({ Authorization: `Bearer ${tok}` });
    expect(bal1.body.reservedDays).toBe(5);

    const c = await request(handle.app.getHttpServer())
      .post(`/api/v1/requests/${r.body.id}/cancel`)
      .set({ Authorization: `Bearer ${tok}` })
      .send({});
    expect(c.status).toBe(201);
    expect(c.body.status).toBe(RequestStatus.CANCELLED);

    const bal2 = await request(handle.app.getHttpServer())
      .get('/api/v1/balances/E4/NY')
      .set({ Authorization: `Bearer ${tok}` });
    expect(bal2.body.reservedDays).toBe(0);
    expect(bal2.body.availableDays).toBe(10);
  });

  it('reject restores reservation', async () => {
    await seedBalance('E5', 'NY', 10);
    const empTok = handle.employeeToken('E5');
    const mgrTok = handle.managerToken();
    const r = await request(handle.app.getHttpServer())
      .post('/api/v1/requests')
      .set({ Authorization: `Bearer ${empTok}` })
      .send({ locationId: 'NY', startDate: '2026-06-01', endDate: '2026-06-03' });
    expect(r.status).toBe(201);

    const rej = await request(handle.app.getHttpServer())
      .post(`/api/v1/requests/${r.body.id}/reject`)
      .set({ Authorization: `Bearer ${mgrTok}` })
      .send({ reason: 'no coverage' });
    expect(rej.status).toBe(201);
    expect(rej.body.status).toBe(RequestStatus.REJECTED);

    const bal = await request(handle.app.getHttpServer())
      .get('/api/v1/balances/E5/NY')
      .set({ Authorization: `Bearer ${empTok}` });
    expect(bal.body.reservedDays).toBe(0);
  });

  it('idempotent create: same Idempotency-Key returns same request', async () => {
    await seedBalance('E6', 'NY', 10);
    const tok = handle.employeeToken('E6');
    const body = { locationId: 'NY', startDate: '2026-06-01', endDate: '2026-06-02' };
    const key = 'idem-create-1';
    const r1 = await request(handle.app.getHttpServer())
      .post('/api/v1/requests')
      .set({ Authorization: `Bearer ${tok}`, 'Idempotency-Key': key })
      .send(body);
    const r2 = await request(handle.app.getHttpServer())
      .post('/api/v1/requests')
      .set({ Authorization: `Bearer ${tok}`, 'Idempotency-Key': key })
      .send(body);
    expect(r1.body.id).toBe(r2.body.id);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
  });

  it('enqueues outbox + stays APPROVED when HCM returns retryable 5xx', async () => {
    await seedBalance('E7', 'NY', 10);
    const empTok = handle.employeeToken('E7');
    const mgrTok = handle.managerToken();
    const r = await request(handle.app.getHttpServer())
      .post('/api/v1/requests')
      .set({ Authorization: `Bearer ${empTok}` })
      .send({ locationId: 'NY', startDate: '2026-06-01', endDate: '2026-06-02' });

    // Turn HCM into 5xx mode — but only AFTER the initial seed refresh ran
    hcm.mock.scenario.mode = 'server_error';

    const approveRes = await request(handle.app.getHttpServer())
      .post(`/api/v1/requests/${r.body.id}/approve`)
      .set({ Authorization: `Bearer ${mgrTok}` })
      .send({});
    expect(approveRes.status).toBe(201);
    expect(approveRes.body.status).toBe(RequestStatus.APPROVED);

    const outbox = handle.app.get(OutboxService);
    const rows = await outbox.listAll();
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe(OutboxStatus.PENDING);

    // now flip HCM back and drain outbox; request should reach COMMITTED
    hcm.mock.resetScenario();
    hcm.mock.store.setBalance('E7', 'NY', 10); // reseed because scenario reset cleared nothing
    const worker = handle.app.get(RequestsService);
    void worker;
    const outboxWorker = handle.app.get(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@timeoff/outbox/outbox.worker').OutboxWorker,
    );
    const drained = await outboxWorker.drainOnce();
    expect(drained).toBe(1);

    const latest = await request(handle.app.getHttpServer())
      .get(`/api/v1/requests/${r.body.id}`)
      .set({ Authorization: `Bearer ${mgrTok}` });
    expect(latest.body.status).toBe(RequestStatus.COMMITTED);
  });

  it('transitions APPROVED → FAILED on terminal HCM INSUFFICIENT_BALANCE', async () => {
    await seedBalance('E8', 'NY', 10);
    const empTok = handle.employeeToken('E8');
    const mgrTok = handle.managerToken();
    const r = await request(handle.app.getHttpServer())
      .post('/api/v1/requests')
      .set({ Authorization: `Bearer ${empTok}` })
      .send({ locationId: 'NY', startDate: '2026-06-01', endDate: '2026-06-02' });
    expect(r.status).toBe(201);

    hcm.mock.scenario.mode = 'insufficient_balance';
    const approveRes = await request(handle.app.getHttpServer())
      .post(`/api/v1/requests/${r.body.id}/approve`)
      .set({ Authorization: `Bearer ${mgrTok}` })
      .send({});
    expect(approveRes.status).toBe(201);
    expect(approveRes.body.status).toBe(RequestStatus.FAILED);

    // reservation should be released
    const bal = await request(handle.app.getHttpServer())
      .get('/api/v1/balances/E8/NY')
      .set({ Authorization: `Bearer ${empTok}` });
    expect(bal.body.reservedDays).toBe(0);
  });
});
