import { IsNotEmpty, IsNumberString, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TransferToBeneficiaryDto {
  @ApiProperty({ example: 'acc_checking_123', description: 'Source Bank Account ID' })
  @IsString()
  @IsNotEmpty()
  sourceAccountId: string;

  @ApiProperty({ example: '250.00', description: 'Transfer amount' })
  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @ApiProperty({ example: '1234', description: '4-digit transaction authorization PIN' })
  @IsString()
  @IsNotEmpty()
  @Length(4, 6)
  pin: string;

  @ApiPropertyOptional({ example: 'Invoice settlement' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'uuid-v4-idempotency' })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}

