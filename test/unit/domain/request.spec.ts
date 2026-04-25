import {
  RequestStatus,
  canTransition,
  assertTransition,
  isTerminal,
  holdsReservation,
  countDaysInclusive,
} from '@timeoff/domain/request';
import { InvalidDateRangeError, InvalidStateTransitionError } from '@timeoff/domain/errors';

describe('request state machine', () => {
  describe('canTransition', () => {
    it('permits PENDING → APPROVED/REJECTED/CANCELLED', () => {
      expect(canTransition(RequestStatus.PENDING, RequestStatus.APPROVED)).toBe(true);
      expect(canTransition(RequestStatus.PENDING, RequestStatus.REJECTED)).toBe(true);
      expect(canTransition(RequestStatus.PENDING, RequestStatus.CANCELLED)).toBe(true);
    });

    it('permits APPROVED → COMMITTED/FAILED', () => {
      expect(canTransition(RequestStatus.APPROVED, RequestStatus.COMMITTED)).toBe(true);
      expect(canTransition(RequestStatus.APPROVED, RequestStatus.FAILED)).toBe(true);
    });

    it('forbids terminal exits', () => {
      const terminals = [
        RequestStatus.COMMITTED,
        RequestStatus.REJECTED,
        RequestStatus.CANCELLED,
        RequestStatus.FAILED,
      ];
      for (const from of terminals) {
        for (const to of Object.values(RequestStatus)) {
          expect(canTransition(from, to)).toBe(false);
        }
      }
    });

    it('forbids skipping APPROVED → CANCELLED (cannot cancel once approved)', () => {
      expect(canTransition(RequestStatus.APPROVED, RequestStatus.CANCELLED)).toBe(false);
      expect(canTransition(RequestStatus.APPROVED, RequestStatus.REJECTED)).toBe(false);
    });

    it('forbids PENDING → COMMITTED (must go through APPROVED)', () => {
      expect(canTransition(RequestStatus.PENDING, RequestStatus.COMMITTED)).toBe(false);
      expect(canTransition(RequestStatus.PENDING, RequestStatus.FAILED)).toBe(false);
    });
  });

  describe('assertTransition', () => {
    it('throws on invalid', () => {
      expect(() =>
        assertTransition(RequestStatus.PENDING, RequestStatus.COMMITTED),
      ).toThrow(InvalidStateTransitionError);
    });

    it('does not throw on valid', () => {
      expect(() =>
        assertTransition(RequestStatus.PENDING, RequestStatus.APPROVED),
      ).not.toThrow();
    });
  });

  describe('isTerminal', () => {
    it('identifies terminals', () => {
      expect(isTerminal(RequestStatus.COMMITTED)).toBe(true);
      expect(isTerminal(RequestStatus.REJECTED)).toBe(true);
      expect(isTerminal(RequestStatus.CANCELLED)).toBe(true);
      expect(isTerminal(RequestStatus.FAILED)).toBe(true);
    });

    it('rejects non-terminals', () => {
      expect(isTerminal(RequestStatus.PENDING)).toBe(false);
      expect(isTerminal(RequestStatus.APPROVED)).toBe(false);
    });
  });

  describe('holdsReservation', () => {
    it('is true for PENDING and APPROVED', () => {
      expect(holdsReservation(RequestStatus.PENDING)).toBe(true);
      expect(holdsReservation(RequestStatus.APPROVED)).toBe(true);
    });

    it('is false for terminals', () => {
      expect(holdsReservation(RequestStatus.COMMITTED)).toBe(false);
      expect(holdsReservation(RequestStatus.REJECTED)).toBe(false);
      expect(holdsReservation(RequestStatus.CANCELLED)).toBe(false);
      expect(holdsReservation(RequestStatus.FAILED)).toBe(false);
    });
  });
});

describe('countDaysInclusive', () => {
  it('returns 1 when start == end', () => {
    expect(countDaysInclusive(new Date('2026-04-24'), new Date('2026-04-24'))).toBe(1);
  });

  it('returns 5 for Mon–Fri inclusive', () => {
    expect(countDaysInclusive(new Date('2026-04-20'), new Date('2026-04-24'))).toBe(5);
  });

  it('spans months correctly', () => {
    expect(countDaysInclusive(new Date('2026-04-28'), new Date('2026-05-02'))).toBe(5);
  });

  it('throws when end before start', () => {
    expect(() =>
      countDaysInclusive(new Date('2026-04-24'), new Date('2026-04-20')),
    ).toThrow(InvalidDateRangeError);
  });

  it('throws on invalid dates (start)', () => {
    expect(() => countDaysInclusive(new Date('not-a-date'), new Date('2026-04-20'))).toThrow(
      InvalidDateRangeError,
    );
  });

  it('throws on invalid dates (end)', () => {
    expect(() => countDaysInclusive(new Date('2026-04-20'), new Date('not-a-date'))).toThrow(
      InvalidDateRangeError,
    );
  });

  it('throws when start arg is not a Date instance', () => {
    expect(() =>
      countDaysInclusive('2026-04-20' as unknown as Date, new Date('2026-04-21')),
    ).toThrow(InvalidDateRangeError);
  });

  it('throws when end arg is not a Date instance', () => {
    expect(() =>
      countDaysInclusive(new Date('2026-04-20'), '2026-04-21' as unknown as Date),
    ).toThrow(InvalidDateRangeError);
  });
});
