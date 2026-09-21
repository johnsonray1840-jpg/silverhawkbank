import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class Disable2faDto {
  @ApiProperty({ description: 'Current user account password' })
  @IsNotEmpty()
  @IsString()
  password: string;

  @ApiProperty({ description: '6-digit TOTP code or backup code', example: '123456' })
  @IsNotEmpty()
  @IsString()
  code: string;
}

