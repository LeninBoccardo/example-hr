import request from 'supertest';
import { bootE2E, E2EFixture, isoDate } from './helpers/setup';

describe('E2E: admin endpoints', () => {
  let f: E2EFixture;

  beforeAll(async () => {
    f = await bootE2E();
  });

  afterAll(async () => {
    await f.closeAll();
  });

  beforeEach(async () => f.reset());

  it('GET /admin/outbox returns rows after a 5xx-induced enqueue', async () => {
    await f.seedBalance('E1', 'NY', 10);
    const empTok = f.app.employeeToken('E1');
    const mgrTok = f.app.managerToken();
    const adminTok = f.app.adminToken();

    const r = await request(f.app.app.getHttpServer())
      .post('/api/v1/requests')
      .set({ Authorization: `Bearer ${empTok}` })
      .send({ locationId: 'NY', startDate: isoDate(0), endDate: isoDate(0) });

    f.hcm.mock.scenario.mode = 'server_error';
    await request(f.app.app.getHttpServer())
      .post(`/api/v1/requests/${r.body.id}/approve`)
      .set({ Authorization: `Bearer ${mgrTok}` })
      .send({});

    const list = await request(f.app.app.getHttpServer())
      .get('/api/v1/admin/outbox')
      .set({ Authorization: `Bearer ${adminTok}` });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBe(1);
    expect(list.body[0].status).toBe('PENDING');
  });

  it('POST /admin/outbox/drain returns processed count and commits drained rows', async () => {
    await f.seedBalance('E2', 'NY', 10);
    const empTok = f.app.employeeToken('E2');
    const mgrTok = f.app.managerToken();
    const adminTok = f.app.adminToken();

    const r = await request(f.app.app.getHttpServer())
      .post('/api/v1/requests')
      .set({ Authorization: `Bearer ${empTok}` })
      .send({ locationId: 'NY', startDate: isoDate(0), endDate: isoDate(0) });

    f.hcm.mock.scenario.mode = 'server_error';
    await request(f.app.app.getHttpServer())
      .post(`/api/v1/requests/${r.body.id}/approve`)
      .set({ Authorization: `Bearer ${mgrTok}` })
      .send({});

    f.hcm.mock.resetScenario();
    f.hcm.mock.store.setBalance('E2', 'NY', 10);

    const drain = await request(f.app.app.getHttpServer())
      .post('/api/v1/admin/outbox/drain')
      .set({ Authorization: `Bearer ${adminTok}` });
    expect(drain.status).toBe(201);
    expect(drain.body.processed).toBe(1);

    const fetched = await request(f.app.app.getHttpServer())
      .get(`/api/v1/requests/${r.body.id}`)
      .set({ Authorization: `Bearer ${mgrTok}` });
    expect(fetched.body.status).toBe('COMMITTED');
  });

  it('POST /admin/reconcile returns scanned/drifted/flagged counts', async () => {
    await f.seedBalance('E3', 'NY', 10);
    const adminTok = f.app.adminToken();

    // Drift HCM behind our back
    f.hcm.mock.store.setBalance('E3', 'NY', 7);

    const res = await request(f.app.app.getHttpServer())
      .post('/api/v1/admin/reconcile')
      .set({ Authorization: `Bearer ${adminTok}` });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ scanned: 1, drifted: 1, errors: 0 });
  });

  it('POST /admin/reconcile counts errors when HCM is unreachable', async () => {
    await f.seedBalance('E4', 'NY', 10);
    const adminTok = f.app.adminToken();
    f.hcm.mock.scenario.mode = 'server_error';

    const res = await request(f.app.app.getHttpServer())
      .post('/api/v1/admin/reconcile')
      .set({ Authorization: `Bearer ${adminTok}` });
    expect(res.status).toBe(201);
    expect(res.body.errors).toBe(1);
  });
});
