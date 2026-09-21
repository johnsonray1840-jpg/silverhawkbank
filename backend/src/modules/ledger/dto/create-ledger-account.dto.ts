import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LedgerAccountType } from '@prisma/client';

export class CreateLedgerAccountDto {
  @ApiProperty({ example: '1060', description: 'Unique ledger code' })
  @IsString()
  @IsNotEmpty()
  accountCode: string;

  @ApiProperty({ example: 'Crypto Clearing Account' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: LedgerAccountType, example: LedgerAccountType.ASSET })
  @IsEnum(LedgerAccountType)
  @IsNotEmpty()
  type: LedgerAccountType;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  currencyCode: string;

  @ApiPropertyOptional({ example: 'acc_01...' })
  @IsString()
  @IsOptional()
  bankAccountId?: string;
}

