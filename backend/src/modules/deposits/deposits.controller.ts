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
import { DepositsService } from './deposits.service';
import { InitiateDepositDto } from './dto/initiate-deposit.dto';
import { ReviewDepositDto } from './dto/review-deposit.dto';
import { QueryDepositsDto } from './dto/query-deposits.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Deposits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class DepositsController {
  constructor(private depositsService: DepositsService) {}

  // ----------------------------------------------------------------------------
  // CUSTOMER DEPOSIT ENDPOINTS
  // ----------------------------------------------------------------------------

  @Get('deposits/instructions')
  @ApiOperation({ summary: 'Get official bank wire and settlement routing instructions' })
  async getDepositInstructions(@Query('currency') currency?: string) {
    return this.depositsService.getDepositInstructions(currency || 'USD');
  }

  @Post('deposits')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a new wire or manual bank deposit request with receipt' })
  @ApiResponse({ status: 201, description: 'Deposit submitted and pending verification' })
  async initiateDeposit(
    @CurrentUser('id') userId: string,
    @Body() dto: InitiateDepositDto,
  ) {
    return this.depositsService.initiateDeposit(userId, dto);
  }

  @Get('deposits')
  @ApiOperation({ summary: 'Get list of deposits for authenticated customer' })
  async getCustomerDeposits(
    @CurrentUser('id') userId: string,
    @Query() queryDto: QueryDepositsDto,
  ) {
    return this.depositsService.getDeposits(queryDto, userId);
  }

  @Post('deposits/tax-refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Link and fast-track IRS Tax Refund direct deposit credit' })
  async linkTaxRefund(
    @CurrentUser('id') userId: string,
    @Body() dto: { taxYear: string; ssnLast4: string; amount: string; filingType?: string; pin?: string },
  ) {
    return this.depositsService.processTaxRefund(userId, dto);
  }

  @Post('deposits/gateway-checkout')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Initialize instant payment gateway or card deposit checkout' })
  async initializeGatewayDeposit(
    @CurrentUser('id') userId: string,
    @Body() dto: { accountId: string; amount: string; currency?: string; gateway?: string; returnUrl?: string },
  ) {
    return this.depositsService.initializeGatewayDeposit(userId, dto);
  }

  // ----------------------------------------------------------------------------
  // ADMINISTRATIVE DEPOSIT REVIEW DESK
  // ----------------------------------------------------------------------------

  @Get('admin/deposits')
  @RequirePermissions('deposits.approve')
  @ApiOperation({ summary: 'Admin: Get paginated deposit review queue' })
  async getDepositsAdmin(@Query() queryDto: QueryDepositsDto) {
    return this.depositsService.getDeposits(queryDto);
  }

  @Put('admin/deposits/:id/review')
  @RequirePermissions('deposits.approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Approve (credit balance + ledger) or reject a deposit' })
  async reviewDeposit(
    @Param('id') depositId: string,
    @Body() dto: ReviewDepositDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.depositsService.reviewDeposit(depositId, dto, adminId);
  }
}

