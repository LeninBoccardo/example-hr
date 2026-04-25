import request from 'supertest';
import { bootE2E, E2EFixture, isoDate } from './helpers/setup';

describe('E2E: auth and access control', () => {
  let f: E2EFixture;

  beforeAll(async () => {
    f = await bootE2E();
  });

  afterAll(async () => {
    await f.closeAll();
  });

  beforeEach(async () => f.reset());

  it('rejects unauthenticated requests', async () => {
    const res = await request(f.app.app.getHttpServer()).get('/api/v1/balances/E1/NY');
    expect(res.status).toBe(401);
  });

  it('employee cannot view another employee\'s balance', async () => {
    await f.seedBalance('E20', 'NY', 5);
    const tok = f.app.employeeToken('E21');
    const res = await request(f.app.app.getHttpServer())
      .get('/api/v1/balances/E20/NY')
      .set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(403);
  });

  it('employee cannot approve their own request', async () => {
    await f.seedBalance('E22', 'NY', 5);
    const empTok = f.app.employeeToken('E22');
    const created = await request(f.app.app.getHttpServer())
      .post('/api/v1/requests')
      .set('Authorization', `Bearer ${empTok}`)
      .send({ locationId: 'NY', startDate: isoDate(0), endDate: isoDate(0) });
    const approve = await request(f.app.app.getHttpServer())
      .post(`/api/v1/requests/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${empTok}`);
    expect(approve.status).toBe(403);
  });

  it('employee cannot cancel another employee\'s request', async () => {
    await f.seedBalance('E23', 'NY', 5);
    const ownerTok = f.app.employeeToken('E23');
    const otherTok = f.app.employeeToken('E24');
    const created = await request(f.app.app.getHttpServer())
      .post('/api/v1/requests')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ locationId: 'NY', startDate: isoDate(0), endDate: isoDate(0) });
    const cancel = await request(f.app.app.getHttpServer())
      .post(`/api/v1/requests/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${otherTok}`)
      .send({});
    expect(cancel.status).toBe(403);
  });

  it('admin endpoints reject non-admin tokens', async () => {
    const mgrTok = f.app.managerToken();
    const reconcile = await request(f.app.app.getHttpServer())
      .post('/api/v1/admin/reconcile')
      .set('Authorization', `Bearer ${mgrTok}`);
    expect(reconcile.status).toBe(403);

    const outboxList = await request(f.app.app.getHttpServer())
      .get('/api/v1/admin/outbox')
      .set('Authorization', `Bearer ${mgrTok}`);
    expect(outboxList.status).toBe(403);
  });

  it('employee cannot fetch another employee\'s request by id', async () => {
    await f.seedBalance('E26', 'NY', 5);
    const ownerTok = f.app.employeeToken('E26');
    const otherTok = f.app.employeeToken('E27');
    const created = await request(f.app.app.getHttpServer())
      .post('/api/v1/requests')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ locationId: 'NY', startDate: isoDate(0), endDate: isoDate(0) });
    const fetch = await request(f.app.app.getHttpServer())
      .get(`/api/v1/requests/${created.body.id}`)
      .set('Authorization', `Bearer ${otherTok}`);
    expect(fetch.status).toBe(403);
  });

  it('employee can fetch their own request by id', async () => {
    await f.seedBalance('E28', 'NY', 5);
    const tok = f.app.employeeToken('E28');
    const created = await request(f.app.app.getHttpServer())
      .post('/api/v1/requests')
      .set('Authorization', `Bearer ${tok}`)
      .send({ locationId: 'NY', startDate: isoDate(0), endDate: isoDate(0) });
    const fetch = await request(f.app.app.getHttpServer())
      .get(`/api/v1/requests/${created.body.id}`)
      .set('Authorization', `Bearer ${tok}`);
    expect(fetch.status).toBe(200);
    expect(fetch.body.id).toBe(created.body.id);
  });

  it('manager can list all requests; employee cannot', async () => {
    await f.seedBalance('E25', 'NY', 5);
    const mgrTok = f.app.managerToken();
    const empTok = f.app.employeeToken('E25');

    const mgrList = await request(f.app.app.getHttpServer())
      .get('/api/v1/requests')
      .set('Authorization', `Bearer ${mgrTok}`);
    expect(mgrList.status).toBe(200);

    const empList = await request(f.app.app.getHttpServer())
      .get('/api/v1/requests')
      .set('Authorization', `Bearer ${empTok}`);
    expect(empList.status).toBe(403);
  });
});
