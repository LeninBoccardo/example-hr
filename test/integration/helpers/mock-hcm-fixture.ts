import { Server } from 'http';
import { createHcmMock, HcmMockServer } from '../../../apps/hcm-mock/src/server';

export interface HcmMockFixture {
  mock: HcmMockServer;
  baseUrl: string;
  port: number;
  close: () => Promise<void>;
}

export async function startMockHcm(): Promise<HcmMockFixture> {
  const mock = createHcmMock();
  const server = await mock.listen(0); // ephemeral port
  return {
    mock,
    baseUrl: `http://127.0.0.1:${server.port}`,
    port: server.port,
    close: () => server.close(),
  };
}

// re-export for test readability
export type { HcmMockServer, Server };
