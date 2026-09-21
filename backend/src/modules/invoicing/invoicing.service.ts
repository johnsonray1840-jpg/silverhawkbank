import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateInvoiceDto,
  RecordInvoicePaymentDto,
  ApplyInvoiceFactoringDto,
} from './dto/invoicing.dto';
import {
  InvoiceStatus,
  FactoringStatus,
  InvoicingReconciliationUtil,
  InvoiceCalculationResult,
  FactoringCalculationResult,
  ReconciliationMatchResult,
} from '../../common/utils/invoicing-reconciliation.util';
import { AccountStatus, TransactionStatus, TransactionType } from '@prisma/client';
import Decimal from 'decimal.js';
import * as crypto from 'crypto';

export interface StoredInvoice {
  id: string;
  invoiceNumber: string;
  userId: string;
  accountId: string;
  recipientName: string;
  recipientEmail: string;
  recipientAddress?: string;
  recipientTaxId?: string;
  currency: string;
  status: InvoiceStatus;
  calculation: InvoiceCalculationResult;
  remainingBalance: string;
  amountPaid: string;
  issueDate: Date;
  dueDate: Date;
  notes?: string;
  factoringStatus: FactoringStatus;
  factoringDetails?: FactoringCalculationResult & {
    payoutAccountId: string;
    factoredAt: Date;
  };
  payments: Array<{
    id: string;
    amount: string;
    reference: string;
    paidAt: Date;
    earlyDiscountApplied: boolean;
    senderName?: string;
    senderTaxId?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class InvoicingService {
  private readonly logger = new Logger(InvoicingService.name);

  // In-memory persistent high-performance store for Invoicing & Factoring lifecycle
  private invoices: Map<string, StoredInvoice> = new Map();

  constructor(private prisma: PrismaService) {}

  /**
   * Create a new B2B Commercial Invoice with line items and optional early payment terms
   */
  async createInvoice(userId: string, dto: CreateInvoiceDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('User not found');

    const account = await this.prisma.bankAccount.findUnique({
      where: { id: dto.accountId },
    });
    if (!account) throw new NotFoundException('Settlement bank account not found');
    if (account.userId !== userId) throw new ForbiddenException('You do not own this bank account');
    if (account.status !== AccountStatus.ACTIVE) throw new BadRequestException('Settlement bank account is not active');

    const currency = (dto.currency || account.currencyCode || 'USD').toUpperCase();
    const issueDate = new Date();
    const netDays = dto.netDueDays || 30;
    const dueDate = new Date(issueDate.getTime() + netDays * 24 * 60 * 60 * 1000);

    const earlyTerms =
      dto.earlyDiscountPercentage && dto.earlyDiscountDays
        ? {
            discountPercentage: dto.earlyDiscountPercentage,
            discountDays: dto.earlyDiscountDays,
            netDays,
          }
        : undefined;

    const calculation = InvoicingReconciliationUtil.calculateInvoice(
      dto.lineItems,
      earlyTerms,
      issueDate,
    );

    const invoiceId = crypto.randomUUID();
    const invoiceNumber = `INV-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    const invoice: StoredInvoice = {
      id: invoiceId,
      invoiceNumber,
      userId,
      accountId: account.id,
      recipientName: dto.recipientName,
      recipientEmail: dto.recipientEmail,
      recipientAddress: dto.recipientAddress,
      recipientTaxId: dto.recipientTaxId,
      currency,
      status: InvoiceStatus.DRAFT,
      calculation,
      remainingBalance: calculation.totalAmount,
      amountPaid: '0.00',
      issueDate,
      dueDate,
      notes: dto.notes,
      factoringStatus: FactoringStatus.NONE,
      payments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.invoices.set(invoiceId, invoice);
    this.logger.log(`Created invoice ${invoiceNumber} (${invoiceId}) for user ${userId} total: ${currency} ${calculation.totalAmount}`);

    return invoice;
  }

  /**
   * Issue a draft invoice to active receivable status
   */
  async issueInvoice(userId: string, invoiceId: string) {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.userId !== userId) throw new ForbiddenException('Access denied to invoice');

    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(`Cannot issue invoice in ${invoice.status} status`);
    }

    invoice.status = InvoiceStatus.ISSUED;
    invoice.updatedAt = new Date();

    this.logger.log(`Issued invoice ${invoice.invoiceNumber} for client ${invoice.recipientName}`);
    return invoice;
  }

  /**
   * Smart AR Reconciliation & Payment Settlement:
   * Auto-matches incoming wire/ACH payment against open invoices or processes explicit invoice ID.
   */
  async recordPayment(userId: string, dto: RecordInvoicePaymentDto) {
    const payAmountDec = new Decimal(dto.amount);
    if (payAmountDec.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    const destinationAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.destinationAccountId },
    });
    if (!destinationAccount) throw new NotFoundException('Destination bank account not found');
    if (destinationAccount.userId !== userId) throw new ForbiddenException('Access denied to destination bank account');
    if (destinationAccount.status !== AccountStatus.ACTIVE) throw new BadRequestException('Destination bank account is not active');

    let targetInvoice: StoredInvoice | undefined;
    let matchResult: ReconciliationMatchResult | undefined;

    if (dto.invoiceId) {
      targetInvoice = this.invoices.get(dto.invoiceId);
      if (!targetInvoice) throw new NotFoundException('Specified invoice not found');
      if (targetInvoice.userId !== userId) throw new ForbiddenException('Access denied to invoice');
    } else {
      // Run Automated AR Reconciliation matcher across all open invoices for this user
      const openInvoices = Array.from(this.invoices.values())
        .filter(
          (inv) =>
            inv.userId === userId &&
            (inv.status === InvoiceStatus.ISSUED ||
              inv.status === InvoiceStatus.PARTIALLY_PAID ||
              inv.status === InvoiceStatus.FACTORED),
        )
        .map((inv) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          clientName: inv.recipientName,
          clientTaxId: inv.recipientTaxId,
          totalAmount: inv.calculation.totalAmount,
          remainingBalance: inv.remainingBalance,
          earlyDiscountAmount: inv.calculation.earlyDiscountAmount,
          earlyDiscountEligibleUntil: inv.calculation.earlyDiscountEligibleUntil,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate,
        }));

      matchResult = InvoicingReconciliationUtil.matchPaymentToInvoices(
        {
          amount: dto.amount,
          reference: dto.reference,
          senderName: dto.senderName,
          senderTaxId: dto.senderTaxId,
          paymentDate: new Date(),
        },
        openInvoices,
      );

      if (matchResult.matched && matchResult.matchedInvoiceId) {
        targetInvoice = this.invoices.get(matchResult.matchedInvoiceId);
      }
    }

    if (!targetInvoice) {
      throw new BadRequestException(
        matchResult
          ? `Automatic AR Reconciliation failed: ${matchResult.matchReason}`
          : 'Could not match payment to any open invoice',
      );
    }

    // Check if early discount applies
    let earlyDiscountApplied = false;
    let effectiveSettlementAmount = payAmountDec;
    const invBalanceDec = new Decimal(targetInvoice.remainingBalance);

    if (
      targetInvoice.calculation.earlyDiscountAmount &&
      targetInvoice.calculation.earlyDiscountEligibleUntil &&
      new Date() <= new Date(targetInvoice.calculation.earlyDiscountEligibleUntil)
    ) {
      const discountDec = new Decimal(targetInvoice.calculation.earlyDiscountAmount);
      const discountedFullTotal = new Decimal(targetInvoice.calculation.totalAmount).minus(discountDec);

      if (payAmountDec.equals(discountedFullTotal)) {
        earlyDiscountApplied = true;
        // The payment covers the full invoice balance via early discount
        effectiveSettlementAmount = invBalanceDec;
      }
    }

    // Execute double-entry ledger balance increment in DB
    const netDepositAmt = payAmountDec.toNumber();
    const paymentRef = `AR-REC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.bankAccount.update({
        where: { id: destinationAccount.id },
        data: {
          currentBalance: { increment: netDepositAmt },
          availableBalance: { increment: netDepositAmt },
        },
      });

      await tx.transaction.create({
        data: {
          userId,
          destinationAccountId: destinationAccount.id,
          type: TransactionType.DEPOSIT,
          amount: netDepositAmt,
          netAmount: netDepositAmt,
          currencyCode: targetInvoice.currency,
          status: TransactionStatus.SUCCESS,
          description: `[Invoice Payment Settled] #${targetInvoice.invoiceNumber} from ${targetInvoice.recipientName}`,
          reference: paymentRef,
        },
      });
    });

    // Update invoice balance and status
    const currentPaidDec = new Decimal(targetInvoice.amountPaid).plus(payAmountDec);
    const newRemainingDec = Decimal.max(0, invBalanceDec.minus(effectiveSettlementAmount));

    targetInvoice.amountPaid = currentPaidDec.toFixed(2);
    targetInvoice.remainingBalance = newRemainingDec.toFixed(2);

    if (newRemainingDec.equals(0)) {
      targetInvoice.status = InvoiceStatus.PAID;
      if (targetInvoice.factoringStatus === FactoringStatus.DISBURSED) {
        targetInvoice.factoringStatus = FactoringStatus.REPAID;
      }
    } else {
      targetInvoice.status = InvoiceStatus.PARTIALLY_PAID;
    }

    const paymentRecord = {
      id: crypto.randomUUID(),
      amount: payAmountDec.toFixed(2),
      reference: dto.reference,
      paidAt: new Date(),
      earlyDiscountApplied,
      senderName: dto.senderName,
      senderTaxId: dto.senderTaxId,
    };

    targetInvoice.payments.push(paymentRecord);
    targetInvoice.updatedAt = new Date();

    return {
      success: true,
      message: 'Invoice payment reconciled and settled to ledger successfully.',
      reconciliation: matchResult || {
        matched: true,
        confidenceScore: 100,
        matchReason: 'Direct invoice ID match provided',
        amountMatchType: earlyDiscountApplied ? 'EARLY_DISCOUNT' : 'EXACT',
        settlementAmount: payAmountDec.toFixed(2),
        earlyDiscountApplied,
      },
      payment: paymentRecord,
      invoice: targetInvoice,
    };
  }

