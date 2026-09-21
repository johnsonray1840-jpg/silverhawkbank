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
import { TransactionsService } from './transactions.service';
import { QueryTransactionsDto } from './dto/query-transactions.dto';
import { ReverseTransactionDto } from './dto/reverse-transaction.dto';
import { ManualAdjustmentDto } from './dto/manual-adjustment.dto';
import { RefundTransactionDto } from './dto/refund-transaction.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Transactions & Audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class TransactionsController {
  constructor(private transactionsService: TransactionsService) {}

  // ----------------------------------------------------------------------------
  // CUSTOMER TRANSACTION ENDPOINTS
  // ----------------------------------------------------------------------------

  @Get('transactions')
  @ApiOperation({ summary: 'Get paginated transaction history for authenticated customer' })
  @ApiResponse({ status: 200, description: 'Paginated customer transactions' })
  async getTransactions(
    @CurrentUser('id') userId: string,
    @Query() queryDto: QueryTransactionsDto,
  ) {
    return this.transactionsService.getTransactions(userId, queryDto);
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get details of a specific transaction including ledger journal entries' })
  async getTransactionDetails(
    @CurrentUser('id') userId: string,
    @Param('id') transactionId: string,
  ) {
    return this.transactionsService.getTransactionDetails(userId, transactionId);
  }

  @Get('transactions/:id/receipt')
  @ApiOperation({ summary: 'Generate digital Proof-of-Payment (POP) receipt with cryptographic hash' })
  async getTransactionReceipt(
    @CurrentUser('id') userId: string,
    @Param('id') transactionId: string,
  ) {
    return this.transactionsService.getTransactionReceipt(userId, transactionId);
  }

  // ----------------------------------------------------------------------------
  // ADMINISTRATIVE AUDIT & FINANCIAL DESK ENDPOINTS
  // ----------------------------------------------------------------------------

  @Get('admin/transactions')
  @RequirePermissions('transactions.read')
  @ApiOperation({ summary: 'Admin: Get global paginated transaction stream across all bank accounts' })
  async getAllTransactionsAdmin(@Query() queryDto: QueryTransactionsDto) {
    return this.transactionsService.getAllTransactionsAdmin(queryDto);
  }

  @Post('admin/transactions/:id/reverse')
  @RequirePermissions('transactions.reverse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Execute an immutable compensating reversal on a transaction' })
  async reverseTransaction(
    @Param('id') transactionId: string,
    @Body() dto: ReverseTransactionDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.transactionsService.reverseTransaction(transactionId, dto, adminId);
  }

  @Post('admin/transactions/adjust')
  @RequirePermissions('transactions.adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Execute a controlled manual credit or debit balance adjustment' })
  async manualAdjustment(
    @Body() dto: ManualAdjustmentDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.transactionsService.manualAdjustment(dto, adminId);
  }

  @Post('admin/transactions/:id/refund')
  @RequirePermissions('transactions.refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Execute an authorized full or partial transaction refund' })
  async refundTransaction(
    @Param('id') transactionId: string,
    @Body() dto: RefundTransactionDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.transactionsService.refundTransaction(transactionId, dto, adminId);
  }
}

