import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SavingsService } from './savings.service';
import {
  CreateSavingsDto,
  TopUpSavingsDto,
  WithdrawSavingsDto,
  CreateSavingsGoalDto,
  CompoundCalculatorDto,
  ToggleRoundUpDto,
  AccrueInterestDto,
  ProcessRoundUpSweepDto,
  CreateFixedDepositDto,
  FixedDepositCalculatorDto,
} from './dto/create-savings.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SavingsStatus, SavingsType } from '@prisma/client';


@Controller('savings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SavingsController {
  constructor(private readonly savingsService: SavingsService) {}

  /**
   * Create a savings account / lockup plan
   */
  @Post()
  async createSavings(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSavingsDto,
  ) {
    return this.savingsService.createSavings(userId, dto);
  }

  /**
   * Fixed Term Deposit: Get available tenure tiers & yield rates
   */
  @Get(['fixed-deposit/tiers', 'fixed-deposits/tiers'])
  getFixedDepositTiers() {
    return this.savingsService.getFixedDepositTenureTiers();
  }

  /**
   * Fixed Term Deposit: Interactive Projection Calculator
   */
  @Post(['fixed-deposit/calculator', 'fixed-deposits/calculator'])
  calculateFixedDepositQuote(@Body() dto: FixedDepositCalculatorDto) {
    return this.savingsService.calculateFixedDepositQuote(dto);
  }

  /**
   * Fixed Term Deposit: Book new FDR Lockup
   */
  @Post(['fixed-deposit', 'fixed-deposits'])
  async createFixedDeposit(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateFixedDepositDto,
  ) {
    return this.savingsService.createFixedDeposit(userId, dto);
  }

  /**
   * Fixed Term Deposit: Preview real-time early liquidation penalties
   */
  @Get(':id/early-liquidation-quote')
  async getEarlyLiquidationQuote(
    @CurrentUser('id') userId: string,
    @Param('id') savingsId: string,
  ) {
    return this.savingsService.getEarlyLiquidationQuote(userId, savingsId);
  }


  /**
   * List customer savings accounts
   */
  @Get()
  async getSavingsList(@CurrentUser('id') userId: string) {
    return this.savingsService.getSavingsList(userId);
  }

  /**
   * Create a High-Yield Savings Goal
   */
  @Post('goals')
  async createSavingsGoal(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSavingsGoalDto,
  ) {
    return this.savingsService.createSavingsGoal(userId, dto);
  }

  /**
   * List all user's High-Yield Savings Goals with progress
   */
  @Get('goals')
  async getUserGoals(@CurrentUser('id') userId: string) {
    return this.savingsService.getUserGoals(userId);
  }

  /**
   * Interactive Compound Interest Projection Simulator
   */
  @Post('calculator')
  async calculateCompoundInterest(@Body() dto: CompoundCalculatorDto) {
    return this.savingsService.calculateCompoundSchedule(dto);
  }

  /**
   * Toggle or configure spare change round-up sweeps
   */
  @Post('goals/:id/roundup-toggle')
  async toggleRoundUp(
    @CurrentUser('id') userId: string,
    @Param('id') goalId: string,
    @Body() dto: ToggleRoundUpDto,
  ) {
    return this.savingsService.toggleRoundUp(userId, goalId, dto);
  }

  /**
   * Process a spare change sweep from transaction debit
   */
  @Post('process-roundups')
  async processSpareChangeRoundUp(
    @CurrentUser('id') userId: string,
    @Body() dto: ProcessRoundUpSweepDto,
  ) {
    return this.savingsService.processSpareChangeRoundUp(userId, dto);
  }

  /**
   * Platform-Wide Compound Interest Accrual and Payout (Admin / Cron)
   */
  @Post('accrue-interest')
  @RequirePermissions('admin:access')
  async accrueAndDisburseCompoundInterest(@Body() dto: AccrueInterestDto) {
    return this.savingsService.accrueAndDisburseCompoundInterest(dto);
  }

  /**
   * Admin: List all savings across platform
   */
  @Get('admin/all')
  @RequirePermissions('admin:access')
  async adminListSavings(
    @Query('type') type?: SavingsType,
    @Query('status') status?: SavingsStatus,
  ) {
    return this.savingsService.adminListSavings({ type, status });
  }

  /**
   * Single savings account details
   */
  @Get(':id')
  async getSavingsById(
    @CurrentUser('id') userId: string,
    @Param('id') savingsId: string,
  ) {
    return this.savingsService.getSavingsById(userId, savingsId);
  }

  /**
   * Top up savings
   */
  @Post(':id/top-up')
  async topUpSavings(
    @CurrentUser('id') userId: string,
    @Param('id') savingsId: string,
    @Body() dto: TopUpSavingsDto,
  ) {
    return this.savingsService.topUpSavings(userId, savingsId, dto);
  }

  /**
   * Withdraw / Liquidate savings
   */
  @Post(':id/withdraw')
  async withdrawSavings(
    @CurrentUser('id') userId: string,
    @Param('id') savingsId: string,
    @Body() dto: WithdrawSavingsDto,
  ) {
    return this.savingsService.withdrawSavings(userId, savingsId, dto);
  }
}

