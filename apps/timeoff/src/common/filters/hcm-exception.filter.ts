import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { HcmError, HcmErrorCode } from '../../hcm/hcm.errors';

const HTTP_STATUS_BY_CODE: Record<HcmErrorCode, number> = {
  [HcmErrorCode.INSUFFICIENT_BALANCE]: HttpStatus.CONFLICT,
  [HcmErrorCode.INVALID_DIMENSION]: HttpStatus.UNPROCESSABLE_ENTITY,
  [HcmErrorCode.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
  [HcmErrorCode.TIMEOUT]: HttpStatus.SERVICE_UNAVAILABLE,
  [HcmErrorCode.CIRCUIT_OPEN]: HttpStatus.SERVICE_UNAVAILABLE,
  [HcmErrorCode.UPSTREAM_ERROR]: HttpStatus.BAD_GATEWAY,
  [HcmErrorCode.UNKNOWN]: HttpStatus.BAD_GATEWAY,
};

@Catch(HcmError)
export class HcmExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HcmExceptionFilter.name);

  catch(exception: HcmError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    const status = HTTP_STATUS_BY_CODE[exception.code] ?? HttpStatus.BAD_GATEWAY;
    this.logger.warn(
      `${req.method} ${req.url} -> ${status} HCM_${exception.code}: ${exception.message}`,
    );
    res.status(status).json({
      statusCode: status,
      error: `HCM_${exception.code}`,
      message: exception.message,
    });
  }
}
