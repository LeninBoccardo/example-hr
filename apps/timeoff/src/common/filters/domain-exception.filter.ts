import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { DomainError, InsufficientBalanceError, InvalidStateTransitionError } from '../../domain/errors';

@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: DomainError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    const status = this.resolveStatus(exception);
    this.logger.warn(
      `${req.method} ${req.url} -> ${status} ${exception.code}: ${exception.message}`,
    );
    res.status(status).json({
      statusCode: status,
      error: exception.code,
      message: exception.message,
    });
  }

  private resolveStatus(err: DomainError): number {
    if (err instanceof InsufficientBalanceError) {
      return HttpStatus.CONFLICT;
    }
    if (err instanceof InvalidStateTransitionError) {
      return HttpStatus.CONFLICT;
    }
    return HttpStatus.BAD_REQUEST;
  }
}
