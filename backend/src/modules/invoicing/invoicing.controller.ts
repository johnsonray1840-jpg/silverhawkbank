import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InvoicingService } from './invoicing.service';
import {
  CreateInvoiceDto,
  RecordInvoicePaymentDto,
  ApplyInvoiceFactoringDto,
} from './dto/invoicing.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { InvoiceStatus } from '../../common/utils/invoicing-reconciliation.util';

@ApiTags('Automated B2B Invoicing, AR Reconciliation & Factoring')
@ApiBearerAuth()
@Controller('invoicing')
export class InvoicingController {
  constructor(private readonly invoicingService: InvoicingService) {}

  @Post('invoices')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new B2B commercial invoice with line items and early payment terms' })
  @ApiResponse({ status: 201, description: 'Invoice drafted successfully' })
  async createInvoice(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoicingService.createInvoice(userId, dto);
  }

  @Post('invoices/:id/issue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a draft invoice to active receivable status' })
  @ApiResponse({ status: 200, description: 'Invoice issued successfully' })
  async issueInvoice(
    @CurrentUser('id') userId: string,
    @Param('id') invoiceId: string,
  ) {
    return this.invoicingService.issueInvoice(userId, invoiceId);
  }

  @Post('payments/record')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record and smart-reconcile an incoming payment against open receivables' })
  @ApiResponse({ status: 200, description: 'Payment reconciled and settled to ledger' })
  async recordPayment(
    @CurrentUser('id') userId: string,
    @Body() dto: RecordInvoicePaymentDto,
  ) {
    return this.invoicingService.recordPayment(userId, dto);
  }

  @Post('factoring/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply for instant Invoice Factoring financing (85% advance liquidity)' })
  @ApiResponse({ status: 200, description: 'Invoice factoring approved and funds disbursed' })
  async applyFactoring(
    @CurrentUser('id') userId: string,
    @Body() dto: ApplyInvoiceFactoringDto,
  ) {
    return this.invoicingService.applyFactoring(userId, dto);
  }

  @Get('invoices')
  @ApiOperation({ summary: 'List all commercial invoices with optional status filtering' })
  @ApiQuery({ name: 'status', enum: InvoiceStatus, required: false })
  @ApiResponse({ status: 200, description: 'List of invoices' })
  async listInvoices(
    @CurrentUser('id') userId: string,
    @Query('status') status?: InvoiceStatus,
  ) {
    return this.invoicingService.listInvoices(userId, status);
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: 'Get detailed invoice information with payment and factoring history' })
  @ApiResponse({ status: 200, description: 'Invoice details' })
  async getInvoice(
    @CurrentUser('id') userId: string,
    @Param('id') invoiceId: string,
  ) {
    return this.invoicingService.getInvoice(userId, invoiceId);
  }
}

