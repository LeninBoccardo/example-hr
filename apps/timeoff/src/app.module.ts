import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { configSchema, AppConfig } from './config/config.schema';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { RolesGuard } from './common/auth/roles.guard';
import { AuthModule } from './common/auth/auth.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { HttpIdempotencyInterceptor } from './common/idempotency/http-idempotency.interceptor';
import { PersistenceModule } from './persistence/persistence.module';
import { BalanceModule } from './balance/balance.module';
import { RequestsModule } from './requests/requests.module';
import { HcmModule } from './hcm/hcm.module';
import { OutboxModule } from './outbox/outbox.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { AdminModule } from './admin/admin.module';
import { entities } from './persistence/entities';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: configSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig>) => ({
        type: 'better-sqlite3',
        database: config.get<string>('DATABASE_PATH', { infer: true })!,
        entities,
        synchronize: config.get<boolean>('DATABASE_SYNCHRONIZE', { infer: true }) ?? false,
        logging: false,
      }),
    }),
    AuthModule,
    PersistenceModule,
    IdempotencyModule,
    BalanceModule,
    RequestsModule,
    HcmModule,
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
})
export class AppModule {}
