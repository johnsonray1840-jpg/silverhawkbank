import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { StripeProviderAdapter } from './adapters/stripe.adapter';
import { PaystackProviderAdapter } from './adapters/paystack.adapter';
import { FlutterwaveProviderAdapter } from './adapters/flutterwave.adapter';
import { BankTransferProviderAdapter } from './adapters/bank-transfer.adapter';
import { PrismaModule } from '../../database/prisma.module';
import { LedgerModule } from '../ledger/ledger.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [PrismaModule, LedgerModule, EmailModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentGatewayRegistry,
    StripeProviderAdapter,
    PaystackProviderAdapter,
    FlutterwaveProviderAdapter,
    BankTransferProviderAdapter,
  ],
  exports: [PaymentsService, PaymentGatewayRegistry],
})
export class PaymentsModule {}

