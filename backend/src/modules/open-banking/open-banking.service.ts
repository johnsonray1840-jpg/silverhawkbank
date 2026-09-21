import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import {
  AuthorizeConsentDto,
  ConsentStatus,
  CreateConsentDto,
  CreatePaymentSetupDto,
  ExecutePaymentDto,
  OpenBankingPermission,
} from './dto/open-banking.dto';
import { LedgerEntryType, TransactionStatus, TransactionType } from '@prisma/client';
import Decimal from 'decimal.js';
import * as crypto from 'crypto';

export interface OpenBankingConsentRecord {
  id: string;
  tppClientId: string;
  tppName: string;
  permissions: OpenBankingPermission[];
  status: ConsentStatus;
  userId?: string;
  allowedAccountIds: string[];
  consentToken: string;
  expiresAt: Date;
  authorizedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenBankingPaymentSetupRecord {
  id: string;
  consentId: string;
  instructedAmount: string;
  currency: string;
  creditorAccountNumber: string;
  creditorName: string;
  remittanceInformation?: string;
  status: 'PENDING_EXECUTION' | 'COMPLETED' | 'CANCELLED';
  createdAt: Date;
}

@Injectable()
export class OpenBankingService {
  private readonly logger = new Logger(OpenBankingService.name);
  private static consentsStore: Map<string, OpenBankingConsentRecord> = new Map();
  private static tokensMap: Map<string, string> = new Map(); // token -> consentId
  private static paymentsStore: Map<string, OpenBankingPaymentSetupRecord> = new Map();

  constructor(
    private prisma: PrismaService,
    private ledgerService: LedgerService,
  ) {}

  /**
   * Step 1: TPP creates consent request
   */
  async createConsent(dto: CreateConsentDto) {
    const consentId = `urn:silverhawk:consent:${crypto.randomBytes(8).toString('hex')}`;
    const rawToken = `ob_tok_${crypto.randomBytes(24).toString('hex')}`;
    const expirationDays = dto.expirationDays || 90;
    const expiresAt = new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000);

    const consent: OpenBankingConsentRecord = {
      id: consentId,
      tppClientId: dto.tppClientId,
      tppName: dto.tppName,
      permissions: dto.permissions,
      status: ConsentStatus.AWAITING_AUTHORIZATION,
      allowedAccountIds: [],
      consentToken: rawToken,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    OpenBankingService.consentsStore.set(consentId, consent);
    OpenBankingService.tokensMap.set(rawToken, consentId);

    this.logger.log(`Open Banking consent ${consentId} requested by TPP ${dto.tppName} (${dto.tppClientId})`);

    return {
      Data: {
        ConsentId: consent.id,
        Status: consent.status,
        CreationDateTime: consent.createdAt.toISOString(),
        StatusUpdateDateTime: consent.updatedAt.toISOString(),
        Permissions: consent.permissions,
        ExpirationDateTime: consent.expiresAt.toISOString(),
      },
      Links: {
        Self: `/open-banking/v3.1/consents/${consent.id}`,
        AuthorizationUrl: `https://silverhawkbank.com/open-banking/authorize?consentId=${consent.id}`,
      },
      Meta: {
        TotalPages: 1,
      },
    };
  }

  /**
   * Step 2: Customer authorizes consent
   */
  async authorizeConsent(userId: string, consentId: string, dto: AuthorizeConsentDto) {
    const consent = OpenBankingService.consentsStore.get(consentId);
    if (!consent) {
      throw new NotFoundException(`Consent ${consentId} not found`);
    }

    if (consent.status !== ConsentStatus.AWAITING_AUTHORIZATION) {
      throw new BadRequestException(`Consent is already in state: ${consent.status}`);
    }

    // Verify Customer & PIN
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.pinHash) throw new BadRequestException('Transaction PIN is not configured');

    const isPinValid = await CryptoUtil.verify(user.pinHash, dto.pin);
    if (!isPinValid) throw new BadRequestException('Invalid transaction authorization PIN');

    // Verify ownership of all allowed accounts
    const userAccounts = await this.prisma.bankAccount.findMany({
      where: { userId, id: { in: dto.allowedAccountIds } },
    });

    if (userAccounts.length !== dto.allowedAccountIds.length) {
      throw new ForbiddenException('One or more selected accounts do not belong to you');
    }

    consent.userId = userId;
    consent.allowedAccountIds = dto.allowedAccountIds;
    consent.status = ConsentStatus.AUTHORIZED;
    consent.authorizedAt = new Date();
    consent.updatedAt = new Date();

    OpenBankingService.consentsStore.set(consentId, consent);
    this.logger.log(`Consent ${consentId} AUTHORIZED by customer ${userId} for TPP ${consent.tppName}`);

    return {
      Data: {
        ConsentId: consent.id,
        Status: consent.status,
        ConsentAccessToken: consent.consentToken,
        StatusUpdateDateTime: consent.updatedAt.toISOString(),
        Permissions: consent.permissions,
        AllowedAccountsCount: consent.allowedAccountIds.length,
      },
      Meta: {
        Message: 'Consent authorized successfully. TPP can now access AIS/PIS APIs.',
      },
    };
  }

