import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionStatus } from '@prisma/client';

export class ReviewDepositDto {
  @ApiProperty({ enum: [TransactionStatus.SUCCESS, TransactionStatus.FAILED], example: TransactionStatus.SUCCESS })
  @IsEnum(TransactionStatus)
  @IsNotEmpty()
  action: TransactionStatus;

  @ApiPropertyOptional({ example: 'Verified wire transfer with central settlement ledger' })
  @IsString()
  @IsOptional()
  reviewNotes?: string;
}

