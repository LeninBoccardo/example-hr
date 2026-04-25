import { CircuitBreaker, CircuitState } from '@timeoff/hcm/circuit-breaker';
import { HcmError } from '@timeoff/hcm/hcm.errors';

describe('CircuitBreaker', () => {
  it('starts CLOSED', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });

  it('opens after failureThreshold retryable failures', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => 0 });
    for (let i = 0; i < 3; i++) {
      await expect(
        cb.execute(async () => {
          throw HcmError.timeout('slow');
        }),
      ).rejects.toBeInstanceOf(HcmError);
    }
    expect(cb.getState()).toBe(CircuitState.OPEN);
  });

  it('rejects fast when OPEN', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => 0 });
    await expect(
      cb.execute(async () => {
        throw HcmError.timeout('slow');
      }),
    ).rejects.toThrow();
    expect(cb.getState()).toBe(CircuitState.OPEN);

    await expect(cb.execute(async () => 'ok')).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
  });

  it('transitions to HALF_OPEN after cooldown', async () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 100, now: () => now });
    await expect(
      cb.execute(async () => {
        throw HcmError.timeout('slow');
      }),
    ).rejects.toThrow();
    expect(cb.getState()).toBe(CircuitState.OPEN);
    now = 100;
    expect(cb.getState()).toBe(CircuitState.HALF_OPEN);
  });

  it('recovers to CLOSED on successful half-open call', async () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 100, now: () => now });
    await expect(
      cb.execute(async () => {
        throw HcmError.upstream('x', 500);
      }),
    ).rejects.toThrow();
    now = 200;
    await cb.execute(async () => 'ok');
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });

  it('ignores non-retryable errors as health signals', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => 0 });
    await expect(
      cb.execute(async () => {
        throw HcmError.insufficientBalance('business failure');
      }),
    ).rejects.toThrow();
    await expect(
      cb.execute(async () => {
        throw HcmError.invalidDimension('business failure');
      }),
    ).rejects.toThrow();
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });

  it('resets on success', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, cooldownMs: 1000, now: () => 0 });
    await expect(cb.execute(async () => { throw HcmError.upstream('x', 500); })).rejects.toThrow();
    await expect(cb.execute(async () => { throw HcmError.upstream('x', 500); })).rejects.toThrow();
    await cb.execute(async () => 'ok');
    await expect(cb.execute(async () => { throw HcmError.upstream('x', 500); })).rejects.toThrow();
    expect(cb.getState()).toBe(CircuitState.CLOSED); // counter reset by the success
  });
});
