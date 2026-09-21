import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountType } from '@prisma/client';

export class RegisterDto {
  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Smith' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiPropertyOptional({ example: 'David' })
  @IsString()
  @IsOptional()
  middleName?: string;

  @ApiProperty({ example: 'johnsmith123' })
  @IsString()
  @IsNotEmpty()
  @Length(3, 30)
  @Matches(/^[a-zA-Z0-9_.-]+$/, {
    message: 'Username can only contain alphanumeric characters, underscores, dots, and dashes',
  })
  username: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({ example: '+1 (234) 567-8901' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'United States of America' })
  @IsString()
  @IsOptional()
  @Transform(({ value }) => value || 'United States of America')
  country?: string;

  @ApiPropertyOptional({ example: 'USD' })
  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value ? String(value).toUpperCase() : 'USD'))
  currency?: string;

  @ApiPropertyOptional({ enum: AccountType, example: AccountType.CHECKING })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return AccountType.CHECKING;
    const norm = String(value).toUpperCase().replace(/\s+/g, '_').replace(/_ACCOUNT/g, '');
    if (norm === 'FIXED_DEPOSIT' || norm === 'FIXED') return AccountType.FIXED_DEPOSIT;
    if (norm === 'SAVINGS' || norm === 'SAVING') return AccountType.SAVINGS;
    if (norm === 'BUSINESS') return AccountType.BUSINESS;
    if (norm === 'INVESTMENT') return AccountType.INVESTMENT;
    return AccountType.CHECKING;
  })
  accountType?: AccountType;

  @ApiPropertyOptional({ example: '1234' })
  @IsString()
  @IsOptional()
  @Transform(({ value }) => (value ? String(value).trim() : '1234'))
  @Matches(/^[0-9]+$/, { message: 'PIN must contain digits only' })
  pin?: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 100)
  password: string;

  @ApiPropertyOptional({ example: 'Password123!' })
  @IsString()
  @IsOptional()
  passwordConfirmation?: string;

  @ApiPropertyOptional({ example: 'REF-JOHNSMITH' })
  @IsString()
  @IsOptional()
  referralCode?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1 || value === '1' || value === undefined || value === null)
  termsAccepted?: boolean;
}


