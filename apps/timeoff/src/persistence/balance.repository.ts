import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { BalanceSnapshotEntity } from './entities/balance-snapshot.entity';

export interface BalanceRow {
  employeeId: string;
  locationId: string;
  balanceDays: number;
  reservedDays: number;
  version: number;
  lastHcmSyncAt: string | null;
  updatedAt: string;
}

@Injectable()
export class BalanceRepository {
  constructor(
    @InjectRepository(BalanceSnapshotEntity)
    private readonly repo: Repository<BalanceSnapshotEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async findOne(employeeId: string, locationId: string): Promise<BalanceRow | null> {
    return this.repo.findOne({ where: { employeeId, locationId } });
  }

  async findOneTx(
    manager: EntityManager,
    employeeId: string,
    locationId: string,
  ): Promise<BalanceRow | null> {
    return manager
      .getRepository(BalanceSnapshotEntity)
      .findOne({ where: { employeeId, locationId } });
  }

  async upsert(row: BalanceRow): Promise<void> {
    await this.repo.save({ ...row });
  }

  async upsertTx(manager: EntityManager, row: BalanceRow): Promise<void> {
    await manager.getRepository(BalanceSnapshotEntity).save({ ...row });
  }

  async listAll(): Promise<BalanceRow[]> {
    return this.repo.find();
  }

  /**
   * Run `fn` inside a SQLite transaction. better-sqlite3 serializes all
   * write transactions, so readers/writers never see partial state.
   */
  async withTx<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(fn);
  }
}
