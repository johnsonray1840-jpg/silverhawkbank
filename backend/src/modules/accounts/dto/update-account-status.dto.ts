import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountStatus } from '@prisma/client';

export class UpdateAccountStatusDto {
  @ApiProperty({ enum: AccountStatus, example: AccountStatus.FROZEN })
  @IsEnum(AccountStatus)
  @IsNotEmpty()
  status: AccountStatus;

  @ApiPropertyOptional({ example: 'Account placed on administrative freeze due to investigation' })
  @IsString()
  @IsOptional()
  reason?: string;
}

