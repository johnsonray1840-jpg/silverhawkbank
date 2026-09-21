import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  ContractDirection,
  SettlementType,
} from '../../../common/utils/fx-forward.util';

export class CreateForwardQuoteDto {
  @ApiProperty({ description: 'Base currency ISO 4217 code (the currency being bought or sold)', example: 'EUR' })
  @IsString()
  @IsNotEmpty()
  baseCurrency!: string;

  @ApiProperty({ description: 'Quote / Counter currency ISO 4217 code', example: 'USD' })
  @IsString()
  @IsNotEmpty()
  quoteCurrency!: string;

  @ApiProperty({ description: 'Notional amount in base currency to hedge', example: 100000.00 })
  @IsNumber()
  @IsPositive()
  notionalBaseAmount!: number;

  @ApiProperty({ description: 'Tenor length in days (e.g. 30, 60, 90, 180, 360)', example: 90 })
  @IsNumber()
  @Min(1)
  @Max(730)
  tenorDays!: number;

  @ApiProperty({
    description: 'Contract direction: BUY_BASE (importer buying base) or SELL_BASE (exporter selling base)',
    enum: ContractDirection,
    example: ContractDirection.BUY_BASE,
  })
  @IsEnum(ContractDirection)
  direction!: ContractDirection;
}

export class BookForwardContractDto {
  @ApiProperty({ description: 'Base currency ISO 4217 code', example: 'EUR' })
  @IsString()
  @IsNotEmpty()
  baseCurrency!: string;

  @ApiProperty({ description: 'Quote / Counter currency ISO 4217 code', example: 'USD' })
  @IsString()
  @IsNotEmpty()
  quoteCurrency!: string;

  @ApiProperty({ description: 'Notional amount in base currency to hedge', example: 100000.00 })
  @IsNumber()
  @IsPositive()
  notionalBaseAmount!: number;

  @ApiProperty({ description: 'Tenor length in days', example: 90 })
  @IsNumber()
  @Min(1)
  @Max(730)
  tenorDays!: number;

  @ApiProperty({
    description: 'Contract direction',
    enum: ContractDirection,
    example: ContractDirection.BUY_BASE,
  })
  @IsEnum(ContractDirection)
  direction!: ContractDirection;

  @ApiProperty({ description: 'Bank Account ID to lock the initial collateral margin in quote currency' })
  @IsUUID()
  collateralAccountId!: string;

  @ApiProperty({
    description: 'Settlement execution type: PHYSICAL_DELIVERY or CASH_SETTLED',
    enum: SettlementType,
    example: SettlementType.PHYSICAL_DELIVERY,
    default: SettlementType.PHYSICAL_DELIVERY,
  })
  @IsEnum(SettlementType)
  settlementType!: SettlementType;
}

export class SettleForwardContractDto {
  @ApiPropertyOptional({ description: 'Target Bank Account ID for physical currency delivery or cash PnL payout' })
  @IsOptional()
  @IsUUID()
  settlementAccountId?: string;
}

export class RolloverForwardContractDto {
  @ApiProperty({ description: 'Additional tenor extension length in days (e.g. 30, 60, 90)', example: 30 })
  @IsNumber()
  @Min(1)
  @Max(365)
  extensionTenorDays!: number;
}
