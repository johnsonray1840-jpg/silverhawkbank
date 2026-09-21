import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WithdrawalsService } from './withdrawals.service';
import { RequestWithdrawalDto } from './dto/request-withdrawal.dto';
import { ReviewWithdrawalDto } from './dto/review-withdrawal.dto';
import { QueryWithdrawalsDto } from './dto/query-withdrawals.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Withdrawals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class WithdrawalsController {
  constructor(private withdrawalsService: WithdrawalsService) {}

  // ----------------------------------------------------------------------------
  // CUSTOMER WITHDRAWAL ENDPOINTS
  // ----------------------------------------------------------------------------

  @Post('withdrawals')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit an outbound local or international bank withdrawal request' })
  @ApiResponse({ status: 200, description: 'Withdrawal requested and queued for settlement' })
  async requestWithdrawal(
    @CurrentUser('id') userId: string,
    @Body() dto: RequestWithdrawalDto,
  ) {
    return this.withdrawalsService.requestWithdrawal(userId, dto);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'Get list of withdrawal requests for authenticated customer' })
  async getCustomerWithdrawals(
    @CurrentUser('id') userId: string,
    @Query() queryDto: QueryWithdrawalsDto,
  ) {
    return this.withdrawalsService.getWithdrawals(queryDto, userId);
  }

  // ----------------------------------------------------------------------------
  // ADMINISTRATIVE WITHDRAWAL DESK
  // ----------------------------------------------------------------------------

  @Get('admin/withdrawals')
  @RequirePermissions('withdrawals.approve')
  @ApiOperation({ summary: 'Admin: Get paginated list of all customer withdrawal requests' })
  async getWithdrawalsAdmin(@Query() queryDto: QueryWithdrawalsDto) {
    return this.withdrawalsService.getWithdrawals(queryDto);
  }

  @Put('admin/withdrawals/:id/review')
  @RequirePermissions('withdrawals.approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Complete (settle via ledger) or reject a withdrawal request' })
  async reviewWithdrawal(
    @Param('id') withdrawalId: string,
    @Body() dto: ReviewWithdrawalDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.withdrawalsService.reviewWithdrawal(withdrawalId, dto, adminId);
  }

  @Post('admin/withdrawals/:id/reverse')
  @RequirePermissions('withdrawals.reverse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Execute a compensating reversal on a settled withdrawal' })
  async reverseWithdrawal(
    @Param('id') withdrawalId: string,
    @Body('reason') reason: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.withdrawalsService.reverseWithdrawal(withdrawalId, reason || 'Administrative withdrawal recall', adminId);
  }
}

