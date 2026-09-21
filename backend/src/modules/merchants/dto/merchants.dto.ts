import { IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class GenerateMerchantQrDto {
  @IsString()
  @IsNotEmpty()
  merchantAccountId: string;

  @IsNumberString()
  @IsOptional()
  amount?: string;

  @IsString()
  @IsOptional()
  @MaxLength(3)
  currency?: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsEnum(['STATIC', 'DYNAMIC'])
  @IsOptional()
  pointOfInitiation?: 'STATIC' | 'DYNAMIC';
}

export class ResolveMerchantQrDto {
  @IsString()
  @IsNotEmpty()
  qrString: string;
}

export class PayMerchantQrDto {
  @IsString()
  @IsNotEmpty()
  qrString: string;

  @IsString()
  @IsNotEmpty()
  sourceAccountId: string;

  @IsNumberString()
  @IsOptional()
  amount?: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 6)
  pin: string;
}

export class CreateInvoiceDto {
  @IsString()
  @IsNotEmpty()
  merchantAccountId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currency: string;

  @IsString()
  @IsOptional()
  customerEmail?: string;
}

export class CreatePaymentLinkDto {
  @IsString()
  @IsNotEmpty()
  merchantAccountId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsNumberString()
  @IsOptional()
  amount?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currency: string;

  @IsString()
  @IsOptional()
  customerEmail?: string;

  @IsString()
  @IsOptional()
  expiresAt?: string;

  @IsString()
  @IsOptional()
  redirectUrl?: string;
}

export class PayPaymentLinkDto {
  @IsString()
  @IsOptional()
  payerAccountId?: string;

  @IsString()
  @IsOptional()
  pin?: string;

  @IsString()
  @IsOptional()
  cardPan?: string;

  @IsString()
  @IsOptional()
  cardExpiry?: string;

  @IsString()
  @IsOptional()
  cardCvv?: string;

  @IsString()
  @IsOptional()
  payerName?: string;

  @IsString()
  @IsOptional()
  payerEmail?: string;

  @IsNumberString()
  @IsOptional()
  customAmount?: string;
}

export class PosChargeDto {
  @IsString()
  @IsNotEmpty()
  merchantAccountId: string;

  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currency: string;

  @IsNumberString()
  @IsOptional()
  tipPercentage?: string;

  @IsNumberString()
  @IsOptional()
  customTip?: string;

  @IsString()
  @IsOptional()
  customerIdentifier?: string; // Account Number, Card PAN or Customer Name

  @IsString()
  @IsOptional()
  paymentMethod?: string; // CARD, ACCOUNT_DIRECT, QR_POS

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  pin?: string;
}

export class MerchantAnalyticsQueryDto {
  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;
}


