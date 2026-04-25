import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { entities } from './entities';
import { BalanceRepository } from './balance.repository';
import { LedgerRepository } from './ledger.repository';
import { RequestRepository } from './request.repository';
import { OutboxRepository } from './outbox.repository';
import { AuditRepository } from './audit.repository';
import { IdempotencyRepository } from './idempotency.repository';

const repos = [
  BalanceRepository,
  LedgerRepository,
  RequestRepository,
  OutboxRepository,
  AuditRepository,
  IdempotencyRepository,
];

@Global()
@Module({
  imports: [TypeOrmModule.forFeature(entities)],
  providers: repos,
  exports: [...repos, TypeOrmModule],
})
export class PersistenceModule {}
