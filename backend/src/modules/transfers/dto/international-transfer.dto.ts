import {
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InternationalTransferDto {
  @ApiProperty({ example: 'acc_01...', description: 'Source Bank Account ID' })
  @IsString()
  @IsNotEmpty()
  sourceAccountId: string;

  @ApiProperty({ example: 'John Smith' })
  @IsString()
  @IsNotEmpty()
  recipientName: string;

  @ApiProperty({ example: 'Barclays Bank UK' })
  @IsString()
  @IsNotEmpty()
  bankName: string;

  @ApiPropertyOptional({ example: 'BARCGB22' })
  @IsString()
  @IsOptional()
  bankCode?: string;

  @ApiProperty({ example: 'GB82BARC20040170931958', description: 'Recipient IBAN or international account number' })
  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @ApiPropertyOptional({ example: '021000021' })
  @IsString()
  @IsOptional()
  routingNumber?: string;

  @ApiProperty({ example: 'BARCGB22XXX', description: 'SWIFT/BIC code (required for international)' })
  @IsString()
  @IsNotEmpty()
  swiftBic: string;

  @ApiPropertyOptional({ example: '123 Wall Street, New York, NY 10005' })
  @IsString()
  @IsOptional()
  recipientAddress?: string;

  @ApiPropertyOptional({ example: 'United Kingdom' })
  @IsString()
  @IsOptional()
  recipientCountry?: string;

  @ApiProperty({ example: '2500.0000' })
  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  @Length(3, 3)
  currency: string;

  @ApiProperty({ example: 'Invoice payment for consulting services' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: 'Purpose of payment' })
  @IsString()
  @IsNotEmpty()
  purposeOfPayment: string;

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
