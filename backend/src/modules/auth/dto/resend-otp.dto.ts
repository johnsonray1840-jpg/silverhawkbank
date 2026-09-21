import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OtpType } from '@prisma/client';

export class ResendOtpDto {
  @ApiProperty({ example: 'john@example.com', description: 'Email address to receive the verification code' })
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @ApiPropertyOptional({ enum: OtpType, example: OtpType.EMAIL_VERIFICATION, default: OtpType.EMAIL_VERIFICATION })
  @IsOptional()
  @IsEnum(OtpType)
  type?: OtpType;
}

