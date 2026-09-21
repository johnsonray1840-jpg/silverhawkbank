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
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountStatusDto } from './dto/update-account-status.dto';
import { UpdateAccountLimitsDto } from './dto/update-account-limits.dto';
import { QueryStatementDto } from './dto/query-statement.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Bank Accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class AccountsController {
  constructor(private accountsService: AccountsService) {}

  // ----------------------------------------------------------------------------
  // CUSTOMER DASHBOARD & ACCOUNT MANAGEMENT ENDPOINTS
  // ----------------------------------------------------------------------------

  @Get(['accounts/summary', 'dashboard', 'dashboard/summary'])
  @ApiOperation({ summary: 'Get Customer Dashboard balance summary and 30-day cash flow' })
  @ApiResponse({ status: 200, description: 'Aggregated total, available, ledger, savings, and loan balances' })
  async getDashboardSummary(@CurrentUser('id') userId: string) {
    return this.accountsService.getDashboardSummary(userId);
  }

  @Post('accounts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Open an additional Checking, Savings, or Business bank account' })
  async createAccount(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateAccountDto,
  ) {
    return this.accountsService.createAccount(userId, dto);
  }

  @Get('accounts/:id')
  @ApiOperation({ summary: 'Get details of a specific bank account' })
  async getAccountDetails(
    @CurrentUser('id') userId: string,
    @Param('id') accountId: string,
  ) {
    return this.accountsService.getAccountDetails(userId, accountId);
  }

  @Get('accounts/:id/statement')
  @ApiOperation({ summary: 'Get paginated transaction statement for a specific bank account' })
  async getAccountStatement(
    @CurrentUser('id') userId: string,
    @Param('id') accountId: string,
    @Query() queryDto: QueryStatementDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (queryDto.format === 'PDF') {
      const pdf = await this.accountsService.exportStatementPdf(userId, accountId, queryDto);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${pdf.filename}"`);
      return res.send(pdf.buffer);
    }
    if (queryDto.format === 'CSV') {
      const csvData = await this.accountsService.exportStatementCsv(userId, accountId, queryDto);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${csvData.filename}"`);
      return res.send(csvData.csv);
    }
    return this.accountsService.getAccountStatement(userId, accountId, queryDto);
  }

  @Get('accounts/:id/statement/pdf')
  @ApiOperation({ summary: 'Export downloadable authentic binary PDF transaction statement' })
  async exportAccountStatementPdf(
    @CurrentUser('id') userId: string,
    @Param('id') accountId: string,
    @Query() queryDto: QueryStatementDto,
    @Res() res: Response,
  ) {
    const pdf = await this.accountsService.exportStatementPdf(userId, accountId, queryDto);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdf.filename}"`);
    res.setHeader('Content-Length', pdf.buffer.length);
    return res.end(pdf.buffer);
  }

  @Get('accounts/:id/statement/csv')
  @ApiOperation({ summary: 'Export downloadable CSV transaction statement' })
  async exportAccountStatementCsv(
    @CurrentUser('id') userId: string,
    @Param('id') accountId: string,
    @Query() queryDto: QueryStatementDto,
    @Res() res: Response,
  ) {
    const csvData = await this.accountsService.exportStatementCsv(userId, accountId, queryDto);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${csvData.filename}"`);
    return res.send(csvData.csv);
  }

  @Get('accounts/:id/statement/export')
  @ApiOperation({ summary: 'Export downloadable CSV transaction statement (Legacy alias)' })
  async exportAccountStatement(
    @CurrentUser('id') userId: string,
    @Param('id') accountId: string,
    @Query() queryDto: QueryStatementDto,
  ) {
    return this.accountsService.exportStatementCsv(userId, accountId, queryDto);
  }

  // ----------------------------------------------------------------------------
  // ADMINISTRATIVE GOVERNANCE ENDPOINTS
  // ----------------------------------------------------------------------------

  @Put('admin/accounts/:id/status')
  @RequirePermissions('accounts.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Freeze, suspend, or activate a customer bank account' })
  async updateAccountStatus(
    @Param('id') accountId: string,
    @Body() dto: UpdateAccountStatusDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.accountsService.updateAccountStatus(accountId, dto, adminId);
  }

  @Put('admin/accounts/:id/limits')
  @RequirePermissions('accounts.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Update daily transfer and withdrawal limits' })
  async updateAccountLimits(
    @Param('id') accountId: string,
    @Body() dto: UpdateAccountLimitsDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.accountsService.updateAccountLimits(accountId, dto, adminId);
  }
}

