import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WithdrawalStatus } from '@prisma/client';

export class ReviewWithdrawalDto {
  @ApiProperty({
    enum: [WithdrawalStatus.APPROVED, WithdrawalStatus.COMPLETED, WithdrawalStatus.REJECTED],
    example: WithdrawalStatus.COMPLETED,
  })
  @IsEnum(WithdrawalStatus)
  @IsNotEmpty()
  status: WithdrawalStatus;

  @ApiPropertyOptional({ example: 'Wire payout settled via Fedwire' })
  @IsString()
  @IsOptional()
  reason?: string;
}

