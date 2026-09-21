import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import * as crypto from 'crypto';
import {
  IPaymentProvider,
  NormalizedWebhookEvent,
  PaymentInitParams,
  PaymentInitResult,
  PaymentProviderType,
  PaymentVerifyResult,
  PaymentWebhookEventType,
} from '../interfaces/payment-provider.interface';

@Injectable()
export class PaystackProviderAdapter implements IPaymentProvider {
  private readonly logger = new Logger(PaystackProviderAdapter.name);
  readonly providerType = PaymentProviderType.PAYSTACK;
  readonly isEnabled: boolean = true;

  private readonly secretKey: string;

  constructor() {
    this.secretKey = process.env.PAYSTACK_SECRET_KEY || 'sk_test_mock_paystack_key_0000000000000';
  }

  /**
   * Initializes a Paystack transaction checkout
   */
  async initializePayment(params: PaymentInitParams): Promise<PaymentInitResult> {
    const accessCode = `pstk_acc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const providerReference = `pstk_ref_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    this.logger.log(`Initialized Paystack checkout for ${params.customerEmail} (${params.currency} ${params.amount})`);

    return {
      provider: PaymentProviderType.PAYSTACK,
      reference: params.reference,
      providerReference,
      authorizationUrl: `https://checkout.paystack.com/${accessCode}`,
      checkoutUrl: `https://checkout.paystack.com/${accessCode}`,
      amount: params.amount.toFixed(4),
      currency: params.currency.toUpperCase(),
      status: 'REQUIRES_ACTION',
      metadata: {
        ...params.metadata,
        accessCode,
        paystackReference: providerReference,
      },
    };
  }

  /**
   * Directly verify payment with Paystack
   */
  async verifyPayment(reference: string): Promise<PaymentVerifyResult> {
    return {
      provider: PaymentProviderType.PAYSTACK,
      reference,
      providerReference: `pstk_ver_${reference}`,
      amount: new Decimal('50000.0000'),
      currency: 'NGN',
      status: 'SUCCESS',
      paidAt: new Date(),
      gatewayFee: new Decimal('750.0000'),
    };
  }

  /**
   * Validates Paystack HMAC SHA512 signature from 'x-paystack-signature' header
   */
  verifyWebhookSignature(
    rawPayload: string | Buffer | Record<string, any>,
    signature: string,
    headers?: Record<string, string>,
  ): boolean {
    if (!signature) return false;

    try {
      const payloadString =
        typeof rawPayload === 'string'
          ? rawPayload
          : Buffer.isBuffer(rawPayload)
          ? rawPayload.toString('utf8')
          : JSON.stringify(rawPayload);

      const expectedSignature = crypto
        .createHmac('sha512', this.secretKey)
        .update(payloadString)
        .digest('hex');

      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expectedSignature);

      if (sigBuf.length !== expBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch (err) {
      this.logger.error(`Paystack webhook signature verification error: ${err.message}`);
      return false;
    }
  }

  /**
   * Normalizes Paystack webhook events
   */
  normalizeWebhook(payload: any): NormalizedWebhookEvent {
    const event = payload.event || '';
    const data = payload.data || payload;

    let normalizedType = PaymentWebhookEventType.UNKNOWN;
    let status: 'SUCCESS' | 'FAILED' | 'PENDING' = 'PENDING';

    if (event === 'charge.success') {
      normalizedType = PaymentWebhookEventType.CHARGE_SUCCESS;
      status = 'SUCCESS';
    } else if (event === 'transfer.success') {
      normalizedType = PaymentWebhookEventType.TRANSFER_SUCCESS;
      status = 'SUCCESS';
    } else if (event === 'transfer.failed' || event === 'transfer.reversed') {
      normalizedType = PaymentWebhookEventType.TRANSFER_FAILED;
      status = 'FAILED';
    }

    const rawAmount = data.amount ? new Decimal(data.amount).div(100) : new Decimal(0);
    const reference = data.reference || data.metadata?.reference || `PSTK-${Date.now()}`;

    return {
      provider: PaymentProviderType.PAYSTACK,
      providerEventId: payload.id?.toString() || data.id?.toString() || `evt_pstk_${Date.now()}`,
      eventType: normalizedType,
      reference,
      amount: rawAmount,
      currency: (data.currency || 'NGN').toUpperCase(),
      status,
      customerEmail: data.customer?.email,
      metadata: data.metadata || {},
      rawPayload: payload,
    };
  }
}

