import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  LedgerAccountType,
  LedgerEntryType,
  TransactionStatus,
  TransactionType,
  WebhookStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { EmailService } from '../email/email.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import {
  InitializeGatewayPaymentDto,
  VerifyGatewayPaymentDto,
} from './dto/payment.dto';
import {
  PaymentProviderType,
  PaymentWebhookEventType,
} from './interfaces/payment-provider.interface';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentGatewayRegistry,
    private readonly ledgerService: LedgerService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * List supported payment gateway providers
   */
  async getProviders() {
    return {
      success: true,
      providers: this.registry.listProviders(),
    };
  }

  /**
   * Customer initializes payment / deposit through gateway
   */
  async initializePayment(userId: string, dto: InitializeGatewayPaymentDto) {
    const depositAmount = new Decimal(dto.amount);
    if (depositAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Deposit amount must be greater than zero');
    }

    const account = await this.prisma.bankAccount.findUnique({
      where: { id: dto.accountId },
      include: { user: { include: { profile: true } } },
    });

    if (!account || account.userId !== userId) {
      throw new NotFoundException('Destination bank account not found or access denied');
    }

    if (account.isFrozen) {
      throw new ForbiddenException('Destination bank account is frozen');
    }

    const providerAdapter = this.registry.getProvider(dto.provider);
    const reference = CryptoUtil.generateTransactionReference('GW');

    // 1. Initialize checkout with payment provider
    const initResult = await providerAdapter.initializePayment({
      amount: depositAmount,
      currency: dto.currency || account.currencyCode,
      customerEmail: account.user.email,
      customerName: account.user.profile
        ? `${account.user.profile.firstName} ${account.user.profile.lastName}`.trim()
        : account.user.username,
      reference,
      accountId: account.id,
      userId,
      callbackUrl: dto.callbackUrl,
      metadata: {
        accountId: account.id,
        accountNumber: account.accountNumber,
        currencyCode: account.currencyCode,
        description: dto.description,
      },
    });

    // 2. Persist initial transaction as PENDING
    await this.prisma.$transaction(async (tx) => {
      const businessTx = await tx.transaction.create({
        data: {
          reference,
          userId,
          destinationAccountId: account.id,
          type: TransactionType.DEPOSIT,
          amount: depositAmount.toFixed(4),
          fee: '0.0000',
          netAmount: depositAmount.toFixed(4),
          currencyCode: account.currencyCode,
          status: TransactionStatus.PENDING,
          description: dto.description || `Gateway deposit via ${dto.provider} into #${account.accountNumber}`,
          metadata: {
            provider: dto.provider,
            providerReference: initResult.providerReference,
            checkoutUrl: initResult.checkoutUrl,
            instructions: initResult.instructions,
          },
        },
      });

      await tx.deposit.create({
        data: {
          transactionId: businessTx.id,
          accountId: account.id,
          method: 'GATEWAY',
          paymentReference: initResult.providerReference || reference,
        },
      });
    });

    return {
      success: true,
      message: 'Payment session initialized successfully',
      ...initResult,
    };
  }

  /**
   * Verify a payment reference
   */
  async verifyPayment(userId: string, dto: VerifyGatewayPaymentDto) {
    const providerAdapter = this.registry.getProvider(dto.provider);
    const verification = await providerAdapter.verifyPayment(dto.reference);

    const transaction = await this.prisma.transaction.findUnique({
      where: { reference: dto.reference },
      include: { destinationAccount: true },
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction with reference '${dto.reference}' not found`);
    }

    if (transaction.userId !== userId) {
      throw new ForbiddenException('Access denied to transaction');
    }

    return {
      success: true,
      transactionStatus: transaction.status,
      verification,
    };
  }

  /**
   * Universal, idempotent, signature-verified webhook handler
   */
  async processWebhook(
    providerType: string,
    rawPayload: any,
    signatureHeader: string,
    headers: Record<string, string> = {},
  ) {
    const provider = this.registry.getProvider(providerType);

    // 1. Strict Server-Side Signature Verification
    const isValidSignature = provider.verifyWebhookSignature(rawPayload, signatureHeader, headers);
    if (!isValidSignature) {
      this.logger.warn(`Rejected invalid webhook signature for provider: ${providerType}`);
      throw new UnauthorizedException(`Invalid webhook signature for ${providerType}`);
    }

    // 2. Normalize Webhook Event
    const normalized = provider.normalizeWebhook(rawPayload, headers);
    const eventRef = `${provider.providerType}_${normalized.providerEventId}_${normalized.reference}`;

    this.logger.log(`Processing inbound webhook [${provider.providerType}] eventRef=${eventRef}, type=${normalized.eventType}`);

    // 3. Strict Idempotency Check in Database
    const existingWebhook = await this.prisma.webhookEvent.findUnique({
      where: { eventRef },
    });

    if (existingWebhook && existingWebhook.status === WebhookStatus.PENDING && existingWebhook.processedAt) {
      this.logger.log(`Idempotent webhook duplicate received: ${eventRef}. Returning success.`);
      return {
        received: true,
        idempotent: true,
        message: 'Webhook event already processed previously',
      };
    }

    // 4. Record WebhookEvent entry
    const webhookRecord = await this.prisma.webhookEvent.upsert({
      where: { eventRef },
      update: {
        attempts: { increment: 1 },
      },
      create: {
        eventRef,
        provider: provider.providerType,
        eventType: normalized.eventType,
        payload: rawPayload,
        signature: signatureHeader || null,
        status: WebhookStatus.PENDING,
      },
    });

    // 5. Handle Charge Success Event
    if (normalized.eventType === PaymentWebhookEventType.CHARGE_SUCCESS && normalized.status === 'SUCCESS') {
      await this.settleInboundPayment(normalized, webhookRecord.id);
    }

    return {
      received: true,
      idempotent: false,
      provider: provider.providerType,
      reference: normalized.reference,
      status: 'PROCESSED',
    };
  }

  /**
   * Atomically settles successful inbound payment with double-entry ledger postings
   */
  private async settleInboundPayment(event: any, webhookEventId: string) {
    // Locate transaction by reference
    const transaction = await this.prisma.transaction.findFirst({
      where: {
        OR: [
          { reference: event.reference },
          { deposit: { paymentReference: event.reference } },
          { metadata: { equals: { providerReference: event.reference } } },
        ],
      },
      include: {
        destinationAccount: { include: { user: { include: { profile: true } } } },
        user: { include: { profile: true } },
      },
    });

    if (!transaction) {
      this.logger.warn(`No pending transaction found for webhook reference: ${event.reference}`);
      return;
    }

    // If transaction is already successful, do not double credit
    if (transaction.status === TransactionStatus.SUCCESS) {
      this.logger.log(`Transaction ${transaction.reference} is already settled.`);
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date() },
      });
      return;
    }

    const account = transaction.destinationAccount;
    if (!account) {
      throw new NotFoundException(`Destination account missing on transaction ${transaction.id}`);
    }

    const creditAmount = new Decimal(transaction.amount);

    await this.prisma.$transaction(async (tx) => {
      // 1. Update Transaction status to SUCCESS
      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.SUCCESS,
          updatedAt: new Date(),
        },
      });

      // 2. Credit destination BankAccount balance
      const updatedAccount = await tx.bankAccount.update({
        where: { id: account.id },
        data: {
          currentBalance: { increment: creditAmount.toFixed(4) },
          availableBalance: { increment: creditAmount.toFixed(4) },
        },
      });

      // 3. Post General Ledger double-entry balancing records
      const clearingAccountCode = `1010-GATEWAY-${event.provider}`;
      const customerLiabilityCode = `2010-${account.accountNumber}`;

      const clearingAccount = await tx.ledgerAccount.upsert({
        where: { accountCode: clearingAccountCode },
        update: {},
        create: {
          accountCode: clearingAccountCode,
          name: `Payment Gateway Clearing Vault (${event.provider})`,
          type: LedgerAccountType.ASSET,
          currencyCode: account.currencyCode,
        },
      });

      const customerLedgerAccount = await tx.ledgerAccount.upsert({
        where: { accountCode: customerLiabilityCode },
        update: {},
        create: {
          accountCode: customerLiabilityCode,
          name: `Customer Deposit Liability #${account.accountNumber}`,
          type: LedgerAccountType.LIABILITY,
          currencyCode: account.currencyCode,
        },
      });

      const journal = await tx.journalTransaction.create({
        data: {
          transactionId: transaction.id,
          reference: `JRN-${transaction.reference}`,
          description: `Inbound gateway deposit settlement via ${event.provider}`,
        },
      });

      // Debit Clearing Asset Account (Inflow received from payment network)
      await tx.ledgerEntry.create({
        data: {
          journalTransactionId: journal.id,
          ledgerAccountId: clearingAccount.id,
          entryType: LedgerEntryType.DEBIT,
          amount: creditAmount.toFixed(4),
          currencyCode: account.currencyCode,
          exchangeRate: '1.000000',
        },
      });

      // Credit Customer Deposit Liability (Funds available to customer)
      await tx.ledgerEntry.create({
        data: {
          journalTransactionId: journal.id,
          ledgerAccountId: customerLedgerAccount.id,
          entryType: LedgerEntryType.CREDIT,
          amount: creditAmount.toFixed(4),
          currencyCode: account.currencyCode,
          exchangeRate: '1.000000',
        },
      });

      // 4. Mark WebhookEvent as processed
      await tx.webhookEvent.update({
        where: { id: webhookEventId },
        data: {
          processedAt: new Date(),
        },
      });

      // 5. In-App Notification
      await tx.notification.create({
        data: {
          userId: account.userId,
          title: 'Deposit Received',
          message: `Your deposit of ${account.currencyCode} ${creditAmount.toFixed(2)} via ${event.provider} has cleared and is now available in account #${account.accountNumber}.`,
          type: 'DEPOSIT',
        },
      });
    });

    this.logger.log(`Successfully settled gateway deposit ${transaction.reference} for ${account.currencyCode} ${creditAmount}`);
  }
}

