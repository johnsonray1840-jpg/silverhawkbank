import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LedgerService } from './ledger.service';
import { CreateLedgerAccountDto } from './dto/create-ledger-account.dto';
import { QueryLedgerDto } from './dto/query-ledger.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Double-Entry General Ledger')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/ledger')
export class LedgerController {
  constructor(private ledgerService: LedgerService) {}

  @Get('chart-of-accounts')
  @RequirePermissions('ledger.read')
  @ApiOperation({ summary: 'Admin: Get complete Chart of Accounts' })
  async getChartOfAccounts() {
    return this.ledgerService.getChartOfAccounts();
  }

  @Post('accounts')
  @RequirePermissions('settings.update')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Admin: Create new General Ledger Account in Chart of Accounts' })
  async createLedgerAccount(@Body() dto: CreateLedgerAccountDto) {
    return this.ledgerService.createLedgerAccount(dto);
  }

  @Get('journal')
  @RequirePermissions('ledger.read')
  @ApiOperation({ summary: 'Admin: Get paginated Journal Transactions and line entries' })
  async getJournalTransactions(@Query() queryDto: QueryLedgerDto) {
    return this.ledgerService.getJournalTransactions(queryDto);
  }

  @Get('trial-balance')
  @RequirePermissions('ledger.read')
  @ApiOperation({ summary: 'Admin: Generate live balanced Trial Balance' })
  @ApiResponse({ status: 200, description: 'Live trial balance with debits and credits reconciliation' })
  async getTrialBalance() {
    return this.ledgerService.getTrialBalance();
  }

  @Get('balance-sheet')
  @RequirePermissions('ledger.read')
  @ApiOperation({ summary: 'Admin: Generate live Balance Sheet (Assets = Liabilities + Equity)' })
  async getBalanceSheet() {
    return this.ledgerService.getBalanceSheet();
  }

  @Get('reconcile/:bankAccountId')
  @RequirePermissions('ledger.read')
  @ApiOperation({ summary: 'Admin: Reconcile Bank Account snapshot balance with General Ledger entries' })
  async reconcileBankAccount(@Param('bankAccountId') bankAccountId: string) {
    return this.ledgerService.reconcileBankAccount(bankAccountId);
  }
}