  /**
   * Helper: Validate consent token and check permission
   */
  private validateConsentAccess(tokenHeader: string, requiredPermission: OpenBankingPermission): OpenBankingConsentRecord {
    const rawToken = tokenHeader.startsWith('Bearer ') ? tokenHeader.substring(7) : tokenHeader;
    const consentId = OpenBankingService.tokensMap.get(rawToken);

    if (!consentId) {
      throw new UnauthorizedException('Invalid or unknown Open Banking consent token');
    }

    const consent = OpenBankingService.consentsStore.get(consentId);
    if (!consent) {
      throw new UnauthorizedException('Consent not found');
    }

    if (consent.status !== ConsentStatus.AUTHORIZED) {
      throw new ForbiddenException(`Consent is not in AUTHORIZED state (Current: ${consent.status})`);
    }

    if (new Date() > consent.expiresAt) {
      consent.status = ConsentStatus.EXPIRED;
      throw new ForbiddenException('Consent has expired. Please prompt customer for re-authorization.');
    }

    if (!consent.permissions.includes(requiredPermission)) {
      throw new ForbiddenException(`Consent lacks required permission scope: ${requiredPermission}`);
    }

    return consent;
  }

  /**
   * AIS: List authorized accounts
   */
  async getAisAccounts(tokenHeader: string) {
    const consent = this.validateConsentAccess(tokenHeader, OpenBankingPermission.READ_ACCOUNTS_BASIC);

    const accounts = await this.prisma.bankAccount.findMany({
      where: { id: { in: consent.allowedAccountIds } },
      include: { user: { include: { profile: true } } },
    });

    return {
      Data: {
        Account: accounts.map((acc) => ({
          AccountId: acc.id,
          Currency: acc.currencyCode,
          AccountType: acc.type,
          AccountSubType: 'CurrentAccount',
          Nickname: acc.accountName,
          Account: [
            {
              SchemeName: 'UK.OBIE.SortCodeAccountNumber',
              Identification: acc.accountNumber,
              Name: acc.accountName,
            },
          ],
        })),
      },
      Links: { Self: '/open-banking/v3.1/ais/accounts' },
      Meta: { TotalPages: 1 },
    };
  }

