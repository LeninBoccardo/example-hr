import { HcmError } from './hcm.errors';

export interface RetryPolicy {
  maxAttempts: number;
  baseMs: number;
  maxMs?: number;
  jitter?: boolean;
}

export function computeDelay(attempt: number, policy: RetryPolicy, rand = Math.random): number {
  const base = policy.baseMs * Math.pow(2, Math.max(0, attempt - 1));
  const capped = policy.maxMs ? Math.min(base, policy.maxMs) : base;
  if (policy.jitter === false) {
    return capped;
  }
  return Math.floor(capped * (0.5 + rand() * 0.5));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof HcmError ? err.retryable : true;
      if (!retryable || attempt === policy.maxAttempts) {
        throw err;
      }
      await sleep(computeDelay(attempt, policy));
    }
  }
  throw lastErr;
}
