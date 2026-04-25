import { Global, Module } from '@nestjs/common';
import { HttpIdempotencyInterceptor } from './http-idempotency.interceptor';

@Global()
@Module({
  providers: [HttpIdempotencyInterceptor],
  exports: [HttpIdempotencyInterceptor],
})
export class IdempotencyModule {}
