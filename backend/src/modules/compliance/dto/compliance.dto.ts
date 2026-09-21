import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export enum AlertType {
  SANCTIONS_HIT = 'SANCTIONS_HIT',
  PEP_MATCH = 'PEP_MATCH',
  STRUCTURING_SMURFING = 'STRUCTURING_SMURFING',
  CTR_THRESHOLD = 'CTR_THRESHOLD',
  HIGH_RISK_COUNTRY = 'HIGH_RISK_COUNTRY',
}

export enum AlertStatus {
  OPEN = 'OPEN',
  INVESTIGATING = 'INVESTIGATING',
  FALSE_POSITIVE = 'FALSE_POSITIVE',
  ESCALATED_TO_SAR = 'ESCALATED_TO_SAR',
  RESOLVED = 'RESOLVED',
}

export enum AlertSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export class ScreenEntityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsNumber()
  @IsOptional()
  threshold?: number;
}

export class ResolveAlertDto {
  @IsEnum(AlertStatus)
  @IsNotEmpty()
  status: AlertStatus;

  @IsString()
  @IsNotEmpty()
  resolutionNotes: string;
}

export class CreateSarDto {
  @IsString()
  @IsNotEmpty()
  alertId: string;

  @IsString()
  @IsNotEmpty()
  suspectName: string;

  @IsString()
  @IsNotEmpty()
  suspectAccountId: string;

  @IsString()
  @IsNotEmpty()
  amountInvolved: string;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsString()
  @IsNotEmpty()
  narrative: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  suspiciousActivityCodes?: string[];
}

