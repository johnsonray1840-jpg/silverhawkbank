import { IsBoolean, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBeneficiaryDto {
  @ApiProperty({ example: 'Alice Walker' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '1004829104', description: 'Account number or IBAN' })
  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @ApiProperty({ example: 'Silverhawk Bank' })
  @IsString()
  @IsNotEmpty()
  bankName: string;

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

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  @Length(3, 3)
  currencyCode: string;

  @ApiPropertyOptional({ example: true, default: false })
  @IsBoolean()
  @IsOptional()
  isInternal?: boolean = false;
}

