import {
  IsArray,
  IsBoolean,
  IsDecimal,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateSystemSettingDto {
  @IsString()
  @IsNotEmpty()
  value: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;
}

export class BatchUpdateSettingsDto {
  @IsNotEmpty()
  settings: Record<string, string>;
}

// -----------------------------------------------------------------------------
// USER MANAGEMENT DTOS
// -----------------------------------------------------------------------------
export class CreateUserAdminDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  username: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  country?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @IsString()
  @IsOptional()
  pin?: string;

  @IsString()
  @IsOptional()
  role?: string; // 'CUSTOMER' | 'ADMIN' | 'SUPER_ADMIN' | 'FINANCE_MANAGER' | etc.

  @IsString()
  @IsOptional()
  currency?: string; // 'USD', 'EUR', 'GBP', etc.

  @IsString()
  @IsOptional()
  accountType?: string; // 'CHECKING', 'SAVINGS', 'BUSINESS'

  @IsOptional()
  initialBalance?: number | string;

  @IsOptional()
  customAccountNumber?: string;

  @IsString()
  @IsOptional()
  status?: string; // 'ACTIVE', 'PENDING', 'FROZEN', 'SUSPENDED'
}

export class UpdateUserAdminDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  username?: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  country?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  status?: string; // 'ACTIVE', 'PENDING', 'FROZEN', 'SUSPENDED', 'CLOSED'

  @IsString()
  @IsOptional()
  role?: string;

  @IsBoolean()
  @IsOptional()
  isEmailVerified?: boolean;

  @IsBoolean()
  @IsOptional()
  twoFactorEnabled?: boolean;
}

export class ResetUserPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;
}

export class ResetUserPinDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(6)
  newPin: string;
}

// -----------------------------------------------------------------------------
// ACCOUNT & BALANCE ADJUSTMENT DTOS
// -----------------------------------------------------------------------------
export class AdjustBalanceDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['CREDIT', 'DEBIT'])
  type: 'CREDIT' | 'DEBIT';

  @IsNotEmpty()
  amount: number | string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  effectiveDate?: string; // ISO String or YYYY-MM-DD
}

export class UpdateAccountStatusDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['ACTIVE', 'FROZEN', 'SUSPENDED', 'CLOSED'])
  status: 'ACTIVE' | 'FROZEN' | 'SUSPENDED' | 'CLOSED';
}

// -----------------------------------------------------------------------------
// MANUAL TRANSACTION INJECTION DTO
// -----------------------------------------------------------------------------
export class ManualTransactionDto {
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['CREDIT', 'DEBIT'])
  direction: 'CREDIT' | 'DEBIT';

  @IsNotEmpty()
  amount: number | string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  counterpartyName?: string;

  @IsString()
  @IsOptional()
  counterpartyBank?: string;

  @IsString()
  @IsOptional()
  counterpartyAccount?: string;

  @IsString()
  @IsOptional()
  type?: string; // 'TRANSFER_EXTERNAL', 'DEPOSIT', 'WIRE', 'ADJUSTMENT_CREDIT', etc.

  @IsString()
  @IsOptional()
  @IsIn(['SUCCESS', 'PENDING', 'FAILED', 'REVERSED'])
  status?: string;

  @IsString()
  @IsOptional()
  createdAt?: string; // Backdated ISO date

  @IsString()
  @IsOptional()
  internalNotes?: string;
}

export class UpdateTransactionAdminDto {
  @IsString()
  @IsOptional()
  @IsIn(['SUCCESS', 'PENDING', 'PROCESSING', 'FAILED', 'REVERSED', 'CANCELLED', 'REQUIRES_REVIEW', 'DECLINED'])
  status?: string;

  @IsOptional()
  amount?: number | string;

  @IsOptional()
  fee?: number | string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  counterpartyName?: string;

  @IsString()
  @IsOptional()
  counterpartyBank?: string;

  @IsString()
  @IsOptional()
  counterpartyAccount?: string;

  @IsString()
  @IsOptional()
  internalNotes?: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  createdAt?: string; // Allow editing effective date
}

// -----------------------------------------------------------------------------
// DEPOSITS & GRANTS DTOS
// -----------------------------------------------------------------------------
export class ApproveDepositDto {
  @IsString()
  @IsOptional()
  note?: string;
}

export class RejectDepositDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class UpdateGrantStatusDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['APPROVED', 'REJECTED', 'DISBURSED'])
  status: 'APPROVED' | 'REJECTED' | 'DISBURSED';

  @IsOptional()
  approvedAmount?: number | string;

  @IsString()
  @IsOptional()
  reviewNotes?: string;
}

export class CreateGrantProgramDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsNotEmpty()
  maxAmount: number;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsArray()
  @IsOptional()
  benefits?: string[];

  @IsString()
  @IsOptional()
  icon?: string;
}

// -----------------------------------------------------------------------------
// KYC & AML DTOS
// -----------------------------------------------------------------------------
export class ReviewKycDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['APPROVED', 'REJECTED', 'UNDER_REVIEW'])
  status: 'APPROVED' | 'REJECTED' | 'UNDER_REVIEW';

  @IsString()
  @IsOptional()
  @IsIn(['TIER_1', 'TIER_2', 'TIER_3'])
  tier?: 'TIER_1' | 'TIER_2' | 'TIER_3';

  @IsString()
  @IsOptional()
  rejectionReason?: string;
}

