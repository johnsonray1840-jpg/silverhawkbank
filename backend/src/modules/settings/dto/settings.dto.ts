import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSettingsBatchDto {
  @ApiProperty({ description: 'Key-value map of system settings' })
  @IsObject()
  @IsNotEmpty()
  settings: Record<string, any>;
}

export class TestSmtpDto {
  @ApiProperty({ description: 'Recipient email address for test message', example: 'admin@silverhawkbank.com' })
  @IsString()
  @IsNotEmpty()
  recipientEmail: string;

  @ApiProperty({ description: 'Optional custom SMTP host override' })
  @IsString()
  @IsOptional()
  smtpHost?: string;

  @ApiProperty({ description: 'Optional custom SMTP port override' })
  @IsString()
  @IsOptional()
  smtpPort?: string;
}

export class TestSmsDto {
  @ApiProperty({ description: 'Recipient phone number in E.164 format', example: '+15554928102' })
  @IsString()
  @IsNotEmpty()
  recipientPhone: string;

  @ApiProperty({ description: 'Test message content', example: 'Silverhawk Banking: SMS Gateway Test Verification' })
  @IsString()
  @IsOptional()
  message?: string;
}

