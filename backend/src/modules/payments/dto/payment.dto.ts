import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaymentProviderType } from '../interfaces/payment-provider.interface';

export class InitializeGatewayPaymentDto {
  @ApiProperty({ description: 'Payment provider to use', enum: PaymentProviderType, example: PaymentProviderType.STRIPE })
  @IsEnum(PaymentProviderType)
  @IsNotEmpty()
  provider: PaymentProviderType;

  @ApiProperty({ description: 'Deposit amount (e.g. 100.00)', example: '100.00' })
  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @ApiProperty({ description: 'Currency code (e.g. USD, EUR, GBP, NGN)', example: 'USD' })
  @IsString()
  @IsNotEmpty()
  currency: string;

  @ApiProperty({ description: 'Destination Bank Account ID', example: 'uuid-here' })
  @IsUUID()
  @IsNotEmpty()
  accountId: string;

  @ApiPropertyOptional({ description: 'Optional client redirect callback URL' })
  @IsString()
  @IsOptional()
  callbackUrl?: string;

  @ApiPropertyOptional({ description: 'Custom narrative / description' })
  @IsString()
  @IsOptional()
  description?: string;
}

export class VerifyGatewayPaymentDto {
  @ApiProperty({ description: 'Payment provider type', enum: PaymentProviderType })
  @IsEnum(PaymentProviderType)
  @IsNotEmpty()
  provider: PaymentProviderType;

  @ApiProperty({ description: 'Transaction reference' })
  @IsString()
  @IsNotEmpty()
  reference: string;
}

export class ConfigureProviderDto {
  @ApiProperty({ description: 'Enable or disable gateway provider' })
  isEnabled: boolean;

  @ApiPropertyOptional({ description: 'Gateway public/publishable key' })
  @IsString()
  @IsOptional()
  publicKey?: string;

  @ApiPropertyOptional({ description: 'Gateway secret API key' })
  @IsString()
  @IsOptional()
  secretKey?: string;

  @ApiPropertyOptional({ description: 'Gateway webhook signing secret / hash' })
  @IsString()
  @IsOptional()
  webhookSecret?: string;
}

