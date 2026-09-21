import { IsNotEmpty, IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RefundTransactionDto {
  @ApiPropertyOptional({ example: '100.00', description: 'Optional refund amount (defaults to full original transaction amount)' })
  @IsNumberString()
  @IsOptional()
  amount?: string;

  @ApiProperty({ example: 'Customer requested service cancellation and merchant approved refund' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

