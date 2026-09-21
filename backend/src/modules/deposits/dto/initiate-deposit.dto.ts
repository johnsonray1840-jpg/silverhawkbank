import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DepositMethod } from '@prisma/client';

export class InitiateDepositDto {
  @ApiProperty({ example: 'acc_01...', description: 'Destination Bank Account ID' })
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @ApiProperty({ example: '5000.0000', description: 'Deposit amount' })
  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  @Length(3, 3)
  currency: string;

  @ApiProperty({ enum: DepositMethod, example: DepositMethod.BANK_TRANSFER })
  @IsEnum(DepositMethod)
  @IsNotEmpty()
  method: DepositMethod;

  @ApiPropertyOptional({ example: 'WIRE-REF-9928371' })
  @IsString()
  @IsOptional()
  paymentReference?: string;

  @ApiPropertyOptional({ example: '/uploads/deposits/wire-slip-10023.pdf' })
  @IsString()
  @IsOptional()
  proofDocumentUrl?: string;

  @ApiPropertyOptional({ example: 'Wire deposit from Citibank account' })
  @IsString()
  @IsOptional()
  description?: string;
}

