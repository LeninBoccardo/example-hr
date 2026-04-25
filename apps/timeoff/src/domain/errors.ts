export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export class InsufficientBalanceError extends DomainError {
  constructor(available: number, requested: number) {
    super(
      'INSUFFICIENT_BALANCE',
      `Requested ${requested} day(s) but only ${available} available`,
    );
    this.name = 'InsufficientBalanceError';
  }
}

export class InvalidStateTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super('INVALID_STATE_TRANSITION', `Cannot transition from ${from} to ${to}`);
    this.name = 'InvalidStateTransitionError';
  }
}

export class InvalidDateRangeError extends DomainError {
  constructor(message: string) {
    super('INVALID_DATE_RANGE', message);
    this.name = 'InvalidDateRangeError';
  }
}

export class InvalidAmountError extends DomainError {
  constructor(message: string) {
    super('INVALID_AMOUNT', message);
    this.name = 'InvalidAmountError';
  }
}
