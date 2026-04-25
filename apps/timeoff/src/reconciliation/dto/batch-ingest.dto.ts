import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class BatchEntryDto {
  @IsString()
  employeeId!: string;

  @IsString()
  locationId!: string;

  @IsNumber()
  @Min(0)
  balance!: number;
}

export class BatchIngestDto {
  @IsString()
  batchId!: string;

  @IsISO8601()
  asOf!: string;

  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => BatchEntryDto)
  entries!: BatchEntryDto[];
}

export class BatchIngestResultDto {
  batchId!: string;
  processedCount!: number;
  changedCount!: number;
  flaggedRequestIds!: string[];
}
