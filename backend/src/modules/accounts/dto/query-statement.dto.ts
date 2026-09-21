import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionType } from '@prisma/client';

export class QueryStatementDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ example: 50, default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit?: number = 50;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ enum: TransactionType })
  @IsEnum(TransactionType)
  @IsOptional()
  type?: TransactionType;

  @ApiPropertyOptional({ example: 'Salary or wire transfer', description: 'Search keywords matching narrative or reference' })
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: ['DEBIT', 'CREDIT', 'ALL'], default: 'ALL' })
  @IsOptional()
  direction?: 'DEBIT' | 'CREDIT' | 'ALL' = 'ALL';

  @ApiPropertyOptional({ example: 'acc-uuid-1234' })
  @IsOptional()
  accountId?: string;

  @ApiPropertyOptional({ enum: ['JSON', 'CSV', 'PDF'], default: 'JSON' })
  @IsOptional()
  format?: 'JSON' | 'CSV' | 'PDF' = 'JSON';
}

