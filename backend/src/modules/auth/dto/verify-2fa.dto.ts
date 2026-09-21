import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class Verify2faDto {
  @ApiProperty({ description: 'User identifier (email, username, or userId)' })
  @IsNotEmpty()
  @IsString()
  identifier: string;

  @ApiProperty({ description: '6-digit TOTP code or alphanumeric backup recovery code', example: '123456' })
  @IsNotEmpty()
  @IsString()
  code: string;
}

