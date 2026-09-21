import { IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChangePinDto {
  @ApiPropertyOptional({ example: '1234', description: 'Current PIN if already set' })
  @IsString()
  @IsOptional()
  currentPin?: string;

  @ApiProperty({ example: '5678' })
  @IsString()
  @IsNotEmpty()
  @Length(4, 6)
  @Matches(/^[0-9]+$/, { message: 'PIN must contain digits only' })
  newPin: string;

  @ApiProperty({ example: '5678' })
  @IsString()
  @IsNotEmpty()
  @Length(4, 6)
  @Matches(/^[0-9]+$/, { message: 'PIN must contain digits only' })
  newPinConfirmation: string;
}

