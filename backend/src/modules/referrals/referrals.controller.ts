import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReferralsService } from './referrals.service';
import { ProcessReferralRewardDto, QueryReferralsDto } from './dto/referral.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@ApiTags('Referrals Program')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get('my-code')
  @ApiOperation({ summary: 'Get customer unique referral code, link, and program terms' })
  @ApiResponse({ status: 200, description: 'Referral link and code' })
  async getMyReferralCode(@CurrentUser('id') userId: string) {
    return this.referralsService.getMyReferralCode(userId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get referral performance metrics and earnings' })
  @ApiResponse({ status: 200, description: 'Referral dashboard statistics' })
  async getReferralStats(@CurrentUser('id') userId: string) {
    return this.referralsService.getReferralStats(userId);
  }

  @Get('referred-users')
  @ApiOperation({ summary: 'List users referred by customer with masked identities' })
  @ApiResponse({ status: 200, description: 'List of referred users' })
  async getReferredUsers(
    @CurrentUser('id') userId: string,
    @Query() query: QueryReferralsDto,
  ) {
    return this.referralsService.getReferredUsers(userId, query);
  }

  @Get('history')
  @ApiOperation({ summary: 'List referral reward payout history' })
  @ApiResponse({ status: 200, description: 'Referral rewards history' })
  async getReferralHistory(
    @CurrentUser('id') userId: string,
    @Query() query: QueryReferralsDto,
  ) {
    return this.referralsService.getReferralHistory(userId, query);
  }

  // --------------------------------------------------------------------------
  // ADMINISTRATIVE REWARD PROCESSING
  // --------------------------------------------------------------------------

  @Post('admin/process-reward')
  @RequirePermissions('settings.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin / System process qualifying referral reward with ledger debit' })
  @ApiResponse({ status: 200, description: 'Referral bonus disbursed successfully' })
  async processQualifyingReward(
    @CurrentUser('id') adminId: string,
    @Body() dto: ProcessReferralRewardDto,
  ) {
    return this.referralsService.processQualifyingReward(adminId, dto);
  }
}

