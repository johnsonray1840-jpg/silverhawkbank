import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';
import { PasskeysService } from './passkeys.service';
import { PasskeysController } from './passkeys.controller';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET', 'super-secret-jwt-key-change-in-production-silverhawk-banking-2026'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRATION', '900s'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, ApiKeysController, PasskeysController],
  providers: [AuthService, ApiKeysService, PasskeysService, JwtStrategy],
  exports: [AuthService, ApiKeysService, PasskeysService, JwtModule, PassportModule],
})
export class AuthModule {}
