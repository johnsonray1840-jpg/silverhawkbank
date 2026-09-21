import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LoansService } from './loans.service';
import {
  ApplyLoanDto,
  CalculateLoanDto,
  CreateLoanProductDto,
  RepayLoanDto,
  ReviewLoanDto,
} from './dto/create-loan.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { LoanStatus } from '@prisma/client';

@Controller('loans')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  /**
   * Get available loan products
   */
  @Get('products')
  @Public()
  async getLoanProducts() {
    return this.loansService.getLoanProducts();
  }

  /**
   * Public loan repayment calculator
   */
  @Post('calculate')
  @Public()
  async calculateLoan(@Body() dto: CalculateLoanDto) {
    return this.loansService.calculateLoan(dto);
  }

  /**
   * Submit loan application
   */
  @Post('apply')
  async applyForLoan(
    @CurrentUser('id') userId: string,
    @Body() dto: ApplyLoanDto,
  ) {
    return this.loansService.applyForLoan(userId, dto);
  }

  /**
   * List customer's loans
   */
  @Get()
  async getUserLoans(@CurrentUser('id') userId: string) {
    return this.loansService.getUserLoans(userId);
  }

  /**
   * Admin: List all loans across the bank
   */
  @Get('admin/all')
  @RequirePermissions('loans.read')
  async adminListLoans(
    @Query('status') status?: LoanStatus,
    @Query('productId') productId?: string,
  ) {
    return this.loansService.adminListLoans({ status, productId });
  }

  /**
   * Admin: Create a new loan product
   */
  @Post('admin/products')
  @RequirePermissions('settings.update')
  async createLoanProduct(@Body() dto: CreateLoanProductDto) {
    return this.loansService.createLoanProduct(dto);
  }

  /**
   * Admin: Review loan application (Approve / Reject)
   */
  @Post('admin/:id/review')
  @RequirePermissions('loans.approve')
  async adminReviewLoan(
    @CurrentUser('id') adminId: string,
    @Param('id') loanId: string,
    @Body() dto: ReviewLoanDto,
  ) {
    return this.loansService.adminReviewLoan(adminId, loanId, dto);
  }

  /**
   * Admin: Disburse approved loan
   */
  @Post('admin/:id/disburse')
  @RequirePermissions('loans.approve')
  async adminDisburseLoan(
    @CurrentUser('id') adminId: string,
    @Param('id') loanId: string,
  ) {
    return this.loansService.adminDisburseLoan(adminId, loanId);
  }

  /**
   * Get single loan details with amortization schedule
   */
  @Get(':id')
  async getLoanById(
    @CurrentUser('id') userId: string,
    @Param('id') loanId: string,
  ) {
    return this.loansService.getLoanById(userId, loanId);
  }

  /**
   * Repay loan installment / payoff
   */
  @Post(':id/repay')
  async repayLoan(
    @CurrentUser('id') userId: string,
    @Param('id') loanId: string,
    @Body() dto: RepayLoanDto,
  ) {
    return this.loansService.repayLoan(userId, loanId, dto);
  }
}
