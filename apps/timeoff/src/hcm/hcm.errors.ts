export enum HcmErrorCode {
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INVALID_DIMENSION = 'INVALID_DIMENSION',
  UNAUTHORIZED = 'UNAUTHORIZED',
  TIMEOUT = 'TIMEOUT',
  CIRCUIT_OPEN = 'CIRCUIT_OPEN',
  UPSTREAM_ERROR = 'UPSTREAM_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export class HcmError extends Error {
  readonly code: HcmErrorCode;
  readonly retryable: boolean;
  readonly upstreamStatus?: number;

  constructor(code: HcmErrorCode, message: string, opts: { retryable?: boolean; upstreamStatus?: number } = {}) {
    super(message);
    this.name = 'HcmError';
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.upstreamStatus = opts.upstreamStatus;
  }

  static insufficientBalance(msg: string): HcmError {
    return new HcmError(HcmErrorCode.INSUFFICIENT_BALANCE, msg, { retryable: false });
  }

  static invalidDimension(msg: string): HcmError {
    return new HcmError(HcmErrorCode.INVALID_DIMENSION, msg, { retryable: false });
  }

  static timeout(msg: string): HcmError {
    return new HcmError(HcmErrorCode.TIMEOUT, msg, { retryable: true });
  }

  static circuitOpen(msg: string): HcmError {
    return new HcmError(HcmErrorCode.CIRCUIT_OPEN, msg, { retryable: true });
  }

  static upstream(msg: string, status?: number): HcmError {
    return new HcmError(HcmErrorCode.UPSTREAM_ERROR, msg, { retryable: true, upstreamStatus: status });
  }

  static unknown(msg: string): HcmError {
    return new HcmError(HcmErrorCode.UNKNOWN, msg, { retryable: true });
  }

  static unauthorized(msg: string, status?: number): HcmError {
    return new HcmError(HcmErrorCode.UNAUTHORIZED, msg, { retryable: false, upstreamStatus: status });
  }
}
