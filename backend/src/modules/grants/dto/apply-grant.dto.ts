import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { GrantStatus } from '@prisma/client';

export class ApplyGrantDto {
  @IsString()
  @IsNotEmpty()
  programId: string;

  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsNumberString()
  @IsNotEmpty()
  requestedAmount: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  businessName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  businessType: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  registrationNum: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  taxId?: string;

  @IsNumberString()
  @IsOptional()
  annualTurnover?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  employeeCount?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  proposalTitle: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  proposalDetails: string;

  @IsOptional()
  milestones?: any;

  @IsString()
  @IsOptional()
  pin?: string;
}

export class ReviewGrantDto {
  @IsEnum(GrantStatus)
  @IsNotEmpty()
  status: GrantStatus;

  @IsNumberString()
  @IsOptional()
  approvedAmount?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  reviewNotes?: string;
}

export class DisburseGrantDto {
  @IsString()
  @IsOptional()
  accountId?: string;

  @IsString()
  @IsOptional()
  pin?: string;
}

