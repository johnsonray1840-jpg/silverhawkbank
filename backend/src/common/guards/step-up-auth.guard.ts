import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TotpUtil } from '../utils/totp.util';
import { CryptoUtil } from '../utils/crypto.util';

@Injectable()
export class StepUpAuthGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.id) {
      throw new UnauthorizedException('Authentication required');
    }

    const fullUser = await this.prisma.user.findUnique({
      where: { id: user.id },
    });

    if (!fullUser) {
      throw new UnauthorizedException('User not found');
    }

    // If user does not have 2FA enabled, allow or check PIN
    if (!fullUser.twoFactorEnabled || !fullUser.twoFactorSecret) {
      return true;
    }

    const twoFactorHeader = request.headers['x-2fa-code'] || request.body?.twoFactorCode;
    if (!twoFactorHeader) {
      throw new ForbiddenException({
        message: 'Step-up authentication required. Please provide a 2FA TOTP code in X-2FA-Code header.',
        requiresStepUp: true,
      });
    }

    const isValid = TotpUtil.verifyTotp(twoFactorHeader, fullUser.twoFactorSecret, 1);
    if (!isValid) {
      throw new ForbiddenException('Invalid or expired 2FA code');
    }

    return true;
  }
}

