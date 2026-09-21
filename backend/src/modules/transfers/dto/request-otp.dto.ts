import {
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequestTransferOtpDto {
  @ApiProperty({ example: 'acc_01...', description: 'Source Bank Account ID' })
  @IsString()
  @IsNotEmpty()
  sourceAccountId: string;

  @ApiProperty({ example: '1500.0000', description: 'Transfer amount as positive numeric string' })
  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @ApiPropertyOptional({ example: 'USD' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ example: 'Robert Downey' })
  @IsString()
  @IsOptional()
  recipientName?: string;

  @ApiPropertyOptional({ example: '1002384912' })
  @IsString()
  @IsOptional()
  accountNumber?: string;

  @ApiPropertyOptional({ example: 'Silverhawk Bank' })
  @IsString()
  @IsOptional()
  bankName?: string;

  @ApiProperty({ example: '1234', description: '4-digit transaction authorization PIN' })
  @IsString()
  @IsNotEmpty()
  @Length(4, 6)
  @Matches(/^[0-9]+$/, { message: 'PIN must contain digits only' })
  pin: string;
}

