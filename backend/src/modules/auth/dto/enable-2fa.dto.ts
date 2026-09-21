import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class Enable2faDto {
  @ApiProperty({ description: '6-digit TOTP code from Google Authenticator / Authy', example: '123456' })
  @IsNotEmpty()
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'Token must be a 6-digit numeric string' })
  code: string;

  @ApiProperty({ description: 'Base32 TOTP secret generated from /auth/2fa/generate' })
  @IsNotEmpty()
  @IsString()
  secret: string;
}

