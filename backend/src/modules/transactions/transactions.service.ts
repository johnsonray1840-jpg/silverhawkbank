import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  LedgerEntryType,
  Prisma,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { QueryTransactionsDto } from './dto/query-transactions.dto';
import { ReverseTransactionDto } from './dto/reverse-transaction.dto';
import { RefundTransactionDto } from './dto/refund-transaction.dto';
import { AdjustmentType, ManualAdjustmentDto } from './dto/manual-adjustment.dto';

@Injectable()
export class TransactionsService {
  constructor(
    private prisma: PrismaService,
    private ledgerService: LedgerService,
  ) {}

  /**
   * Get paginated transaction history for authenticated customer
   */
  async getTransactions(userId: string, queryDto: QueryTransactionsDto) {
    const { page = 1, limit = 20, type, status, currency, search, startDate, endDate } = queryDto;
    const skip = (page - 1) * limit;

    const where: Prisma.TransactionWhereInput = {
      userId,
    };

    if (type) where.type = type;
    if (status) where.status = status;
    if (currency) where.currencyCode = currency.toUpperCase();

    if (search) {
      where.OR = [
        { reference: { contains: search } },
        { description: { contains: search } },
      ];
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          sourceAccount: { select: { accountNumber: true, accountName: true } },
          destinationAccount: { select: { accountNumber: true, accountName: true } },
          transfer: true,
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      data: transactions,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get transaction details including double-entry journal postings
   */
  async getTransactionDetails(userId: string, transactionId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        sourceAccount: true,
        destinationAccount: true,
        transfer: true,
        deposit: true,
        withdrawal: true,
        journalTransaction: {
          include: {
            entries: {
              include: {
                ledgerAccount: true,
              },
            },
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (transaction.userId !== userId) {
      throw new ForbiddenException('Access denied to this transaction');
    }

    return transaction;
  }

  /**
   * Generate formal institutional Proof-of-Payment (POP) receipt
   */
  async getTransactionReceipt(userId: string, transactionId: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, userId },
      include: {
        user: { include: { profile: true } },
        sourceAccount: true,
        destinationAccount: true,
        transfer: true,
        deposit: true,
      },
    });

    if (!tx) {
      throw new NotFoundException('Transaction receipt not found or access denied');
    }

    const digitalCert = CryptoUtil.hashSha256(
      `${tx.id}:${tx.reference}:${tx.amount.toString()}:${tx.createdAt.toISOString()}:SILVERHAWK_DIGITAL_TRUST`
    );

    return {
      receiptNumber: `REC-${tx.reference}`,
      reference: tx.reference,
      transactionId: tx.id,
      timestamp: tx.createdAt.toISOString(),
      settledAt: tx.updatedAt.toISOString(),
      status: tx.status,
      type: tx.type,
      currency: tx.currencyCode,
      amount: tx.amount.toFixed(2),
      fee: tx.fee.toFixed(2),
      netAmount: tx.netAmount.toFixed(2),
      description: tx.description,
      sender: {
        name: tx.user.profile ? `${tx.user.profile.firstName} ${tx.user.profile.lastName}`.trim() : tx.user.username,
        accountNumber: tx.sourceAccount?.accountNumber || 'N/A',
        accountName: tx.sourceAccount?.accountName || 'Primary Checking',
        institution: 'Silverhawk Digital Federal Trust',
      },
      beneficiary: {
        name: tx.transfer?.recipientName || (tx.metadata as any)?.counterpartyName || 'Account Holder',
        accountNumber: tx.transfer?.recipientAccount || tx.destinationAccount?.accountNumber || (tx.metadata as any)?.counterpartyAccount || 'N/A',
        bankName: tx.transfer?.bankName || (tx.metadata as any)?.counterpartyBank || 'Silverhawk Digital Bank',
        routingNumber: tx.transfer?.routingNumber || '021000021',
        swiftCode: tx.transfer?.swiftBic || 'RMVLUS33NYC',
      },
      clearingMetadata: {
        clearingNetwork: tx.type === TransactionType.TRANSFER_INTERNAL ? 'SILVERHAWK_INSTANT_P2P' : 'FEDERAL_RESERVE_FEDWIRE_CLEARED',
        verificationHash: digitalCert,
        verificationUrl: `https://silverhawkbank.com/verify-receipt?ref=${encodeURIComponent(tx.reference)}&sig=${digitalCert.slice(0, 16)}`,
        institutionalSeal: 'CERTIFIED_INSTITUTIONAL_PROOF_OF_PAYMENT',
      },
    };
  }

  /**
   * Admin: Get global stream of all transactions across all customers
   */
  async getAllTransactionsAdmin(queryDto: QueryTransactionsDto) {
    const { page = 1, limit = 20, type, status, currency, search, startDate, endDate } = queryDto;
    const skip = (page - 1) * limit;

    const where: Prisma.TransactionWhereInput = {};

    if (type) where.type = type;
    if (status) where.status = status;
    if (currency) where.currencyCode = currency.toUpperCase();

    if (search) {
      where.OR = [
        { reference: { contains: search } },
        { description: { contains: search } },
        { user: { email: { contains: search } } },
        { user: { username: { contains: search } } },
      ];
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              profile: true,
            },
          },
          sourceAccount: { select: { accountNumber: true, accountName: true } },
          destinationAccount: { select: { accountNumber: true, accountName: true } },
          transfer: true,
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      data: transactions,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Admin: Execute an immutable compensating transaction reversal
   */
  async reverseTransaction(transactionId: string, dto: ReverseTransactionDto, adminId?: string) {
    const originalTx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        sourceAccount: true,
        destinationAccount: true,
        journalTransaction: {
          include: {
            entries: {
              include: { ledgerAccount: true },
            },
          },
        },
      },
    });

    if (!originalTx) {
      throw new NotFoundException('Transaction not found');
    }

    if (originalTx.status === TransactionStatus.REVERSED) {
      throw new BadRequestException('This transaction has already been reversed');
    }

    if (originalTx.status !== TransactionStatus.SUCCESS) {
      throw new BadRequestException('Only successful transactions can be reversed');
    }

    const reversalRef = CryptoUtil.generateTransactionReference('REV');
    const amount = new Decimal(originalTx.amount.toString());

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Mark Original Transaction as REVERSED (Preserved immutably)
      await tx.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.REVERSED },
      });

      // 2. Reverse Bank Account Balances
      if (originalTx.type === TransactionType.TRANSFER_INTERNAL) {
        if (originalTx.sourceAccountId && originalTx.destinationAccountId) {
          // Re-credit source
          await tx.bankAccount.update({
            where: { id: originalTx.sourceAccountId },
            data: {
              currentBalance: { increment: amount.toFixed(4) },
              availableBalance: { increment: amount.toFixed(4) },
              ledgerBalance: { increment: amount.toFixed(4) },
            },
          });

          // Debit destination
          await tx.bankAccount.update({
            where: { id: originalTx.destinationAccountId },
            data: {
              currentBalance: { decrement: amount.toFixed(4) },
              availableBalance: { decrement: amount.toFixed(4) },
              ledgerBalance: { decrement: amount.toFixed(4) },
            },
          });
        }
      } else if (originalTx.type === TransactionType.DEPOSIT && originalTx.destinationAccountId) {
        // Debit destination
        await tx.bankAccount.update({
          where: { id: originalTx.destinationAccountId },
          data: {
            currentBalance: { decrement: amount.toFixed(4) },
            availableBalance: { decrement: amount.toFixed(4) },
            ledgerBalance: { decrement: amount.toFixed(4) },
          },
        });
      } else if (originalTx.type === TransactionType.WITHDRAWAL && originalTx.sourceAccountId) {
        // Re-credit source
        await tx.bankAccount.update({
          where: { id: originalTx.sourceAccountId },
          data: {
            currentBalance: { increment: amount.toFixed(4) },
            availableBalance: { increment: amount.toFixed(4) },
            ledgerBalance: { increment: amount.toFixed(4) },
          },
        });
      }

      // 3. Create Compensating Reversal Transaction
      const reversalTx = await tx.transaction.create({
        data: {
          reference: reversalRef,
          userId: originalTx.userId,
          sourceAccountId: originalTx.destinationAccountId, // Swapped for reversal
          destinationAccountId: originalTx.sourceAccountId,
          type: TransactionType.REVERSAL,
          amount: amount.toFixed(4),
          fee: '0.0000',
          netAmount: amount.toFixed(4),
          currencyCode: originalTx.currencyCode,
          status: TransactionStatus.SUCCESS,
          description: `Reversal of ${originalTx.reference}: ${dto.reason}`,
          metadata: {
            originalTransactionReference: originalTx.reference,
            reversalReason: dto.reason,
            reversedBy: adminId || 'SYSTEM_ADMIN',
          },
        },
      });

      // 4. Create Compensating Double-Entry Ledger Entries (Exact opposite direction)
      if (originalTx.journalTransaction && originalTx.journalTransaction.entries.length > 0) {
        const reversalJournalEntries = originalTx.journalTransaction.entries.map((entry) => ({
          accountCode: entry.ledgerAccount.accountCode,
          entryType: entry.entryType === LedgerEntryType.DEBIT ? LedgerEntryType.CREDIT : LedgerEntryType.DEBIT,
          amount: entry.amount.toString(),
          currencyCode: entry.currencyCode,
          exchangeRate: entry.exchangeRate.toString(),
        }));

        await this.ledgerService.postJournalEntry(
          tx,
          {
            reference: `JRN-${reversalRef}`,
            transactionId: reversalTx.id,
            description: `Compensating Reversal for JRN-${originalTx.reference}`,
            entries: reversalJournalEntries,
          },
          adminId,
        );
      }

      // 5. Write Immutable Audit Log
      await tx.auditLog.create({
        data: {
          actorId: adminId || null,
          actorRole: 'ADMIN',
          action: 'TRANSACTION_REVERSAL',
          resource: 'Transaction',
          resourceId: transactionId,
          beforeState: { status: originalTx.status, reference: originalTx.reference },
          afterState: { status: TransactionStatus.REVERSED, reversalReference: reversalRef, reason: dto.reason },
        },
      });

      // 6. Notify Customer
      await tx.notification.create({
        data: {
          userId: originalTx.userId,
          title: 'Transaction Reversed',
          message: `Transaction ${originalTx.reference} for ${originalTx.currencyCode} ${amount.toFixed(2)} has been reversed. Reason: ${dto.reason}`,
          type: 'SECURITY',
        },
      });

      return reversalTx;
    });

    return {
      message: 'Transaction successfully reversed with compensating ledger postings',
      reversalReference: reversalRef,
      transaction: result,
    };
  }

  /**
   * Admin: Controlled manual credit or debit adjustment
   */
  async manualAdjustment(dto: ManualAdjustmentDto, adminId?: string) {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id: dto.accountId },
      include: { user: true },
    });

    if (!account) {
      throw new NotFoundException('Bank account not found');
    }

    const adjustAmount = new Decimal(dto.amount);
    if (adjustAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Adjustment amount must be greater than zero');
    }

    const isCredit = dto.type === AdjustmentType.CREDIT;
    const txType = isCredit ? TransactionType.ADJUSTMENT_CREDIT : TransactionType.ADJUSTMENT_DEBIT;
    const adjustmentRef = CryptoUtil.generateTransactionReference(isCredit ? 'ADJ-CR' : 'ADJ-DR');

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Update Bank Account Balance
      if (isCredit) {
        await tx.bankAccount.update({
          where: { id: account.id },
          data: {
            currentBalance: { increment: adjustAmount.toFixed(4) },
            availableBalance: { increment: adjustAmount.toFixed(4) },
            ledgerBalance: { increment: adjustAmount.toFixed(4) },
          },
        });
      } else {
        const available = new Decimal(account.availableBalance.toString());
        if (available.lessThan(adjustAmount)) {
          throw new BadRequestException('INSUFFICIENT_FUNDS: Account balance is less than debit adjustment amount');
        }

        await tx.bankAccount.update({
          where: { id: account.id },
          data: {
            currentBalance: { decrement: adjustAmount.toFixed(4) },
            availableBalance: { decrement: adjustAmount.toFixed(4) },
            ledgerBalance: { decrement: adjustAmount.toFixed(4) },
          },
        });
      }

      // 2. Create Transaction record
      const businessTx = await tx.transaction.create({
        data: {
          reference: adjustmentRef,
          userId: account.userId,
          destinationAccountId: isCredit ? account.id : null,
          sourceAccountId: !isCredit ? account.id : null,
          type: txType,
          amount: adjustAmount.toFixed(4),
          fee: '0.0000',
          netAmount: adjustAmount.toFixed(4),
          currencyCode: account.currencyCode,
          status: TransactionStatus.SUCCESS,
          description: `Manual ${dto.type}: ${dto.reason}`,
          metadata: {
            adjustmentType: dto.type,
            reason: dto.reason,
            authorizedBy: adminId || 'ADMIN',
          },
        },
      });

      // 3. Post Double-Entry Journal
      // Credit adjustment: Debit Retained Earnings (3020) or Expense (5010), Credit Customer Liability (2010-<acc>)
      // Debit adjustment: Debit Customer Liability (2010-<acc>), Credit Revenue/Retained Earnings (3020)
      const customerLedgerAccountCode = `2010-${account.accountNumber}`;
      const journalEntries = isCredit
        ? [
            {
              accountCode: '3020', // Retained Earnings / Equity
              entryType: LedgerEntryType.DEBIT,
              amount: adjustAmount.toFixed(4),
              currencyCode: account.currencyCode,
            },
            {
              accountCode: customerLedgerAccountCode,
              entryType: LedgerEntryType.CREDIT,
              amount: adjustAmount.toFixed(4),
              currencyCode: account.currencyCode,
            },
          ]
        : [
            {
              accountCode: customerLedgerAccountCode,
              entryType: LedgerEntryType.DEBIT,
              amount: adjustAmount.toFixed(4),
              currencyCode: account.currencyCode,
            },
            {
              accountCode: '3020',
              entryType: LedgerEntryType.CREDIT,
              amount: adjustAmount.toFixed(4),
              currencyCode: account.currencyCode,
            },
          ];

      await this.ledgerService.postJournalEntry(
        tx,
        {
          reference: `JRN-${adjustmentRef}`,
          transactionId: businessTx.id,
          description: `Manual ${dto.type} adjustment on #${account.accountNumber}: ${dto.reason}`,
          entries: journalEntries,
        },
        adminId,
      );

      // 4. Audit Log
      await tx.auditLog.create({
        data: {
          actorId: adminId || null,
          actorRole: 'FINANCE_MANAGER',
          action: `MANUAL_BALANCE_${dto.type}`,
          resource: 'BankAccount',
          resourceId: account.id,
          beforeState: { balance: account.currentBalance.toString() },
          afterState: {
            adjustmentType: dto.type,
            amount: adjustAmount.toFixed(4),
            reason: dto.reason,
          },
        },
      });

      // 5. Notify Customer
      await tx.notification.create({
        data: {
          userId: account.userId,
          title: `Account Balance ${isCredit ? 'Credit' : 'Debit'} Adjustment`,
          message: `Your account #${account.accountNumber} has received a manual ${dto.type.toLowerCase()} of ${account.currencyCode} ${adjustAmount.toFixed(2)}. Reason: ${dto.reason}`,
          type: 'ACCOUNT',
        },
      });

      return businessTx;
    });

    return {
      message: `Manual ${dto.type} adjustment executed successfully`,
      reference: adjustmentRef,
      transaction: result,
    };
  }

  /**
   * Process an authorized refund for a purchase, fee, or commercial transaction
   */
  async refundTransaction(transactionId: string, dto: RefundTransactionDto, adminId?: string) {
    const originalTx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        sourceAccount: true,
        destinationAccount: true,
        user: true,
      },
    });

    if (!originalTx) {
      throw new NotFoundException('Transaction not found');
    }

    if (originalTx.status !== TransactionStatus.SUCCESS) {
      throw new BadRequestException('Only successfully settled transactions are eligible for refund');
    }

    const refundAmount = dto.amount ? new Decimal(dto.amount) : new Decimal(originalTx.amount.toString());
    const originalAmount = new Decimal(originalTx.amount.toString());

    if (refundAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Refund amount must be greater than zero');
    }

    if (refundAmount.greaterThan(originalAmount)) {
      throw new BadRequestException(`Refund amount cannot exceed original transaction amount (${originalAmount.toFixed(2)})`);
    }

    const refundRef = CryptoUtil.generateTransactionReference('REF');
    const targetAccountId = originalTx.sourceAccountId || originalTx.destinationAccountId;

    if (!targetAccountId) {
      throw new BadRequestException('No valid bank account associated with this transaction for refund processing');
    }

    const account = await this.prisma.bankAccount.findUnique({ where: { id: targetAccountId } });
    if (!account) {
      throw new NotFoundException('Target refund account not found');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Credit the customer's bank account with the refund amount
      await tx.bankAccount.update({
        where: { id: account.id },
        data: {
          currentBalance: { increment: refundAmount.toFixed(4) },
          availableBalance: { increment: refundAmount.toFixed(4) },
          ledgerBalance: { increment: refundAmount.toFixed(4) },
        },
      });

      // 2. Create Refund Transaction record
      const refundTx = await tx.transaction.create({
        data: {
          reference: refundRef,
          userId: originalTx.userId,
          destinationAccountId: account.id,
          sourceAccountId: null,
          type: TransactionType.ADJUSTMENT_CREDIT,
          amount: refundAmount.toFixed(4),
          fee: '0.0000',
          netAmount: refundAmount.toFixed(4),
          currencyCode: originalTx.currencyCode,
          status: TransactionStatus.SUCCESS,
          description: `Refund for ${originalTx.reference}: ${dto.reason}`,
          metadata: {
            originalTransactionReference: originalTx.reference,
            originalTransactionId: originalTx.id,
            refundReason: dto.reason,
            authorizedBy: adminId || 'SYSTEM_REFUND',
          },
        },
      });

      // 3. Post Double-Entry Ledger Entries
      // Debit Merchant Payout/Operating Expense (5010), Credit Customer Liability (2010-<acc>)
      const customerLedgerAccountCode = `2010-${account.accountNumber}`;
      await this.ledgerService.postJournalEntry(
        tx,
        {
          reference: `JRN-${refundRef}`,
          transactionId: refundTx.id,
          description: `Refund for ${originalTx.reference}: ${dto.reason}`,
          entries: [
            {
              accountCode: '5010', // Operating Expense / Merchant Refund Clearing
              entryType: LedgerEntryType.DEBIT,
              amount: refundAmount.toFixed(4),
              currencyCode: originalTx.currencyCode,
            },
            {
              accountCode: customerLedgerAccountCode,
              entryType: LedgerEntryType.CREDIT,
              amount: refundAmount.toFixed(4),
              currencyCode: originalTx.currencyCode,
            },
          ],
        },
        adminId,
      );

      // 4. Create Audit Log
      await tx.auditLog.create({
        data: {
          actorId: adminId || null,
          actorRole: 'FINANCE_MANAGER',
          action: 'TRANSACTION_REFUND',
          resource: 'Transaction',
          resourceId: transactionId,
          beforeState: { reference: originalTx.reference, amount: originalTx.amount.toString() },
          afterState: {
            refundReference: refundRef,
            refundAmount: refundAmount.toFixed(4),
            reason: dto.reason,
          },
        },
      });

      // 5. Send Notification to Customer
      await tx.notification.create({
        data: {
          userId: originalTx.userId,
          title: 'Refund Processed',
          message: `A refund of ${originalTx.currencyCode} ${refundAmount.toFixed(2)} has been credited to your account #${account.accountNumber}. Reference: ${refundRef}`,
          type: 'PAYMENT',
        },
      });

      return refundTx;
    });

    return {
      message: 'Refund successfully processed and credited',
      refundReference: refundRef,
      transaction: result,
    };
  }
}

