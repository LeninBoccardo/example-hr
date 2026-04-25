import { Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../common/auth/roles.decorator';
import { Role, AuthenticatedUser } from '../common/auth/auth.types';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { OutboxService } from '../outbox/outbox.service';
import { OutboxWorker } from '../outbox/outbox.worker';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly outbox: OutboxService,
    private readonly outboxWorker: OutboxWorker,
  ) {}

  @Post('reconcile')
  @Roles(Role.ADMIN)
  reconcile(@CurrentUser() user: AuthenticatedUser) {
    return this.reconciliation.reconcile(user.userId);
  }

  @Get('outbox')
  @Roles(Role.ADMIN)
  outboxList() {
    return this.outbox.listAll();
  }

  @Post('outbox/drain')
  @Roles(Role.ADMIN)
  async drain(): Promise<{ processed: number }> {
    const processed = await this.outboxWorker.drainOnce();
    return { processed };
  }
}
