import {
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InternalTransferDto {
  @ApiProperty({ example: 'acc_01...', description: 'Source Bank Account ID' })
  @IsString()
  @IsNotEmpty()
  sourceAccountId: string;

  @ApiProperty({ example: '1002384912', description: 'Destination 10-digit Silverhawk Account Number' })
  @IsString()
  @IsNotEmpty()
  destinationAccountNumber: string;

  @ApiProperty({ example: '1500.0000', description: 'Transfer amount as positive numeric string' })
  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  @Length(3, 3)
  currency: string;

  @ApiProperty({ example: 'Monthly rent split' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: '1234', description: '4-digit transaction authorization PIN' })
  @IsString()
  @IsNotEmpty()
  @Length(4, 6)
  @Matches(/^[0-9]+$/, { message: 'PIN must contain digits only' })
  pin: string;

  @ApiPropertyOptional({ example: '123456', description: '6-digit OTP verification code' })
  @IsString()
  @IsOptional()
  otp?: string;

  @ApiPropertyOptional({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}

