import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import {
  InitializeGatewayPaymentDto,
  VerifyGatewayPaymentDto,
} from './dto/payment.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Payment Gateways')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('providers')
  @ApiOperation({ summary: 'List supported payment providers and features' })
  @ApiResponse({ status: 200, description: 'List of payment gateways' })
  async getProviders() {
    return this.paymentsService.getProviders();
  }

  @Post('initialize')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initialize deposit checkout session via payment provider' })
  @ApiResponse({ status: 200, description: 'Payment session created with checkout URL' })
  async initializePayment(
    @CurrentUser('id') userId: string,
    @Body() dto: InitializeGatewayPaymentDto,
  ) {
    return this.paymentsService.initializePayment(userId, dto);
  }

  @Post('verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify payment reference status' })
  @ApiResponse({ status: 200, description: 'Verification result' })
  async verifyPayment(
    @CurrentUser('id') userId: string,
    @Body() dto: VerifyGatewayPaymentDto,
  ) {
    return this.paymentsService.verifyPayment(userId, dto);
  }

  /**
   * Universal public webhook endpoint for external providers (Stripe, Paystack, Flutterwave, Bank Transfer)
   */
  @Post('webhook/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Public webhook endpoint for payment providers' })
  @ApiResponse({ status: 200, description: 'Webhook received and processed idempotently' })
  async handleWebhook(
    @Param('provider') provider: string,
    @Body() body: any,
    @Headers('stripe-signature') stripeSignature?: string,
    @Headers('x-paystack-signature') paystackSignature?: string,
    @Headers('verif-hash') flwSignature?: string,
    @Headers('x-signature') genericSignature?: string,
    @Headers() allHeaders?: Record<string, string>,
  ) {
    const signature =
      stripeSignature ||
      paystackSignature ||
      flwSignature ||
      genericSignature ||
      allHeaders?.['x-webhook-signature'] ||
      '';

    return this.paymentsService.processWebhook(
      provider,
      body,
      signature,
      allHeaders || {},
    );
  }
}

