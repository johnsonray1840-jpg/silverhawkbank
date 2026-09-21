import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export enum OpenBankingPermission {
  READ_ACCOUNTS_BASIC = 'ReadAccountsBasic',
  READ_ACCOUNTS_DETAIL = 'ReadAccountsDetail',
  READ_BALANCES = 'ReadBalances',
  READ_TRANSACTIONS_DETAIL = 'ReadTransactionsDetail',
  INITIATE_PAYMENT_SINGLE = 'InitiatePaymentSingle',
}

export enum ConsentStatus {
  AWAITING_AUTHORIZATION = 'AwaitingAuthorization',
  AUTHORIZED = 'Authorized',
  REJECTED = 'Rejected',
  REVOKED = 'Revoked',
  EXPIRED = 'Expired',
}

export class CreateConsentDto {
  @IsString()
  @IsNotEmpty()
  tppClientId: string;

  @IsString()
  @IsNotEmpty()
  tppName: string;

  @IsArray()
  @IsEnum(OpenBankingPermission, { each: true })
  @IsNotEmpty()
  permissions: OpenBankingPermission[];

  @IsInt()
  @Min(1)
  @Max(90)
  @IsOptional()
  expirationDays?: number;
}

export class AuthorizeConsentDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  allowedAccountIds: string[];

  @IsString()
  @IsNotEmpty()
  @Length(4, 6)
  pin: string;
}

export class CreatePaymentSetupDto {
  @IsString()
  @IsNotEmpty()
  instructedAmount: string;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsString()
  @IsNotEmpty()
  creditorAccountNumber: string;

  @IsString()
  @IsNotEmpty()
  creditorName: string;

  @IsString()
  @IsOptional()
  remittanceInformation?: string;
}

export class ExecutePaymentDto {
  @IsString()
  @IsNotEmpty()
  paymentSetupId: string;

  @IsString()
  @IsNotEmpty()
  debtorAccountId: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 6)
  pin: string;
}