export class AmlScreenDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  country?: string;

  @IsOptional()
  threshold?: number;
}

export class CreateSarDto {
  @IsString()
  @IsNotEmpty()
  subjectName: string;

  @IsString()
  @IsNotEmpty()
  activityType: string;

  @IsNotEmpty()
  amount: number | string;

  @IsString()
  @IsNotEmpty()
  narrative: string;

  @IsString()
  @IsOptional()
  referenceNumber?: string;
}

// -----------------------------------------------------------------------------
// CARDS & LOANS DTOS
// -----------------------------------------------------------------------------
export class IssueCardAdminDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['VIRTUAL', 'PHYSICAL'])
  cardType: 'VIRTUAL' | 'PHYSICAL';

  @IsString()
  @IsNotEmpty()
  @IsIn(['VISA', 'MASTERCARD'])
  brand: 'VISA' | 'MASTERCARD';

  @IsString()
  @IsNotEmpty()
  cardHolderName: string;

  @IsOptional()
  spendingLimitMonthly?: number | string;

  @IsOptional()
  spendingLimitDaily?: number | string;
}

export class UpdateCardStatusAdminDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['PENDING_APPROVAL', 'ACTIVE', 'FROZEN', 'BLOCKED', 'CANCELLED', 'EXPIRED', 'REJECTED'])
  status: 'PENDING_APPROVAL' | 'ACTIVE' | 'FROZEN' | 'BLOCKED' | 'CANCELLED' | 'EXPIRED' | 'REJECTED';
}

export class RejectCardDto {
  @IsString()
  @IsOptional()
  reason?: string;
}

export class ReviewLoanDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['APPROVED', 'REJECTED'])
  action: 'APPROVED' | 'REJECTED';

  @IsString()
  @IsOptional()
  reviewNotes?: string;

  @IsOptional()
  approvedAmount?: number | string;
}

// -----------------------------------------------------------------------------
// SUPPORT TICKETS & SETTINGS DTOS
// -----------------------------------------------------------------------------
export class ReplyTicketDto {
  @IsString()
  @IsNotEmpty()
  message: string;

  @IsString()
  @IsOptional()
  @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'])
  status?: string;
}

export class UpdateMasterSettingsDto {
  @IsNotEmpty()
  settings: Record<string, any>;
}

// -----------------------------------------------------------------------------
// LOAN PRODUCTS & OPERATIONS DTOS
// -----------------------------------------------------------------------------
export class CreateLoanProductDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNotEmpty()
  minAmount: number | string;

  @IsNotEmpty()
  maxAmount: number | string;

  @IsNotEmpty()
  interestRate: number | string;

  @IsString()
  @IsOptional()
  @IsIn(['FLAT', 'REDUCING_BALANCE', 'COMPOUND'])
  interestType?: 'FLAT' | 'REDUCING_BALANCE' | 'COMPOUND';

  @IsNumber()
  @IsNotEmpty()
  minTenureMonths: number;

  @IsNumber()
  @IsNotEmpty()
  maxTenureMonths: number;

  @IsOptional()
  processingFeePercentage?: number | string;

  @IsOptional()
  latePenaltyPercentage?: number | string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateLoanProductDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptional()
  minAmount?: number | string;

  @IsOptional()
  maxAmount?: number | string;

  @IsOptional()
  interestRate?: number | string;

  @IsString()
  @IsOptional()
  @IsIn(['FLAT', 'REDUCING_BALANCE', 'COMPOUND'])
  interestType?: 'FLAT' | 'REDUCING_BALANCE' | 'COMPOUND';

  @IsNumber()
  @IsOptional()
  minTenureMonths?: number;

  @IsNumber()
  @IsOptional()
  maxTenureMonths?: number;

  @IsOptional()
  processingFeePercentage?: number | string;

  @IsOptional()
  latePenaltyPercentage?: number | string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateLoanProductStatusDto {
  @IsBoolean()
  @IsNotEmpty()
  isActive: boolean;
}

export class DisburseLoanDto {
  @IsOptional()
  approvedAmount?: number | string;

  @IsOptional()
  interestRate?: number | string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  firstDueDate?: string;
}

export class ApplyLoanPenaltyDto {
  @IsOptional()
  penaltyAmount?: number | string;

  @IsString()
  @IsOptional()
  reason?: string;
}

// -----------------------------------------------------------------------------
// WITHDRAWALS MANAGEMENT DTOS
// -----------------------------------------------------------------------------
export class ApproveWithdrawalDto {
  @IsString()
  @IsOptional()
  note?: string;
}

export class ProcessWithdrawalDto {
  @IsString()
  @IsOptional()
  providerReference?: string;

  @IsString()
  @IsOptional()
  note?: string;
}

export class CompleteWithdrawalDto {
  @IsString()
  @IsOptional()
  settlementReference?: string;

  @IsString()
  @IsOptional()
  note?: string;
}

export class RejectWithdrawalDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class ReverseWithdrawalDto {
  @IsString()
  @IsOptional()
  reason?: string;
}

// -----------------------------------------------------------------------------
// RBAC & STAFF MANAGEMENT DTOS
// -----------------------------------------------------------------------------
export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  permissions?: string[];
}

export class UpdateRolePermissionsDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  permissions: string[];
}

export class CreateStaffUserDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  username: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  roles: string[];
}

export class AssignUserRolesDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  roles: string[];
}

