import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { configSchema } from '@timeoff/config/config.schema';
import { AuthModule } from '@timeoff/common/auth/auth.module';
import { JwtAuthGuard } from '@timeoff/common/auth/jwt-auth.guard';
import { RolesGuard } from '@timeoff/common/auth/roles.guard';
import { IdempotencyModule } from '@timeoff/common/idempotency/idempotency.module';
import { HttpIdempotencyInterceptor } from '@timeoff/common/idempotency/http-idempotency.interceptor';
import { PersistenceModule } from '@timeoff/persistence/persistence.module';
import { BalanceModule } from '@timeoff/balance/balance.module';
import { RequestsModule } from '@timeoff/requests/requests.module';
import { HcmModule } from '@timeoff/hcm/hcm.module';
import { OutboxModule } from '@timeoff/outbox/outbox.module';
import { ReconciliationModule } from '@timeoff/reconciliation/reconciliation.module';
import { AuditModule } from '@timeoff/audit/audit.module';
import { HealthModule } from '@timeoff/health/health.module';
import { AdminModule } from '@timeoff/admin/admin.module';
import { DomainExceptionFilter } from '@timeoff/common/filters/domain-exception.filter';
import { HcmExceptionFilter } from '@timeoff/common/filters/hcm-exception.filter';
import { entities } from '@timeoff/persistence/entities';
import { TokenService } from '@timeoff/common/auth/token.service';
import { Role } from '@timeoff/common/auth/auth.types';

export interface TestAppHandle {
  app: INestApplication;
  module: TestingModule;
  dbFile: string;
  employeeToken: (employeeId: string) => string;
  managerToken: (userId?: string) => string;
  adminToken: (userId?: string) => string;
  close: () => Promise<void>;
}

export interface CreateTestAppOptions {
  hcmBaseUrl: string;
  outboxWorkerEnabled?: boolean;
  pollIntervalMs?: number;
  batchIngestSecret?: string;
}

export async function createTestApp(opts: CreateTestAppOptions): Promise<TestAppHandle> {
  const dir = join(tmpdir(), 'timeoff-tests');
  mkdirSync(dir, { recursive: true });
  const dbFile = join(dir, `${randomUUID()}.sqlite`);

  // NestJS ConfigService reads from process.env first, so override env here
  // before the module compiles. A single test file owns this process, so
  // mutating env is safe in the test harness.
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0';
  process.env.DATABASE_PATH = dbFile;
  process.env.DATABASE_SYNCHRONIZE = 'true';
  process.env.JWT_SECRET = 'test-secret-please';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.HCM_BASE_URL = opts.hcmBaseUrl;
  process.env.HCM_TIMEOUT_MS = '2000';
  process.env.HCM_MAX_RETRIES = '2';
  process.env.HCM_RETRY_BASE_MS = '5';
  process.env.HCM_CIRCUIT_FAILURE_THRESHOLD = '5';
  process.env.HCM_CIRCUIT_COOLDOWN_MS = '500';
  process.env.OUTBOX_POLL_INTERVAL_MS = String(opts.pollIntervalMs ?? 50);
  process.env.OUTBOX_MAX_ATTEMPTS = '3';
  process.env.OUTBOX_WORKER_ENABLED = opts.outboxWorkerEnabled ? 'true' : 'false';
  process.env.RECONCILE_CRON_ENABLED = 'false';
  process.env.RECONCILE_CRON_EXPRESSION = '0 */30 * * * *';
  process.env.HCM_BATCH_INGEST_SECRET = opts.batchIngestSecret ?? 'test-batch-secret';

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validationSchema: configSchema,
        validationOptions: { allowUnknown: true, abortEarly: false },
      }),
      ScheduleModule.forRoot(),
      TypeOrmModule.forRootAsync({
        useFactory: (config: ConfigService) => ({
          type: 'better-sqlite3',
          database: config.get<string>('DATABASE_PATH')!,
          entities,
          synchronize: true,
          logging: false,
        }),
        inject: [ConfigService],
      }),
      AuthModule,
      PersistenceModule,
      IdempotencyModule,
      HcmModule,
      BalanceModule,
      RequestsModule,
      OutboxModule,
      ReconciliationModule,
      AuditModule,
      HealthModule,
      AdminModule,
    ],
    providers: [
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: APP_INTERCEPTOR, useClass: HttpIdempotencyInterceptor },
    ],
  }).compile();

  const app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new DomainExceptionFilter(), new HcmExceptionFilter());
  await app.init();

  const tokens = app.get(TokenService);

  return {
    app,
    module,
    dbFile,
    employeeToken: (employeeId: string) =>
      tokens.sign(`user-${employeeId}`, employeeId, Role.EMPLOYEE),
    managerToken: (userId = 'mgr-1') => tokens.sign(userId, 'E-MGR', Role.MANAGER),
    adminToken: (userId = 'admin-1') => tokens.sign(userId, 'E-ADMIN', Role.ADMIN),
    close: async () => {
      await app.close();
    },
  };
}
