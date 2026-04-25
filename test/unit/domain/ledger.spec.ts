import {
  LedgerEntryType,
  LedgerEvent,
  LedgerSource,
  applyEvent,
  isDebitType,
  projectBalance,
} from '@timeoff/domain/ledger';

function ev(
  partial: Partial<LedgerEvent> & Pick<LedgerEvent, 'delta' | 'type' | 'source'>,
): LedgerEvent {
  return {
    employeeId: partial.employeeId ?? 'E1',
    locationId: partial.locationId ?? 'L1',
    delta: partial.delta,
    type: partial.type,
    source: partial.source,
    requestId: partial.requestId ?? null,
    actor: partial.actor ?? null,
    reason: partial.reason ?? null,
    occurredAt: partial.occurredAt ?? new Date('2026-04-24T10:00:00Z'),
  };
}

describe('ledger domain', () => {
  describe('projectBalance', () => {
    it('sums an empty stream to zero', () => {
      expect(projectBalance([])).toBe(0);
    });

    it('projects a typical lifecycle', () => {
      const events: LedgerEvent[] = [
        ev({ delta: 10, type: LedgerEntryType.ACCRUAL, source: LedgerSource.HCM_BATCH }),
        ev({ delta: -2, type: LedgerEntryType.DEBIT, source: LedgerSource.REQUEST }),
        ev({ delta: 1, type: LedgerEntryType.ANNIVERSARY, source: LedgerSource.HCM_BATCH }),
        ev({ delta: -1, type: LedgerEntryType.DEBIT, source: LedgerSource.REQUEST }),
        ev({ delta: 0.5, type: LedgerEntryType.MANUAL_CORRECTION, source: LedgerSource.ADMIN }),
      ];
      expect(projectBalance(events)).toBe(8.5);
    });

    it('supports half-day precision without drift', () => {
      const events: LedgerEvent[] = [];
      for (let i = 0; i < 20; i++) {
        events.push(
          ev({ delta: 0.5, type: LedgerEntryType.ACCRUAL, source: LedgerSource.HCM_BATCH }),
        );
      }
      expect(projectBalance(events)).toBe(10);
    });
  });

  describe('applyEvent', () => {
    it('adds to balance', () => {
      const next = applyEvent(
        { balanceDays: 10, reservedDays: 2 },
        ev({ delta: 5, type: LedgerEntryType.ANNIVERSARY, source: LedgerSource.HCM_BATCH }),
      );
      expect(next.balanceDays).toBe(15);
      expect(next.reservedDays).toBe(2);
    });

    it('subtracts from balance', () => {
      const next = applyEvent(
        { balanceDays: 10, reservedDays: 0 },
        ev({ delta: -3, type: LedgerEntryType.DEBIT, source: LedgerSource.REQUEST }),
      );
      expect(next.balanceDays).toBe(7);
    });

    it('throws on ledger violation (would go negative)', () => {
      expect(() =>
        applyEvent(
          { balanceDays: 1, reservedDays: 0 },
          ev({ delta: -3, type: LedgerEntryType.DEBIT, source: LedgerSource.REQUEST }),
        ),
      ).toThrow(/Ledger integrity violation/);
    });
  });

  describe('isDebitType', () => {
    it('identifies DEBIT type', () => {
      expect(isDebitType(LedgerEntryType.DEBIT)).toBe(true);
      expect(isDebitType(LedgerEntryType.ACCRUAL)).toBe(false);
      expect(isDebitType(LedgerEntryType.REFUND)).toBe(false);
    });
  });
});
