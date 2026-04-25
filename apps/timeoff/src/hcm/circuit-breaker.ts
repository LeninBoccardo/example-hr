import { Injectable } from '@nestjs/common';
import { HcmError } from './hcm.errors';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitConfig {
  failureThreshold: number;
  cooldownMs: number;
  now?: () => number;
}

@Injectable()
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private openedAt: number | null = null;
  private readonly now: () => number;

  constructor(private readonly config: CircuitConfig) {
    this.now = config.now ?? (() => Date.now());
  }

  getState(): CircuitState {
    this.tryTransitionFromOpen();
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.tryTransitionFromOpen();
    if (this.state === CircuitState.OPEN) {
      throw HcmError.circuitOpen('HCM circuit is OPEN; upstream deemed unhealthy');
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.openedAt = null;
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = CircuitState.CLOSED;
    this.openedAt = null;
  }

  private onFailure(err: unknown): void {
    // Domain-level errors (insufficient balance, invalid dimension) are not
    // health signals about HCM — they're business outcomes.
    const isHealthSignal =
      !(err instanceof HcmError) ||
      err.retryable ||
      err.code === 'TIMEOUT' ||
      err.code === 'UPSTREAM_ERROR' ||
      err.code === 'UNKNOWN';
    if (!isHealthSignal) {
      return;
    }
    this.failures += 1;
    if (this.failures >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.openedAt = this.now();
    }
  }

  private tryTransitionFromOpen(): void {
    if (this.state === CircuitState.OPEN && this.openedAt !== null) {
      if (this.now() - this.openedAt >= this.config.cooldownMs) {
        this.state = CircuitState.HALF_OPEN;
      }
    }
  }
}
