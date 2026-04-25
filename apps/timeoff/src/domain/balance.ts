import { InsufficientBalanceError, InvalidAmountError } from './errors';

/**
 * Balance math is done in "tenths of a day" (integer) internally to avoid
 * floating-point drift, because half-days (0.5) are a common leave unit.
 */
const SCALE = 10;

export function toUnits(days: number): number {
  if (!Number.isFinite(days)) {
    throw new InvalidAmountError(`Not a finite number: ${days}`);
  }
  const scaled = Math.round(days * SCALE);
  if (Math.abs(scaled - days * SCALE) > 1e-6) {
    throw new InvalidAmountError(`Balance units only support 0.1-day precision, got ${days}`);
  }
  return scaled;
}

export function toDays(units: number): number {
  return units / SCALE;
}

export interface BalanceState {
  readonly balanceDays: number;
  readonly reservedDays: number;
}

export function available(state: BalanceState): number {
  return toDays(toUnits(state.balanceDays) - toUnits(state.reservedDays));
}

export function assertNonNegative(days: number, label: string): void {
  if (days < 0) {
    throw new InvalidAmountError(`${label} must be >= 0, got ${days}`);
  }
}

export function canReserve(state: BalanceState, days: number): boolean {
  assertNonNegative(days, 'days');
  return toUnits(available(state)) >= toUnits(days);
}

export function reserve(state: BalanceState, days: number): BalanceState {
  assertNonNegative(days, 'days');
  if (!canReserve(state, days)) {
    throw new InsufficientBalanceError(available(state), days);
  }
  return {
    balanceDays: state.balanceDays,
    reservedDays: toDays(toUnits(state.reservedDays) + toUnits(days)),
  };
}

export function releaseReservation(state: BalanceState, days: number): BalanceState {
  assertNonNegative(days, 'days');
  const newReserved = toUnits(state.reservedDays) - toUnits(days);
  if (newReserved < 0) {
    throw new InvalidAmountError(
      `Cannot release ${days} days; only ${state.reservedDays} reserved`,
    );
  }
  return {
    balanceDays: state.balanceDays,
    reservedDays: toDays(newReserved),
  };
}

/**
 * Commit a previously reserved amount to an actual debit: balance decreases,
 * reservation decreases. Used when a request is approved and HCM confirms.
 */
export function commitReservation(state: BalanceState, days: number): BalanceState {
  assertNonNegative(days, 'days');
  const newReserved = toUnits(state.reservedDays) - toUnits(days);
  const newBalance = toUnits(state.balanceDays) - toUnits(days);
  if (newReserved < 0) {
    throw new InvalidAmountError(
      `Cannot commit ${days} days; only ${state.reservedDays} reserved`,
    );
  }
  if (newBalance < 0) {
    throw new InsufficientBalanceError(state.balanceDays, days);
  }
  return {
    balanceDays: toDays(newBalance),
    reservedDays: toDays(newReserved),
  };
}

export function applyDelta(state: BalanceState, delta: number): BalanceState {
  const newBalance = toUnits(state.balanceDays) + toUnits(delta);
  if (newBalance < 0) {
    throw new InsufficientBalanceError(state.balanceDays, -delta);
  }
  return {
    balanceDays: toDays(newBalance),
    reservedDays: state.reservedDays,
  };
}

/**
 * Set balance to an absolute value (used when HCM pushes authoritative state).
 * Returns the delta that was applied, so a ledger entry can be recorded.
 */
export function setAbsolute(
  state: BalanceState,
  absoluteBalanceDays: number,
): { next: BalanceState; delta: number } {
  assertNonNegative(absoluteBalanceDays, 'absoluteBalanceDays');
  const deltaUnits = toUnits(absoluteBalanceDays) - toUnits(state.balanceDays);
  return {
    next: { balanceDays: absoluteBalanceDays, reservedDays: state.reservedDays },
    delta: toDays(deltaUnits),
  };
}
