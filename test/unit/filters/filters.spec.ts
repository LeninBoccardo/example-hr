import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { DomainExceptionFilter } from '@timeoff/common/filters/domain-exception.filter';
import { HcmExceptionFilter } from '@timeoff/common/filters/hcm-exception.filter';
import {
  DomainError,
  InsufficientBalanceError,
  InvalidStateTransitionError,
  InvalidDateRangeError,
} from '@timeoff/domain/errors';
import { HcmError, HcmErrorCode } from '@timeoff/hcm/hcm.errors';

function makeHost(req: Record<string, unknown> = { method: 'POST', url: '/x' }) {
  const status = jest.fn().mockReturnThis();
  const json = jest.fn().mockReturnThis();
  return {
    host: {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ status, json }) }),
    } as unknown as ArgumentsHost,
    status,
    json,
  };
}

describe('DomainExceptionFilter', () => {
  const filter = new DomainExceptionFilter();

  it('maps InsufficientBalanceError to 409', () => {
    const { host, status, json } = makeHost();
    filter.catch(new InsufficientBalanceError(2, 5), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json.mock.calls[0][0]).toMatchObject({ error: 'INSUFFICIENT_BALANCE' });
  });

  it('maps InvalidStateTransitionError to 409', () => {
    const { host, status } = makeHost();
    filter.catch(new InvalidStateTransitionError('PENDING', 'COMMITTED'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
  });

  it('maps generic DomainError (e.g., InvalidDateRangeError) to 400', () => {
    const { host, status } = makeHost();
    filter.catch(new InvalidDateRangeError('bad'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
  });

  it('maps unknown DomainError to 400', () => {
    const { host, status } = makeHost();
    filter.catch(new DomainError('FOO', 'x'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
  });
});

describe('HcmExceptionFilter', () => {
  const filter = new HcmExceptionFilter();

  it('maps INSUFFICIENT_BALANCE to 409', () => {
    const { host, status, json } = makeHost();
    filter.catch(HcmError.insufficientBalance('x'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json.mock.calls[0][0]).toMatchObject({ error: 'HCM_INSUFFICIENT_BALANCE' });
  });

  it('maps INVALID_DIMENSION to 422', () => {
    const { host, status } = makeHost();
    filter.catch(HcmError.invalidDimension('x'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  it('maps TIMEOUT to 503', () => {
    const { host, status } = makeHost();
    filter.catch(HcmError.timeout('x'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('maps CIRCUIT_OPEN to 503', () => {
    const { host, status } = makeHost();
    filter.catch(HcmError.circuitOpen('x'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('maps UPSTREAM_ERROR to 502', () => {
    const { host, status } = makeHost();
    filter.catch(HcmError.upstream('x', 500), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
  });

  it('maps UNKNOWN to 502', () => {
    const { host, status } = makeHost();
    filter.catch(HcmError.unknown('x'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
  });

  it('maps UNAUTHORIZED to 401', () => {
    const { host, status } = makeHost();
    const e = new HcmError(HcmErrorCode.UNAUTHORIZED, 'x');
    filter.catch(e, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
  });

  it('falls back to 502 BAD_GATEWAY for an unmapped error code', () => {
    const { host, status } = makeHost();
    // Forge an HcmError with a code that's not in HTTP_STATUS_BY_CODE
    const e = new HcmError('NEVER_HEARD_OF_IT' as unknown as HcmErrorCode, 'x');
    filter.catch(e, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
  });
});
