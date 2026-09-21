import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import * as crypto from 'crypto';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Generate unique tracking error ID for triage
    const errorId = `ERR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const timestamp = new Date().toISOString();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected internal error occurred. Please contact customer support with your tracking ID.';
    let validationErrors: any[] = [];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res: any = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
        errorCode = res.toUpperCase().replace(/\s+/g, '_');
      } else if (typeof res === 'object' && res !== null) {
        message = res.message || message;
        errorCode = res.error || errorCode;

        if (Array.isArray(res.message)) {
          validationErrors = res.message;
          message = 'Validation failed';
          errorCode = 'VALIDATION_ERROR';
        }
      }
    } else {
      // Unhandled / system error: Log full internal details securely server-side only
      this.logger.error(
        `[${errorId}] Unhandled Internal Error on ${request.method} ${request.url}:`,
        exception instanceof Error ? exception.stack : JSON.stringify(exception),
      );

      // NEVER leak database error codes (e.g. 23505, P2002), stack traces or SQL to the client
      message = 'A secure processing error occurred. Our engineering team has been notified.';
      errorCode = 'INTERNAL_SERVER_ERROR';
    }

    // Build sanitized OWASP-compliant response payload
    const errorResponse: Record<string, any> = {
      success: false,
      errorId,
      errorCode,
      message,
      timestamp,
      path: request.url,
    };

    if (validationErrors.length > 0) {
      errorResponse.validationErrors = validationErrors;
    }

    response.status(status).json(errorResponse);
  }
}
