import { Global, Module } from '@nestjs/common';
import { HcmClient } from './hcm.client';

@Global()
@Module({
  providers: [HcmClient],
  exports: [HcmClient],
})
export class HcmModule {}
