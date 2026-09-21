import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EscrowService } from './escrow.service';
import {
  CreateEscrowContractDto,
  SubmitMilestoneDto,
  ApproveMilestoneDto,
  RaiseDisputeDto,
  ResolveDisputeDto,
} from './dto/escrow.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Programmable Smart Escrow & Milestone Settlements')
@ApiBearerAuth()
@Controller('escrow')
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @Post('contracts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a smart escrow contract with conditional payment milestones' })
  @ApiResponse({ status: 201, description: 'Escrow contract initialized in CREATED state' })
  async createContract(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateEscrowContractDto,
  ) {
    return this.escrowService.createContract(userId, dto);
  }

  @Get('contracts')
  @ApiOperation({ summary: 'List all escrow contracts where authenticated user is buyer or seller' })
  @ApiResponse({ status: 200, description: 'List of user escrow agreements' })
  async listUserContracts(@CurrentUser('id') userId: string) {
    return this.escrowService.listUserContracts(userId);
  }

  @Get('contracts/:id')
  @ApiOperation({ summary: 'Get detailed escrow contract agreement, milestone checklist, and dispute status' })
  @ApiResponse({ status: 200, description: 'Contract details' })
  async getContract(
    @CurrentUser('id') userId: string,
    @Param('id') contractId: string,
  ) {
    return this.escrowService.getContract(userId, contractId);
  }

  @Post('contracts/:id/fund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Buyer locks total contract amount into escrow sub-ledger vault' })
  @ApiResponse({ status: 200, description: 'Funds successfully locked in escrow' })
  async fundContract(
    @CurrentUser('id') userId: string,
    @Param('id') contractId: string,
  ) {
    return this.escrowService.fundContract(userId, contractId);
  }

  @Post('contracts/:id/milestones/:milestoneId/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Seller/Contractor submits proof of deliverable for milestone review' })
  @ApiResponse({ status: 200, description: 'Milestone submitted; inspection window triggered' })
  async submitMilestone(
    @CurrentUser('id') userId: string,
    @Param('id') contractId: string,
    @Param('milestoneId') milestoneId: string,
    @Body() dto: SubmitMilestoneDto,
  ) {
    return this.escrowService.submitMilestone(userId, contractId, milestoneId, dto);
  }

  @Post('contracts/:id/milestones/:milestoneId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Buyer approves milestone and releases milestone payout to seller' })
  @ApiResponse({ status: 200, description: 'Milestone approved and payout settled atomically' })
  async approveMilestone(
    @CurrentUser('id') userId: string,
    @Param('id') contractId: string,
    @Param('milestoneId') milestoneId: string,
    @Body() dto: ApproveMilestoneDto,
  ) {
    return this.escrowService.approveMilestone(userId, contractId, milestoneId, dto);
  }

  @Post('contracts/:id/dispute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Raise a formal contract dispute (freezes unreleased escrow funds)' })
  @ApiResponse({ status: 200, description: 'Dispute registered' })
  async raiseDispute(
    @CurrentUser('id') userId: string,
    @Param('id') contractId: string,
    @Body() dto: RaiseDisputeDto,
  ) {
    return this.escrowService.raiseDispute(userId, contractId, dto);
  }

  @Post('contracts/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Compliance Arbitrator issues binding resolution (Release, Refund, or Split)' })
  @ApiResponse({ status: 200, description: 'Dispute adjudicated and funds disbursed' })
  async resolveDispute(
    @CurrentUser('id') arbitratorId: string,
    @Param('id') contractId: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.escrowService.resolveDispute(arbitratorId, contractId, dto);
  }
}

