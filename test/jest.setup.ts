import 'reflect-metadata';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-do-not-use-in-prod';
process.env.HCM_BASE_URL = process.env.HCM_BASE_URL ?? 'http://localhost:0';
process.env.HCM_TIMEOUT_MS = process.env.HCM_TIMEOUT_MS ?? '1000';
process.env.OUTBOX_POLL_INTERVAL_MS = process.env.OUTBOX_POLL_INTERVAL_MS ?? '100';
process.env.RECONCILE_CRON_ENABLED = 'false';
