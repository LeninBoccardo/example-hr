import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  locationId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
