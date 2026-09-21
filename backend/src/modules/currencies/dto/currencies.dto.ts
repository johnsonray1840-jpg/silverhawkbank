import { IsNotEmpty, IsNumberString, IsOptional, IsString, MaxLength, Length } from 'class-validator';

export class UpdateExchangeRateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  baseCurrency: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  quoteCurrency: string;

  @IsNumberString()
  @IsNotEmpty()
  rate: string;
}

export class SwapCurrencyDto {
  @IsString()
  @IsOptional()
  sourceAccountId?: string;

  @IsString()
  @IsOptional()
  destinationAccountId?: string;

  @IsString()
  @IsOptional()
  fromCurrency?: string;

  @IsString()
  @IsOptional()
  toCurrency?: string;

  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 6)
  pin: string;

  @IsString()
  @IsOptional()
  slippageTolerancePercent?: string;
}

export class ExchangeQuoteDto {
  @IsString()
  @IsNotEmpty()
  fromCurrency: string;

  @IsString()
  @IsNotEmpty()
  toCurrency: string;

  @IsNumberString()
  @IsNotEmpty()
  amount: string;
}
