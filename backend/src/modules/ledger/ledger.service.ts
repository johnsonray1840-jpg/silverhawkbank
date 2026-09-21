import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { LedgerAccountType, LedgerEntryType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PostJournalDto } from './dto/post-journal.dto';
import { CreateLedgerAccountDto } from './dto/create-ledger-account.dto';
import { QueryLedgerDto } from './dto/query-ledger.dto';

@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  /**
   * Post a balanced double-entry journal transaction within an interactive Prisma transaction
   */
  async postJournalEntry(
    tx: Prisma.TransactionClient,
    dto: PostJournalDto,
    createdBy?: string,
  ) {
    if (!dto.entries || dto.entries.length < 2) {
      throw new BadRequestException('A double-entry journal must contain at least two entries');
    }

    let totalDebits = new Decimal(0);
    let totalCredits = new Decimal(0);

    for (const entry of dto.entries) {
      const amount = new Decimal(entry.amount);
      if (amount.lessThanOrEqualTo(0)) {
        throw new BadRequestException('Entry amounts must be strictly positive');
      }

      if (entry.entryType === LedgerEntryType.DEBIT) {
        totalDebits = totalDebits.plus(amount);
      } else if (entry.entryType === LedgerEntryType.CREDIT) {
        totalCredits = totalCredits.plus(amount);
      }
    }

    // Strict Double-Entry Balanced Equation Check: Debits MUST equal Credits
    if (!totalDebits.equals(totalCredits)) {
      throw new BadRequestException(
        `UNBALANCED_JOURNAL_ENTRY: Total Debits (${totalDebits.toFixed(4)}) must equal Total Credits (${totalCredits.toFixed(4)})`,
      );
    }

    // 1. Create Journal Transaction header
    const journalTx = await tx.journalTransaction.create({
      data: {
        reference: dto.reference,
        transactionId: dto.transactionId || null,
        description: dto.description,
        createdBy: createdBy || null,
      },
    });

    // 2. Resolve Ledger Accounts and create Ledger Entries
    for (const entry of dto.entries) {
      const ledgerAccount = await tx.ledgerAccount.findUnique({
        where: { accountCode: entry.accountCode },
      });

      if (!ledgerAccount) {
        throw new NotFoundException(`Ledger account code ${entry.accountCode} not found in Chart of Accounts`);
      }

      await tx.ledgerEntry.create({
        data: {
          journalTransactionId: journalTx.id,
          ledgerAccountId: ledgerAccount.id,
          entryType: entry.entryType,
          amount: new Decimal(entry.amount).toFixed(4),
          currencyCode: entry.currencyCode,
          exchangeRate: entry.exchangeRate ? new Decimal(entry.exchangeRate).toFixed(6) : '1.000000',
        },
      });
    }

    return journalTx;
  }

  /**
   * Create or register a new Ledger Account in Chart of Accounts
   */
  async createLedgerAccount(dto: CreateLedgerAccountDto) {
    const existing = await this.prisma.ledgerAccount.findUnique({
      where: { accountCode: dto.accountCode },
    });

    if (existing) {
      throw new BadRequestException(`Ledger account ${dto.accountCode} already exists`);
    }

    return this.prisma.ledgerAccount.create({
      data: {
        accountCode: dto.accountCode,
        name: dto.name,
        type: dto.type,
        currencyCode: dto.currencyCode,
        bankAccountId: dto.bankAccountId || null,
      },
    });
  }

  /**
   * Get complete Chart of Accounts
   */
  async getChartOfAccounts() {
    const accounts = await this.prisma.ledgerAccount.findMany({
      orderBy: { accountCode: 'asc' },
      include: {
        bankAccount: {
          select: {
            accountNumber: true,
            accountName: true,
          },
        },
      },
    });

    return accounts;
  }

  /**
   * Generate live Trial Balance from all ledger entries
   */
  async getTrialBalance() {
    const ledgerAccounts = await this.prisma.ledgerAccount.findMany({
      include: {
        entries: true,
      },
      orderBy: { accountCode: 'asc' },
    });

    let grandTotalDebits = new Decimal(0);
    let grandTotalCredits = new Decimal(0);

    const report = ledgerAccounts.map((account) => {
      let debitSum = new Decimal(0);
      let creditSum = new Decimal(0);

      for (const entry of account.entries) {
        if (entry.entryType === LedgerEntryType.DEBIT) {
          debitSum = debitSum.plus(new Decimal(entry.amount.toString()));
        } else {
          creditSum = creditSum.plus(new Decimal(entry.amount.toString()));
        }
      }

      grandTotalDebits = grandTotalDebits.plus(debitSum);
      grandTotalCredits = grandTotalCredits.plus(creditSum);

      // Normal balance by account type
      let netBalance = new Decimal(0);
      if (
        account.type === LedgerAccountType.ASSET ||
        account.type === LedgerAccountType.EXPENSE
      ) {
        netBalance = debitSum.minus(creditSum);
      } else {
        netBalance = creditSum.minus(debitSum);
      }

      return {
        accountCode: account.accountCode,
        name: account.name,
        type: account.type,
        currency: account.currencyCode,
        totalDebit: debitSum.toFixed(4),
        totalCredit: creditSum.toFixed(4),
        netBalance: netBalance.toFixed(4),
      };
    });

    return {
      trialBalance: report,
      grandTotalDebits: grandTotalDebits.toFixed(4),
      grandTotalCredits: grandTotalCredits.toFixed(4),
      isBalanced: grandTotalDebits.equals(grandTotalCredits),
      generatedAt: new Date(),
    };
  }

  /**
   * Generate live Balance Sheet (Assets = Liabilities + Equity)
   */
  async getBalanceSheet() {
    const trialBalanceData = await this.getTrialBalance();

    const assets = trialBalanceData.trialBalance.filter((a) => a.type === LedgerAccountType.ASSET);
    const liabilities = trialBalanceData.trialBalance.filter((a) => a.type === LedgerAccountType.LIABILITY);
    const equity = trialBalanceData.trialBalance.filter((a) => a.type === LedgerAccountType.EQUITY);

    const sumCategory = (items: typeof assets) =>
      items.reduce((acc, curr) => acc.plus(new Decimal(curr.netBalance)), new Decimal(0));

    const totalAssets = sumCategory(assets);
    const totalLiabilities = sumCategory(liabilities);
    const totalEquity = sumCategory(equity);

    return {
      assets: { items: assets, total: totalAssets.toFixed(4) },
      liabilities: { items: liabilities, total: totalLiabilities.toFixed(4) },
      equity: { items: equity, total: totalEquity.toFixed(4) },
      liabilitiesAndEquityTotal: totalLiabilities.plus(totalEquity).toFixed(4),
      isBalanced: totalAssets.equals(totalLiabilities.plus(totalEquity)),
      generatedAt: new Date(),
    };
  }

  /**
   * Reconcile a Bank Account against its underlying Double-Entry Ledger entries
   */
  async reconcileBankAccount(bankAccountId: string) {
    const bankAccount = await this.prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
      include: {
        ledgerAccount: {
          include: {
            entries: true,
          },
        },
      },
    });

    if (!bankAccount) {
      throw new NotFoundException('Bank account not found');
    }

    if (!bankAccount.ledgerAccount) {
      return {
        bankAccountId,
        accountNumber: bankAccount.accountNumber,
        isReconciled: false,
        message: 'No corresponding General Ledger account linked',
      };
    }

    let creditSum = new Decimal(0);
    let debitSum = new Decimal(0);

    for (const entry of bankAccount.ledgerAccount.entries) {
      if (entry.entryType === LedgerEntryType.CREDIT) {
        creditSum = creditSum.plus(new Decimal(entry.amount.toString()));
      } else {
        debitSum = debitSum.plus(new Decimal(entry.amount.toString()));
      }
    }

    // Customer Deposit liability balance: Credit entries increase liability, Debit entries decrease it
    const ledgerCalculatedBalance = creditSum.minus(debitSum);
    const currentCachedBalance = new Decimal(bankAccount.currentBalance.toString());

    const isReconciled = ledgerCalculatedBalance.equals(currentCachedBalance);

    return {
      bankAccountId,
      accountNumber: bankAccount.accountNumber,
      accountName: bankAccount.accountName,
      cachedCurrentBalance: currentCachedBalance.toFixed(4),
      ledgerDerivedBalance: ledgerCalculatedBalance.toFixed(4),
      discrepancy: currentCachedBalance.minus(ledgerCalculatedBalance).toFixed(4),
      isReconciled,
      totalEntries: bankAccount.ledgerAccount.entries.length,
      reconciledAt: new Date(),
    };
  }

  /**
   * Paginated query of Journal Transactions
   */
  async getJournalTransactions(queryDto: QueryLedgerDto) {
    const { page = 1, limit = 20, accountCode, startDate, endDate } = queryDto;
    const skip = (page - 1) * limit;

    const where: Prisma.JournalTransactionWhereInput = {};

    if (startDate || endDate) {
      where.postedAt = {};
      if (startDate) where.postedAt.gte = new Date(startDate);
      if (endDate) where.postedAt.lte = new Date(endDate);
    }

    if (accountCode) {
      where.entries = {
        some: {
          ledgerAccount: {
            accountCode,
          },
        },
      };
    }

    const [journals, total] = await Promise.all([
      this.prisma.journalTransaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { postedAt: 'desc' },
        include: {
          entries: {
            include: {
              ledgerAccount: {
                select: {
                  accountCode: true,
                  name: true,
                  type: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.journalTransaction.count({ where }),
    ]);

    return {
      data: journals,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Post a compensating Reversal Journal Transaction for an existing journal entry
   * Historical records are never deleted; an equal-and-opposite journal is posted.
   */
  async reverseJournalTransaction(
    tx: Prisma.TransactionClient,
    originalJournalId: string,
    reason: string,
    reversedBy?: string,
  ) {
    const original = await tx.journalTransaction.findUnique({
      where: { id: originalJournalId },
      include: {
        entries: {
          include: { ledgerAccount: true },
        },
      },
    });

    if (!original) {
      throw new NotFoundException(`Original journal transaction #${originalJournalId} not found`);
    }

    const reversalRef = `REV-${original.reference}-${Date.now().toString().slice(-6)}`;

    // Create reversing journal transaction header
    const reversalJournal = await tx.journalTransaction.create({
      data: {
        reference: reversalRef,
        transactionId: original.transactionId,
        description: `REVERSAL of ${original.reference}: ${reason}`,
        createdBy: reversedBy || null,
      },
    });

    // Invert all entries: DEBIT -> CREDIT, CREDIT -> DEBIT
    for (const entry of original.entries) {
      const invertedType =
        entry.entryType === LedgerEntryType.DEBIT
          ? LedgerEntryType.CREDIT
          : LedgerEntryType.DEBIT;

      await tx.ledgerEntry.create({
        data: {
          journalTransactionId: reversalJournal.id,
          ledgerAccountId: entry.ledgerAccountId,
          entryType: invertedType,
          amount: entry.amount,
          currencyCode: entry.currencyCode,
          exchangeRate: entry.exchangeRate,
        },
      });
    }

    return reversalJournal;
  }
}

