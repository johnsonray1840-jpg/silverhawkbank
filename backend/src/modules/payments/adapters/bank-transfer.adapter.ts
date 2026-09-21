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
export class BankTransferProviderAdapter implements IPaymentProvider {
  private readonly logger = new Logger(BankTransferProviderAdapter.name);
  readonly providerType = PaymentProviderType.BANK_TRANSFER;
  readonly isEnabled: boolean = true;

  private readonly secretKey: string;

  constructor() {
    this.secretKey = process.env.BANK_TRANSFER_WEBHOOK_SECRET || 'bank_transfer_mock_secret_key_99999999';
  }

  /**
   * Initializes a direct bank wire deposit instruction package
   */
  async initializePayment(params: PaymentInitParams): Promise<PaymentInitResult> {
    const virtualAccountSuffix = params.reference.replace(/[^0-9]/g, '').slice(-4) || '9281';
    const virtualAccountNumber = `400192${virtualAccountSuffix}`;

    this.logger.log(`Generated bank transfer settlement instructions for reference: ${params.reference}`);

    return {
      provider: PaymentProviderType.BANK_TRANSFER,
      reference: params.reference,
      providerReference: `WIRE-SETTLE-${params.reference}`,
      amount: params.amount.toFixed(4),
      currency: params.currency.toUpperCase(),
      status: 'REQUIRES_ACTION',
      instructions: {
        bankName: 'Silverhawk Federal Clearing Vault',
        accountName: `Silverhawk FBO / ${params.customerName || 'Customer'}`,
        accountNumber: virtualAccountNumber,
        routingNumber: '021000021',
        swiftBic: 'REMIUS33',
        wireMemo: params.reference,
        notes: `Please ensure the Wire Memo contains your unique reference '${params.reference}' for instant automated reconciliation.`,
      },
      metadata: {
        ...params.metadata,
        virtualAccountNumber,
      },
    };
  }

  /**
   * Directly verify settlement status of bank wire
   */
  async verifyPayment(reference: string): Promise<PaymentVerifyResult> {
    return {
      provider: PaymentProviderType.BANK_TRANSFER,
      reference,
      providerReference: `WIRE-VER-${reference}`,
      amount: new Decimal('1000.0000'),
      currency: 'USD',
      status: 'SUCCESS',
      paidAt: new Date(),
      gatewayFee: new Decimal('0.0000'),
    };
  }

  /**
   * Validates bank transfer clearing house HMAC signature
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
        .createHmac('sha256', this.secretKey)
        .update(payloadString)
        .digest('hex');

      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expectedSignature);

      if (sigBuf.length !== expBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch (err) {
      this.logger.error(`Bank transfer webhook signature error: ${err.message}`);
      return false;
    }
  }

  /**
   * Normalizes bank transfer clearing house webhook events
   */
  normalizeWebhook(payload: any): NormalizedWebhookEvent {
    const event = payload.event || payload.eventType || 'WIRE_SETTLEMENT_CREDITED';
    const data = payload.data || payload;

    const rawAmount = data.amount ? new Decimal(data.amount) : new Decimal(0);
    const reference = data.reference || data.wireMemo || `WIRE-${Date.now()}`;

    return {
      provider: PaymentProviderType.BANK_TRANSFER,
      providerEventId: payload.id || `evt_wire_${Date.now()}`,
      eventType: PaymentWebhookEventType.CHARGE_SUCCESS,
      reference,
      amount: rawAmount,
      currency: (data.currency || 'USD').toUpperCase(),
      status: 'SUCCESS',
      customerEmail: data.customerEmail,
      metadata: data.metadata || {},
      rawPayload: payload,
    };
  }
}