  /**
   * AIS: Get Balances
   */
  async getAisBalances(tokenHeader: string, accountId: string) {
    const consent = this.validateConsentAccess(tokenHeader, OpenBankingPermission.READ_BALANCES);

    if (!consent.allowedAccountIds.includes(accountId)) {
      throw new ForbiddenException('This account is not included in the granted consent');
    }

    const account = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
    });

    if (!account) throw new NotFoundException('Account not found');

    return {
      Data: {
        Balance: [
          {
            AccountId: account.id,
            Amount: {
              Amount: account.availableBalance.toString(),
              Currency: account.currencyCode,
            },
            CreditDebitIndicator: 'Credit',
            Type: 'InterimAvailable',
            DateTime: new Date().toISOString(),
          },
          {
            AccountId: account.id,
            Amount: {
              Amount: account.currentBalance.toString(),
              Currency: account.currencyCode,
            },
            CreditDebitIndicator: 'Credit',
            Type: 'InterimBooked',
            DateTime: new Date().toISOString(),
          },
        ],
      },
      Links: { Self: `/open-banking/v3.1/ais/accounts/${accountId}/balances` },
      Meta: { TotalPages: 1 },
    };
  }

  /**
   * AIS: Get Transactions
   */
  async getAisTransactions(tokenHeader: string, accountId: string) {
    const consent = this.validateConsentAccess(tokenHeader, OpenBankingPermission.READ_TRANSACTIONS_DETAIL);

    if (!consent.allowedAccountIds.includes(accountId)) {
      throw new ForbiddenException('This account is not included in the granted consent');
    }

    const transactions = await this.prisma.transaction.findMany({
      where: {
        OR: [{ sourceAccountId: accountId }, { destinationAccountId: accountId }],
        status: TransactionStatus.SUCCESS,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return {
      Data: {
        Transaction: transactions.map((t) => ({
          AccountId: accountId,
          TransactionId: t.id,
          TransactionReference: t.reference,
          Amount: {
            Amount: t.amount.toString(),
            Currency: t.currencyCode,
          },
          CreditDebitIndicator: t.sourceAccountId === accountId ? 'Debit' : 'Credit',
          Status: 'Booked',
          BookingDateTime: t.createdAt.toISOString(),
          TransactionInformation: t.description,
        })),
      },
      Links: { Self: `/open-banking/v3.1/ais/accounts/${accountId}/transactions` },
      Meta: { TotalPages: 1 },
    };
  }

  /**
   * PIS: Create Payment Setup
   */
  async createPaymentSetup(tokenHeader: string, dto: CreatePaymentSetupDto) {
    const consent = this.validateConsentAccess(tokenHeader, OpenBankingPermission.INITIATE_PAYMENT_SINGLE);

    const setupId = `urn:silverhawk:payment:${crypto.randomBytes(8).toString('hex')}`;
    const paymentSetup: OpenBankingPaymentSetupRecord = {
      id: setupId,
      consentId: consent.id,
      instructedAmount: new Decimal(dto.instructedAmount).toFixed(4),
      currency: dto.currency,
      creditorAccountNumber: dto.creditorAccountNumber,
      creditorName: dto.creditorName,
      remittanceInformation: dto.remittanceInformation || 'Open Banking Single Immediate Payment',
      status: 'PENDING_EXECUTION',
      createdAt: new Date(),
    };

    OpenBankingService.paymentsStore.set(setupId, paymentSetup);
    this.logger.log(`Open Banking payment setup ${setupId} created for ${paymentSetup.instructedAmount} ${paymentSetup.currency}`);

    return {
      Data: {
        PaymentId: setupId,
        ConsentId: consent.id,
        Status: 'AwaitingAuthorisation',
        CreationDateTime: paymentSetup.createdAt.toISOString(),
        Initiation: {
          InstructedAmount: {
            Amount: paymentSetup.instructedAmount,
            Currency: paymentSetup.currency,
          },
          CreditorAccount: {
            Identification: paymentSetup.creditorAccountNumber,
            Name: paymentSetup.creditorName,
          },
          RemittanceInformation: paymentSetup.remittanceInformation,
        },
      },
      Links: {
        Self: `/open-banking/v3.1/pis/payment-setups/${setupId}`,
      },
    };
  }

  /**
   * PIS: Execute Authorized Payment
   */
  async executePayment(userId: string, dto: ExecutePaymentDto) {
    const setup = OpenBankingService.paymentsStore.get(dto.paymentSetupId);
    if (!setup) {
      throw new NotFoundException(`Payment setup ${dto.paymentSetupId} not found`);
    }

    if (setup.status !== 'PENDING_EXECUTION') {
      throw new BadRequestException(`Payment is already processed (Status: ${setup.status})`);
    }

    // Verify User & PIN
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.pinHash) throw new BadRequestException('Transaction PIN is not configured');

    const isPinValid = await CryptoUtil.verify(user.pinHash, dto.pin);
    if (!isPinValid) throw new BadRequestException('Invalid transaction authorization PIN');

    // Load Debtor Account
    const debtorAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.debtorAccountId },
    });
    if (!debtorAccount || debtorAccount.userId !== userId) {
      throw new ForbiddenException('Invalid or unowned debtor bank account');
    }

    const paymentAmount = new Decimal(setup.instructedAmount);
    if (new Decimal(debtorAccount.availableBalance.toString()).lessThan(paymentAmount)) {
      throw new BadRequestException('Insufficient funds in debtor account to execute Open Banking payment');
    }

    // Find Creditor Account
    const creditorAccount = await this.prisma.bankAccount.findUnique({
      where: { accountNumber: setup.creditorAccountNumber },
    });

    const txRef = CryptoUtil.generateTransactionReference('OB-PIS');

    // Execute atomic transfer
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.bankAccount.update({
        where: { id: debtorAccount.id },
        data: {
          currentBalance: { decrement: paymentAmount.toString() },
          availableBalance: { decrement: paymentAmount.toString() },
        },
      });

      if (creditorAccount) {
        await tx.bankAccount.update({
          where: { id: creditorAccount.id },
          data: {
            currentBalance: { increment: paymentAmount.toString() },
            availableBalance: { increment: paymentAmount.toString() },
          },
        });
      }

      const transaction = await tx.transaction.create({
        data: {
          reference: txRef,
          userId,
          sourceAccountId: debtorAccount.id,
          destinationAccountId: creditorAccount?.id || null,
          type: TransactionType.TRANSFER_INTERNAL,
          amount: paymentAmount.toString(),
          fee: '0.0000',
          tax: '0.0000',
          netAmount: paymentAmount.toString(),
          currencyCode: setup.currency,
          status: TransactionStatus.SUCCESS,
          description: `Open Banking PIS: ${setup.creditorName} (${setup.remittanceInformation})`,
        },
      });

      return transaction;
    });

    setup.status = 'COMPLETED';
    OpenBankingService.paymentsStore.set(setup.id, setup);

    this.logger.log(`Open Banking payment ${setup.id} executed successfully [Ref: ${txRef}]`);

    return {
      Data: {
        PaymentId: setup.id,
        Status: 'AcceptedSettlementCompleted',
        StatusUpdateDateTime: new Date().toISOString(),
        TransactionReference: txRef,
        InstructedAmount: {
          Amount: setup.instructedAmount,
          Currency: setup.currency,
        },
      },
      Meta: {
        Message: 'Payment executed and general ledger posted successfully',
      },
    };
  }

  /**
   * Revoke consent
   */
  async revokeConsent(consentId: string) {
    const consent = OpenBankingService.consentsStore.get(consentId);
    if (!consent) {
      throw new NotFoundException(`Consent ${consentId} not found`);
    }

    consent.status = ConsentStatus.REVOKED;
    consent.updatedAt = new Date();
    OpenBankingService.consentsStore.set(consentId, consent);

    this.logger.log(`Open Banking consent ${consentId} REVOKED`);

    return { message: `Consent ${consentId} revoked successfully` };
  }
}

