import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupportTicketPriority, SupportTicketStatus } from '@prisma/client';

export class CreateTicketDto {
  @ApiProperty({ description: 'Ticket subject line', example: 'Inquiry regarding wire settlement' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject: string;

  @ApiPropertyOptional({ description: 'Category (e.g. BILLING, TECHNICAL, ACCOUNT, TRANSACTION, GENERAL)', default: 'GENERAL' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  category?: string;

  @ApiPropertyOptional({ enum: SupportTicketPriority, default: SupportTicketPriority.MEDIUM })
  @IsEnum(SupportTicketPriority)
  @IsOptional()
  priority?: SupportTicketPriority;

  @ApiProperty({ description: 'Initial message content' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({ description: 'Secure attachment document URL' })
  @IsString()
  @IsOptional()
  attachment?: string;
}

export class AddMessageDto {
  @ApiProperty({ description: 'Response message body' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({ description: 'Optional attachment URL' })
  @IsString()
  @IsOptional()
  attachment?: string;
}

export class UpdateTicketStatusDto {
  @ApiProperty({ enum: SupportTicketStatus })
  @IsEnum(SupportTicketStatus)
  @IsNotEmpty()
  status: SupportTicketStatus;

  @ApiPropertyOptional({ description: 'Internal operational notes' })
  @IsString()
  @IsOptional()
  note?: string;
}

export class UpdateTicketPriorityDto {
  @ApiProperty({ enum: SupportTicketPriority })
  @IsEnum(SupportTicketPriority)
  @IsNotEmpty()
  priority: SupportTicketPriority;
}

export class AssignTicketDto {
  @ApiProperty({ description: 'Staff user ID' })
  @IsString()
  @IsNotEmpty()
  staffId: string;
}

export class ReopenTicketDto {
  @ApiPropertyOptional({ description: 'Reason for reopening ticket' })
  @IsString()
  @IsOptional()
  reason?: string;
}

export class QueryTicketsDto {
  @ApiPropertyOptional({ enum: SupportTicketStatus })
  @IsEnum(SupportTicketStatus)
  @IsOptional()
  status?: SupportTicketStatus;

  @ApiPropertyOptional({ enum: SupportTicketPriority })
  @IsEnum(SupportTicketPriority)
  @IsOptional()
  priority?: SupportTicketPriority;

  @ApiPropertyOptional({ description: 'Category filter' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ description: 'Search term for subject, ticket number or user email' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Assigned staff user ID' })
  @IsString()
  @IsOptional()
  assignedTo?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  limit?: number;
}
