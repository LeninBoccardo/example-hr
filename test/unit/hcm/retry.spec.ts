import { computeDelay, withRetry } from '@timeoff/hcm/retry';
import { HcmError } from '@timeoff/hcm/hcm.errors';

describe('computeDelay', () => {
  it('returns base on attempt 1 without jitter', () => {
    expect(computeDelay(1, { maxAttempts: 3, baseMs: 100, jitter: false })).toBe(100);
  });

  it('doubles per attempt (exponential)', () => {
    expect(computeDelay(2, { maxAttempts: 3, baseMs: 100, jitter: false })).toBe(200);
    expect(computeDelay(3, { maxAttempts: 3, baseMs: 100, jitter: false })).toBe(400);
  });

  it('caps at maxMs', () => {
    expect(
      computeDelay(5, { maxAttempts: 5, baseMs: 100, jitter: false, maxMs: 500 }),
    ).toBe(500);
  });

  it('applies jitter in [0.5, 1.0] of the computed delay', () => {
    const d = computeDelay(2, { maxAttempts: 3, baseMs: 100 }, () => 0);
    expect(d).toBe(100); // 200 * 0.5
    const d2 = computeDelay(2, { maxAttempts: 3, baseMs: 100 }, () => 0.999);
    expect(d2).toBeGreaterThanOrEqual(199);
    expect(d2).toBeLessThanOrEqual(200);
  });
});

describe('withRetry', () => {
  const noSleep = async () => undefined;

  it('returns result on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3, baseMs: 10 }, noSleep);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries retryable HcmError up to maxAttempts', async () => {
    const fn = jest.fn().mockRejectedValue(HcmError.timeout('slow'));
    await expect(
      withRetry(fn, { maxAttempts: 3, baseMs: 10 }, noSleep),
    ).rejects.toBeInstanceOf(HcmError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable HcmError', async () => {
    const fn = jest.fn().mockRejectedValue(HcmError.insufficientBalance('nope'));
    await expect(
      withRetry(fn, { maxAttempts: 3, baseMs: 10 }, noSleep),
    ).rejects.toBeInstanceOf(HcmError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('succeeds on an intermediate attempt', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(HcmError.timeout('1'))
      .mockRejectedValueOnce(HcmError.upstream('2', 500))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { maxAttempts: 5, baseMs: 1 }, noSleep);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries generic (non-Hcm) errors by default', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(
      withRetry(fn, { maxAttempts: 2, baseMs: 1 }, noSleep),
    ).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
