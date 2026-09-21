import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { LoanInterestType, LoanStatus } from '@prisma/client';

export class CalculateLoanDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @IsInt()
  @Min(1)
  @Max(120)
  @IsNotEmpty()
  tenureMonths: number;
}

export class ApplyLoanDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsNumberString()
  @IsNotEmpty()
  principalAmount: string;

  @IsInt()
  @Min(1)
  @Max(120)
  @IsNotEmpty()
  tenureMonths: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  purpose: string;
}

export class RepayLoanDto {
  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @IsString()
  @IsNotEmpty()
  pin: string;
}

export class ReviewLoanDto {
  @IsEnum(LoanStatus)
  @IsNotEmpty()
  status: LoanStatus; // APPROVED or REJECTED

  @IsString()
  @IsOptional()
  reviewNotes?: string;
}

export class CreateLoanProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumberString()
  @IsNotEmpty()
  minAmount: string;

  @IsNumberString()
  @IsNotEmpty()
  maxAmount: string;

  @IsNumberString()
  @IsNotEmpty()
  interestRate: string;

  @IsEnum(LoanInterestType)
  @IsOptional()
  interestType?: LoanInterestType;

  @IsInt()
  @Min(1)
  @IsNotEmpty()
  minTenureMonths: number;

  @IsInt()
  @Min(1)
  @IsNotEmpty()
  maxTenureMonths: number;

  @IsNumberString()
  @IsOptional()
  processingFeePercentage?: string;

  @IsNumberString()
  @IsOptional()
  latePenaltyPercentage?: string;
}
