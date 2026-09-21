import { Injectable, NotFoundException } from '@nestjs/common';
import {
  IPaymentProvider,
  PaymentProviderType,
} from './interfaces/payment-provider.interface';
import { StripeProviderAdapter } from './adapters/stripe.adapter';
import { PaystackProviderAdapter } from './adapters/paystack.adapter';
import { FlutterwaveProviderAdapter } from './adapters/flutterwave.adapter';
import { BankTransferProviderAdapter } from './adapters/bank-transfer.adapter';

@Injectable()
export class PaymentGatewayRegistry {
  private readonly providers: Map<PaymentProviderType, IPaymentProvider> = new Map();

  constructor(
    private readonly stripeAdapter: StripeProviderAdapter,
    private readonly paystackAdapter: PaystackProviderAdapter,
    private readonly flutterwaveAdapter: FlutterwaveProviderAdapter,
    private readonly bankTransferAdapter: BankTransferProviderAdapter,
  ) {
    this.registerProvider(this.stripeAdapter);
    this.registerProvider(this.paystackAdapter);
    this.registerProvider(this.flutterwaveAdapter);
    this.registerProvider(this.bankTransferAdapter);
  }

  /**
   * Register a payment provider adapter
   */
  public registerProvider(provider: IPaymentProvider): void {
    this.providers.set(provider.providerType, provider);
  }

  /**
   * Retrieve adapter by provider enum or string identifier
   */
  public getProvider(type: PaymentProviderType | string): IPaymentProvider {
    const normalized = (type || '').toString().toUpperCase() as PaymentProviderType;
    const provider = this.providers.get(normalized);

    if (!provider) {
      throw new NotFoundException(`Payment gateway provider '${type}' is not supported or active`);
    }

    return provider;
  }

  /**
   * List all registered and active providers
   */
  public listProviders(): Array<{
    type: PaymentProviderType;
    name: string;
    isEnabled: boolean;
    supportedCurrencies: string[];
    features: string[];
  }> {
    return [
      {
        type: PaymentProviderType.STRIPE,
        name: 'Stripe Global Payments',
        isEnabled: this.stripeAdapter.isEnabled,
        supportedCurrencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY'],
        features: ['Cards', 'Apple Pay', 'Google Pay', 'SEPA', 'iDEAL'],
      },
      {
        type: PaymentProviderType.PAYSTACK,
        name: 'Paystack Africa & UK',
        isEnabled: this.paystackAdapter.isEnabled,
        supportedCurrencies: ['NGN', 'GHS', 'ZAR', 'USD', 'KES'],
        features: ['Cards', 'Bank Transfer', 'USSD', 'Mobile Money'],
      },
      {
        type: PaymentProviderType.FLUTTERWAVE,
        name: 'Flutterwave Global Network',
        isEnabled: this.flutterwaveAdapter.isEnabled,
        supportedCurrencies: ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'ZAR', 'RWF'],
        features: ['Cards', 'Mobile Money', 'Bank Wire', 'Barter', 'PayPal'],
      },
      {
        type: PaymentProviderType.BANK_TRANSFER,
        name: 'Direct Federal Wire & ACH Clearing',
        isEnabled: this.bankTransferAdapter.isEnabled,
        supportedCurrencies: ['USD', 'EUR', 'GBP'],
        features: ['Fedwire', 'CHIPS', 'ACH', 'SWIFT BIC', 'SEPA Instant'],
      },
    ];
  }
}

