import request from 'supertest';
import { bootE2E, E2EFixture } from './helpers/setup';

describe('E2E: health endpoint', () => {
  let f: E2EFixture;

  beforeAll(async () => {
    f = await bootE2E();
  });

  afterAll(async () => {
    await f.closeAll();
  });

  beforeEach(async () => f.reset());

  it('reports ok when HCM reachable', async () => {
    const res = await request(f.app.app.getHttpServer()).get('/api/v1/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', hcm: 'reachable' });
  });

  it('reports degraded when HCM is down (5xx mode)', async () => {
    f.hcm.mock.scenario.mode = 'server_error';
    const res = await request(f.app.app.getHttpServer()).get('/api/v1/healthz');
    expect(res.status).toBe(200);
    expect(res.body.hcm).toBe('unreachable');
    expect(res.body.status).toBe('degraded');
  });
});
