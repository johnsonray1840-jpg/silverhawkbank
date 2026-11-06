import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ReverseTransactionDto {
  @ApiPropertyOptional({ example: 'Customer disputed charge; investigation verified duplicate billing error', description: 'Mandatory audit explanation' })
  @IsString()
  @IsOptional()
  reason?: string;
}

