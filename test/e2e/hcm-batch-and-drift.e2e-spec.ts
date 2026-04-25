import request from 'supertest';
import { bootE2E, E2EFixture, isoDate } from './helpers/setup';
import { RequestStatus } from '@timeoff/domain/request';
import { LedgerRepository } from '@timeoff/persistence/ledger.repository';

describe('E2E: HCM batch + drift reconciliation', () => {
  let f: E2EFixture;

  beforeAll(async () => {
    f = await bootE2E();
  });

  afterAll(async () => {
    await f.closeAll();
  });

  beforeEach(async () => f.reset());

  it('batch ingest applies anniversary bonus and writes ledger entry', async () => {
    await f.seedBalance('E10', 'NY', 10);

    const ingest = await request(f.app.app.getHttpServer())
      .post('/api/v1/hcm/batch-ingest')
      .set('x-hcm-secret', 'test-batch-secret')
      .send({
        batchId: 'B-1',
        asOf: '2026-04-24T00:00:00Z',
        entries: [{ employeeId: 'E10', locationId: 'NY', balance: 12 }],
      });
    expect(ingest.status).toBe(201);
    expect(ingest.body.changedCount).toBe(1);
    expect(ingest.body.flaggedRequestIds).toEqual([]);

    const bal = await request(f.app.app.getHttpServer())
      .get('/api/v1/balances/E10/NY')
      .set('Authorization', `Bearer ${f.app.employeeToken('E10')}`);
    expect(bal.body.balanceDays).toBe(12);

    const entries = await f.app.app
      .get(LedgerRepository)
      .listByEmployeeLocation('E10', 'NY');
    expect(entries.find((e) => e.delta === 2 && e.type === 'HCM_SYNC_ADJUST')).toBeTruthy();
  });

  it('batch ingest below pending reservation flags newest pending requests as FAILED', async () => {
    await f.seedBalance('E11', 'NY', 10);
    const empToken = f.app.employeeToken('E11');

    const r1 = await request(f.app.app.getHttpServer())
      .post('/api/v1/requests')
      .set('Authorization', `Bearer ${empToken}`)
      .send({ locationId: 'NY', startDate: isoDate(0), endDate: isoDate(2) }); // 3 days
    const r2 = await request(f.app.app.getHttpServer())
      .post('/api/v1/requests')
      .set('Authorization', `Bearer ${empToken}`)
      .send({ locationId: 'NY', startDate: isoDate(10), endDate: isoDate(13) }); // 4 days
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    // total reserved = 7. HCM now says balance = 4 → over-reserved by 3.
    const ingest = await request(f.app.app.getHttpServer())
      .post('/api/v1/hcm/batch-ingest')
      .set('x-hcm-secret', 'test-batch-secret')
      .send({
        batchId: 'B-2',
        asOf: '2026-04-24T00:00:00Z',
        entries: [{ employeeId: 'E11', locationId: 'NY', balance: 4 }],
      });
    expect(ingest.status).toBe(201);
    expect(ingest.body.flaggedRequestIds).toContain(r2.body.id);

    // r2 should be FAILED, r1 PENDING
    const r1After = await request(f.app.app.getHttpServer())
      .get(`/api/v1/requests/${r1.body.id}`)
      .set('Authorization', `Bearer ${empToken}`);
    const r2After = await request(f.app.app.getHttpServer())
      .get(`/api/v1/requests/${r2.body.id}`)
      .set('Authorization', `Bearer ${empToken}`);
    expect(r1After.body.status).toBe(RequestStatus.PENDING);
    expect(r2After.body.status).toBe(RequestStatus.FAILED);

    const bal = await request(f.app.app.getHttpServer())
      .get('/api/v1/balances/E11/NY')
      .set('Authorization', `Bearer ${empToken}`);
    expect(bal.body).toMatchObject({ balanceDays: 4, reservedDays: 3, availableDays: 1 });
  });

  it('batch ingest rejects request without correct secret', async () => {
    const res = await request(f.app.app.getHttpServer())
      .post('/api/v1/hcm/batch-ingest')
      .set('x-hcm-secret', 'wrong')
      .send({ batchId: 'B-x', asOf: '2026-04-24T00:00:00Z', entries: [] });
    expect(res.status).toBe(401);
  });

  it('manual reconcile detects drift and writes HCM_SYNC_ADJUST ledger', async () => {
    await f.seedBalance('E12', 'NY', 10);
    // Silently change HCM behind our back
    f.hcm.mock.store.setBalance('E12', 'NY', 8);

    const adminToken = f.app.adminToken();
    const reconcile = await request(f.app.app.getHttpServer())
      .post('/api/v1/admin/reconcile')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reconcile.status).toBe(201);
    expect(reconcile.body.drifted).toBeGreaterThanOrEqual(1);

    const bal = await request(f.app.app.getHttpServer())
      .get('/api/v1/balances/E12/NY')
      .set('Authorization', `Bearer ${f.app.employeeToken('E12')}`);
    expect(bal.body.balanceDays).toBe(8);

    const entries = await f.app.app.get(LedgerRepository).listByEmployeeLocation('E12', 'NY');
    expect(
      entries.find((e) => e.type === 'HCM_SYNC_ADJUST' && e.delta === -2),
    ).toBeTruthy();
  });
});
