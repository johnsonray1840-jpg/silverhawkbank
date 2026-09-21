import Decimal from 'decimal.js';

export enum PaymentProviderType {
  STRIPE = 'STRIPE',
  PAYSTACK = 'PAYSTACK',
  FLUTTERWAVE = 'FLUTTERWAVE',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CUSTOM = 'CUSTOM',
}

export enum PaymentWebhookEventType {
  CHARGE_SUCCESS = 'CHARGE_SUCCESS',
  CHARGE_FAILED = 'CHARGE_FAILED',
  TRANSFER_SUCCESS = 'TRANSFER_SUCCESS',
  TRANSFER_FAILED = 'TRANSFER_FAILED',
  REFUND_SUCCESS = 'REFUND_SUCCESS',
  DISPUTE_CREATED = 'DISPUTE_CREATED',
  UNKNOWN = 'UNKNOWN',
}

export interface PaymentInitParams {
  amount: Decimal;
  currency: string;
  customerEmail: string;
  customerName?: string;
  reference: string;
  accountId: string;
  userId: string;
  callbackUrl?: string;
  metadata?: Record<string, any>;
}

export interface PaymentInitResult {
  provider: PaymentProviderType;
  reference: string;
  providerReference?: string;
  checkoutUrl?: string;
  authorizationUrl?: string;
  instructions?: Record<string, any>;
  amount: string;
  currency: string;
  status: 'PENDING' | 'REQUIRES_ACTION' | 'SUCCESS';
  metadata?: Record<string, any>;
}

export interface PaymentVerifyResult {
  provider: PaymentProviderType;
  reference: string;
  providerReference: string;
  amount: Decimal;
  currency: string;
  status: 'SUCCESS' | 'PENDING' | 'FAILED';
  paidAt?: Date;
  customerEmail?: string;
  gatewayFee?: Decimal;
  rawResponse?: any;
}

export interface NormalizedWebhookEvent {
  provider: PaymentProviderType;
  providerEventId: string;
  eventType: PaymentWebhookEventType;
  reference: string;
  amount: Decimal;
  currency: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  customerEmail?: string;
  metadata?: Record<string, any>;
  rawPayload: any;
}

export interface IPaymentProvider {
  readonly providerType: PaymentProviderType;
  readonly isEnabled: boolean;

  initializePayment(params: PaymentInitParams): Promise<PaymentInitResult>;
  verifyPayment(reference: string): Promise<PaymentVerifyResult>;
  verifyWebhookSignature(
    rawPayload: string | Buffer | Record<string, any>,
    signature: string,
    headers?: Record<string, string>,
  ): boolean;
  normalizeWebhook(payload: any, headers?: Record<string, string>): NormalizedWebhookEvent;
}

