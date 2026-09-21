import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KycStatus, KycTier } from '@prisma/client';

export class ReviewKycDto {
  @ApiProperty({ enum: [KycStatus.APPROVED, KycStatus.REJECTED, KycStatus.UNDER_REVIEW], example: KycStatus.APPROVED })
  @IsEnum(KycStatus)
  @IsNotEmpty()
  status: KycStatus;

  @ApiPropertyOptional({ enum: KycTier, example: KycTier.TIER_2 })
  @IsEnum(KycTier)
  @IsOptional()
  assignedTier?: KycTier;

  @ApiPropertyOptional({ example: 'Passport verified, address matched utility bill.' })
  @IsString()
  @IsOptional()
  reviewNotes?: string;

  @ApiPropertyOptional({ example: 'Document image is blurred and unreadable.' })
  @IsString()
  @IsOptional()
  rejectionReason?: string;

  @ApiPropertyOptional({ example: 'Please provide a clear copy of your utility bill dated within the last 3 months.' })
  @IsString()
  @IsOptional()
  requestedInfo?: string;
}


