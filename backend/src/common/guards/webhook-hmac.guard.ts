import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class WebhookHmacGuard implements CanActivate {
  private readonly secretKey = process.env.ENCRYPTION_KEY || 'silverhawk-banking-secret-key-32b!';

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const signature =
      req.headers['x-silverhawk-signature'] ||
      req.headers['x-webhook-signature'] ||
      req.headers['x-hub-signature-256'];

    if (!signature || typeof signature !== 'string') {
      throw new UnauthorizedException('Missing webhook signature header');
    }

    const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', this.secretKey)
      .update(payload)
      .digest('hex');

    const cleanSignature = signature.replace(/^sha256=/, '');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(cleanSignature, 'utf8'),
      Buffer.from(expectedSignature, 'utf8'),
    );

    if (!isValid) {
      throw new UnauthorizedException('Invalid webhook cryptographic signature');
    }

    return true;
  }
}
