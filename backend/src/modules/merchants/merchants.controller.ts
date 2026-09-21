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
import { MerchantsService } from './merchants.service';
import {
  CreateInvoiceDto,
  GenerateMerchantQrDto,
  PayMerchantQrDto,
  ResolveMerchantQrDto,
  CreatePaymentLinkDto,
  PayPaymentLinkDto,
  PosChargeDto,
  MerchantAnalyticsQueryDto,
} from './dto/merchants.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Merchant POS & QR Payments')
@Controller('merchants')
export class MerchantsController {
  constructor(private readonly merchantsService: MerchantsService) {}

  @Post('qr/generate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate EMVCo compliant dynamic/static QR code for merchant account' })
  async generateQr(
    @CurrentUser('id') userId: string,
    @Body() dto: GenerateMerchantQrDto,
  ) {
    return this.merchantsService.generateMerchantQr(userId, dto);
  }

  @Post('qr/resolve')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Parse and validate an EMVCo QR code string before checkout' })
  async resolveQr(@Body() dto: ResolveMerchantQrDto) {
    return this.merchantsService.resolveQr(dto);
  }

  @Post('qr/pay')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Instant scan-to-pay settlement for EMVCo merchant QR' })
  @ApiResponse({ status: 200, description: 'Merchant payment completed and ledger posted' })
  async payQr(
    @CurrentUser('id') userId: string,
    @Body() dto: PayMerchantQrDto,
  ) {
    return this.merchantsService.payMerchantQr(userId, dto);
  }

  @Post('invoices')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create dynamic digital invoice with attached QR payment payload' })
  async createInvoice(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.merchantsService.createInvoice(userId, dto);
  }

  @Post('payment-links')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a hosted shareable multi-currency payment link' })
  async createPaymentLink(
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePaymentLinkDto,
  ) {
    return this.merchantsService.createPaymentLink(userId, dto);
  }

  @Get('payment-links')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all payment links created by merchant' })
  async getPaymentLinks(@CurrentUser('id') userId: string) {
    return this.merchantsService.getMerchantPaymentLinks(userId);
  }

  @Get('payment-links/:id')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Public resolution of hosted payment link details for checkout' })
  async getPublicPaymentLink(@Param('id') linkId: string) {
    return this.merchantsService.getPublicPaymentLink(linkId);
  }

  @Post('payment-links/:id/pay')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute payment settlement for hosted payment link' })
  async payPaymentLink(
    @Param('id') linkId: string,
    @Body() dto: PayPaymentLinkDto,
    @CurrentUser('id') userId?: string,
  ) {
    return this.merchantsService.payPaymentLink(linkId, dto, userId);
  }

  @Post('pos/charge')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Process instant Virtual POS Terminal transaction with tip/tax' })
  async processPosCharge(
    @CurrentUser('id') userId: string,
    @Body() dto: PosChargeDto,
  ) {
    return this.merchantsService.processPosCharge(userId, dto);
  }

  @Get('analytics')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get merchant gross sales, MDR interchange fees & settlement metrics' })
  async getMerchantAnalytics(
    @CurrentUser('id') userId: string,
    @Query() query?: MerchantAnalyticsQueryDto,
  ) {
    return this.merchantsService.getMerchantAnalytics(userId, query);
  }
}


