import request from 'supertest';
import { bootE2E, E2EFixture } from './helpers/setup';

describe('E2E: balance endpoints', () => {
  let f: E2EFixture;
  beforeAll(async () => {
    f = await bootE2E();
  });
  afterAll(async () => {
    await f.closeAll();
  });
  beforeEach(async () => f.reset());

  it('POST /balances/:e/:l/refresh re-fetches from HCM and reports HCM_REFRESH source', async () => {
    f.hcm.mock.store.setBalance('E-R', 'NY', 12);
    const mgrTok = f.app.managerToken();
    const res = await request(f.app.app.getHttpServer())
      .post('/api/v1/balances/E-R/NY/refresh')
      .set('Authorization', `Bearer ${mgrTok}`);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ balanceDays: 12, source: 'HCM_REFRESH' });
  });

  it('GET /balances/:e/:l returns 404 when there is no local snapshot yet', async () => {
    const mgrTok = f.app.managerToken();
    const res = await request(f.app.app.getHttpServer())
      .get('/api/v1/balances/UNKNOWN/UNKNOWN')
      .set('Authorization', `Bearer ${mgrTok}`);
    expect(res.status).toBe(404);
  });
});
