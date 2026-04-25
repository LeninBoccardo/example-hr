import * as Joi from 'joi';

export const configSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_PATH: Joi.string().default('data/timeoff.sqlite'),
  DATABASE_SYNCHRONIZE: Joi.boolean().default(false),
  JWT_SECRET: Joi.string().min(8).required(),
  JWT_EXPIRES_IN: Joi.string().default('1h'),
  HCM_BASE_URL: Joi.string().uri().required(),
  HCM_TIMEOUT_MS: Joi.number().default(5000),
  HCM_MAX_RETRIES: Joi.number().default(3),
  HCM_RETRY_BASE_MS: Joi.number().default(100),
  HCM_CIRCUIT_FAILURE_THRESHOLD: Joi.number().default(5),
  HCM_CIRCUIT_COOLDOWN_MS: Joi.number().default(30000),
  OUTBOX_POLL_INTERVAL_MS: Joi.number().default(2000),
  OUTBOX_MAX_ATTEMPTS: Joi.number().default(5),
  OUTBOX_WORKER_ENABLED: Joi.boolean().default(true),
  RECONCILE_CRON_ENABLED: Joi.boolean().default(false),
  RECONCILE_CRON_EXPRESSION: Joi.string().default('0 */15 * * * *'),
  HCM_BATCH_INGEST_SECRET: Joi.string().min(8).default('batch-ingest-shared-secret'),
});

export interface AppConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  DATABASE_PATH: string;
  DATABASE_SYNCHRONIZE: boolean;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  HCM_BASE_URL: string;
  HCM_TIMEOUT_MS: number;
  HCM_MAX_RETRIES: number;
  HCM_RETRY_BASE_MS: number;
  HCM_CIRCUIT_FAILURE_THRESHOLD: number;
  HCM_CIRCUIT_COOLDOWN_MS: number;
  OUTBOX_POLL_INTERVAL_MS: number;
  OUTBOX_MAX_ATTEMPTS: number;
  OUTBOX_WORKER_ENABLED: boolean;
  RECONCILE_CRON_ENABLED: boolean;
  RECONCILE_CRON_EXPRESSION: string;
  HCM_BATCH_INGEST_SECRET: string;
}
