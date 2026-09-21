import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { CardBrand, CardType, CardStatus } from '@prisma/client';

export class IssueCardDto {
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsEnum(CardType)
  @IsNotEmpty()
  cardType: CardType;

  @IsEnum(CardBrand)
  @IsNotEmpty()
  brand: CardBrand;

  @IsNumberString()
  @IsOptional()
  spendingLimitMonthly?: string;

  @IsNumberString()
  @IsOptional()
  spendingLimitDaily?: string;

  @IsString()
  @IsNotEmpty()
  pin: string;
}

export class RevealCardDto {
  @IsString()
  @IsNotEmpty()
  pin: string;
}

export class UpdateCardLimitsDto {
  @IsNumberString()
  @IsOptional()
  spendingLimitMonthly?: string;

  @IsNumberString()
  @IsOptional()
  spendingLimitDaily?: string;

  @IsString()
  @IsNotEmpty()
  pin: string;
}

export class BlockCardDto {
  @IsString()
  @IsNotEmpty()
  pin: string;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class SimulateCardTransactionDto {
  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  merchantName: string;

  @IsString()
  @IsOptional()
  merchantCity?: string;

  @IsString()
  @IsOptional()
  merchantCountry?: string;
}
