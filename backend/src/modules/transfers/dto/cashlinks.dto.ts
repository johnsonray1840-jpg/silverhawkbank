import { IsDateString, IsNotEmpty, IsNumberString, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export enum CashlinkStatus {
  ACTIVE = 'ACTIVE',
  CLAIMED = 'CLAIMED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export class CreateCashlinkDto {
  @IsString()
  @IsNotEmpty()
  sourceAccountId: string;

  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 8)
  passcode: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 6)
  pin: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  note?: string;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}

export class ClaimCashlinkDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  passcode: string;

  @IsString()
  @IsNotEmpty()
  destinationAccountId: string;
}

