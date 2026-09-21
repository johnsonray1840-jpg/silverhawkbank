import { IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReverseTransactionDto {
  @ApiProperty({ example: 'Customer disputed charge; investigation verified duplicate billing error', description: 'Mandatory audit explanation' })
  @IsString()
  @IsNotEmpty()
  @Length(10, 500)
  reason: string;
}

