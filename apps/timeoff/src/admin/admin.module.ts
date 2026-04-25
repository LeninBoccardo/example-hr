import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';

@Module({
  imports: [ReconciliationModule],
  controllers: [AdminController],
})
export class AdminModule {}
