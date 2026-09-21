import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Headers,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PasskeysService } from './passkeys.service';
import {
  LoginPasskeyChallengeDto,
  VerifyPasskeyLoginDto,
  VerifyPasskeyRegistrationDto,
} from './dto/passkeys.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('FIDO2 & Biometric Passkeys')
@Controller('auth/passkeys')
export class PasskeysController {
  constructor(private readonly passkeysService: PasskeysService) {}

  @Post('register-challenge')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate WebAuthn registration challenge for browser navigator.credentials.create()' })
  async createRegistrationChallenge(@CurrentUser('id') userId: string) {
    return this.passkeysService.createRegistrationChallenge(userId);
  }

  @Post('register-verify')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Verify WebAuthn credential and register biometric Passkey' })
  async verifyRegistration(
    @CurrentUser('id') userId: string,
    @Body() dto: VerifyPasskeyRegistrationDto,
  ) {
    return this.passkeysService.verifyRegistration(userId, dto);
  }

  @Post('login-challenge')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate WebAuthn assertion challenge for passwordless biometric login' })
  async createLoginChallenge(@Body() dto: LoginPasskeyChallengeDto) {
    return this.passkeysService.createLoginChallenge(dto);
  }

  @Post('login-verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify biometric assertion and authenticate user with JWT' })
  @ApiResponse({ status: 200, description: 'Biometric authentication successful' })
  async verifyLogin(
    @Body() dto: VerifyPasskeyLoginDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.passkeysService.verifyLogin(dto, ipAddress, userAgent);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List all registered biometric devices and hardware keys' })
  async getUserPasskeys(@CurrentUser('id') userId: string) {
    return this.passkeysService.getUserPasskeys(userId);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Revoke a registered biometric Passkey' })
  async revokePasskey(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.passkeysService.revokePasskey(userId, id);
  }
}

