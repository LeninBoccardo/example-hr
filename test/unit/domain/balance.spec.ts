import {
  available,
  canReserve,
  reserve,
  releaseReservation,
  commitReservation,
  applyDelta,
  setAbsolute,
  toUnits,
  toDays,
} from '@timeoff/domain/balance';
import { InsufficientBalanceError, InvalidAmountError } from '@timeoff/domain/errors';

describe('balance domain', () => {
  describe('toUnits / toDays', () => {
    it('round-trips common values', () => {
      expect(toDays(toUnits(10))).toBe(10);
      expect(toDays(toUnits(0.5))).toBe(0.5);
      expect(toDays(toUnits(1.5))).toBe(1.5);
    });

    it('rejects non-finite', () => {
      expect(() => toUnits(NaN)).toThrow(InvalidAmountError);
      expect(() => toUnits(Infinity)).toThrow(InvalidAmountError);
    });

    it('rejects sub-0.1 precision', () => {
      expect(() => toUnits(0.05)).toThrow(InvalidAmountError);
      expect(() => toUnits(1.23)).toThrow(InvalidAmountError);
    });
  });

  describe('available', () => {
    it('returns balance minus reserved', () => {
      expect(available({ balanceDays: 10, reservedDays: 3 })).toBe(7);
    });

    it('is 0 when fully reserved', () => {
      expect(available({ balanceDays: 5, reservedDays: 5 })).toBe(0);
    });

    it('handles half-days without drift', () => {
      expect(available({ balanceDays: 10, reservedDays: 0.5 })).toBe(9.5);
    });
  });

  describe('reserve', () => {
    it('increases reservedDays when balance sufficient', () => {
      const next = reserve({ balanceDays: 10, reservedDays: 0 }, 3);
      expect(next.balanceDays).toBe(10);
      expect(next.reservedDays).toBe(3);
    });

    it('throws InsufficientBalanceError when over-reserving', () => {
      expect(() =>
        reserve({ balanceDays: 10, reservedDays: 8 }, 3),
      ).toThrow(InsufficientBalanceError);
    });

    it('rejects negative days', () => {
      expect(() => reserve({ balanceDays: 10, reservedDays: 0 }, -1)).toThrow(InvalidAmountError);
    });

    it('allows reserving exactly the available balance', () => {
      const next = reserve({ balanceDays: 10, reservedDays: 2 }, 8);
      expect(next.reservedDays).toBe(10);
      expect(available(next)).toBe(0);
    });
  });

  describe('canReserve', () => {
    it('returns true/false correctly at boundaries', () => {
      const s = { balanceDays: 10, reservedDays: 2 };
      expect(canReserve(s, 8)).toBe(true);
      expect(canReserve(s, 8.1)).toBe(false);
    });
  });

  describe('releaseReservation', () => {
    it('decreases reservedDays', () => {
      const next = releaseReservation({ balanceDays: 10, reservedDays: 3 }, 2);
      expect(next.reservedDays).toBe(1);
      expect(next.balanceDays).toBe(10);
    });

    it('throws if releasing more than reserved', () => {
      expect(() =>
        releaseReservation({ balanceDays: 10, reservedDays: 2 }, 3),
      ).toThrow(InvalidAmountError);
    });
  });

  describe('commitReservation', () => {
    it('deducts from both balance and reservation', () => {
      const next = commitReservation({ balanceDays: 10, reservedDays: 4 }, 3);
      expect(next.balanceDays).toBe(7);
      expect(next.reservedDays).toBe(1);
    });

    it('throws if committing more than reserved', () => {
      expect(() =>
        commitReservation({ balanceDays: 10, reservedDays: 1 }, 2),
      ).toThrow(InvalidAmountError);
    });
  });

  describe('applyDelta', () => {
    it('adds positive delta (accrual/anniversary)', () => {
      const next = applyDelta({ balanceDays: 10, reservedDays: 0 }, 5);
      expect(next.balanceDays).toBe(15);
    });

    it('subtracts negative delta', () => {
      const next = applyDelta({ balanceDays: 10, reservedDays: 0 }, -3);
      expect(next.balanceDays).toBe(7);
    });

    it('throws on going negative', () => {
      expect(() =>
        applyDelta({ balanceDays: 2, reservedDays: 0 }, -5),
      ).toThrow(InsufficientBalanceError);
    });

    it('preserves reservedDays', () => {
      const next = applyDelta({ balanceDays: 10, reservedDays: 3 }, 2);
      expect(next.reservedDays).toBe(3);
    });
  });

  describe('setAbsolute', () => {
    it('emits positive delta when HCM raises balance', () => {
      const { next, delta } = setAbsolute({ balanceDays: 10, reservedDays: 1 }, 15);
      expect(next.balanceDays).toBe(15);
      expect(next.reservedDays).toBe(1);
      expect(delta).toBe(5);
    });

    it('emits negative delta when HCM lowers balance', () => {
      const { next, delta } = setAbsolute({ balanceDays: 10, reservedDays: 1 }, 7);
      expect(next.balanceDays).toBe(7);
      expect(delta).toBe(-3);
    });

    it('emits zero delta when unchanged', () => {
      const { delta } = setAbsolute({ balanceDays: 10, reservedDays: 0 }, 10);
      expect(delta).toBe(0);
    });

    it('rejects negative absolute', () => {
      expect(() => setAbsolute({ balanceDays: 10, reservedDays: 0 }, -1)).toThrow(InvalidAmountError);
    });
  });
});
