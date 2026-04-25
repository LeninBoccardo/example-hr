import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditRepository } from '../persistence/audit.repository';

export interface AuditArgs {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

@Injectable()
export class AuditService {
  constructor(private readonly repo: AuditRepository) {}

  async record(args: AuditArgs, manager?: EntityManager): Promise<void> {
    const row = {
      actor: args.actor,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      beforeJson: args.before === undefined ? null : JSON.stringify(args.before),
      afterJson: args.after === undefined ? null : JSON.stringify(args.after),
      occurredAt: new Date().toISOString(),
    };
    if (manager) {
      await this.repo.insertTx(manager, row);
    } else {
      await this.repo.insert(row);
    }
  }
}
