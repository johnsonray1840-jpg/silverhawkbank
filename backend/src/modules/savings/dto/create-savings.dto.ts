import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  IsInt,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';
import { SavingsType, AutoDebitFrequency } from '@prisma/client';

export class CreateSavingsDto {
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsEnum(SavingsType)
  @IsNotEmpty()
  type: SavingsType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsNumberString()
  @IsOptional()
  targetAmount?: string;

  @IsNumberString()
  @IsOptional()
  initialDeposit?: string;

  @IsInt()
  @Min(1)
  @Max(60)
  @IsOptional()
  durationMonths?: number;

  @IsEnum(AutoDebitFrequency)
  @IsOptional()
  autoDebitFrequency?: AutoDebitFrequency;

  @IsNumberString()
  @IsOptional()
  autoDebitAmount?: string;
}

export class TopUpSavingsDto {
  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @IsString()
  @IsNotEmpty()
  pin: string;
}

export class WithdrawSavingsDto {
  @IsNumberString()
  @IsOptional()
  amount?: string; // If omitted for FIXED_DEPOSIT, full liquidation

  @IsString()
  @IsNotEmpty()
  pin: string;

  @IsBoolean()
  @IsOptional()
  isEarlyLiquidationConsent?: boolean;
}

export class CreateSavingsGoalDto {
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsNumberString()
  @IsNotEmpty()
  targetAmount: string;

  @IsNumberString()
  @IsOptional()
  initialDeposit?: string;

  @IsString()
  @IsOptional()
  targetDate?: string;

  @IsEnum(AutoDebitFrequency)
  @IsOptional()
  autoDebitFrequency?: AutoDebitFrequency;

  @IsNumberString()
  @IsOptional()
  autoDebitAmount?: string;

  @IsBoolean()
  @IsOptional()
  roundUpEnabled?: boolean;

  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  roundUpMultiplier?: number;
}

export class CompoundCalculatorDto {
  @IsNumberString()
  @IsNotEmpty()
  principal: string;

  @IsNumberString()
  @IsOptional()
  monthlyContribution?: string;

  @IsNumberString()
  @IsOptional()
  annualRatePct?: string;

  @IsInt()
  @Min(1)
  @Max(50)
  years: number;

  @IsInt()
  @IsOptional()
  frequency?: number;
}

export class ToggleRoundUpDto {
  @IsBoolean()
  enabled: boolean;

  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  multiplier?: number;

  @IsString()
  @IsOptional()
  targetSavingsId?: string;
}

export class AccrueInterestDto {
  @IsString()
  @IsOptional()
  asOfDate?: string;

  @IsBoolean()
  @IsOptional()
  dryRun?: boolean;
}

export class ProcessRoundUpSweepDto {
  @IsNumberString()
  @IsNotEmpty()
  transactionAmount: string;

  @IsString()
  @IsNotEmpty()
  sourceAccountId: string;

  @IsString()
  @IsOptional()
  targetSavingsId?: string;
}

export class FixedDepositCalculatorDto {
  @IsNumberString()
  @IsNotEmpty()
  principal: string;

  @IsInt()
  @Min(1)
  @Max(60)
  durationMonths: number;

  @IsNumberString()
  @IsOptional()
  customRate?: string;
}

export class CreateFixedDepositDto {
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsNumberString()
  @IsNotEmpty()
  principal: string;

  @IsInt()
  @Min(1)
  @Max(60)
  durationMonths: number;

  @IsString()
  @IsOptional()
  @MaxLength(150)
  title?: string;

  @IsString()
  @IsNotEmpty()
  pin: string;

  @IsBoolean()
  @IsOptional()
  autoRollOver?: boolean;
}


