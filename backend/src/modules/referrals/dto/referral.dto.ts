import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class ProcessReferralRewardDto {
  @ApiProperty({ description: 'ID of the referred user who met qualification criteria' })
  @IsUUID()
  @IsNotEmpty()
  referredUserId: string;

  @ApiPropertyOptional({ description: 'Custom reward bonus amount override (defaults to platform setting)' })
  @IsNumberString()
  @IsOptional()
  customAmount?: string;

  @ApiPropertyOptional({ description: 'Currency code for reward', default: 'USD' })
  @IsString()
  @IsOptional()
  currencyCode?: string;

  @ApiPropertyOptional({ description: 'Administrative note / reason for bonus' })
  @IsString()
  @IsOptional()
  note?: string;
}

export class QueryReferralsDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ description: 'Filter by paid status' })
  @IsOptional()
  isPaid?: boolean;
}

