import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LedgerEntryType } from '@prisma/client';

export class JournalEntryItemDto {
  @ApiProperty({ example: '1010', description: 'Ledger account code' })
  @IsString()
  @IsNotEmpty()
  accountCode: string;

  @ApiProperty({ enum: LedgerEntryType, example: LedgerEntryType.DEBIT })
  @IsEnum(LedgerEntryType)
  @IsNotEmpty()
  entryType: LedgerEntryType;

  @ApiProperty({ example: '1500.0000', description: 'Monetary amount as string for exact precision' })
  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  currencyCode: string;

  @ApiPropertyOptional({ example: '1.000000', default: '1.000000' })
  @IsNumberString()
  @IsOptional()
  exchangeRate?: string = '1.000000';
}

export class PostJournalDto {
  @ApiProperty({ example: 'JRN-TXN-1002384912' })
  @IsString()
  @IsNotEmpty()
  reference: string;

  @ApiProperty({ example: 'Customer transfer debit/credit balanced entry' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional({ example: 'txn_01...' })
  @IsString()
  @IsOptional()
  transactionId?: string;

  @ApiProperty({ type: [JournalEntryItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JournalEntryItemDto)
  entries: JournalEntryItemDto[];
}

