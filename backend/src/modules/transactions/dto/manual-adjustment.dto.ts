import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsString,
  Length,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum AdjustmentType {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

export class ManualAdjustmentDto {
  @ApiProperty({ example: 'acc_01...', description: 'Target Bank Account ID' })
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @ApiProperty({ enum: AdjustmentType, example: AdjustmentType.CREDIT })
  @IsEnum(AdjustmentType)
  @IsNotEmpty()
  type: AdjustmentType;

  @ApiProperty({ example: '500.0000', description: 'Adjustment amount' })
  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @ApiProperty({ example: 'Compensation for banking service outage on 2026-09-01' })
  @IsString()
  @IsNotEmpty()
  @Length(10, 500)
  reason: string;
}

