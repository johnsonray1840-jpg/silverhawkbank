import {
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExternalTransferDto {
  @ApiProperty({ example: 'acc_01...', description: 'Source Bank Account ID' })
  @IsString()
  @IsNotEmpty()
  sourceAccountId: string;

  @ApiProperty({ example: 'Robert Downey' })
  @IsString()
  @IsNotEmpty()
  recipientName: string;

  @ApiProperty({ example: 'Barclays Bank UK' })
  @IsString()
  @IsNotEmpty()
  bankName: string;

  @ApiPropertyOptional({ example: '044' })
  @IsString()
  @IsOptional()
  bankCode?: string;

  @ApiProperty({ example: '9823746152', description: 'Recipient external account number or IBAN' })
  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @ApiPropertyOptional({ example: '021000021' })
  @IsString()
  @IsOptional()
  routingNumber?: string;

  @ApiPropertyOptional({ example: 'BARCGB22' })
  @IsString()
  @IsOptional()
  swiftBic?: string;

  @ApiProperty({ example: '2500.0000' })
  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  @Length(3, 3)
  currency: string;

  @ApiProperty({ example: 'Consulting invoice payment' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: '1234' })
  @IsString()
  @IsNotEmpty()
  @Length(4, 6)
  @Matches(/^[0-9]+$/, { message: 'PIN must contain digits only' })
  pin: string;

  @ApiPropertyOptional({ example: '123456', description: '6-digit OTP verification code' })
  @IsString()
  @IsOptional()
  otp?: string;

  @ApiPropertyOptional({ example: 'e89fa416-202b-49f1-aec6-e151459d9b3b' })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}

