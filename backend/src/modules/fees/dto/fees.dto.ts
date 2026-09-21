import { IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeeCategory } from '../../../common/utils/fee-engine.util';

export class CalculateFeeQuoteDto {
  @ApiProperty({ enum: FeeCategory, example: FeeCategory.TRANSFER_EXTERNAL })
  @IsEnum(FeeCategory)
  @IsNotEmpty()
  category: FeeCategory;

  @ApiProperty({ example: '1000.00' })
  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @ApiPropertyOptional({ example: 'USD', default: 'USD' })
  @IsString()
  @IsOptional()
  currencyCode?: string = 'USD';
}

export class ConfigureFeeRuleDto {
  @ApiProperty({ enum: FeeCategory, example: FeeCategory.WITHDRAWAL })
  @IsEnum(FeeCategory)
  @IsNotEmpty()
  category: FeeCategory;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  currencyCode: string;

  @ApiProperty({ example: '10.0000' })
  @IsNumberString()
  @IsNotEmpty()
  flatFee: string;

  @ApiProperty({ example: '0.25' })
  @IsNumberString()
  @IsNotEmpty()
  percentageFee: string;

  @ApiPropertyOptional({ example: '10.0000' })
  @IsNumberString()
  @IsOptional()
  minFee?: string;

  @ApiPropertyOptional({ example: '250.0000' })
  @IsNumberString()
  @IsOptional()
  maxFee?: string;
}

