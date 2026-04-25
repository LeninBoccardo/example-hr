import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReconciliationService } from './reconciliation.service';
import { BatchIngestDto, BatchIngestResultDto } from './dto/batch-ingest.dto';
import { Public } from '../common/auth/public.decorator';
import { AppConfig } from '../config/config.schema';

@Controller('hcm')
export class ReconciliationController {
  constructor(
    private readonly service: ReconciliationService,
    private readonly config: ConfigService<AppConfig>,
  ) {}

  @Post('batch-ingest')
  @Public()
  async batchIngest(
    @Body() dto: BatchIngestDto,
    @Headers('x-hcm-secret') secret?: string,
  ): Promise<BatchIngestResultDto> {
    const expected = this.config.get<string>('HCM_BATCH_INGEST_SECRET', { infer: true });
    if (!secret || secret !== expected) {
      throw new UnauthorizedException('invalid or missing batch-ingest secret');
    }
    if (!Array.isArray(dto.entries)) {
      throw new BadRequestException('entries must be an array');
    }
    return this.service.ingestBatch(dto, 'hcm:batch');
  }
}
