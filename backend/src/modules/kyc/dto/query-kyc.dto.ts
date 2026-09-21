import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { KycStatus, KycTier } from '@prisma/client';

export class QueryKycDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({ enum: KycStatus, example: KycStatus.PENDING })
  @IsEnum(KycStatus)
  @IsOptional()
  status?: KycStatus;

  @ApiPropertyOptional({ enum: KycTier })
  @IsEnum(KycTier)
  @IsOptional()
  tier?: KycTier;
}

