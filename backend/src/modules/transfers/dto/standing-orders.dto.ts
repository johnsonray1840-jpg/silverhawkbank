import { IsString, IsNotEmpty, IsEnum, IsNumberString, IsOptional, IsInt, Min, IsDateString } from 'class-validator';

export enum StandingOrderFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  MONTHLY = 'MONTHLY',
}

export enum StandingOrderStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export class CreateStandingOrderDto {
  @IsString()
  @IsNotEmpty()
  sourceAccountId: string;

  @IsString()
  @IsNotEmpty()
  destinationAccountNumber: string;

  @IsString()
  @IsNotEmpty()
  destinationAccountName: string;

  @IsString()
  @IsOptional()
  destinationBankCode?: string;

  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsEnum(StandingOrderFrequency)
  @IsNotEmpty()
  frequency: StandingOrderFrequency;

  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxOccurrences?: number;

  @IsString()
  @IsOptional()
  narration?: string;
}

export class UpdateStandingOrderDto {
  @IsEnum(StandingOrderStatus)
  @IsOptional()
  status?: StandingOrderStatus;

  @IsNumberString()
  @IsOptional()
  amount?: string;

  @IsString()
  @IsOptional()
  narration?: string;
}

