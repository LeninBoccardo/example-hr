import { createTestApp, TestAppHandle } from '../../integration/helpers/app-factory';
import { startMockHcm, HcmMockFixture } from '../../integration/helpers/mock-hcm-fixture';
import { HcmClient } from '@timeoff/hcm/hcm.client';
import { BalanceService } from '@timeoff/balance/balance.service';
import { DataSource } from 'typeorm';
import { entities } from '@timeoff/persistence/entities';

export interface E2EFixture {
  app: TestAppHandle;
  hcm: HcmMockFixture;
  reset(): Promise<void>;
  seedBalance(employeeId: string, locationId: string, balance: number): Promise<void>;
  closeAll(): Promise<void>;
}

export async function bootE2E(opts: { outboxWorkerEnabled?: boolean } = {}): Promise<E2EFixture> {
  const hcm = await startMockHcm();
  const app = await createTestApp({
    hcmBaseUrl: hcm.baseUrl,
    outboxWorkerEnabled: opts.outboxWorkerEnabled ?? false,
    pollIntervalMs: 50,
  });
  return {
    app,
    hcm,
    async reset() {
      hcm.mock.store.clear();
      hcm.mock.resetScenario();
      app.app.get(HcmClient).getCircuit().reset();
      const ds = app.app.get(DataSource);
      // Order matters only loosely (no FKs), but clear children-ish first.
      for (const e of entities) {
        await ds.getRepository(e).clear();
      }
    },
    async seedBalance(employeeId, locationId, balance) {
      hcm.mock.store.setBalance(employeeId, locationId, balance);
      await app.app.get(BalanceService).refreshFromHcm(employeeId, locationId, 'system:seed');
    },
    async closeAll() {
      await app.close();
      await hcm.close();
    },
  };
}

export const isoDate = (offsetDays: number, base = new Date('2026-06-01T00:00:00Z')): string => {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};
