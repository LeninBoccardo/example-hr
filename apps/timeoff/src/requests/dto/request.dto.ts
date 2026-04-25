import { IsOptional, IsString, MaxLength } from 'class-validator';
import { RequestStatus } from '../../domain/request';

export class RequestDto {
  id!: string;
  employeeId!: string;
  locationId!: string;
  startDate!: string;
  endDate!: string;
  daysRequested!: number;
  status!: RequestStatus;
  reason!: string | null;
  createdBy!: string;
  approvedBy!: string | null;
  rejectedReason!: string | null;
  hcmCommitId!: string | null;
  createdAt!: string;
  updatedAt!: string;
}

export class RejectRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CancelRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
