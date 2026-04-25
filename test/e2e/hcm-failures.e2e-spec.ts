import request from 'supertest';
import { bootE2E, E2EFixture, isoDate } from './helpers/setup';
import { RequestStatus } from '@timeoff/domain/request';
import { OutboxService } from '@timeoff/outbox/outbox.service';
import { OutboxStatus } from '@timeoff/persistence/entities/outbox-event.entity';
import { OutboxWorker } from '@timeoff/outbox/outbox.worker';

describe('E2E: HCM failure handling', () => {
  let f: E2EFixture;

  beforeAll(async () => {
    f = await bootE2E();
  });

  afterAll(async () => {
    await f.closeAll();
  });

  beforeEach(async () => f.reset());

  async function pendingRequest(employeeId: string, days = 2) {
    await f.seedBalance(employeeId, 'NY', 10);
    const empToken = f.app.employeeToken(employeeId);
    const created = await request(f.app.app.getHttpServer())
      .post('/api/v1/requests')
      .set('Authorization', `Bearer ${empToken}`)
      .send({
        locationId: 'NY',
        startDate: isoDate(0),
        endDate: isoDate(days - 1),
      });
    expect(created.status).toBe(201);
    return created.body.id as string;
  }

  it('HCM 5xx → request stays APPROVED, outbox PENDING; flips to COMMITTED on drain', async () => {
    const reqId = await pendingRequest('E2');
    f.hcm.mock.scenario.mode = 'server_error';

    const approveRes = await request(f.app.app.getHttpServer())
      .post(`/api/v1/requests/${reqId}/approve`)
      .set('Authorization', `Bearer ${f.app.managerToken()}`);
    expect(approveRes.status).toBe(201);
    expect(approveRes.body.status).toBe(RequestStatus.APPROVED);

    const outbox = f.app.app.get(OutboxService);
    let rows = await outbox.listAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(OutboxStatus.PENDING);

    f.hcm.mock.resetScenario();
    f.hcm.mock.store.setBalance('E2', 'NY', 10); // restore HCM-side state

    const drained = await f.app.app.get(OutboxWorker).drainOnce();
    expect(drained).toBe(1);

    rows = await outbox.listAll();
    expect(rows[0].status).toBe(OutboxStatus.DONE);

    const final = await request(f.app.app.getHttpServer())
      .get(`/api/v1/requests/${reqId}`)
      .set('Authorization', `Bearer ${f.app.managerToken()}`);
    expect(final.body.status).toBe(RequestStatus.COMMITTED);
  });

  it('HCM INSUFFICIENT_BALANCE on approve → FAILED, reservation released, ledger entry recorded', async () => {
    const reqId = await pendingRequest('E3');
    f.hcm.mock.scenario.mode = 'insufficient_balance';

    const approveRes = await request(f.app.app.getHttpServer())
      .post(`/api/v1/requests/${reqId}/approve`)
      .set('Authorization', `Bearer ${f.app.managerToken()}`);
    expect(approveRes.status).toBe(201);
    expect(approveRes.body.status).toBe(RequestStatus.FAILED);
    expect(approveRes.body.rejectedReason).toMatch(/INSUFFICIENT_BALANCE/);

    const bal = await request(f.app.app.getHttpServer())
      .get('/api/v1/balances/E3/NY')
      .set('Authorization', `Bearer ${f.app.employeeToken('E3')}`);
    expect(bal.body).toMatchObject({ reservedDays: 0, availableDays: 10 });
  });

  it('HCM INVALID_DIMENSION on approve → FAILED non-retryable', async () => {
    const reqId = await pendingRequest('E4');
    f.hcm.mock.scenario.mode = 'invalid_dimension';

    const approveRes = await request(f.app.app.getHttpServer())
      .post(`/api/v1/requests/${reqId}/approve`)
      .set('Authorization', `Bearer ${f.app.managerToken()}`);
    expect(approveRes.status).toBe(201);
    expect(approveRes.body.status).toBe(RequestStatus.FAILED);
    expect(approveRes.body.rejectedReason).toMatch(/INVALID_DIMENSION/);
  });

  it('HCM idempotent debit: replaying same idempotency key does not double-debit', async () => {
    await f.seedBalance('E5', 'NY', 10);
    const reqId = await pendingRequest('E5');
    const approveRes = await request(f.app.app.getHttpServer())
      .post(`/api/v1/requests/${reqId}/approve`)
      .set('Authorization', `Bearer ${f.app.managerToken()}`);
    expect(approveRes.body.status).toBe(RequestStatus.COMMITTED);
    const balanceAfterFirst = f.hcm.mock.store.getBalance('E5', 'NY');

    // Manually retry the same debit at HCM level using the same idempotency key
    const idempotencyKey = `req-${reqId}`;
    const replay = await request(f.hcm.mock.app)
      .post('/hcm/balances/E5/NY/debit')
      .send({ days: 2, idempotencyKey });
    expect(replay.status).toBe(200);
    expect(f.hcm.mock.store.getBalance('E5', 'NY')).toBe(balanceAfterFirst);
  });

  it('outbox marks DEAD after exhausting retries', async () => {
    const reqId = await pendingRequest('E6');
    f.hcm.mock.scenario.mode = 'server_error';

    await request(f.app.app.getHttpServer())
      .post(`/api/v1/requests/${reqId}/approve`)
      .set('Authorization', `Bearer ${f.app.managerToken()}`);

    const worker = f.app.app.get(OutboxWorker);
    // OUTBOX_MAX_ATTEMPTS = 3 in test config; need that many drains while HCM still flapping.
    for (let i = 0; i < 5; i++) {
      const due = await f.app.app.get(OutboxService).findDue(10, new Date(Date.now() + 60_000));
      if (due.length === 0) break;
      // force nextAttemptAt to past so worker picks them up
      for (const r of due) {
        await f.app.app.get(OutboxService).markFailed(r, new Error('forced'), new Date(0), 999);
      }
      await worker.drainOnce();
    }

    const rows = await f.app.app.get(OutboxService).listAll();
    const dead = rows.filter((r) => r.status === OutboxStatus.DEAD);
    expect(dead.length).toBeGreaterThanOrEqual(1);
  });
});
