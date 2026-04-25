import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { AppConfig } from '../config/config.schema';
import { CircuitBreaker } from './circuit-breaker';
import { HcmError } from './hcm.errors';
import { withRetry } from './retry';

export interface HcmBalanceResponse {
  employeeId: string;
  locationId: string;
  balance: number;
  asOf: string;
}

export interface HcmBatchEntry {
  employeeId: string;
  locationId: string;
  balance: number;
}

export interface HcmBatchPayload {
  batchId: string;
  asOf: string;
  entries: HcmBatchEntry[];
}

export interface HcmDebitResult {
  commitId: string;
  newBalance: number;
}

@Injectable()
export class HcmClient {
  private readonly http: AxiosInstance;
  private readonly breaker: CircuitBreaker;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(config: ConfigService<AppConfig>) {
    this.http = axios.create({
      baseURL: config.get<string>('HCM_BASE_URL', { infer: true }),
      timeout: config.get<number>('HCM_TIMEOUT_MS', { infer: true }),
      validateStatus: () => true,
    });
    this.breaker = new CircuitBreaker({
      failureThreshold: config.get<number>('HCM_CIRCUIT_FAILURE_THRESHOLD', { infer: true })!,
      cooldownMs: config.get<number>('HCM_CIRCUIT_COOLDOWN_MS', { infer: true })!,
    });
    this.maxRetries = config.get<number>('HCM_MAX_RETRIES', { infer: true })!;
    this.retryBaseMs = config.get<number>('HCM_RETRY_BASE_MS', { infer: true })!;
  }

  getCircuit(): CircuitBreaker {
    return this.breaker;
  }

  async getBalance(employeeId: string, locationId: string): Promise<HcmBalanceResponse> {
    return this.executeWithResilience(() => this.doGetBalance(employeeId, locationId));
  }

  async debit(
    employeeId: string,
    locationId: string,
    days: number,
    idempotencyKey: string,
  ): Promise<HcmDebitResult> {
    return this.executeWithResilience(() =>
      this.doDebit(employeeId, locationId, days, idempotencyKey),
    );
  }

  async ping(): Promise<boolean> {
    try {
      await this.executeWithResilience(async () => {
        const res = await this.http.get('/healthz');
        if (res.status !== 200) {
          throw HcmError.upstream(`health check returned ${res.status}`, res.status);
        }
        return true;
      });
      return true;
    } catch {
      return false;
    }
  }

  private async executeWithResilience<T>(fn: () => Promise<T>): Promise<T> {
    return this.breaker.execute(() =>
      withRetry(fn, { maxAttempts: this.maxRetries, baseMs: this.retryBaseMs }),
    );
  }

  private async doGetBalance(
    employeeId: string,
    locationId: string,
  ): Promise<HcmBalanceResponse> {
    try {
      const res = await this.http.get(`/hcm/balances/${employeeId}/${locationId}`);
      return this.handleResponse(res) as HcmBalanceResponse;
    } catch (err) {
      throw this.translateAxiosError(err);
    }
  }

  private async doDebit(
    employeeId: string,
    locationId: string,
    days: number,
    idempotencyKey: string,
  ): Promise<HcmDebitResult> {
    try {
      const res = await this.http.post(
        `/hcm/balances/${employeeId}/${locationId}/debit`,
        { days, idempotencyKey },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      );
      return this.handleResponse(res) as HcmDebitResult;
    } catch (err) {
      throw this.translateAxiosError(err);
    }
  }

  private handleResponse(res: { status: number; data: unknown }): unknown {
    if (res.status >= 200 && res.status < 300) {
      return res.data;
    }
    const body = (res.data ?? {}) as { code?: string; message?: string };
    const msg = body.message ?? `HCM responded ${res.status}`;
    if (res.status === 409 && body.code === 'INSUFFICIENT_BALANCE') {
      throw HcmError.insufficientBalance(msg);
    }
    if (res.status === 422 && body.code === 'INVALID_DIMENSION') {
      throw HcmError.invalidDimension(msg);
    }
    if (res.status === 401 || res.status === 403) {
      throw HcmError.unauthorized(msg, res.status);
    }
    if (res.status >= 500) {
      throw HcmError.upstream(msg, res.status);
    }
    throw HcmError.upstream(msg, res.status);
  }

  private translateAxiosError(err: unknown): HcmError {
    if (err instanceof HcmError) {
      return err;
    }
    if (axios.isAxiosError(err)) {
      const ae = err as AxiosError;
      if (ae.code === 'ECONNABORTED' || ae.code === 'ETIMEDOUT') {
        return HcmError.timeout(ae.message);
      }
      if (ae.code === 'ECONNREFUSED' || ae.code === 'ENOTFOUND' || ae.code === 'ECONNRESET') {
        return HcmError.upstream(`network error: ${ae.code}`);
      }
      return HcmError.upstream(ae.message);
    }
    return HcmError.unknown((err as Error)?.message ?? 'unknown HCM error');
  }
}
