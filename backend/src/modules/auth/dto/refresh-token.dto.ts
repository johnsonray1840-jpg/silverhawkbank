import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({ example: '8f7a6b5c4d3e2f1a...' })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

