import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { WebhookEventTopic } from '../webhooks/dto/webhook-subscription.dto';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { EmvcoQrUtil, ParsedEmvcoQr } from '../../common/utils/emvco-qr.util';
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
import { LedgerEntryType, TransactionStatus, TransactionType } from '@prisma/client';
import Decimal from 'decimal.js';
import { MerchantPosUtil } from '../../common/utils/merchant-pos.util';

@Injectable()
export class MerchantsService {
  private readonly logger = new Logger(MerchantsService.name);
  private paymentLinksStore = new Map<string, any>();

  constructor(
    private prisma: PrismaService,
    private ledgerService: LedgerService,
    private webhookService: WebhookDispatcherService,
  ) {}

  /**
   * Generate dynamic or static EMVCo QR code for merchant account
   */
  async generateMerchantQr(merchantUserId: string, dto: GenerateMerchantQrDto) {
    const merchantAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.merchantAccountId },
      include: { user: { include: { profile: true } } },
    });

    if (!merchantAccount || merchantAccount.userId !== merchantUserId) {
      throw new ForbiddenException('Invalid or unowned merchant bank account');
    }

    const merchantName = merchantAccount.user.profile
      ? `${merchantAccount.user.profile.firstName} ${merchantAccount.user.profile.lastName}`
      : merchantAccount.accountName;

    const reference = dto.reference || CryptoUtil.generateTransactionReference('QR-POS');

    const qrPayload = EmvcoQrUtil.generateQrPayload({
      pointOfInitiation: dto.pointOfInitiation || (dto.amount ? 'DYNAMIC' : 'STATIC'),
      merchantId: merchantAccount.accountNumber,
      merchantName,
      merchantCity: merchantAccount.user.profile?.city || 'New York',
      currencyCode: dto.currency || merchantAccount.currencyCode,
      amount: dto.amount,
      reference,
      countryCode: merchantAccount.user.profile?.country?.slice(0, 2).toUpperCase() || 'US',
    });

    this.logger.log(`Generated EMVCo QR for merchant ${merchantName} [Ref: ${reference}]`);

    return {
      reference,
      merchantName,
      merchantAccountNumber: merchantAccount.accountNumber,
      currency: dto.currency || merchantAccount.currencyCode,
      amount: dto.amount || null,
      pointOfInitiation: dto.pointOfInitiation || (dto.amount ? 'DYNAMIC' : 'STATIC'),
      qrPayload,
      qrDataUri: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="50" font-size="6">EMVCo QR [${reference}]</text></svg>`,
    };
  }

  /**
   * Resolve and validate QR code for customer scan-to-pay
   */
  async resolveQr(dto: ResolveMerchantQrDto): Promise<ParsedEmvcoQr> {
    const parsed = EmvcoQrUtil.parseQrPayload(dto.qrString);
    if (!parsed.isValidChecksum) {
      throw new BadRequestException('Corrupted or invalid QR code checksum');
    }
    return parsed;
  }

  /**
   * Execute instant Scan-to-Pay settlement
   */
  async payMerchantQr(payerUserId: string, dto: PayMerchantQrDto) {
    // 1. Resolve QR
    const qrInfo = await this.resolveQr({ qrString: dto.qrString });

    const payableAmount = new Decimal(dto.amount || qrInfo.amount || '0.0000');
    if (payableAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    // 2. Validate Payer & PIN
    const payer = await this.prisma.user.findUnique({
      where: { id: payerUserId },
      include: { profile: true },
    });
    if (!payer) throw new NotFoundException('Payer account not found');
    if (!payer.pinHash) throw new BadRequestException('Transaction PIN is not configured');

    const isPinValid = await CryptoUtil.verify(payer.pinHash, dto.pin);
    if (!isPinValid) throw new BadRequestException('Invalid transaction authorization PIN');

    // 3. Load Accounts
    const payerAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.sourceAccountId },
    });
    if (!payerAccount || payerAccount.userId !== payerUserId) {
      throw new ForbiddenException('Invalid or unowned payer bank account');
    }

    if (new Decimal(payerAccount.availableBalance.toString()).lessThan(payableAmount)) {
      throw new BadRequestException('Insufficient available funds to complete QR payment');
    }

    // Find Merchant Bank Account
    const merchantAccount = await this.prisma.bankAccount.findUnique({
      where: { accountNumber: qrInfo.merchantId },
      include: { user: true },
    });
    if (!merchantAccount) {
      throw new NotFoundException(`Merchant account ${qrInfo.merchantId} not found`);
    }

    // 4. Atomic MySQL Transaction
    const txRef = CryptoUtil.generateTransactionReference('POS-QR');
    const result = await this.prisma.$transaction(async (tx) => {
      // Debit Payer
      const updatedPayer = await tx.bankAccount.update({
        where: { id: payerAccount.id },
        data: {
          currentBalance: { decrement: payableAmount.toString() },
          availableBalance: { decrement: payableAmount.toString() },
        },
      });

      // Credit Merchant
      const updatedMerchant = await tx.bankAccount.update({
        where: { id: merchantAccount.id },
        data: {
          currentBalance: { increment: payableAmount.toString() },
          availableBalance: { increment: payableAmount.toString() },
        },
      });

      // Create Transaction
      const transaction = await tx.transaction.create({
        data: {
          reference: txRef,
          userId: payerUserId,
          sourceAccountId: payerAccount.id,
          destinationAccountId: merchantAccount.id,
          type: TransactionType.TRANSFER_INTERNAL,
          amount: payableAmount.toString(),
          fee: '0.0000',
          tax: '0.0000',
          netAmount: payableAmount.toString(),
          currencyCode: payerAccount.currencyCode,
          status: TransactionStatus.SUCCESS,
          description: `QR Merchant Payment: ${qrInfo.merchantName} (${qrInfo.reference})`,
        },
      });

      // Post General Ledger
      const payerLedger = await tx.ledgerAccount.findUnique({
        where: { bankAccountId: payerAccount.id },
      });
      const merchantLedger = await tx.ledgerAccount.findUnique({
        where: { bankAccountId: merchantAccount.id },
      });

      if (payerLedger && merchantLedger) {
        const journal = await tx.journalTransaction.create({
          data: {
            reference: `JRN-${txRef}`,
            transactionId: transaction.id,
            description: `QR POS Settlement: ${qrInfo.reference}`,
            createdBy: payerUserId,
          },
        });

        await tx.ledgerEntry.createMany({
          data: [
            {
              journalTransactionId: journal.id,
              ledgerAccountId: payerLedger.id,
              entryType: LedgerEntryType.DEBIT,
              amount: payableAmount.toString(),
              currencyCode: payerAccount.currencyCode,
              exchangeRate: '1.000000',
            },
            {
              journalTransactionId: journal.id,
              ledgerAccountId: merchantLedger.id,
              entryType: LedgerEntryType.CREDIT,
              amount: payableAmount.toString(),
              currencyCode: merchantAccount.currencyCode,
              exchangeRate: '1.000000',
            },
          ],
        });
      }

      return { transaction, payerBalance: updatedPayer.availableBalance, merchantBalance: updatedMerchant.availableBalance };
    });

    // 5. Fire Outbound Webhook to Merchant
    await this.webhookService.dispatchEvent(
      WebhookEventTopic.TRANSACTION_SUCCESS,
      {
        reference: txRef,
        merchantReference: qrInfo.reference,
        amount: payableAmount.toFixed(4),
        currency: payerAccount.currencyCode,
        payerName: payer.profile ? `${payer.profile.firstName} ${payer.profile.lastName}` : 'Silverhawk Customer',
        paidAt: new Date(),
      },
      merchantAccount.userId,
    );

    this.logger.log(`QR payment of ${payableAmount.toFixed(2)} ${payerAccount.currencyCode} settled to merchant ${qrInfo.merchantName}`);

    return {
      message: 'QR Merchant payment completed successfully',
      reference: txRef,
      merchantName: qrInfo.merchantName,
      amount: payableAmount.toFixed(4),
      currency: payerAccount.currencyCode,
      paidAt: new Date(),
      transaction: result.transaction,
    };
  }

  /**
   * Create digital invoice for merchant
   */
  async createInvoice(merchantUserId: string, dto: CreateInvoiceDto) {
    const merchantAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.merchantAccountId },
      include: { user: { include: { profile: true } } },
    });

    if (!merchantAccount || merchantAccount.userId !== merchantUserId) {
      throw new ForbiddenException('Invalid or unowned merchant bank account');
    }

    const invoiceRef = CryptoUtil.generateTransactionReference('INV');
    const qrResult = await this.generateMerchantQr(merchantUserId, {
      merchantAccountId: dto.merchantAccountId,
      amount: dto.amount,
      currency: dto.currency,
      reference: invoiceRef,
      pointOfInitiation: 'DYNAMIC',
    });

    return {
      invoiceNumber: invoiceRef,
      title: dto.title,
      amount: dto.amount,
      currency: dto.currency,
      customerEmail: dto.customerEmail,
      qr: qrResult,
      status: 'PENDING',
      createdAt: new Date(),
    };
  }

  // ==============================================================================
  // PHASE 36: HOSTED PAYMENT LINKS, VIRTUAL POS TERMINAL & MERCHANT ANALYTICS
  // ==============================================================================

  /**
   * Create a Hosted Shareable Payment Link with multi-currency checkout & MDR fee tracking
   */
  async createPaymentLink(merchantUserId: string, dto: CreatePaymentLinkDto) {
    const merchantAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.merchantAccountId },
      include: { user: { include: { profile: true } } },
    });

    if (!merchantAccount || merchantAccount.userId !== merchantUserId) {
      throw new ForbiddenException('Invalid or unowned merchant bank account');
    }

    const merchantName = merchantAccount.user.profile
      ? `${merchantAccount.user.profile.firstName} ${merchantAccount.user.profile.lastName}`
      : merchantAccount.accountName;

    const linkId = `plink_${CryptoUtil.generateNumericOtp(8)}`;
    const reference = CryptoUtil.generateTransactionReference('PLINK');
    const currency = dto.currency ? dto.currency.toUpperCase() : merchantAccount.currencyCode;
    const amount = dto.amount ? new Decimal(dto.amount).toFixed(2) : null;

    const signature = MerchantPosUtil.generateLinkSignature(linkId, merchantAccount.accountNumber, amount || '0.00', currency);
    const checkoutUrl = `https://silverhawkbank.com/pay/${linkId}`;

    const paymentLinkRecord = {
      id: linkId,
      merchantUserId,
      merchantAccountId: merchantAccount.id,
      merchantAccountNumber: merchantAccount.accountNumber,
      merchantName,
      reference,
      title: dto.title,
      description: dto.description || '',
      amount,
      currency,
      customerEmail: dto.customerEmail || null,
      redirectUrl: dto.redirectUrl || null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt).toISOString() : null,
      signature,
      checkoutUrl,
      status: 'ACTIVE',
      paymentCount: 0,
      totalCollected: '0.00',
      createdAt: new Date().toISOString(),
    };

    this.paymentLinksStore.set(linkId, paymentLinkRecord);

    return {
      paymentLink: paymentLinkRecord,
      message: `Hosted payment link "${dto.title}" created successfully!`,
    };
  }

  /**
   * List all payment links created by merchant
   */
  async getMerchantPaymentLinks(merchantUserId: string) {
    const links: any[] = [];
    for (const link of this.paymentLinksStore.values()) {
      if (link.merchantUserId === merchantUserId) {
        const isExpired = MerchantPosUtil.isLinkExpired(link.expiresAt);
        links.push({
          ...link,
          status: isExpired ? 'EXPIRED' : link.status,
        });
      }
    }

    links.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      paymentLinks: links,
      totalCount: links.length,
    };
  }

  /**
   * Public endpoint to resolve hosted payment link metadata for checkout page
   */
  async getPublicPaymentLink(linkId: string) {
    const link = this.paymentLinksStore.get(linkId);
    if (!link) {
      throw new NotFoundException('Payment link not found or expired');
    }

    if (MerchantPosUtil.isLinkExpired(link.expiresAt)) {
      throw new BadRequestException('This payment link has expired');
    }

    return {
      id: link.id,
      merchantName: link.merchantName,
      title: link.title,
      description: link.description,
      amount: link.amount,
      currency: link.currency,
      customerEmail: link.customerEmail,
      status: link.status,
      signature: link.signature,
      expiresAt: link.expiresAt,
    };
  }

  /**
   * Settle checkout payment for hosted link with MDR fee deduction & double-entry ledger posting
   */
  async payPaymentLink(linkId: string, dto: PayPaymentLinkDto, authenticatedUserId?: string) {
    const link = this.paymentLinksStore.get(linkId);
    if (!link) {
      throw new NotFoundException('Payment link not found');
    }

    if (MerchantPosUtil.isLinkExpired(link.expiresAt)) {
      throw new BadRequestException('Payment link has expired');
    }

    const payableAmount = new Decimal(link.amount || dto.customAmount || '0.00');
    if (payableAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Valid payment amount required');
    }

    const merchantAccount = await this.prisma.bankAccount.findUnique({
      where: { id: link.merchantAccountId },
    });

    if (!merchantAccount) {
      throw new NotFoundException('Merchant settlement account not found');
    }

    // Compute standard MDR fee (1.25% + $0.30)
    const mdr = MerchantPosUtil.calculateMdrFee(payableAmount, 1.25, 0.30);
    const mdrFee = new Decimal(mdr.totalMdrFee);
    const netMerchantCredit = new Decimal(mdr.netMerchantSettlement);

    const txRef = CryptoUtil.generateTransactionReference('PAYLINK-SETTLE');

    await this.prisma.$transaction(async (tx) => {
      // If payer uses an internal bank account
      if (dto.payerAccountId) {
        const payerAccount = await tx.bankAccount.findUnique({
          where: { id: dto.payerAccountId },
        });

        if (!payerAccount || (authenticatedUserId && payerAccount.userId !== authenticatedUserId)) {
          throw new ForbiddenException('Invalid or unowned payer account');
        }

        if (new Decimal(payerAccount.availableBalance.toString()).lessThan(payableAmount)) {
          throw new BadRequestException('Insufficient available balance for checkout');
        }

        if (dto.pin) {
          const user = await tx.user.findUnique({ where: { id: payerAccount.userId } });
          const isValidPin = await CryptoUtil.verify(user.pinHash, dto.pin);
          if (!isValidPin) {
            throw new ForbiddenException('Invalid authorization PIN');
          }
        }

        // Deduct payer
        await tx.bankAccount.update({
          where: { id: payerAccount.id },
          data: {
            currentBalance: { decrement: payableAmount.toFixed(4) },
            availableBalance: { decrement: payableAmount.toFixed(4) },
            ledgerBalance: { decrement: payableAmount.toFixed(4) },
          },
        });

        // Create debit transaction for payer
        await tx.transaction.create({
          data: {
            reference: `${txRef}-DR`,
            userId: payerAccount.userId,
            sourceAccountId: payerAccount.id,
            destinationAccountId: merchantAccount.id,
            type: TransactionType.TRANSFER_INTERNAL,
            status: TransactionStatus.SUCCESS,
            amount: payableAmount.toFixed(4),
            fee: '0.0000',
            netAmount: payableAmount.toFixed(4),
            currencyCode: payerAccount.currencyCode,
            description: `Payment to ${link.merchantName} [${link.title}]`,
            metadata: {
              linkId: link.id,
              merchantName: link.merchantName,
            },
          },
        });
      }

      // Credit merchant account with net amount
      await tx.bankAccount.update({
        where: { id: merchantAccount.id },
        data: {
          currentBalance: { increment: netMerchantCredit.toFixed(4) },
          availableBalance: { increment: netMerchantCredit.toFixed(4) },
          ledgerBalance: { increment: netMerchantCredit.toFixed(4) },
        },
      });

      // Create credit transaction for merchant
      const merchantTx = await tx.transaction.create({
        data: {
          reference: txRef,
          userId: link.merchantUserId,
          destinationAccountId: merchantAccount.id,
          type: TransactionType.CARD_PURCHASE,
          status: TransactionStatus.SUCCESS,
          amount: payableAmount.toFixed(4),
          fee: mdrFee.toFixed(4),
          netAmount: netMerchantCredit.toFixed(4),
          currencyCode: merchantAccount.currencyCode,
          description: `Checkout Settlement: ${link.title} (Payer: ${dto.payerName || 'Online Customer'})`,
          metadata: {
            linkId: link.id,
            payerName: dto.payerName || 'Online Customer',
            payerEmail: dto.payerEmail || null,
            mdrFee: mdrFee.toFixed(2),
            netSettlement: netMerchantCredit.toFixed(2),
          },
        },
      });

      // Double-entry posting:
      // Debit: 2010-<payerAcc> or 1050-CARD-CLEARING
      // Credit: 2010-<merchantAcc> (Net settlement)
      // Credit: 4010-MDR-FEES (Bank Merchant Fee Revenue)
      const payerLedgerCode = dto.payerAccountId ? `2010-${dto.payerAccountId.slice(0, 10)}` : '1050-CARD-CLEARING';
      const merchantLedgerCode = `2010-${merchantAccount.accountNumber}`;

      await this.ledgerService.postJournalEntry(
        tx,
        {
          reference: `JRN-${txRef}`,
          transactionId: merchantTx.id,
          description: `Hosted Checkout Settlement: ${link.title}`,
          entries: [
            {
              accountCode: payerLedgerCode,
              entryType: LedgerEntryType.DEBIT,
              amount: payableAmount.toFixed(4),
              currencyCode: merchantAccount.currencyCode,
            },
            {
              accountCode: merchantLedgerCode,
              entryType: LedgerEntryType.CREDIT,
              amount: netMerchantCredit.toFixed(4),
              currencyCode: merchantAccount.currencyCode,
            },
            {
              accountCode: '4010-MDR-FEES',
              entryType: LedgerEntryType.CREDIT,
              amount: mdrFee.toFixed(4),
              currencyCode: merchantAccount.currencyCode,
            },
          ],
        },
        link.merchantUserId,
      );
    });

    // Update link counters
    link.paymentCount = (link.paymentCount || 0) + 1;
    link.totalCollected = new Decimal(link.totalCollected || '0.00').plus(payableAmount).toFixed(2);
    link.status = 'PAID';
    this.paymentLinksStore.set(linkId, link);

    // Dispatch webhook
    await this.webhookService.dispatchEvent(
      WebhookEventTopic.TRANSACTION_SUCCESS,
      {
        linkId: link.id,
        reference: txRef,
        amount: payableAmount.toFixed(2),
        currency: link.currency,
        mdrFee: mdrFee.toFixed(2),
        netSettlement: netMerchantCredit.toFixed(2),
        payerName: dto.payerName || 'Online Customer',
        paidAt: new Date().toISOString(),
      },
      link.merchantUserId,
    );

    return {
      success: true,
      reference: txRef,
      amountPaid: payableAmount.toFixed(2),
      currency: link.currency,
      merchantName: link.merchantName,
      redirectUrl: link.redirectUrl,
      message: `Checkout payment of ${link.currency} ${payableAmount.toFixed(2)} completed successfully!`,
    };
  }

  /**
   * Process Virtual POS Terminal instant charge with gratuity tip & thermal receipt generation
   */
  async processPosCharge(merchantUserId: string, dto: PosChargeDto) {
    const merchantAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.merchantAccountId },
      include: { user: { include: { profile: true } } },
    });

    if (!merchantAccount || merchantAccount.userId !== merchantUserId) {
      throw new ForbiddenException('Invalid or unowned merchant terminal account');
    }

    const merchantName = merchantAccount.user.profile
      ? `${merchantAccount.user.profile.firstName} ${merchantAccount.user.profile.lastName}`
      : merchantAccount.accountName;

    const baseAmount = new Decimal(dto.amount);
    if (baseAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('POS charge amount must be greater than zero');
    }

    const tipPct = dto.tipPercentage ? parseFloat(dto.tipPercentage) : 0;
    const customTip = dto.customTip ? parseFloat(dto.customTip) : 0;

    const billCalc = MerchantPosUtil.calculatePosBill(baseAmount, tipPct, customTip, 0);
    const totalCharge = new Decimal(billCalc.totalPayable);

    // MDR calculation
    const mdr = MerchantPosUtil.calculateMdrFee(totalCharge, 1.25, 0.30);
    const mdrFee = new Decimal(mdr.totalMdrFee);
    const netCredit = new Decimal(mdr.netMerchantSettlement);

    const posRef = CryptoUtil.generateTransactionReference('POS-TRM');
    const terminalId = `TRM-${merchantAccount.accountNumber.slice(-4)}`;
    const authCode = `AUTH-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.bankAccount.update({
        where: { id: merchantAccount.id },
        data: {
          currentBalance: { increment: netCredit.toFixed(4) },
          availableBalance: { increment: netCredit.toFixed(4) },
          ledgerBalance: { increment: netCredit.toFixed(4) },
        },
      });

      const posTx = await tx.transaction.create({
        data: {
          reference: posRef,
          userId: merchantUserId,
          destinationAccountId: merchantAccount.id,
          type: TransactionType.CARD_PURCHASE,
          status: TransactionStatus.SUCCESS,
          amount: totalCharge.toFixed(4),
          fee: mdrFee.toFixed(4),
          netAmount: netCredit.toFixed(4),
          currencyCode: dto.currency || merchantAccount.currencyCode,
          description: `Virtual POS Charge [${terminalId}] - Base: $${billCalc.subtotal}, Tip: $${billCalc.tipAmount}`,
          metadata: {
            terminalId,
            authCode,
            subtotal: billCalc.subtotal,
            tipAmount: billCalc.tipAmount,
            mdrFee: mdrFee.toFixed(2),
            customer: dto.customerIdentifier || 'Walk-in Customer',
          },
        },
      });

      const merchantLedgerCode = `2010-${merchantAccount.accountNumber}`;
      await this.ledgerService.postJournalEntry(
        tx,
        {
          reference: `JRN-${posRef}`,
          transactionId: posTx.id,
          description: `Virtual POS Settlement [${terminalId}]`,
          entries: [
            {
              accountCode: '1050-POS-TERMINAL-CLEARING',
              entryType: LedgerEntryType.DEBIT,
              amount: totalCharge.toFixed(4),
              currencyCode: merchantAccount.currencyCode,
            },
            {
              accountCode: merchantLedgerCode,
              entryType: LedgerEntryType.CREDIT,
              amount: netCredit.toFixed(4),
              currencyCode: merchantAccount.currencyCode,
            },
            {
              accountCode: '4010-MDR-FEES',
              entryType: LedgerEntryType.CREDIT,
              amount: mdrFee.toFixed(4),
              currencyCode: merchantAccount.currencyCode,
            },
          ],
        },
        merchantUserId,
      );
    });

    const thermalSlip = MerchantPosUtil.formatThermalReceipt({
      merchantName,
      terminalId,
      reference: posRef,
      date: new Date(),
      currency: dto.currency || '$',
      subtotal: billCalc.subtotal,
      tax: billCalc.taxAmount,
      tip: billCalc.tipAmount,
      total: billCalc.totalPayable,
      cardPanMasked: dto.customerIdentifier || '•••• •••• •••• 8821',
      authCode,
    });

    return {
      approved: true,
      reference: posRef,
      terminalId,
      authCode,
      bill: billCalc,
      mdr,
      thermalSlip,
      message: `POS charge of ${dto.currency || '$'} ${billCalc.totalPayable} approved!`,
    };
  }

  /**
   * Merchant sales volume analytics and interchange breakdown
   */
  async getMerchantAnalytics(merchantUserId: string, query?: MerchantAnalyticsQueryDto) {
    const merchantAccounts = await this.prisma.bankAccount.findMany({
      where: { userId: merchantUserId },
      select: { id: true, accountNumber: true, currencyCode: true },
    });

    const accountIds = merchantAccounts.map((a) => a.id);

    const txs = await this.prisma.transaction.findMany({
      where: {
        userId: merchantUserId,
        destinationAccountId: { in: accountIds },
        type: { in: [TransactionType.CARD_PURCHASE, TransactionType.TRANSFER_INTERNAL] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    let grossVolume = new Decimal('0.00');
    let totalMdrFees = new Decimal('0.00');
    let netPayoutVolume = new Decimal('0.00');

    for (const t of txs) {
      grossVolume = grossVolume.plus(new Decimal(t.amount.toString()));
      totalMdrFees = totalMdrFees.plus(new Decimal(t.fee.toString()));
      netPayoutVolume = netPayoutVolume.plus(new Decimal(t.netAmount.toString()));
    }

    const txCount = txs.length;
    const aov = txCount > 0 ? grossVolume.dividedBy(txCount).toFixed(2) : '0.00';

    return {
      grossSalesVolume: grossVolume.toFixed(2),
      totalMdrInterchangeFees: totalMdrFees.toFixed(2),
      netSettledPayoutVolume: netPayoutVolume.toFixed(2),
      transactionCount: txCount,
      averageOrderValue: aov,
      recentTransactions: txs.slice(0, 10),
    };
  }
}


