import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { HcmClient } from '../hcm/hcm.client';
import { Public } from '../common/auth/public.decorator';

@Controller('healthz')
export class HealthController {
  constructor(private readonly hcm: HcmClient) {}

  @Get()
  @Public()
  @HttpCode(HttpStatus.OK)
  async health(): Promise<{ status: string; hcm: 'reachable' | 'unreachable' }> {
    const reachable = await this.hcm.ping();
    return {
      status: reachable ? 'ok' : 'degraded',
      hcm: reachable ? 'reachable' : 'unreachable',
    };
  }
}
