import { IsEnum, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OtpType } from '@prisma/client';

export class VerifyOtpDto {
  @ApiPropertyOptional({ example: 'john@example.com', description: 'Email or identifier associated with the OTP' })
  @IsOptional()
  @IsString()
  identifier?: string;

  @ApiPropertyOptional({ example: 'john@example.com', description: 'Email alias for identifier' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty({ example: '580448', description: '6-digit verification code' })
  @IsString()
  @IsNotEmpty()
  @Length(4, 10)
  code!: string;

  @ApiPropertyOptional({ enum: OtpType, example: OtpType.EMAIL_VERIFICATION, default: OtpType.EMAIL_VERIFICATION })
  @IsOptional()
  @IsEnum(OtpType)
  type?: OtpType;
}
