import express, { Express, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { DEFAULT_SCENARIO, ScenarioState } from './scenarios';
import { HcmStore } from './store';

export interface HcmMockServer {
  app: Express;
  listen(port: number): Promise<{ port: number; close: () => Promise<void> }>;
  store: HcmStore;
  scenario: ScenarioState;
  resetScenario(): void;
}

function inFailScope(state: ScenarioState, employeeId: string, locationId: string): boolean {
  if (!state.failScopeEmployeeId && !state.failScopeLocationId) return true;
  if (state.failScopeEmployeeId && state.failScopeEmployeeId !== employeeId) return false;
  if (state.failScopeLocationId && state.failScopeLocationId !== locationId) return false;
  return true;
}

async function applyDelay(state: ScenarioState): Promise<void> {
  if (state.delayMs > 0) {
    await new Promise((r) => setTimeout(r, state.delayMs));
  }
}

export function createHcmMock(): HcmMockServer {
  const store = new HcmStore();
  const scenario: ScenarioState = { ...DEFAULT_SCENARIO };
  const app = express();
  app.use(express.json());

  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(scenario.mode === 'server_error' ? 503 : 200).json({
      status: scenario.mode === 'server_error' ? 'down' : 'ok',
    });
  });

  app.get('/hcm/balances/:employeeId/:locationId', async (req, res) => {
    await applyDelay(scenario);
    const { employeeId, locationId } = req.params;

    if (scenario.mode === 'timeout' && inFailScope(scenario, employeeId, locationId)) {
      // simulate a never-responding server: hang for 10s then 504
      await new Promise((r) => setTimeout(r, 10000));
      return res.status(504).json({ code: 'GATEWAY_TIMEOUT', message: 'simulated timeout' });
    }
    if (scenario.mode === 'server_error' && inFailScope(scenario, employeeId, locationId)) {
      return res.status(500).json({ code: 'SERVER_ERROR', message: 'simulated 500' });
    }

    const balance = store.getBalance(employeeId, locationId);
    if (balance === undefined) {
      return res
        .status(422)
        .json({ code: 'INVALID_DIMENSION', message: 'unknown employee/location' });
    }
    const reported = balance + scenario.driftDays; // drift only affects GET, not actual debit state
    return res.json({
      employeeId,
      locationId,
      balance: reported,
      asOf: new Date().toISOString(),
    });
  });

  app.post('/hcm/balances/:employeeId/:locationId/debit', async (req, res) => {
    await applyDelay(scenario);
    const { employeeId, locationId } = req.params;
    const { days, idempotencyKey } = req.body ?? {};

    if (typeof days !== 'number' || days <= 0) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'days must be positive number' });
    }
    const idem = idempotencyKey ?? (req.headers['idempotency-key'] as string | undefined);
    if (!idem || typeof idem !== 'string') {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'idempotencyKey required' });
    }

    const existing = store.findDebit(idem);
    if (existing) {
      const currentBalance = store.getBalance(existing.employeeId, existing.locationId) ?? 0;
      return res.json({ commitId: existing.commitId, newBalance: currentBalance });
    }

    if (scenario.mode === 'timeout' && inFailScope(scenario, employeeId, locationId)) {
      await new Promise((r) => setTimeout(r, 10000));
      return res.status(504).json({ code: 'GATEWAY_TIMEOUT', message: 'simulated timeout' });
    }
    if (scenario.mode === 'server_error' && inFailScope(scenario, employeeId, locationId)) {
      return res.status(500).json({ code: 'SERVER_ERROR', message: 'simulated 500' });
    }
    if (scenario.mode === 'invalid_dimension' && inFailScope(scenario, employeeId, locationId)) {
      return res
        .status(422)
        .json({ code: 'INVALID_DIMENSION', message: 'simulated invalid employee/location' });
    }

    const current = store.getBalance(employeeId, locationId);
    if (current === undefined) {
      return res.status(422).json({
        code: 'INVALID_DIMENSION',
        message: 'unknown employee/location',
      });
    }

    const forcedInsufficient =
      scenario.mode === 'insufficient_balance' && inFailScope(scenario, employeeId, locationId);
    const actuallyInsufficient = current < days;
    if (forcedInsufficient || actuallyInsufficient) {
      return res.status(409).json({
        code: 'INSUFFICIENT_BALANCE',
        message: `balance ${current}, requested ${days}`,
      });
    }

    const newBalance = store.bumpBalance(employeeId, locationId, -days);
    const commitId = `HCM-${randomUUID()}`;
    store.recordDebit({
      idempotencyKey: idem,
      employeeId,
      locationId,
      days,
      commitId,
      appliedAt: new Date().toISOString(),
    });
    return res.json({ commitId, newBalance });
  });

  app.post('/hcm/batch', async (_req, res) => {
    const entries = store.snapshotAll();
    res.json({
      batchId: `BATCH-${randomUUID()}`,
      asOf: new Date().toISOString(),
      entries,
    });
  });

  app.post('/_test/scenario', (req, res) => {
    Object.assign(scenario, req.body ?? {});
    res.json({ scenario });
  });

  app.post('/_test/seed', (req, res) => {
    const { employeeId, locationId, balance } = req.body ?? {};
    if (!employeeId || !locationId || typeof balance !== 'number') {
      return res.status(400).json({ message: 'employeeId, locationId, balance required' });
    }
    store.setBalance(employeeId, locationId, balance);
    return res.json({ ok: true });
  });

  app.post('/_test/bump', (req, res) => {
    const { employeeId, locationId, delta } = req.body ?? {};
    if (!employeeId || !locationId || typeof delta !== 'number') {
      return res.status(400).json({ message: 'employeeId, locationId, delta required' });
    }
    const next = store.bumpBalance(employeeId, locationId, delta);
    return res.json({ balance: next });
  });

  app.post('/_test/reset', (_req, res) => {
    store.clear();
    Object.assign(scenario, DEFAULT_SCENARIO);
    res.json({ ok: true });
  });

  return {
    app,
    store,
    scenario,
    resetScenario: () => Object.assign(scenario, DEFAULT_SCENARIO),
    async listen(port: number) {
      return new Promise((resolve, reject) => {
        const server = app.listen(port, () => {
          const address = server.address();
          const actualPort = typeof address === 'object' && address ? address.port : port;
          resolve({
            port: actualPort,
            close: () =>
              new Promise<void>((resolveClose, rejectClose) => {
                server.close((err) => (err ? rejectClose(err) : resolveClose()));
              }),
          });
        });
        server.on('error', reject);
      });
    },
  };
}
