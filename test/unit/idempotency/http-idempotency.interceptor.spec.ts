import { ConflictException, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { HttpIdempotencyInterceptor } from '@timeoff/common/idempotency/http-idempotency.interceptor';
import {
  IdempotencyRepository,
  IdempotencyRow,
} from '@timeoff/persistence/idempotency.repository';

class InMemoryStore implements Pick<IdempotencyRepository, 'findByKey' | 'insert'> {
  private rows = new Map<string, IdempotencyRow>();
  findByKey = jest.fn(async (key: string) => this.rows.get(key) ?? null);
  insert = jest.fn(async (row: IdempotencyRow) => {
    if (this.rows.has(row.key)) {
      throw new Error(`duplicate key ${row.key}`);
    }
    this.rows.set(row.key, row);
  });
}

function makeCtx(req: {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body?: unknown;
}, res: { statusCode?: number } = {}): ExecutionContext {
  const response = {
    statusCode: res.statusCode ?? 201,
    status: jest.fn().mockImplementation(function (this: { statusCode: number }, code: number) {
      this.statusCode = code;
      return this;
    }),
  };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

const handler = (body: unknown) => ({ handle: () => of(body) });

describe('HttpIdempotencyInterceptor', () => {
  it('passes through GET requests without consulting the store', async () => {
    const store = new InMemoryStore();
    const interceptor = new HttpIdempotencyInterceptor(store as unknown as IdempotencyRepository);
    const ctx = makeCtx({ method: 'GET', url: '/x', headers: { 'idempotency-key': 'k' } });
    const result = await lastValueFrom(
      interceptor.intercept(ctx, handler({ ok: true })),
    );
    expect(result).toEqual({ ok: true });
    expect(store.findByKey).not.toHaveBeenCalled();
  });

  it('passes through requests with no Idempotency-Key', async () => {
    const store = new InMemoryStore();
    const interceptor = new HttpIdempotencyInterceptor(store as unknown as IdempotencyRepository);
    const ctx = makeCtx({ method: 'POST', url: '/x', headers: {} });
    const result = await lastValueFrom(
      interceptor.intercept(ctx, handler({ id: 1 })),
    );
    expect(result).toEqual({ id: 1 });
    expect(store.findByKey).not.toHaveBeenCalled();
  });

  it('caches a first-time response and replays it on second call', async () => {
    const store = new InMemoryStore();
    const interceptor = new HttpIdempotencyInterceptor(store as unknown as IdempotencyRepository);
    const body = { foo: 'bar' };
    const ctx1 = makeCtx({
      method: 'POST', url: '/requests', headers: { 'idempotency-key': 'k1' }, body,
    });
    const r1 = await lastValueFrom(interceptor.intercept(ctx1, handler({ id: 'R-1' })));
    expect(r1).toEqual({ id: 'R-1' });
    // Allow microtasks: insert is in tap()
    await new Promise((r) => setImmediate(r));

    const ctx2 = makeCtx({
      method: 'POST', url: '/requests', headers: { 'idempotency-key': 'k1' }, body,
    });
    const handler2 = handler({ id: 'R-2-WOULD-BE' });
    const r2 = await lastValueFrom(interceptor.intercept(ctx2, handler2));
    expect(r2).toEqual({ id: 'R-1' });
    expect(store.insert).toHaveBeenCalledTimes(1);
  });

  it('rejects replay with a different body as 409', async () => {
    const store = new InMemoryStore();
    const interceptor = new HttpIdempotencyInterceptor(store as unknown as IdempotencyRepository);
    const ctx1 = makeCtx({
      method: 'POST', url: '/requests', headers: { 'idempotency-key': 'k2' }, body: { a: 1 },
    });
    await lastValueFrom(interceptor.intercept(ctx1, handler({ ok: true })));
    await new Promise((r) => setImmediate(r));

    const ctx2 = makeCtx({
      method: 'POST', url: '/requests', headers: { 'idempotency-key': 'k2' }, body: { a: 2 },
    });
    await expect(
      lastValueFrom(interceptor.intercept(ctx2, handler({ ok: true }))),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects replay on a different path/method as 409', async () => {
    const store = new InMemoryStore();
    const interceptor = new HttpIdempotencyInterceptor(store as unknown as IdempotencyRepository);
    const ctx1 = makeCtx({
      method: 'POST', url: '/a', headers: { 'idempotency-key': 'k3' }, body: {},
    });
    await lastValueFrom(interceptor.intercept(ctx1, handler({ ok: 1 })));
    await new Promise((r) => setImmediate(r));

    const ctx2 = makeCtx({
      method: 'POST', url: '/b', headers: { 'idempotency-key': 'k3' }, body: {},
    });
    await expect(
      lastValueFrom(interceptor.intercept(ctx2, handler({ ok: 2 }))),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('survives a duplicate insert race (cache miss-write is logged but not thrown)', async () => {
    const store = {
      findByKey: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockRejectedValue(new Error('UNIQUE constraint')),
    };
    const interceptor = new HttpIdempotencyInterceptor(store as unknown as IdempotencyRepository);
    const ctx = makeCtx({
      method: 'POST', url: '/x', headers: { 'idempotency-key': 'race' }, body: {},
    });
    const r = await lastValueFrom(interceptor.intercept(ctx, handler({ ok: true })));
    await new Promise((r) => setImmediate(r));
    expect(r).toEqual({ ok: true });
    expect(store.insert).toHaveBeenCalledTimes(1);
  });

  it('handles a request with no body (treats as empty object) and array bodies via stable stringify', async () => {
    const store = new InMemoryStore();
    const interceptor = new HttpIdempotencyInterceptor(store as unknown as IdempotencyRepository);

    // First call: no body, originalUrl missing so falls back to url
    const ctx1 = makeCtx({ method: 'POST', url: '/x', headers: { 'idempotency-key': 'k-empty' } });
    await lastValueFrom(interceptor.intercept(ctx1, handler({ ok: 1 })));
    await new Promise((r) => setImmediate(r));

    // Replay with an explicit `{}` body should match the cached response.
    const ctx2 = makeCtx({
      method: 'POST', url: '/x', headers: { 'idempotency-key': 'k-empty' }, body: {},
    });
    const r = await lastValueFrom(interceptor.intercept(ctx2, handler({ ok: 'NEVER' })));
    expect(r).toEqual({ ok: 1 });

    // Different request with array body — exercises the stable stringify array branch
    const ctx3 = makeCtx({
      method: 'POST', url: '/y', headers: { 'idempotency-key': 'k-arr' }, body: [1, 2, 3],
    });
    const r3 = await lastValueFrom(interceptor.intercept(ctx3, handler({ ok: 'arr' })));
    expect(r3).toEqual({ ok: 'arr' });
  });

  it('uses the response.statusCode default of 200 when handler did not set one', async () => {
    const store = new InMemoryStore();
    const interceptor = new HttpIdempotencyInterceptor(store as unknown as IdempotencyRepository);
    const req = { method: 'POST', url: '/no-status', headers: { 'idempotency-key': 'no-status' }, body: {} };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => req,
        // intentionally omit statusCode so the `?? 200` branch fires
        getResponse: () => ({ status: jest.fn().mockReturnThis() }),
      }),
    } as unknown as ExecutionContext;
    await lastValueFrom(interceptor.intercept(ctx, handler({ ok: true })));
    await new Promise((r) => setImmediate(r));
    expect(store.insert).toHaveBeenCalledWith(expect.objectContaining({ responseStatus: 200 }));
  });

  it('survives malformed cached body (returns the raw string)', async () => {
    const store = {
      findByKey: jest.fn().mockResolvedValue({
        key: 'k4',
        method: 'POST',
        path: '/x',
        requestHash: 'whatever',
        responseStatus: 200,
        responseBody: 'not-valid-json',
        createdAt: new Date().toISOString(),
      } satisfies IdempotencyRow),
      insert: jest.fn(),
    };
    const interceptor = new HttpIdempotencyInterceptor(store as unknown as IdempotencyRepository);
    const ctx = makeCtx({
      method: 'POST', url: '/x', headers: { 'idempotency-key': 'k4' }, body: {},
    });
    // Need matching hash for the replay to take the cached-body branch.
    // We forge by using empty body and recomputing matches. Easier: use a key
    // that doesn't match hashes -> we'd hit ConflictException. So instead,
    // use a stub findByKey that returns hash matching what the interceptor will produce.
    // Recompute hash on the fly using the same algorithm:
    const { createHash } = require('crypto');
    const hash = createHash('sha256').update(`POST\n/x\n{}`).digest('hex');
    (store.findByKey as jest.Mock).mockResolvedValue({
      key: 'k4',
      method: 'POST',
      path: '/x',
      requestHash: hash,
      responseStatus: 200,
      responseBody: 'not-valid-json',
      createdAt: new Date().toISOString(),
    });
    const r = await lastValueFrom(interceptor.intercept(ctx, handler({ ok: true })));
    expect(r).toBe('not-valid-json');
  });
});
