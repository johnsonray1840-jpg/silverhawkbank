import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();

    // For POST/PUT requests with financial mutations, extract idempotency key
    if (['POST', 'PUT'].includes(req.method)) {
      const idempotencyKey =
        req.headers['idempotency-key'] ||
        req.headers['x-idempotency-key'] ||
        req.body?.idempotencyKey;

      if (idempotencyKey) {
        if (typeof idempotencyKey === 'string' && idempotencyKey.length > 255) {
          throw new BadRequestException('Idempotency-Key must not exceed 255 characters');
        }
        // Attach normalized key to request for services to consume
        req['idempotencyKey'] = idempotencyKey;
      }
    }

    return next.handle();
  }
}
