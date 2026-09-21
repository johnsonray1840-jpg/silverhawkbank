import {
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequestWithdrawalDto {
  @ApiProperty({ example: 'acc_01...', description: 'Source Bank Account ID' })
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @ApiProperty({ example: '2500.0000', description: 'Withdrawal amount' })
  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  @Length(3, 3)
  currency: string;

  @ApiProperty({ example: 'Chase Bank USA', description: 'Destination Bank Name' })
  @IsString()
  @IsNotEmpty()
  bankName: string;

  @ApiProperty({ example: 'John Smith', description: 'Account Holder Name' })
  @IsString()
  @IsNotEmpty()
  accountName: string;

  @ApiProperty({ example: '9876543210', description: 'Destination Account Number or IBAN' })
  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @ApiPropertyOptional({ example: '021000021' })
  @IsString()
  @IsOptional()
  routingNumber?: string;

  @ApiPropertyOptional({ example: 'CHASUS33' })
  @IsString()
  @IsOptional()
  swiftBic?: string;

  @ApiPropertyOptional({ example: 'United States' })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ example: '452 Market Street, San Francisco, CA' })
  @IsString()
  @IsOptional()
  beneficiaryAddress?: string;

  @ApiPropertyOptional({ example: 'BANK_WIRE', description: 'Withdrawal method (BANK_WIRE, ACH, CRYPTO, CARD, CHECK)' })
  @IsString()
  @IsOptional()
  method?: string;

  @ApiPropertyOptional({ example: 'uuid-v4-idempotency-key' })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;

  @ApiProperty({ example: '1234', description: '4-digit transaction authorization PIN' })
  @IsString()
  @IsNotEmpty()
  @Length(4, 6)
  @Matches(/^[0-9]+$/, { message: 'PIN must contain digits only' })
  pin: string;
}

