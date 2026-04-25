import { createHcmMock } from './server';

async function bootstrap() {
  const port = Number(process.env.HCM_MOCK_PORT ?? 3100);
  const mock = createHcmMock();
  const server = await mock.listen(port);
  // seed a couple of demo employees for manual exploration
  mock.store.setBalance('E1', 'NY', 10);
  mock.store.setBalance('E1', 'SF', 5);
  mock.store.setBalance('E2', 'NY', 15);
  // eslint-disable-next-line no-console
  console.log(`[hcm-mock] listening on :${server.port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[hcm-mock] failed to start', err);
  process.exit(1);
});
