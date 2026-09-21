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
import { TreasuryService } from './treasury.service';
import {
  CreateSharedVaultDto,
  AddVaultMemberDto,
  InitiateTreasuryTransferDto,
  ApproveTransferDto,
  RejectTransferDto,
  ConfigureSweepRuleDto,
} from './dto/treasury.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Multi-Party Shared Treasury & Multi-Signature Governance')
@ApiBearerAuth()
@Controller('treasury')
export class TreasuryController {
  constructor(private readonly treasuryService: TreasuryService) {}

  @Post('vaults')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a multi-party collaborative shared treasury vault' })
  @ApiResponse({ status: 201, description: 'Shared treasury vault created successfully' })
  async createSharedVault(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSharedVaultDto,
  ) {
    return this.treasuryService.createSharedVault(userId, dto);
  }

  @Get('vaults')
  @ApiOperation({ summary: 'List all shared treasury vaults accessible to the authenticated user' })
  @ApiResponse({ status: 200, description: 'List of accessible collaborative vaults' })
  async listUserVaults(@CurrentUser('id') userId: string) {
    return this.treasuryService.listUserVaults(userId);
  }

  @Post('vaults/:vaultId/members')
  @ApiOperation({ summary: 'Invite or add a user as an authorized signer/member of the treasury vault' })
  @ApiResponse({ status: 200, description: 'Member added with designated role' })
  async addVaultMember(
    @CurrentUser('id') userId: string,
    @Param('vaultId') vaultId: string,
    @Body() dto: AddVaultMemberDto,
  ) {
    return this.treasuryService.addVaultMember(userId, vaultId, dto);
  }

  @Get('vaults/:vaultId/members')
  @ApiOperation({ summary: 'List all members and their assigned governance roles for a vault' })
  @ApiResponse({ status: 200, description: 'List of vault members' })
  async listVaultMembers(
    @CurrentUser('id') userId: string,
    @Param('vaultId') vaultId: string,
  ) {
    return this.treasuryService.listVaultMembers(userId, vaultId);
  }

  @Post('vaults/:vaultId/transfers')
  @ApiOperation({ summary: 'Initiate a treasury disbursement (instant if <= limit, or queues M-of-N multi-sig request)' })
  @ApiResponse({ status: 200, description: 'Disbursement executed or queued for required signatures' })
  async initiateTransfer(
    @CurrentUser('id') userId: string,
    @Param('vaultId') vaultId: string,
    @Body() dto: InitiateTreasuryTransferDto,
  ) {
    return this.treasuryService.initiateTransfer(userId, vaultId, dto);
  }

  @Get('vaults/:vaultId/requests')
  @ApiOperation({ summary: 'List all pending and historical multi-sig approval requests for a vault' })
  @ApiResponse({ status: 200, description: 'List of multi-sig requests' })
  async listVaultRequests(
    @CurrentUser('id') userId: string,
    @Param('vaultId') vaultId: string,
  ) {
    return this.treasuryService.listVaultRequests(userId, vaultId);
  }

  @Post('requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign and approve a pending multi-sig transfer request (executes upon M-of-N quorum)' })
  @ApiResponse({ status: 200, description: 'Signature registered; executed if quorum achieved' })
  async approveTransfer(
    @CurrentUser('id') userId: string,
    @Param('requestId') requestId: string,
    @Body() dto: ApproveTransferDto,
  ) {
    return this.treasuryService.approveTransfer(userId, requestId, dto);
  }

  @Post('requests/:requestId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a pending multi-sig transfer request' })
  @ApiResponse({ status: 200, description: 'Request rejected' })
  async rejectTransfer(
    @CurrentUser('id') userId: string,
    @Param('requestId') requestId: string,
    @Body() dto: RejectTransferDto,
  ) {
    return this.treasuryService.rejectTransfer(userId, requestId, dto);
  }

  @Post('vaults/:vaultId/sweep-rule')
  @ApiOperation({ summary: 'Configure automated target balance / zero-balance liquidity sweep rule' })
  @ApiResponse({ status: 200, description: 'Sweep rule configured successfully' })
  async configureSweepRule(
    @CurrentUser('id') userId: string,
    @Param('vaultId') vaultId: string,
    @Body() dto: ConfigureSweepRuleDto,
  ) {
    return this.treasuryService.configureSweepRule(userId, vaultId, dto);
  }

  @Post('vaults/:vaultId/sweep')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger automated liquidity rebalancing sweep calculation' })
  @ApiResponse({ status: 200, description: 'Sweep evaluation and rebalancing result' })
  async executeSweep(
    @CurrentUser('id') userId: string,
    @Param('vaultId') vaultId: string,
  ) {
    return this.treasuryService.executeSweep(userId, vaultId);
  }
}

