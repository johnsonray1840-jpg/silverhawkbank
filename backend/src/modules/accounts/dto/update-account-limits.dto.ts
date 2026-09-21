import { IsNumberString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAccountLimitsDto {
  @ApiPropertyOptional({ example: '50000.0000' })
  @IsNumberString()
  @IsOptional()
  dailyTransferLimit?: string;

  @ApiPropertyOptional({ example: '20000.0000' })
  @IsNumberString()
  @IsOptional()
  dailyWithdrawalLimit?: string;
}

