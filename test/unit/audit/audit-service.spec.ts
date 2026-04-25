import { AuditService } from '@timeoff/audit/audit.service';

describe('AuditService', () => {
  it('falls back to insert (no manager) when called outside a transaction', async () => {
    const repo = {
      insert: jest.fn().mockResolvedValue(undefined),
      insertTx: jest.fn().mockResolvedValue(undefined),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new AuditService(repo as any);
    await svc.record({ actor: 'u', action: 'a.b', entityType: 'request', entityId: 'R1' });
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(repo.insertTx).not.toHaveBeenCalled();
  });

  it('uses insertTx when a manager is provided', async () => {
    const repo = {
      insert: jest.fn().mockResolvedValue(undefined),
      insertTx: jest.fn().mockResolvedValue(undefined),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new AuditService(repo as any);
    await svc.record(
      { actor: 'u', action: 'a.b', entityType: 'request', entityId: 'R1', before: { x: 1 }, after: { x: 2 } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );
    expect(repo.insertTx).toHaveBeenCalledTimes(1);
    expect(repo.insert).not.toHaveBeenCalled();
    const row = repo.insertTx.mock.calls[0][1];
    expect(row.beforeJson).toBe(JSON.stringify({ x: 1 }));
    expect(row.afterJson).toBe(JSON.stringify({ x: 2 }));
  });

  it('serializes undefined before/after as null', async () => {
    const repo = { insert: jest.fn().mockResolvedValue(undefined), insertTx: jest.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new AuditService(repo as any);
    await svc.record({ actor: 'u', action: 'a.b', entityType: 'r', entityId: '1' });
    const row = repo.insert.mock.calls[0][0];
    expect(row.beforeJson).toBeNull();
    expect(row.afterJson).toBeNull();
  });
});
