import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateBeneficiaryDto {
  @ApiPropertyOptional({ example: 'Alice Walker' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: '1004829104' })
  @IsString()
  @IsOptional()
  accountNumber?: string;

  @ApiPropertyOptional({ example: 'Silverhawk Bank' })
  @IsString()
  @IsOptional()
  bankName?: string;

  @ApiPropertyOptional({ example: '044' })
  @IsString()
  @IsOptional()
  bankCode?: string;

  @ApiPropertyOptional({ example: '021000021' })
  @IsString()
  @IsOptional()
  routingNumber?: string;

  @ApiPropertyOptional({ example: 'BARCGB22' })
  @IsString()
  @IsOptional()
  swiftBic?: string;

  @ApiPropertyOptional({ example: 'USD' })
  @IsString()
  @IsOptional()
  @Length(3, 3)
  currencyCode?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isInternal?: boolean;

  @ApiPropertyOptional({ example: '1234', description: '4-digit transaction authorization PIN' })
  @IsString()
  @IsOptional()
  pin?: string;
}

