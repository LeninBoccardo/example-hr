import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import { IdempotencyRepository } from '../../persistence/idempotency.repository';

const HEADER = 'idempotency-key';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * HTTP-level idempotency: if the same Idempotency-Key is replayed against the
 * same path+method+body, return the cached response verbatim. Two safety rules:
 *  1. The body hash must match the original — different body, same key = 409.
 *  2. Only mutating methods (POST/PUT/PATCH/DELETE) participate.
 */
@Injectable()
export class HttpIdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpIdempotencyInterceptor.name);

  constructor(private readonly store: IdempotencyRepository) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const method = (req.method as string).toUpperCase();
    const key = req.headers[HEADER];

    if (SAFE_METHODS.has(method) || !key || typeof key !== 'string') {
      return next.handle();
    }

    const path = req.originalUrl ?? req.url;
    const body = req.body ?? {};
    const requestHash = hash(`${method}\n${path}\n${stableStringify(body)}`);

    return from(this.store.findByKey(key)).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.method !== method || existing.path !== path) {
            throw new ConflictException(
              `Idempotency-Key reused on a different ${existing.method} ${existing.path}`,
            );
          }
          if (existing.requestHash !== requestHash) {
            throw new ConflictException(
              'Idempotency-Key reused with a different request body',
            );
          }
          res.status(existing.responseStatus);
          this.logger.debug(`idempotent replay for key=${key} -> ${existing.responseStatus}`);
          try {
            return of(JSON.parse(existing.responseBody));
          } catch {
            return of(existing.responseBody);
          }
        }
        return next.handle().pipe(
          tap(async (responseBody) => {
            try {
              await this.store.insert({
                key,
                method,
                path,
                requestHash,
                responseStatus: res.statusCode ?? 200,
                responseBody: JSON.stringify(responseBody ?? null),
                createdAt: new Date().toISOString(),
              });
            } catch (err) {
              // Two concurrent requests with the same key — losing race is fine,
              // we just don't cache. Body uniqueness is still guaranteed by the
              // domain-level idempotency in RequestsService.create.
              this.logger.debug(`idempotency cache miss-write: ${(err as Error).message}`);
            }
          }),
        );
      }),
    );
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
