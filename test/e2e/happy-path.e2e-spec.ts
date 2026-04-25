import request from 'supertest';
import { bootE2E, E2EFixture, isoDate } from './helpers/setup';
import { RequestStatus } from '@timeoff/domain/request';
import { LedgerRepository } from '@timeoff/persistence/ledger.repository';
import { AuditRepository } from '@timeoff/persistence/audit.repository';

describe('E2E: happy path', () => {
  let f: E2EFixture;

  beforeAll(async () => {
    f = await bootE2E();
  });

  afterAll(async () => {
    await f.closeAll();
  });

  beforeEach(async () => f.reset());

  it('employee → manager → HCM commit, ledger and audit reflect the truth', async () => {
    await f.seedBalance('E1', 'NY', 10);
    const empToken = f.app.employeeToken('E1');
    const mgrToken = f.app.managerToken();
    const http = request(f.app.app.getHttpServer());

    const balRes0 = await http.get('/api/v1/balances/E1/NY').set('Authorization', `Bearer ${empToken}`);
    expect(balRes0.body).toMatchObject({ balanceDays: 10, availableDays: 10 });

    const create = await http
      .post('/api/v1/requests')
      .set('Authorization', `Bearer ${empToken}`)
      .send({ locationId: 'NY', startDate: isoDate(0), endDate: isoDate(2), reason: 'family event' });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe(RequestStatus.PENDING);
    expect(create.body.daysRequested).toBe(3);

    const balRes1 = await http.get('/api/v1/balances/E1/NY').set('Authorization', `Bearer ${empToken}`);
    expect(balRes1.body).toMatchObject({ availableDays: 7, reservedDays: 3 });

    const approve = await http
      .post(`/api/v1/requests/${create.body.id}/approve`)
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(approve.status).toBe(201);
    expect(approve.body.status).toBe(RequestStatus.COMMITTED);
    expect(approve.body.hcmCommitId).toBeTruthy();
    expect(approve.body.approvedBy).toBeTruthy();

    const balRes2 = await http.get('/api/v1/balances/E1/NY').set('Authorization', `Bearer ${empToken}`);
    expect(balRes2.body).toMatchObject({ balanceDays: 7, reservedDays: 0, availableDays: 7 });

    // HCM should also reflect the debit
    expect(f.hcm.mock.store.getBalance('E1', 'NY')).toBe(7);

    const ledger = await f.app.app.get(LedgerRepository).listByRequest(create.body.id);
    expect(ledger.length).toBe(1);
    expect(ledger[0]).toMatchObject({ delta: -3, type: 'DEBIT' });

    const audit = await f.app.app.get(AuditRepository).listForEntity('request', create.body.id);
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['request.created', 'request.approved', 'request.committed']),
    );
  });
});
