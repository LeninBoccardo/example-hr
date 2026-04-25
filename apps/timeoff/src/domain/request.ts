import { InvalidDateRangeError, InvalidStateTransitionError } from './errors';

export enum RequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  COMMITTED = 'COMMITTED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

const VALID_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  [RequestStatus.PENDING]: [
    RequestStatus.APPROVED,
    RequestStatus.REJECTED,
    RequestStatus.CANCELLED,
  ],
  [RequestStatus.APPROVED]: [RequestStatus.COMMITTED, RequestStatus.FAILED],
  [RequestStatus.COMMITTED]: [],
  [RequestStatus.REJECTED]: [],
  [RequestStatus.CANCELLED]: [],
  [RequestStatus.FAILED]: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RequestStatus, to: RequestStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}

export function isTerminal(status: RequestStatus): boolean {
  return VALID_TRANSITIONS[status].length === 0;
}

/**
 * Returns true if the request is still "holding" balance (i.e., the reservation
 * should still be counted toward `reserved_days`). Applies to PENDING and
 * APPROVED (APPROVED briefly before COMMITTED or FAILED).
 */
export function holdsReservation(status: RequestStatus): boolean {
  return status === RequestStatus.PENDING || status === RequestStatus.APPROVED;
}

/**
 * Counts business/calendar days inclusive of both start and end.
 * Simplification: no weekend/holiday calendar — HCM owns the true calendar;
 * we use inclusive calendar-day counting, which is deterministic and testable.
 */
export function countDaysInclusive(start: Date, end: Date): number {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    throw new InvalidDateRangeError('startDate is not a valid Date');
  }
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
    throw new InvalidDateRangeError('endDate is not a valid Date');
  }
  if (end.getTime() < start.getTime()) {
    throw new InvalidDateRangeError('endDate must be >= startDate');
  }
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.round((endUtc - startUtc) / MS_PER_DAY) + 1;
}
