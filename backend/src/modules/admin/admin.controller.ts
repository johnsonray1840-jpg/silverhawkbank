import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import {
  AdjustBalanceDto,
  AmlScreenDto,
  ApplyLoanPenaltyDto,
  ApproveDepositDto,
  ApproveWithdrawalDto,
  AssignUserRolesDto,
  BatchUpdateSettingsDto,
  CompleteWithdrawalDto,
  CreateGrantProgramDto,
  CreateLoanProductDto,
  CreateRoleDto,
  CreateSarDto,
  CreateStaffUserDto,
  CreateUserAdminDto,
  DisburseLoanDto,
  IssueCardAdminDto,
  ManualTransactionDto,
  ProcessWithdrawalDto,
  RejectDepositDto,
  RejectWithdrawalDto,
  RejectCardDto,
  ReplyTicketDto,
  ResetUserPasswordDto,
  ResetUserPinDto,
  ReverseWithdrawalDto,
  ReviewKycDto,
  ReviewLoanDto,
  UpdateAccountStatusDto,
  UpdateCardStatusAdminDto,
  UpdateGrantStatusDto,
  UpdateLoanProductDto,
  UpdateLoanProductStatusDto,
  UpdateMasterSettingsDto,
  UpdateRolePermissionsDto,
  UpdateSystemSettingDto,
  UpdateTransactionAdminDto,
  UpdateUserAdminDto,
} from './dto/admin.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Admin Command Center')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ---------------------------------------------------------------------------
  // 1. EXECUTIVE KPI ANALYTICS & AUDIT LOGS
  // ---------------------------------------------------------------------------
  @Get('analytics/dashboard')
  @ApiOperation({ summary: 'Executive KPI Analytics & System Health Metrics' })
  async getDashboardAnalytics() {
    return this.adminService.getDashboardAnalytics();
  }

  @Get('analytics/audit-logs')
  @ApiOperation({ summary: 'Explore global audit log hash trail' })
  async getAuditLogs(
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('resource') resource?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ) {
    return this.adminService.getAuditLogs({ actorId, action, resource, search, startDate, endDate, page, limit, offset, sortBy, sortOrder });
  }

  // ---------------------------------------------------------------------------
  // 2. USER & CUSTOMER MANAGEMENT
  // ---------------------------------------------------------------------------
  @Get('users')
  @ApiOperation({ summary: 'List all users with search, role and status filters' })
  async getUsers(
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ) {
    return this.adminService.getUsers({ search, role, status, startDate, endDate, page, limit, sortBy, sortOrder });
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get 360-degree Customer Dossier' })
  async getUserDetails(@Param('id') id: string) {
    return this.adminService.getUserDetails(id);
  }

  @Get('users/:id/accounts')
  @ApiOperation({ summary: 'Get all bank accounts for specific customer' })
  async getUserAccounts(@Param('id') id: string) {
    return this.adminService.getUserAccounts(id);
  }

  @Get('users/:id/transactions')
  @ApiOperation({ summary: 'Get transaction history for specific customer' })
  async getUserTransactions(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getUserTransactions(id, { page, limit, type, status, search });
  }

  @Get('users/:id/kyc')
  @ApiOperation({ summary: 'Get KYC profile & documents for specific customer' })
  async getUserKyc(@Param('id') id: string) {
    return this.adminService.getUserKyc(id);
  }

  @Get('users/:id/loans')
  @ApiOperation({ summary: 'Get loans and applications for specific customer' })
  async getUserLoans(@Param('id') id: string) {
    return this.adminService.getUserLoans(id);
  }

  @Get('users/:id/deposits')
  @ApiOperation({ summary: 'Get deposits history for specific customer' })
  async getUserDeposits(@Param('id') id: string) {
    return this.adminService.getUserDeposits(id);
  }

  @Get('users/:id/withdrawals')
  @ApiOperation({ summary: 'Get withdrawal requests for specific customer' })
  async getUserWithdrawals(@Param('id') id: string) {
    return this.adminService.getUserWithdrawals(id);
  }

  @Post('users/:id/suspend')
  @ApiOperation({ summary: 'Suspend customer access' })
  async suspendUser(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.suspendUser(id, reason, adminId);
  }

  @Post('users/:id/activate')
  @ApiOperation({ summary: 'Activate suspended or locked customer' })
  async activateUser(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.activateUser(id, adminId);
  }

  @Post('users/:id/freeze')
  @ApiOperation({ summary: 'Freeze customer and all associated accounts' })
  async freezeUser(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.freezeUser(id, reason, adminId);
  }

  @Post('users/:id/disable')
  @ApiOperation({ summary: 'Deactivate / close customer account' })
  async disableUser(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.disableUser(id, reason, adminId);
  }

  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Admin direct onboarding with initial balance' })
  async createUser(
    @Body() dto: CreateUserAdminDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.createUser(dto, adminId);
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Update customer profile, status, or role' })
  async updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserAdminDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.updateUser(id, dto, adminId);
  }

  @Post('users/:id/reset-password')
  @ApiOperation({ summary: 'Direct password reset for locked-out customer' })
  async resetUserPassword(
    @Param('id') id: string,
    @Body() dto: ResetUserPasswordDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.resetUserPassword(id, dto, adminId);
  }

  @Post('users/:id/reset-pin')
  @ApiOperation({ summary: 'Direct PIN override for customer' })
  async resetUserPin(
    @Param('id') id: string,
    @Body() dto: ResetUserPinDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.resetUserPin(id, dto, adminId);
  }

  @Post('users/:id/reset-2fa')
  @ApiOperation({ summary: 'Clear 2FA/WebAuthn lock for customer' })
  async resetUser2fa(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.resetUser2fa(id, adminId);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Close, archive, or permanently delete user account' })
  async deleteUser(
    @Param('id') id: string,
    @Query('permanent') permanent?: string,
    @CurrentUser('id') adminId?: string,
  ) {
    const isPermanent = permanent === 'true' || permanent === '1';
    return this.adminService.deleteUser(id, adminId!, isPermanent);
  }

  @Post('users/:id/impersonate')
  @ApiOperation({ summary: 'Admin impersonation session to access user portal without password' })
  async impersonateUser(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Req() req: Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.adminService.impersonateUser(id, adminId, ip, userAgent);
  }

  // ---------------------------------------------------------------------------
  // 3. ACCOUNTS & DIRECT DOUBLE-ENTRY LEDGER BALANCE ADJUSTMENTS
  // ---------------------------------------------------------------------------
  @Get('accounts')
  @ApiOperation({ summary: 'List all universal bank accounts' })
  async getAccounts(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('currency') currency?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ) {
    return this.adminService.getAccounts({ search, status, type, currency, page, limit, sortBy, sortOrder });
  }

  @Post('accounts/:id/adjust-balance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Direct Credit or Debit balance with double-entry ledger update' })
  async adjustAccountBalance(
    @Param('id') accountId: string,
    @Body() dto: AdjustBalanceDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.adjustAccountBalance(accountId, dto, adminId);
  }

  @Patch('accounts/:id/status')
  @ApiOperation({ summary: 'Freeze or unfreeze bank account' })
  async updateAccountStatus(
    @Param('id') accountId: string,
    @Body() dto: UpdateAccountStatusDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.updateAccountStatus(accountId, dto, adminId);
  }

  // ---------------------------------------------------------------------------
  // 4. TRANSACTIONS & MANUAL CUSTOM INJECTIONS
  // ---------------------------------------------------------------------------
  @Get('transactions')
  @ApiOperation({ summary: 'Global transaction ledger explorer' })
  async getTransactions(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getTransactions({ search, status, type, page, limit });
  }

  @Get('transactions/pending')
  @ApiOperation({ summary: 'Get all pending transactions requiring admin approval' })
  async getPendingTransactions(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('type') type?: string,
  ) {
    return this.adminService.getPendingTransactions({ page, limit, type });
  }

  @Get('transactions/export')
  @ApiOperation({ summary: 'Export global transaction audit reports in CSV or certified PDF format' })
  async exportTransactions(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('currency') currency?: string,
    @Query('format') format?: 'CSV' | 'PDF',
    @Res() res?: Response,
  ) {
    const report = await this.adminService.exportTransactionReport({
      search,
      status,
      type,
      startDate,
      endDate,
      currency,
      format,
    });

    if (res) {
      res.setHeader('Content-Type', report.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
      if (report.buffer) {
        res.setHeader('Content-Length', report.buffer.length);
        return res.end(report.buffer);
      }
      return res.send(report.csv);
    }
    return report;
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get 360-degree Transaction Details with Ledger double-entry record' })
  async getTransactionDetails(@Param('id') id: string) {
    return this.adminService.getTransactionDetails(id);
  }

  @Post('transactions/inject')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Manual custom transaction injection with ledger balancing' })
  async injectTransaction(
    @Body() dto: ManualTransactionDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.injectTransaction(dto, adminId);
  }

  @Post('transactions/:id/approve')
  @ApiOperation({ summary: 'Approve pending wire or transfer' })
  async approveTransaction(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.approveTransaction(id, adminId);
  }

  @Post('transactions/:id/reject')
  @ApiOperation({ summary: 'Reject pending wire or transfer and restore funds' })
  async rejectTransaction(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.rejectTransaction(id, reason || 'Transaction declined by compliance desk', adminId);
  }

  @Post('transactions/:id/pend')
  @ApiOperation({ summary: 'Set transaction to pending state' })
  async setTransactionPending(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.setTransactionPending(id, reason || 'Transaction placed on pending status by administrator', adminId);
  }

  @Post('transactions/:id/under-review')
  @ApiOperation({ summary: 'Flag and place transaction under compliance review' })
  async setTransactionUnderReview(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.setTransactionUnderReview(id, reason || 'Placed under compliance review', adminId);
  }

  @Patch('transactions/:id')
  @ApiOperation({ summary: 'Update transaction parameters, status, metadata and internal notes' })
  async updateTransaction(
    @Param('id') id: string,
    @Body() dto: UpdateTransactionAdminDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.updateTransaction(id, dto, adminId);
  }

  @Delete('transactions/:id')
  @ApiOperation({ summary: 'Delete transaction and audit trail record' })
  async deleteTransaction(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.deleteTransaction(id, adminId);
  }

  @Post('transactions/:id/reverse')
  @ApiOperation({ summary: 'Reverse completed transaction and balance' })
  async reverseTransaction(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.reverseTransaction(id, adminId);
  }

  // ---------------------------------------------------------------------------
  // 5. DEPOSITS MANAGEMENT
  // ---------------------------------------------------------------------------
  @Get('deposits')
  @RequirePermissions('deposits.read')
  @ApiOperation({ summary: 'List all inbound deposits with multi-filtering and pagination' })
  async getDeposits(
    @Query('status') status?: string,
    @Query('method') method?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getDeposits({ status, method, search, startDate, endDate, page, limit });
  }

  @Get('deposits/:id')
  @RequirePermissions('deposits.read')
  @ApiOperation({ summary: 'Get 360-degree Deposit Details with Proof and Ledger records' })
  async getDepositDetails(@Param('id') id: string) {
    return this.adminService.getDepositDetails(id);
  }

  @Post('deposits/:id/approve')
  @RequirePermissions('deposits.approve')
  @ApiOperation({ summary: 'Approve deposit and credit customer available balance' })
  async approveDeposit(
    @Param('id') id: string,
    @Body() dto: ApproveDepositDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.approveDeposit(id, dto, adminId);
  }

  @Post('deposits/:id/reject')
  @RequirePermissions('deposits.approve')
  @ApiOperation({ summary: 'Reject invalid or unconfirmed deposit with mandatory reason' })
  async rejectDeposit(
    @Param('id') id: string,
    @Body() dto: RejectDepositDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.rejectDeposit(id, dto, adminId);
  }

  // ---------------------------------------------------------------------------
  // 6. WITHDRAWALS MANAGEMENT
  // ---------------------------------------------------------------------------
  @Get('withdrawals')
  @RequirePermissions('withdrawals.approve')
  @ApiOperation({ summary: 'List all customer withdrawal requests with multi-filtering' })
  async getWithdrawals(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getWithdrawals({ status, search, startDate, endDate, page, limit });
  }

  @Get('withdrawals/:id')
  @RequirePermissions('withdrawals.approve')
  @ApiOperation({ summary: 'Get 360-degree Withdrawal request dossier with payout details' })
  async getWithdrawalDetails(@Param('id') id: string) {
    return this.adminService.getWithdrawalDetails(id);
  }

  @Post('withdrawals/:id/approve')
  @RequirePermissions('withdrawals.approve')
  @ApiOperation({ summary: 'Approve withdrawal request for payout queue' })
  async approveWithdrawal(
    @Param('id') id: string,
    @Body() dto: ApproveWithdrawalDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.approveWithdrawal(id, dto, adminId);
  }

  @Post('withdrawals/:id/process')
  @RequirePermissions('withdrawals.approve')
  @ApiOperation({ summary: 'Mark withdrawal as PROCESSING through provider rail' })
  async processWithdrawal(
    @Param('id') id: string,
    @Body() dto: ProcessWithdrawalDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.processWithdrawal(id, dto, adminId);
  }

  @Post('withdrawals/:id/complete')
  @RequirePermissions('withdrawals.approve')
  @ApiOperation({ summary: 'Complete and settle withdrawal with ledger debit' })
  async completeWithdrawal(
    @Param('id') id: string,
    @Body() dto: CompleteWithdrawalDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.completeWithdrawal(id, dto, adminId);
  }

  @Post('withdrawals/:id/reject')
  @RequirePermissions('withdrawals.approve')
  @ApiOperation({ summary: 'Decline withdrawal request and restore held customer funds' })
  async rejectWithdrawal(
    @Param('id') id: string,
    @Body() dto: RejectWithdrawalDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.rejectWithdrawal(id, dto, adminId);
  }

  @Post('withdrawals/:id/reverse')
  @RequirePermissions('transactions.reverse')
  @ApiOperation({ summary: 'Execute compensating reversal for completed withdrawal' })
  async reverseWithdrawal(
    @Param('id') id: string,
    @Body() dto: ReverseWithdrawalDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.reverseWithdrawal(id, dto, adminId);
  }

  // ---------------------------------------------------------------------------
  // 7. GRANTS & BUSINESS SUBSIDIES
  // ---------------------------------------------------------------------------
  @Get('grants')
  @ApiOperation({ summary: 'List grant applications across all commercial programs' })
  async getGrants(@Query('status') status?: string) {
    return this.adminService.getGrants({ status });
  }

  @Post('grants/:id/status')
  @ApiOperation({ summary: 'Approve, reject, or disburse grant award' })
  async updateGrantStatus(
    @Param('id') id: string,
    @Body() dto: UpdateGrantStatusDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.updateGrantStatus(id, dto, adminId);
  }

  // ---------------------------------------------------------------------------
  // 8. TAX REFUNDS
  // ---------------------------------------------------------------------------
  @Get('tax-refunds')
  @ApiOperation({ summary: 'List IRS direct deposit tax refund claims' })
  async getTaxRefunds() {
    return this.adminService.getTaxRefunds();
  }

  // ---------------------------------------------------------------------------
  // 9. KYC & AML SANCTIONS COMPLIANCE
  // ---------------------------------------------------------------------------
  @Get('kyc')
  @RequirePermissions('kyc.read')
  @ApiOperation({ summary: 'List KYC identity verification submissions' })
  async getKycProfiles(
    @Query('status') status?: string,
    @Query('tier') tier?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ) {
    return this.adminService.getKycProfiles({ status, tier, search, page, limit, sortBy, sortOrder });
  }

  @Post('kyc/:id/review')
  @RequirePermissions('kyc.approve')
  @ApiOperation({ summary: 'Approve or reject KYC identity submission' })
  async reviewKyc(
    @Param('id') id: string,
    @Body() dto: ReviewKycDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.reviewKyc(id, dto, adminId);
  }

  @Post('aml/screen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run real-time Jaro-Winkler OFAC SDN & PEP screener' })
  async screenAml(@Body() dto: AmlScreenDto) {
    return this.adminService.screenAml(dto);
  }

  @Post('aml/sar')
  @ApiOperation({ summary: 'Record and transmit FinCEN Suspicious Activity Report' })
  async createSar(
    @Body() dto: CreateSarDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.createSar(dto, adminId);
  }

  // ---------------------------------------------------------------------------
  // 10. CARDS MANAGEMENT
  // ---------------------------------------------------------------------------
  @Get('cards')
  @RequirePermissions('cards.manage')
  @ApiOperation({ summary: 'List all issued customer debit and virtual cards' })
  async getCards() {
    return this.adminService.getCards();
  }

  @Post('cards/issue')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('cards.manage')
  @ApiOperation({ summary: 'Issue new card for customer' })
  async issueCard(
    @Body() dto: IssueCardAdminDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.issueCard(dto, adminId);
  }

  @Patch('cards/:id/status')
  @RequirePermissions('cards.manage')
  @ApiOperation({ summary: 'Freeze, activate, or cancel card' })
  async updateCardStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCardStatusAdminDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.updateCardStatus(id, dto, adminId);
  }

  @Post('cards/:id/approve')
  @RequirePermissions('cards.manage')
  @ApiOperation({ summary: 'Approve and activate pending card application' })
  async approveCard(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.approveCard(id, adminId);
  }

  @Post('cards/:id/reject')
  @RequirePermissions('cards.manage')
  @ApiOperation({ summary: 'Reject pending card application' })
  async rejectCard(
    @Param('id') id: string,
    @Body() dto: RejectCardDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.rejectCard(id, dto, adminId);
  }

  // ---------------------------------------------------------------------------
  // 11. LOAN PRODUCTS LIFECYCLE
  // ---------------------------------------------------------------------------
  @Post('loans/products')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('loans.approve')
  @ApiOperation({ summary: 'Create new commercial or retail loan product' })
  async createLoanProduct(
    @Body() dto: CreateLoanProductDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.createLoanProduct(dto, adminId);
  }

  @Get('loans/products')
  @RequirePermissions('loans.read')
  @ApiOperation({ summary: 'List all loan products with portfolio metrics' })
  async getLoanProducts(@Query('isActive') isActive?: boolean) {
    return this.adminService.getLoanProducts({ isActive });
  }

  @Get('loans/products/:id')
  @RequirePermissions('loans.read')
  @ApiOperation({ summary: 'Get detailed loan product configuration' })
  async getLoanProductDetails(@Param('id') id: string) {
    return this.adminService.getLoanProductDetails(id);
  }

  @Patch('loans/products/:id')
  @RequirePermissions('loans.approve')
  @ApiOperation({ summary: 'Update loan product terms, interest, and limits' })
  async updateLoanProduct(
    @Param('id') id: string,
    @Body() dto: UpdateLoanProductDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.updateLoanProduct(id, dto, adminId);
  }

  @Patch('loans/products/:id/status')
  @RequirePermissions('loans.approve')
  @ApiOperation({ summary: 'Enable or disable a loan product' })
  async setLoanProductStatus(
    @Param('id') id: string,
    @Body() dto: UpdateLoanProductStatusDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.setLoanProductStatus(id, dto.isActive, adminId);
  }

  // ---------------------------------------------------------------------------
  // 12. LOAN APPLICATIONS & UNDERWRITING
  // ---------------------------------------------------------------------------
  @Get('loans/applications')
  @RequirePermissions('loans.read')
  @ApiOperation({ summary: 'List all credit facility loan applications' })
  async getLoanApplications(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getLoanApplications({ status, search, page, limit });
  }

  @Get('loans/applications/:id')
  @RequirePermissions('loans.read')
  @ApiOperation({ summary: 'Get 360-degree Loan Application Underwriting Dossier' })
  async getLoanApplicationDetails(@Param('id') id: string) {
    return this.adminService.getLoanApplicationDetails(id);
  }

  @Post('loans/applications/:id/approve')
  @RequirePermissions('loans.approve')
  @ApiOperation({ summary: 'Underwriting committee approval for loan application' })
  async approveLoanApplication(
    @Param('id') id: string,
    @Body() dto: ReviewLoanDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.approveLoanApplication(id, dto, adminId);
  }

  @Post('loans/applications/:id/reject')
  @RequirePermissions('loans.approve')
  @ApiOperation({ summary: 'Decline loan application with formal review notes' })
  async rejectLoanApplication(
    @Param('id') id: string,
    @Body() dto: ReviewLoanDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.rejectLoanApplication(id, dto, adminId);
  }

  @Post('loans/applications/:id/disburse')
  @RequirePermissions('loans.disburse')
  @ApiOperation({ summary: 'Atomic loan disbursement with installment schedule generation' })
  async disburseLoan(
    @Param('id') id: string,
    @Body() dto: DisburseLoanDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.disburseLoan(id, dto, adminId);
  }

  // ---------------------------------------------------------------------------
  // 13. ACTIVE LOANS & OVERDUE RECOVERY
  // ---------------------------------------------------------------------------
  @Get('loans/active')
  @RequirePermissions('loans.read')
  @ApiOperation({ summary: 'Monitor active loans portfolio and outstanding balances' })
  async getActiveLoans(
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getActiveLoans({ search, page, limit });
  }

  @Get('loans/overdue')
  @RequirePermissions('loans.read')
  @ApiOperation({ summary: 'Identify overdue loan installments and calculate late penalty fees' })
  async getOverdueLoans(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getOverdueLoans({ page, limit });
  }

  @Post('loans/:id/apply-penalty')
  @RequirePermissions('loans.approve')
  @ApiOperation({ summary: 'Assess and apply contractual late payment penalty to loan' })
  async applyLoanPenalty(
    @Param('id') id: string,
    @Body() dto: ApplyLoanPenaltyDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.applyLoanPenalty(id, dto, adminId);
  }

  @Get('loans/:id/repayments')
  @RequirePermissions('loans.read')
  @ApiOperation({ summary: 'Get full repayment schedule and logs for specific loan' })
  async getLoanRepayments(@Param('id') id: string) {
    return this.adminService.getLoanRepayments(id);
  }

  // ---------------------------------------------------------------------------
  // 14. STAFF & RBAC (ROLE-BASED ACCESS CONTROL)
  // ---------------------------------------------------------------------------
  @Get('rbac/roles')
  @RequirePermissions('settings.update')
  @ApiOperation({ summary: 'List all system roles with assigned permissions and user counts' })
  async getRbacRoles() {
    return this.adminService.getRbacRoles();
  }

  @Get('rbac/permissions')
  @RequirePermissions('settings.update')
  @ApiOperation({ summary: 'List all granular security permissions grouped by functional module' })
  async getRbacPermissions() {
    return this.adminService.getRbacPermissions();
  }

  @Post('rbac/roles')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('settings.update')
  @ApiOperation({ summary: 'Create new custom staff role with granular permissions' })
  async createRbacRole(
    @Body() dto: CreateRoleDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.createRbacRole(dto, adminId);
  }

  @Put('rbac/roles/:id/permissions')
  @RequirePermissions('settings.update')
  @ApiOperation({ summary: 'Update granular permissions assigned to a role' })
  async updateRbacRolePermissions(
    @Param('id') roleId: string,
    @Body() dto: UpdateRolePermissionsDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.updateRbacRolePermissions(roleId, dto, adminId);
  }

  @Get('staff')
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'List all staff users with assigned roles and permissions' })
  async getStaffMembers() {
    return this.adminService.getStaffMembers();
  }

  @Post('staff')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('users.create')
  @ApiOperation({ summary: 'Create and provision new administrative staff member' })
  async createStaffUser(
    @Body() dto: CreateStaffUserDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.createStaffUser(dto, adminId);
  }

  @Put('staff/:id/roles')
  @RequirePermissions('users.update')
  @ApiOperation({ summary: 'Assign or update roles for staff member' })
  async assignStaffRoles(
    @Param('id') userId: string,
    @Body() dto: AssignUserRolesDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.assignStaffRoles(userId, dto, adminId);
  }

  // ---------------------------------------------------------------------------
  // 15. SUPPORT TICKETS
  // ---------------------------------------------------------------------------
  @Get('support/tickets')
  @RequirePermissions('support.manage')
  @ApiOperation({ summary: 'List customer support inquiries' })
  async getSupportTickets(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('category') category?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ) {
    return this.adminService.getSupportTickets({ status, priority, category, assignedTo, search, page, limit, sortBy, sortOrder });
  }

  @Post('support/tickets/:id/reply')
  @RequirePermissions('support.manage')
  @ApiOperation({ summary: 'Staff reply to customer support ticket' })
  async replySupportTicket(
    @Param('id') ticketId: string,
    @Body() dto: ReplyTicketDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.adminService.replySupportTicket(ticketId, dto, adminId);
  }

  // ---------------------------------------------------------------------------
  // 16. MASTER SYSTEM SETTINGS
  // ---------------------------------------------------------------------------
  @Get('settings')
  @RequirePermissions('settings.update')
  @ApiOperation({ summary: 'Get all system settings and bank parameters' })
  async getSystemSettings() {
    return this.adminService.getSystemSettings();
  }

  @Patch('settings/:key')
  @RequirePermissions('settings.update')
  @ApiOperation({ summary: 'Update single bank setting' })
  async updateSystemSetting(
    @CurrentUser('id') adminId: string,
    @Param('key') key: string,
    @Body() dto: UpdateSystemSettingDto,
  ) {
    return this.adminService.updateSystemSetting(adminId, key, dto);
  }

  @Put('settings/batch')
  @RequirePermissions('settings.update')
  @ApiOperation({ summary: 'Batch update system settings' })
  async batchUpdateSettings(
    @CurrentUser('id') adminId: string,
    @Body() dto: BatchUpdateSettingsDto,
  ) {
    return this.adminService.batchUpdateSettings(adminId, dto);
  }

  @Post('settings')
  @RequirePermissions('settings.update')
  @ApiOperation({ summary: 'Update master settings' })
  async updateMasterSettings(
    @CurrentUser('id') adminId: string,
    @Body() dto: UpdateMasterSettingsDto,
  ) {
    return this.adminService.updateMasterSettings(adminId, dto);
  }
}
