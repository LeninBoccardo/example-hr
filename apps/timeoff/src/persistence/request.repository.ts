import { Injectable } from '@nestjs/common';
import { EntityManager, In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { TimeOffRequestEntity } from './entities/time-off-request.entity';
import { RequestStatus } from '../domain/request';

export interface RequestRow {
  id: string;
  employeeId: string;
  locationId: string;
  startDate: string;
  endDate: string;
  daysRequested: number;
  status: RequestStatus;
  reason: string | null;
  createdBy: string;
  approvedBy: string | null;
  rejectedReason: string | null;
  hcmCommitId: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

@Injectable()
export class RequestRepository {
  constructor(
    @InjectRepository(TimeOffRequestEntity)
    private readonly repo: Repository<TimeOffRequestEntity>,
  ) {}

  async findById(id: string): Promise<RequestRow | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByIdTx(manager: EntityManager, id: string): Promise<RequestRow | null> {
    return manager.getRepository(TimeOffRequestEntity).findOne({ where: { id } });
  }

  async findByIdempotencyKey(key: string): Promise<RequestRow | null> {
    return this.repo.findOne({ where: { idempotencyKey: key } });
  }

  async list(filter: {
    employeeId?: string;
    status?: RequestStatus | RequestStatus[];
  }): Promise<RequestRow[]> {
    const where: Record<string, unknown> = {};
    if (filter.employeeId) {
      where.employeeId = filter.employeeId;
    }
    if (filter.status) {
      where.status = Array.isArray(filter.status) ? In(filter.status) : filter.status;
    }
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  async listPendingReservationsForEmployeeLocation(
    manager: EntityManager,
    employeeId: string,
    locationId: string,
  ): Promise<RequestRow[]> {
    return manager.getRepository(TimeOffRequestEntity).find({
      where: {
        employeeId,
        locationId,
        status: In([RequestStatus.PENDING, RequestStatus.APPROVED]),
      },
    });
  }

  async insert(row: Omit<RequestRow, 'version'>): Promise<RequestRow> {
    return this.repo.save(row as TimeOffRequestEntity);
  }

  async insertTx(
    manager: EntityManager,
    row: Omit<RequestRow, 'version'>,
  ): Promise<RequestRow> {
    return manager.getRepository(TimeOffRequestEntity).save(row as TimeOffRequestEntity);
  }

  async update(row: RequestRow): Promise<RequestRow> {
    return this.repo.save(row);
  }

  async updateTx(manager: EntityManager, row: RequestRow): Promise<RequestRow> {
    return manager.getRepository(TimeOffRequestEntity).save(row);
  }
}
