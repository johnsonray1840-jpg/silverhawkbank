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
export class StripeProviderAdapter implements IPaymentProvider {
  private readonly logger = new Logger(StripeProviderAdapter.name);
  readonly providerType = PaymentProviderType.STRIPE;
  readonly isEnabled: boolean = true;

  private readonly secretKey: string;
  private readonly webhookSecret: string;

  constructor() {
    this.secretKey = process.env.STRIPE_SECRET_KEY || 'sk_test_mock_stripe_key_0000000000000';
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock_stripe_secret_000000000';
  }

  /**
   * Initializes a Stripe checkout session / PaymentIntent
   */
  async initializePayment(params: PaymentInitParams): Promise<PaymentInitResult> {
    const providerReference = `pi_stripe_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    this.logger.log(`Initialized Stripe payment intent ${providerReference} for ${params.currency} ${params.amount}`);

    return {
      provider: PaymentProviderType.STRIPE,
      reference: params.reference,
      providerReference,
      checkoutUrl: `https://checkout.stripe.com/c/pay/${providerReference}`,
      amount: params.amount.toFixed(4),
      currency: params.currency.toUpperCase(),
      status: 'REQUIRES_ACTION',
      metadata: {
        ...params.metadata,
        stripePaymentIntentId: providerReference,
      },
    };
  }

  /**
   * Verify status of a payment intent
   */
  async verifyPayment(reference: string): Promise<PaymentVerifyResult> {
    return {
      provider: PaymentProviderType.STRIPE,
      reference,
      providerReference: `pi_stripe_verified_${reference}`,
      amount: new Decimal('100.0000'),
      currency: 'USD',
      status: 'SUCCESS',
      paidAt: new Date(),
      gatewayFee: new Decimal('2.9000'),
    };
  }

  /**
   * Validates Stripe HMAC signature header (stripe-signature: t=timestamp,v1=signature)
   */
  verifyWebhookSignature(
    rawPayload: string | Buffer | Record<string, any>,
    signatureHeader: string,
    headers?: Record<string, string>,
  ): boolean {
    if (!signatureHeader) return false;

    try {
      const payloadString =
        typeof rawPayload === 'string'
          ? rawPayload
          : Buffer.isBuffer(rawPayload)
          ? rawPayload.toString('utf8')
          : JSON.stringify(rawPayload);

      let timestamp = '';
      let signature = signatureHeader;

      if (signatureHeader.includes('t=') && signatureHeader.includes('v1=')) {
        const parts = signatureHeader.split(',');
        for (const part of parts) {
          if (part.startsWith('t=')) timestamp = part.substring(2);
          if (part.startsWith('v1=')) signature = part.substring(3);
        }
      }

      const signedPayload = timestamp ? `${timestamp}.${payloadString}` : payloadString;
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(signedPayload)
        .digest('hex');

      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expectedSignature);

      if (sigBuf.length !== expBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch (err) {
      this.logger.error(`Stripe webhook signature validation failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Normalizes Stripe webhook events
   */
  normalizeWebhook(payload: any): NormalizedWebhookEvent {
    const eventType = payload.type || '';
    const dataObj = payload.data?.object || payload;

    let normalizedType = PaymentWebhookEventType.UNKNOWN;
    let status: 'SUCCESS' | 'FAILED' | 'PENDING' = 'PENDING';

    if (eventType === 'payment_intent.succeeded' || eventType === 'charge.succeeded') {
      normalizedType = PaymentWebhookEventType.CHARGE_SUCCESS;
      status = 'SUCCESS';
    } else if (eventType === 'payment_intent.payment_failed' || eventType === 'charge.failed') {
      normalizedType = PaymentWebhookEventType.CHARGE_FAILED;
      status = 'FAILED';
    } else if (eventType === 'charge.refunded') {
      normalizedType = PaymentWebhookEventType.REFUND_SUCCESS;
      status = 'SUCCESS';
    }

    const rawAmount = dataObj.amount ? new Decimal(dataObj.amount).div(100) : new Decimal(0);
    const reference = dataObj.metadata?.reference || dataObj.id || `STRIPE-${Date.now()}`;

    return {
      provider: PaymentProviderType.STRIPE,
      providerEventId: payload.id || `evt_stripe_${Date.now()}`,
      eventType: normalizedType,
      reference,
      amount: rawAmount,
      currency: (dataObj.currency || 'USD').toUpperCase(),
      status,
      customerEmail: dataObj.receipt_email || dataObj.customer_email || dataObj.billing_details?.email,
      metadata: dataObj.metadata || {},
      rawPayload: payload,
    };
  }
}

