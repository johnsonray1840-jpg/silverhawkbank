import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ResponseEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
  meta?: any;
}

@Injectable()
export class ResponseEnvelopeInterceptor<T>
  implements NestInterceptor<T, ResponseEnvelope<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ResponseEnvelope<T>> {
    return next.handle().pipe(
      map((result) => {
        // If result already matches envelope, return as is
        if (result && typeof result === 'object' && 'success' in result && 'data' in result) {
          return result;
        }

        let data = result;
        let message = 'Operation completed successfully';
        let meta = undefined;

        if (result && typeof result === 'object') {
          if ('message' in result && typeof result.message === 'string') {
            message = result.message;
          }
          if ('meta' in result) {
            meta = result.meta;
          }
          // Only extract `data` if it is a pure envelope wrapper without pagination metrics
          if ('data' in result && !('total' in result) && !('totalPages' in result) && !('page' in result)) {
            data = result.data;
          }
        }

        return {
          success: true,
          message,
          data,
          ...(meta ? { meta } : {}),
        };
      }),
    );
  }
}

