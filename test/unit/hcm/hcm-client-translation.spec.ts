import axios from 'axios';
import { HcmClient } from '@timeoff/hcm/hcm.client';
import { HcmError, HcmErrorCode } from '@timeoff/hcm/hcm.errors';

function buildClient(baseURL: string, timeoutMs = 100): HcmClient {
  const config = {
    get: (key: string) => {
      const map: Record<string, unknown> = {
        HCM_BASE_URL: baseURL,
        HCM_TIMEOUT_MS: timeoutMs,
        HCM_MAX_RETRIES: 1,
        HCM_RETRY_BASE_MS: 1,
        HCM_CIRCUIT_FAILURE_THRESHOLD: 50,
        HCM_CIRCUIT_COOLDOWN_MS: 1000,
      };
      return map[key];
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new HcmClient(config as any);
}

describe('HcmClient error translation', () => {
  // Bind to a dead port (port 1 reserved on most systems)
  const DEAD = 'http://127.0.0.1:1';

  it('translates connection refused to upstream error', async () => {
    const client = buildClient(DEAD);
    await expect(client.getBalance('E', 'L')).rejects.toBeInstanceOf(HcmError);
    try {
      await client.getBalance('E', 'L');
    } catch (err) {
      expect(err).toBeInstanceOf(HcmError);
      expect((err as HcmError).retryable).toBe(true);
    }
  });

  it('returns false on ping when HCM is down', async () => {
    const client = buildClient(DEAD);
    const reachable = await client.ping();
    expect(reachable).toBe(false);
  });

  it('translates 422 with INVALID_DIMENSION code from a tiny stub server', async () => {
    const http = require('http');
    const server = http.createServer((_req: unknown, res: { writeHead: (s: number, h: object) => void; end: (b: string) => void }) => {
      res.writeHead(422, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'INVALID_DIMENSION', message: 'unknown employee' }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    const client = buildClient(`http://127.0.0.1:${port}`);
    try {
      await expect(client.getBalance('E', 'L')).rejects.toMatchObject({
        code: HcmErrorCode.INVALID_DIMENSION,
        retryable: false,
      });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('translates 409 with INSUFFICIENT_BALANCE code on debit', async () => {
    const http = require('http');
    const server = http.createServer((_req: unknown, res: { writeHead: (s: number, h: object) => void; end: (b: string) => void }) => {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'INSUFFICIENT_BALANCE', message: 'over budget' }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    const client = buildClient(`http://127.0.0.1:${port}`);
    try {
      await expect(client.debit('E', 'L', 1, 'idem-1')).rejects.toMatchObject({
        code: HcmErrorCode.INSUFFICIENT_BALANCE,
        retryable: false,
      });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('translates plain 500 to upstream retryable error', async () => {
    const http = require('http');
    const server = http.createServer((_req: unknown, res: { writeHead: (s: number) => void; end: () => void }) => {
      res.writeHead(500);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    const client = buildClient(`http://127.0.0.1:${port}`);
    try {
      await expect(client.getBalance('E', 'L')).rejects.toMatchObject({
        code: HcmErrorCode.UPSTREAM_ERROR,
        retryable: true,
      });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

// Suppress unused axios reference warning while keeping a hint that direct
// use of axios in tests should also work the same way.
void axios;
