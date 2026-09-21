import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InvoiceLineItemDto {
  @ApiProperty({ description: 'Item description or service provided', example: 'Cloud Infrastructure Consulting - 40 hrs' })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({ description: 'Item quantity or hours', example: 40 })
  @IsNumber()
  @IsPositive()
  quantity!: number;

  @ApiProperty({ description: 'Unit price per item/hour in invoice currency', example: 150.00 })
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @ApiPropertyOptional({ description: 'Tax or VAT percentage (e.g. 20 for 20%)', example: 20 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;
}

export class CreateInvoiceDto {
  @ApiProperty({ description: 'Client / Buyer business name', example: 'Acme Global Enterprises Inc.' })
  @IsString()
  @IsNotEmpty()
  recipientName!: string;

  @ApiProperty({ description: 'Client billing email address', example: 'ap@acmeglobal.com' })
  @IsEmail()
  recipientEmail!: string;

  @ApiPropertyOptional({ description: 'Client physical billing address', example: '100 Wall Street, New York, NY' })
  @IsOptional()
  @IsString()
  recipientAddress?: string;

  @ApiPropertyOptional({ description: 'Client Tax ID / VAT Number', example: 'US-EIN-987654321' })
  @IsOptional()
  @IsString()
  recipientTaxId?: string;

  @ApiPropertyOptional({ description: 'Currency ISO 4217 code', example: 'USD', default: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ description: 'Bank Account ID receiving payment settlements' })
  @IsUUID()
  accountId!: string;

  @ApiProperty({ description: 'Invoice line items', type: [InvoiceLineItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemDto)
  lineItems!: InvoiceLineItemDto[];

  @ApiPropertyOptional({ description: 'Early payment discount percentage (e.g. 2 for 2%)', example: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  earlyDiscountPercentage?: number;

  @ApiPropertyOptional({ description: 'Early payment discount window in days (e.g. 10 for 2/10 Net 30)', example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  earlyDiscountDays?: number;

  @ApiPropertyOptional({ description: 'Net payment due window in days', example: 30, default: 30 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  netDueDays?: number;

  @ApiPropertyOptional({ description: 'Invoice notes or payment instructions', example: 'Wire transfer payment to Silverhawk Bank. 2% discount if paid within 10 days.' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class IssueInvoiceDto {
  @ApiProperty({ description: 'Invoice ID to issue' })
  @IsUUID()
  invoiceId!: string;
}

export class RecordInvoicePaymentDto {
  @ApiPropertyOptional({ description: 'Invoice ID if explicitly known' })
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @ApiProperty({ description: 'Payment amount received', example: 6000.00 })
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiProperty({ description: 'Payment reference or wire narrative', example: 'INV-2026-001 ACME CONSULTING' })
  @IsString()
  @IsNotEmpty()
  reference!: string;

  @ApiPropertyOptional({ description: 'Sender business name', example: 'Acme Global Enterprises Inc.' })
  @IsOptional()
  @IsString()
  senderName?: string;

  @ApiPropertyOptional({ description: 'Sender Tax ID', example: 'US-EIN-987654321' })
  @IsOptional()
  @IsString()
  senderTaxId?: string;

  @ApiProperty({ description: 'Destination Bank Account ID receiving funds' })
  @IsUUID()
  destinationAccountId!: string;
}

export class ApplyInvoiceFactoringDto {
  @ApiProperty({ description: 'Invoice ID to factor for early liquidity' })
  @IsUUID()
  invoiceId!: string;

  @ApiPropertyOptional({ description: 'Requested advance rate percentage (e.g. 85 for 85%)', example: 85, default: 85 })
  @IsOptional()
  @IsNumber()
  @Min(50)
  @Max(95)
  advanceRatePct?: number;

  @ApiProperty({ description: 'Bank account to receive factoring advance liquidity payout' })
  @IsUUID()
  payoutAccountId!: string;
}

