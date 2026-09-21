import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KycDocumentType, KycTier } from '@prisma/client';

export class KycDocumentSubmissionDto {
  @ApiProperty({ enum: KycDocumentType, example: KycDocumentType.PASSPORT })
  @IsEnum(KycDocumentType)
  @IsNotEmpty()
  documentType: KycDocumentType;

  @ApiPropertyOptional({ example: 'P12345678' })
  @IsString()
  @IsOptional()
  documentNumber?: string;

  @ApiProperty({ example: '/uploads/kyc/passport-user123.jpg' })
  @IsString()
  @IsNotEmpty()
  filePath: string;

  @ApiPropertyOptional({ example: 'passport_scan.jpg' })
  @IsString()
  @IsOptional()
  originalFilename?: string;

  @ApiPropertyOptional({ example: 'a1b2c3d4e5f6...' })
  @IsString()
  @IsOptional()
  fileHash?: string;

  @ApiPropertyOptional({ example: '2030-12-31' })
  @IsString()
  @IsOptional()
  expiryDate?: string;

  @ApiProperty({ example: 2048576, description: 'File size in bytes' })
  @IsNumber()
  @IsNotEmpty()
  fileSize: number;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;
}

export class SubmitKycDto {
  @ApiProperty({ enum: KycTier, example: KycTier.TIER_2 })
  @IsEnum(KycTier)
  @IsNotEmpty()
  targetTier: KycTier;

  @ApiProperty({ type: [KycDocumentSubmissionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KycDocumentSubmissionDto)
  documents: KycDocumentSubmissionDto[];
}

