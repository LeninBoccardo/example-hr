import { BalanceState, toDays, toUnits } from './balance';

export enum LedgerEntryType {
  ACCRUAL = 'ACCRUAL',
  DEBIT = 'DEBIT',
  REFUND = 'REFUND',
  HCM_SYNC_ADJUST = 'HCM_SYNC_ADJUST',
  ANNIVERSARY = 'ANNIVERSARY',
  YEARLY_REFRESH = 'YEARLY_REFRESH',
  MANUAL_CORRECTION = 'MANUAL_CORRECTION',
}

export enum LedgerSource {
  REQUEST = 'REQUEST',
  HCM_REALTIME = 'HCM_REALTIME',
  HCM_BATCH = 'HCM_BATCH',
  ADMIN = 'ADMIN',
  SYSTEM = 'SYSTEM',
}

export interface LedgerEvent {
  readonly employeeId: string;
  readonly locationId: string;
  readonly delta: number;
  readonly type: LedgerEntryType;
  readonly source: LedgerSource;
  readonly requestId?: string | null;
  readonly actor?: string | null;
  readonly reason?: string | null;
  readonly occurredAt: Date;
}

/**
 * Re-apply the projection from a stream of ledger events. Used for reconciling
 * the snapshot from the ledger (e.g., in integrity tests and recovery).
 */
export function projectBalance(events: ReadonlyArray<LedgerEvent>): number {
  const totalUnits = events.reduce((acc, ev) => acc + toUnits(ev.delta), 0);
  if (totalUnits < 0) {
    return toDays(totalUnits); // allow caller to detect bad ledger state
  }
  return toDays(totalUnits);
}

export function isDebitType(type: LedgerEntryType): boolean {
  return type === LedgerEntryType.DEBIT;
}

export function describeDelta(ev: LedgerEvent): string {
  const sign = ev.delta >= 0 ? '+' : '';
  return `${sign}${ev.delta}d (${ev.type} via ${ev.source})`;
}

/**
 * Given a prior state and a new event, compute the next state. Throws on
 * negative projected balance since that's a ledger integrity violation.
 */
export function applyEvent(state: BalanceState, ev: LedgerEvent): BalanceState {
  const nextUnits = toUnits(state.balanceDays) + toUnits(ev.delta);
  if (nextUnits < 0) {
    throw new Error(
      `Ledger integrity violation: applying ${ev.delta} to ${state.balanceDays} would go negative`,
    );
  }
  return {
    balanceDays: toDays(nextUnits),
    reservedDays: state.reservedDays,
  };
}
