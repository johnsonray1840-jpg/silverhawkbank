import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export enum AuditLogAction {
  // Authentication & Security
  USER_REGISTERED = 'USER_REGISTERED',
  USER_LOGGED_IN = 'USER_LOGGED_IN',
  USER_LOGGED_OUT = 'USER_LOGGED_OUT',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  PIN_CHANGED = 'PIN_CHANGED',
  TWO_FACTOR_ENABLED = 'TWO_FACTOR_ENABLED',
  TWO_FACTOR_DISABLED = 'TWO_FACTOR_DISABLED',

  // Banking Operations
  BENEFICIARY_ADDED = 'BENEFICIARY_ADDED',
  TRANSFER_INITIATED = 'TRANSFER_INITIATED',
  DEPOSIT_INITIATED = 'DEPOSIT_INITIATED',
  WITHDRAWAL_REQUESTED = 'WITHDRAWAL_REQUESTED',
  CARD_CREATED = 'CARD_CREATED',
  CARD_FROZEN = 'CARD_FROZEN',
  CARD_UNFROZEN = 'CARD_UNFROZEN',
  LOAN_APPLIED = 'LOAN_APPLIED',

  // Administrative Governance
  ADMIN_DEPOSIT_APPROVED = 'ADMIN_DEPOSIT_APPROVED',
  ADMIN_DEPOSIT_REJECTED = 'ADMIN_DEPOSIT_REJECTED',
  ADMIN_WITHDRAWAL_APPROVED = 'ADMIN_WITHDRAWAL_APPROVED',
  ADMIN_WITHDRAWAL_REJECTED = 'ADMIN_WITHDRAWAL_REJECTED',
  ADMIN_WITHDRAWAL_REVERSED = 'ADMIN_WITHDRAWAL_REVERSED',
  ADMIN_KYC_APPROVED = 'ADMIN_KYC_APPROVED',
  ADMIN_KYC_REJECTED = 'ADMIN_KYC_REJECTED',
  ADMIN_LOAN_APPROVED = 'ADMIN_LOAN_APPROVED',
  ADMIN_LOAN_REJECTED = 'ADMIN_LOAN_REJECTED',
  ADMIN_LOAN_DISBURSED = 'ADMIN_LOAN_DISBURSED',
  ADMIN_ACCOUNT_FROZEN = 'ADMIN_ACCOUNT_FROZEN',
  ADMIN_ACCOUNT_UNFROZEN = 'ADMIN_ACCOUNT_UNFROZEN',
  ADMIN_USER_SUSPENDED = 'ADMIN_USER_SUSPENDED',
  ADMIN_USER_ACTIVATED = 'ADMIN_USER_ACTIVATED',
  ADMIN_TRANSACTION_REVERSED = 'ADMIN_TRANSACTION_REVERSED',
  ADMIN_BALANCE_ADJUSTED = 'ADMIN_BALANCE_ADJUSTED',
  ADMIN_SETTINGS_CHANGED = 'ADMIN_SETTINGS_CHANGED',
  ADMIN_ROLE_ASSIGNED = 'ADMIN_ROLE_ASSIGNED',
}

export class QueryAuditLogsDto {
  @ApiPropertyOptional({ description: 'Filter by actor ID' })
  @IsString()
  @IsOptional()
  actorId?: string;

  @ApiPropertyOptional({ description: 'Filter by actor role (e.g. SUPER_ADMIN, COMPLIANCE_OFFICER, USER)' })
  @IsString()
  @IsOptional()
  actorRole?: string;

  @ApiPropertyOptional({ description: 'Filter by specific audit action' })
  @IsString()
  @IsOptional()
  action?: string;

  @ApiPropertyOptional({ description: 'Filter by target resource entity (e.g. BankAccount, User, Withdrawal, Transaction)' })
  @IsString()
  @IsOptional()
  resource?: string;

  @ApiPropertyOptional({ description: 'Filter by resource ID' })
  @IsString()
  @IsOptional()
  resourceId?: string;

  @ApiPropertyOptional({ description: 'Filter by IP address' })
  @IsString()
  @IsOptional()
  ipAddress?: string;

  @ApiPropertyOptional({ description: 'Start date filter (ISO 8601)' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date filter (ISO 8601)' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Search across resource, action, and actor' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  limit?: number;
}

export class ExportAuditLogsDto extends QueryAuditLogsDto {
  @ApiPropertyOptional({ enum: ['CSV', 'PDF'], default: 'CSV' })
  @IsEnum(['CSV', 'PDF'])
  @IsOptional()
  format?: 'CSV' | 'PDF';
}

