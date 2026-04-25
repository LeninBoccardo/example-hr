export interface BalanceKey {
  employeeId: string;
  locationId: string;
}

export interface DebitRecord {
  idempotencyKey: string;
  employeeId: string;
  locationId: string;
  days: number;
  commitId: string;
  appliedAt: string;
}

export class HcmStore {
  private balances = new Map<string, number>();
  private debits = new Map<string, DebitRecord>();

  private key(employeeId: string, locationId: string): string {
    return `${employeeId}::${locationId}`;
  }

  setBalance(employeeId: string, locationId: string, balance: number): void {
    this.balances.set(this.key(employeeId, locationId), balance);
  }

  getBalance(employeeId: string, locationId: string): number | undefined {
    return this.balances.get(this.key(employeeId, locationId));
  }

  bumpBalance(employeeId: string, locationId: string, delta: number): number {
    const k = this.key(employeeId, locationId);
    const current = this.balances.get(k) ?? 0;
    const next = current + delta;
    this.balances.set(k, next);
    return next;
  }

  recordDebit(rec: DebitRecord): void {
    this.debits.set(rec.idempotencyKey, rec);
  }

  findDebit(idempotencyKey: string): DebitRecord | undefined {
    return this.debits.get(idempotencyKey);
  }

  snapshotAll(): Array<{ employeeId: string; locationId: string; balance: number }> {
    return Array.from(this.balances.entries()).map(([k, balance]) => {
      const [employeeId, locationId] = k.split('::');
      return { employeeId, locationId, balance };
    });
  }

  clear(): void {
    this.balances.clear();
    this.debits.clear();
  }
}
