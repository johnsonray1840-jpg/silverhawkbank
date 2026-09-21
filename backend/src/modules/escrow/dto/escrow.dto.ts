import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DisputeRuling } from '../../../common/utils/smart-escrow.util';

export class MilestoneDefinitionDto {
  @ApiProperty({ example: 'Initial Architecture & Database Design', description: 'Milestone title' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: 'Delivery of complete system architecture diagram and schema', description: 'Milestone deliverable requirements' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 30, description: 'Percentage of total escrow amount (e.g. 30 for 30%)' })
  @IsNumber()
  @IsOptional()
  percentage?: number;

  @ApiPropertyOptional({ example: 3000.0, description: 'Direct monetary amount for milestone' })
  @IsNumber()
  @IsOptional()
  amount?: number;
}

export class CreateEscrowContractDto {
  @ApiProperty({ example: 'Enterprise Mobile Banking App Design & Engineering', description: 'Contract title' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: 'Full-stack design, implementation, security audit and deployment', description: 'Detailed scope of work' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 'usr_seller_01928374', description: 'User ID of the counterparty seller/contractor' })
  @IsString()
  @IsNotEmpty()
  sellerId: string;

  @ApiProperty({ example: 10000.0, description: 'Total contract escrow amount' })
  @IsNumber()
  @Min(1.0)
  totalAmount: number;

  @ApiProperty({ example: 'USD', description: '3-letter ISO-4217 currency code' })
  @IsString()
  @IsNotEmpty()
  currencyCode: string;

  @ApiPropertyOptional({ example: 72, description: 'Statutory inspection window in hours before auto-release', default: 72 })
  @IsNumber()
  @IsOptional()
  inspectionWindowHours?: number;

  @ApiProperty({
    type: [MilestoneDefinitionDto],
    description: 'List of conditional payment milestones',
    example: [
      { title: 'Milestone 1: Prototype & Design Specs', percentage: 30 },
      { title: 'Milestone 2: Frontend & Core APIs Integration', percentage: 40 },
      { title: 'Milestone 3: Production Deployment & Acceptance', percentage: 30 },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MilestoneDefinitionDto)
  milestones: MilestoneDefinitionDto[];
}

export class SubmitMilestoneDto {
  @ApiProperty({ example: 'https://github.com/silverhawk/repo/pull/42 or IPFS Proof CID', description: 'Proof of milestone delivery or document link' })
  @IsString()
  @IsNotEmpty()
  deliverableProof: string;
}

export class ApproveMilestoneDto {
  @ApiPropertyOptional({ example: 'Deliverables inspected and verified against specification.', description: 'Buyer confirmation remarks' })
  @IsString()
  @IsOptional()
  remarks?: string;
}

export class RaiseDisputeDto {
  @ApiProperty({ example: 'Contractor missed critical acceptance deadline and code quality failed security audit.', description: 'Detailed dispute justification' })
  @IsString()
  @IsNotEmpty()
  disputeReason: string;

  @ApiPropertyOptional({ example: 'https://docs.silverhawkbank.com/evidence/audit-report.pdf', description: 'Link to audit evidence or proof documentation' })
  @IsString()
  @IsOptional()
  evidenceUrl?: string;
}

export class ResolveDisputeDto {
  @ApiProperty({ enum: DisputeRuling, example: DisputeRuling.SPLIT_SETTLEMENT, description: 'Arbitrator binding resolution ruling' })
  @IsEnum(DisputeRuling)
  ruling: DisputeRuling;

  @ApiPropertyOptional({ example: 60, description: 'Percentage of remaining escrow refunded to buyer (required if SPLIT_SETTLEMENT)' })
  @IsNumber()
  @IsOptional()
  buyerSplitPercentage?: number;

  @ApiPropertyOptional({ example: 40, description: 'Percentage of remaining escrow released to seller (required if SPLIT_SETTLEMENT)' })
  @IsNumber()
  @IsOptional()
  sellerSplitPercentage?: number;

  @ApiProperty({ example: 'Mediated settlement based on 60% partial completion of milestone deliverables.', description: 'Official arbitrator ruling notes' })
  @IsString()
  @IsNotEmpty()
  arbitrationNotes: string;
}