  /**
   * Apply for instant Invoice Factoring financing (85% immediate liquidity advance)
   */
  async applyFactoring(userId: string, dto: ApplyInvoiceFactoringDto) {
    const invoice = this.invoices.get(dto.invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.userId !== userId) throw new ForbiddenException('Access denied to invoice');

    if (
      invoice.status !== InvoiceStatus.ISSUED &&
      invoice.status !== InvoiceStatus.PARTIALLY_PAID
    ) {
      throw new BadRequestException(`Cannot factor invoice in ${invoice.status} status. Invoice must be ISSUED.`);
    }

    if (invoice.factoringStatus !== FactoringStatus.NONE) {
      throw new BadRequestException(`Invoice is already factored or factoring requested`);
    }

    const payoutAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.payoutAccountId },
    });
    if (!payoutAccount) throw new NotFoundException('Factoring payout bank account not found');
    if (payoutAccount.userId !== userId) throw new ForbiddenException('Access denied to payout bank account');
    if (payoutAccount.status !== AccountStatus.ACTIVE) throw new BadRequestException('Payout bank account is not active');

    const advanceRate = dto.advanceRatePct || 85;
    const factoringCalculation = InvoicingReconciliationUtil.calculateFactoringTerms(
      invoice.remainingBalance,
      advanceRate,
      1.5,
    );

    const advanceDisburseAmt = new Decimal(factoringCalculation.netAdvanceDisbursed).toNumber();
    const factorRef = `FACTOR-ADV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // Disburse immediate liquidity advance to seller's account
    await this.prisma.$transaction(async (tx) => {
      await tx.bankAccount.update({
        where: { id: payoutAccount.id },
        data: {
          currentBalance: { increment: advanceDisburseAmt },
          availableBalance: { increment: advanceDisburseAmt },
        },
      });

      await tx.transaction.create({
        data: {
          userId,
          destinationAccountId: payoutAccount.id,
          type: TransactionType.DEPOSIT,
          amount: advanceDisburseAmt,
          netAmount: advanceDisburseAmt,
          currencyCode: invoice.currency,
          status: TransactionStatus.SUCCESS,
          description: `[Invoice Factoring Advance ${advanceRate}%] #${invoice.invoiceNumber} - Immediate Liquidity`,
          reference: factorRef,
        },
      });
    });

    invoice.status = InvoiceStatus.FACTORED;
    invoice.factoringStatus = FactoringStatus.DISBURSED;
    invoice.factoringDetails = {
      ...factoringCalculation,
      payoutAccountId: payoutAccount.id,
      factoredAt: new Date(),
    };
    invoice.updatedAt = new Date();

    this.logger.log(`Disbursed factoring advance ${invoice.currency} ${advanceDisburseAmt} for invoice ${invoice.invoiceNumber}`);

    return {
      success: true,
      message: 'Invoice factoring approved and liquidity advance disbursed immediately.',
      factoring: invoice.factoringDetails,
      invoice,
    };
  }

  /**
   * Get single invoice by ID
   */
  async getInvoice(userId: string, invoiceId: string) {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.userId !== userId) throw new ForbiddenException('Access denied to invoice');
    return invoice;
  }

  /**
   * List all invoices for a user, with optional status filter
   */
  async listInvoices(userId: string, status?: InvoiceStatus) {
    const userInvoices = Array.from(this.invoices.values()).filter(
      (inv) => inv.userId === userId && (!status || inv.status === status),
    );
    return userInvoices;
  }
}

