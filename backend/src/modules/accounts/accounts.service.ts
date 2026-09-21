import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { AccountStatus, LedgerAccountType, Prisma, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountStatusDto } from './dto/update-account-status.dto';
import { UpdateAccountLimitsDto } from './dto/update-account-limits.dto';
import { QueryStatementDto } from './dto/query-statement.dto';
import { StatementGeneratorUtil } from '../../common/utils/statement-generator.util';

@Injectable()
export class AccountsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get comprehensive Customer Dashboard financial summary
   */
  async getDashboardSummary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        bankAccounts: {
          include: {
            currency: true,
          },
        },
        savingsAccounts: {
          where: { status: 'ACTIVE' },
        },
        loanApplications: {
          where: { status: 'ACTIVE' },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    let totalBalance = new Decimal(0);
    let availableBalance = new Decimal(0);
    let ledgerBalance = new Decimal(0);
    let savingsBalance = new Decimal(0);
    let loanBalance = new Decimal(0);

    for (const acc of user.bankAccounts) {
      if (acc.status === AccountStatus.ACTIVE) {
        totalBalance = totalBalance.plus(new Decimal(acc.currentBalance.toString()));
        availableBalance = availableBalance.plus(new Decimal(acc.availableBalance.toString()));
        ledgerBalance = ledgerBalance.plus(new Decimal(acc.ledgerBalance.toString()));
      }
    }

    for (const sav of user.savingsAccounts) {
      savingsBalance = savingsBalance.plus(new Decimal(sav.currentAmount.toString()));
    }

    for (const loan of user.loanApplications) {
      loanBalance = loanBalance.plus(new Decimal(loan.outstandingBalance.toString()));
    }

    // Fetch recent transactions (10 most recent)
    const recentTransactions = await this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        sourceAccount: { select: { accountNumber: true, accountName: true } },
        destinationAccount: { select: { accountNumber: true, accountName: true } },
      },
    });

    // Compute 30-day cash flow & breakdown
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const monthlyTransactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        status: TransactionStatus.SUCCESS,
        createdAt: { gte: thirtyDaysAgo },
      },
    });

    let monthlyIncome = new Decimal(0);
    let monthlyExpenses = new Decimal(0);
    let monthlyDeposits = new Decimal(0);
    let monthlyWithdrawals = new Decimal(0);
    let monthlyTransfers = new Decimal(0);

    for (const tx of monthlyTransactions) {
      const amount = new Decimal(tx.amount.toString());
      if (tx.type === 'DEPOSIT' || tx.type === 'LOAN_DISBURSEMENT') {
        monthlyIncome = monthlyIncome.plus(amount);
        if (tx.type === 'DEPOSIT') {
          monthlyDeposits = monthlyDeposits.plus(amount);
        }
      } else if (
        tx.type === 'WITHDRAWAL' ||
        tx.type === 'TRANSFER_INTERNAL' ||
        tx.type === 'TRANSFER_EXTERNAL' ||
        tx.type === 'CARD_PURCHASE'
      ) {
        monthlyExpenses = monthlyExpenses.plus(amount).plus(new Decimal(tx.fee.toString()));
        if (tx.type === 'WITHDRAWAL') {
          monthlyWithdrawals = monthlyWithdrawals.plus(amount);
        } else if (tx.type === 'TRANSFER_INTERNAL' || tx.type === 'TRANSFER_EXTERNAL') {
          monthlyTransfers = monthlyTransfers.plus(amount);
        }
      }
    }

    // Aggregate lifetime deposit, withdrawal, and transfer totals
    const allSuccessfulTransactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        status: TransactionStatus.SUCCESS,
      },
      select: {
        type: true,
        amount: true,
        fee: true,
      },
    });

    let totalDeposits = new Decimal(0);
    let depositCount = 0;
    let totalWithdrawals = new Decimal(0);
    let withdrawalCount = 0;
    let totalTransfers = new Decimal(0);
    let transferCount = 0;

    for (const tx of allSuccessfulTransactions) {
      const amt = new Decimal(tx.amount.toString());
      if (tx.type === 'DEPOSIT') {
        totalDeposits = totalDeposits.plus(amt);
        depositCount++;
      } else if (tx.type === 'WITHDRAWAL') {
        totalWithdrawals = totalWithdrawals.plus(amt);
        withdrawalCount++;
      } else if (tx.type === 'TRANSFER_INTERNAL' || tx.type === 'TRANSFER_EXTERNAL') {
        totalTransfers = totalTransfers.plus(amt);
        transferCount++;
      }
    }

    // Fetch Cards & Unread Notifications
    const [cards, unreadNotificationsCount, recentNotifications] = await Promise.all([
      this.prisma.card.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({
        where: { userId, isRead: false },
      }),
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    // Build 6-Month Chart Inflow/Outflow Trends
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const chartLabels: string[] = [];
    const chartInflows: number[] = [];
    const chartOutflows: number[] = [];
    const chartNets: number[] = [];

    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

      chartLabels.push(`${monthNames[d.getMonth()]} ${d.getFullYear().toString().slice(-2)}`);

      let monthInflow = new Decimal(0);
      let monthOutflow = new Decimal(0);

      // Aggregate transactions in this historical month
      for (const tx of allSuccessfulTransactions) {
        // (If created timestamp matches month range)
      }

      chartInflows.push(0);
      chartOutflows.push(0);
      chartNets.push(0);
    }

    // Compute actual historical monthly values
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const historicalTxs = await this.prisma.transaction.findMany({
      where: {
        userId,
        status: TransactionStatus.SUCCESS,
        createdAt: { gte: sixMonthsAgo },
      },
      select: {
        type: true,
        amount: true,
        fee: true,
        createdAt: true,
      },
    });

    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

      let inflow = new Decimal(0);
      let outflow = new Decimal(0);

      for (const tx of historicalTxs) {
        if (tx.createdAt >= start && tx.createdAt <= end) {
          const amt = new Decimal(tx.amount.toString());
          if (tx.type === 'DEPOSIT' || tx.type === 'LOAN_DISBURSEMENT') {
            inflow = inflow.plus(amt);
          } else if (
            tx.type === 'WITHDRAWAL' ||
            tx.type === 'TRANSFER_INTERNAL' ||
            tx.type === 'TRANSFER_EXTERNAL' ||
            tx.type === 'CARD_PURCHASE'
          ) {
            outflow = outflow.plus(amt).plus(new Decimal(tx.fee.toString()));
          }
        }
      }

      chartInflows[i] = parseFloat(inflow.toFixed(2));
      chartOutflows[i] = parseFloat(outflow.toFixed(2));
      chartNets[i] = parseFloat(inflow.minus(outflow).toFixed(2));
    }

    const primaryAccount = user.bankAccounts[0] || null;
    const pendingBalance = ledgerBalance.minus(availableBalance).isPositive()
      ? ledgerBalance.minus(availableBalance)
      : new Decimal(0);

    return {
      // Primary overview
      currentBalance: totalBalance.toFixed(4),
      availableBalance: availableBalance.toFixed(4),
      pendingBalance: pendingBalance.toFixed(4),
      ledgerBalance: ledgerBalance.toFixed(4),
      accountNumber: primaryAccount?.accountNumber || '',
      accountType: primaryAccount?.type || 'CHECKING',
      currency: primaryAccount?.currencyCode || 'USD',
      savingsBalance: savingsBalance.toFixed(4),
      loanBalance: loanBalance.toFixed(4),

      // Totals & Financial Statistics
      totals: {
        totalBalance: totalBalance.toFixed(4),
        availableBalance: availableBalance.toFixed(4),
        pendingBalance: pendingBalance.toFixed(4),
        ledgerBalance: ledgerBalance.toFixed(4),
        totalDeposits: totalDeposits.toFixed(4),
        depositCount,
        totalWithdrawals: totalWithdrawals.toFixed(4),
        withdrawalCount,
        totalTransfers: totalTransfers.toFixed(4),
        transferCount,
        savingsBalance: savingsBalance.toFixed(4),
        loanBalance: loanBalance.toFixed(4),
      },

      financialStats: {
        monthlyIncome: monthlyIncome.toFixed(4),
        monthlyExpenses: monthlyExpenses.toFixed(4),
        netCashFlow: monthlyIncome.minus(monthlyExpenses).toFixed(4),
        monthlyDeposits: monthlyDeposits.toFixed(4),
        monthlyWithdrawals: monthlyWithdrawals.toFixed(4),
        monthlyTransfers: monthlyTransfers.toFixed(4),
        totalTransactionsCount: allSuccessfulTransactions.length,
      },

      monthlyCashFlow: {
        monthlyIncome: monthlyIncome.toFixed(4),
        monthlyExpenses: monthlyExpenses.toFixed(4),
        netCashFlow: monthlyIncome.minus(monthlyExpenses).toFixed(4),
      },

      // Accounts list
      accounts: user.bankAccounts.map((acc) => ({
        id: acc.id,
        accountNumber: acc.accountNumber,
        accountName: acc.accountName,
        type: acc.type,
        currency: acc.currencyCode,
        currencyCode: acc.currencyCode,
        currentBalance: acc.currentBalance,
        availableBalance: acc.availableBalance,
        ledgerBalance: acc.ledgerBalance,
        status: acc.status,
        isFrozen: acc.isFrozen,
      })),

      // Cards
      cards: cards.map((c) => ({
        id: c.id,
        maskedNumber: c.maskedPan,
        maskedPan: c.maskedPan,
        cardholderName: c.cardHolderName,
        cardHolderName: c.cardHolderName,
        type: c.cardType,
        cardType: c.cardType,
        brand: c.brand,
        expiryMonth: c.expiryMonth,
        expiryYear: c.expiryYear,
        status: c.status,
        isFrozen: c.isFrozen,
        dailyLimit: c.spendingLimitDaily,
        monthlyLimit: c.spendingLimitMonthly,
        spendingLimitDaily: c.spendingLimitDaily,
        spendingLimitMonthly: c.spendingLimitMonthly,
      })),
      totalCards: cards.length,
      activeCardsCount: cards.filter((c) => c.status === 'ACTIVE' && !c.isFrozen).length,

      // Notifications
      notifications: {
        unreadCount: unreadNotificationsCount,
        recent: recentNotifications,
      },

      // Chart Trends
      charts: {
        labels: chartLabels,
        inflow: chartInflows,
        outflow: chartOutflows,
        net: chartNets,
      },

      recentTransactions,
    };
  }

  /**
   * Open an additional bank account for an authenticated customer
   */
  async createAccount(userId: string, dto: CreateAccountDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const currency = await this.prisma.currency.findUnique({
      where: { code: dto.currency.toUpperCase() },
    });

    if (!currency || !currency.isActive) {
      throw new BadRequestException(`Currency ${dto.currency} is currently not supported or inactive`);
    }

    const accountNumber = CryptoUtil.generateAccountNumber();
    const accountName = dto.accountName || `${user.profile?.firstName || user.username}'s ${dto.type} Account`;

    const newAccount = await this.prisma.$transaction(async (tx) => {
      // 1. Create Bank Account
      const acc = await tx.bankAccount.create({
        data: {
          userId,
          accountNumber,
          accountName,
          type: dto.type,
          currencyCode: currency.code,
          status: AccountStatus.ACTIVE,
          currentBalance: 0.0000,
          availableBalance: 0.0000,
          ledgerBalance: 0.0000,
        },
      });

      // 2. Create Corresponding Liability Ledger Account in Chart of Accounts
      await tx.ledgerAccount.create({
        data: {
          accountCode: `2010-${accountNumber}`,
          name: `Liability - ${accountName}`,
          type: LedgerAccountType.LIABILITY,
          currencyCode: currency.code,
          bankAccountId: acc.id,
        },
      });

      // 3. Notification
      await tx.notification.create({
        data: {
          userId,
          title: 'New Account Opened',
          message: `Your new ${dto.type} account #${accountNumber} (${currency.code}) is ready to use.`,
          type: 'ACCOUNT',
        },
      });

      return acc;
    });

    return {
      message: 'Bank account opened successfully',
      account: newAccount,
    };
  }

  /**
   * Get specific bank account details and balances
   */
  async getAccountDetails(userId: string, accountId: string) {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
      include: {
        currency: true,
        cards: true,
        savings: true,
      },
    });

    if (!account) {
      throw new NotFoundException('Bank account not found');
    }

    if (account.userId !== userId) {
      throw new ForbiddenException('You do not have access to this account');
    }

    return account;
  }

  /**
   * Extract account transaction statement with opening & closing balances
   */
  async getAccountStatement(userId: string, accountId: string, queryDto: QueryStatementDto) {
    const account = await this.prisma.bankAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException('Bank account not found');
    }

    if (account.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const { page = 1, limit = 50, startDate, endDate, type, search, direction = 'ALL' } = queryDto;
    const skip = (page - 1) * limit;

    const andConditions: Prisma.TransactionWhereInput[] = [
      { status: TransactionStatus.SUCCESS },
    ];

    if (direction === 'DEBIT') {
      andConditions.push({ sourceAccountId: accountId });
    } else if (direction === 'CREDIT') {
      andConditions.push({ destinationAccountId: accountId });
    } else {
      andConditions.push({
        OR: [{ sourceAccountId: accountId }, { destinationAccountId: accountId }],
      });
    }

    if (type) {
      andConditions.push({ type });
    }

    if (search && search.trim()) {
      const q = search.trim();
      andConditions.push({
        OR: [
          { description: { contains: q } },
          { reference: { contains: q } },
        ],
      });
    }

    if (startDate || endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);
      andConditions.push({ createdAt: dateFilter });
    }

    const where: Prisma.TransactionWhereInput = { AND: andConditions };

    const [transactions, total, allPeriodTxs] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        select: { sourceAccountId: true, amount: true, fee: true },
      }),
    ]);

    let totalDebits = new Decimal(0);
    let totalCredits = new Decimal(0);

    for (const tx of allPeriodTxs) {
      const amt = new Decimal(tx.amount.toString());
      if (tx.sourceAccountId === accountId) {
        totalDebits = totalDebits.plus(amt).plus(new Decimal(tx.fee?.toString() || '0'));
      } else {
        totalCredits = totalCredits.plus(amt);
      }
    }

    const enrichedTransactions = transactions.map((tx) => {
      const isDebit = tx.sourceAccountId === accountId;
      return {
        ...tx,
        direction: isDebit ? ('DEBIT' as const) : ('CREDIT' as const),
        netAmount: isDebit ? `-${tx.amount}` : `+${tx.amount}`,
      };
    });

    return {
      account: {
        id: account.id,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        type: account.type,
        currency: account.currencyCode,
        currentBalance: account.currentBalance,
        availableBalance: account.availableBalance,
        ledgerBalance: account.ledgerBalance,
      },
      summary: {
        totalCredits: totalCredits.toFixed(4),
        totalDebits: totalDebits.toFixed(4),
        netMovement: totalCredits.minus(totalDebits).toFixed(4),
        transactionsCount: total,
      },
      transactions: enrichedTransactions,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Admin: Freeze or update bank account status with audit log
   */
  async updateAccountStatus(accountId: string, dto: UpdateAccountStatusDto, adminId?: string) {
    const account = await this.prisma.bankAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException('Bank account not found');
    }

    const previousStatus = account.status;
    const isFrozen = dto.status === AccountStatus.FROZEN || dto.status === AccountStatus.SUSPENDED;

    await this.prisma.$transaction(async (tx) => {
      await tx.bankAccount.update({
        where: { id: accountId },
        data: {
          status: dto.status,
          isFrozen,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId || null,
          actorRole: 'ADMIN',
          action: `BANK_ACCOUNT_STATUS_${dto.status}`,
          resource: 'BankAccount',
          resourceId: accountId,
          beforeState: { status: previousStatus },
          afterState: { status: dto.status, reason: dto.reason || null },
        },
      });
    });

    return {
      message: `Account status updated to ${dto.status}`,
      accountId,
      status: dto.status,
      isFrozen,
    };
  }

  /**
   * Admin: Update daily transfer and withdrawal limits
   */
  async updateAccountLimits(accountId: string, dto: UpdateAccountLimitsDto, adminId?: string) {
    const account = await this.prisma.bankAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException('Bank account not found');
    }

    const updateData: Record<string, any> = {};
    if (dto.dailyTransferLimit) {
      updateData.dailyTransferLimit = new Decimal(dto.dailyTransferLimit).toFixed(4);
    }
    if (dto.dailyWithdrawalLimit) {
      updateData.dailyWithdrawalLimit = new Decimal(dto.dailyWithdrawalLimit).toFixed(4);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bankAccount.update({
        where: { id: accountId },
        data: updateData,
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId || null,
          actorRole: 'ADMIN',
          action: 'BANK_ACCOUNT_LIMITS_UPDATE',
          resource: 'BankAccount',
          resourceId: accountId,
          beforeState: {
            dailyTransferLimit: account.dailyTransferLimit.toString(),
            dailyWithdrawalLimit: account.dailyWithdrawalLimit.toString(),
          },
          afterState: updateData,
        },
      });
    });

    return {
      message: 'Account limits updated successfully',
      accountId,
      limits: updateData,
    };
  }

  /**
   * Export RFC-4180 compliant CSV statement for account
   */
  /**
   * Export RFC-4180 compliant CSV statement for account with search, direction and date filters
   */
  async exportStatementCsv(userId: string, accountId: string, queryDto: QueryStatementDto): Promise<{ filename: string; csv: string }> {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
      include: { user: { include: { profile: true } } },
    });

    if (!account) {
      throw new NotFoundException('Bank account not found');
    }

    if (account.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const { startDate, endDate, type, search, direction = 'ALL' } = queryDto;
    const andConditions: Prisma.TransactionWhereInput[] = [
      { status: TransactionStatus.SUCCESS },
    ];

    if (direction === 'DEBIT') {
      andConditions.push({ sourceAccountId: accountId });
    } else if (direction === 'CREDIT') {
      andConditions.push({ destinationAccountId: accountId });
    } else {
      andConditions.push({
        OR: [{ sourceAccountId: accountId }, { destinationAccountId: accountId }],
      });
    }

    if (type) andConditions.push({ type });
    if (search && search.trim()) {
      const q = search.trim();
      andConditions.push({
        OR: [
          { description: { contains: q } },
          { reference: { contains: q } },
        ],
      });
    }

    if (startDate || endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);
      andConditions.push({ createdAt: dateFilter });
    }

    const transactions = await this.prisma.transaction.findMany({
      where: { AND: andConditions },
      orderBy: { createdAt: 'asc' },
    });

    let totalDebits = new Decimal(0);
    let totalCredits = new Decimal(0);

    const statementTxs = transactions.map((tx) => {
      const isDebit = tx.sourceAccountId === accountId;
      const amt = new Decimal(tx.amount.toString());
      if (isDebit) {
        totalDebits = totalDebits.plus(amt);
      } else {
        totalCredits = totalCredits.plus(amt);
      }
      return {
        id: tx.id,
        reference: tx.reference,
        date: tx.createdAt,
        description: tx.description || `${tx.type} Transaction`,
        amount: tx.amount.toString(),
        type: isDebit ? ('DEBIT' as const) : ('CREDIT' as const),
        currency: account.currencyCode,
      };
    });

    const accountHolder = `${account.user.profile?.firstName || ''} ${account.user.profile?.lastName || ''}`.trim() || account.user.username;
    const fromDateStr = startDate ? new Date(startDate).toISOString().slice(0, 10) : 'Inception';
    const toDateStr = endDate ? new Date(endDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

    const csv = StatementGeneratorUtil.generateCsvStatement({
      accountHolder,
      accountNumber: account.accountNumber,
      accountType: account.type,
      currency: account.currencyCode,
      startDate,
      endDate,
      openingBalance: account.currentBalance.toString(),
      closingBalance: account.availableBalance.toString(),
      totalCredits: totalCredits.toFixed(4),
      totalDebits: totalDebits.toFixed(4),
      transactions: statementTxs,
    });

    const filename = `silverhawk_statement_${account.accountNumber}_${fromDateStr}_to_${toDateStr}.csv`;
    return { filename, csv };
  }

  /**
   * Export authentic certified binary PDF statement for account
   */
  async exportStatementPdf(userId: string, accountId: string, queryDto: QueryStatementDto): Promise<{ filename: string; buffer: Buffer }> {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
      include: { user: { include: { profile: true } } },
    });

    if (!account) {
      throw new NotFoundException('Bank account not found');
    }

    if (account.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const { startDate, endDate, type, search, direction = 'ALL' } = queryDto;
    const andConditions: Prisma.TransactionWhereInput[] = [
      { status: TransactionStatus.SUCCESS },
    ];

    if (direction === 'DEBIT') {
      andConditions.push({ sourceAccountId: accountId });
    } else if (direction === 'CREDIT') {
      andConditions.push({ destinationAccountId: accountId });
    } else {
      andConditions.push({
        OR: [{ sourceAccountId: accountId }, { destinationAccountId: accountId }],
      });
    }

    if (type) andConditions.push({ type });
    if (search && search.trim()) {
      const q = search.trim();
      andConditions.push({
        OR: [
          { description: { contains: q } },
          { reference: { contains: q } },
        ],
      });
    }

    if (startDate || endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);
      andConditions.push({ createdAt: dateFilter });
    }

    const transactions = await this.prisma.transaction.findMany({
      where: { AND: andConditions },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    let totalDebits = new Decimal(0);
    let totalCredits = new Decimal(0);

    const statementTxs = transactions.map((tx) => {
      const isDebit = tx.sourceAccountId === accountId;
      const amt = new Decimal(tx.amount.toString());
      if (isDebit) {
        totalDebits = totalDebits.plus(amt);
      } else {
        totalCredits = totalCredits.plus(amt);
      }
      return {
        id: tx.id,
        reference: tx.reference,
        date: tx.createdAt,
        description: tx.description || `${tx.type} Transaction`,
        amount: tx.amount.toString(),
        type: isDebit ? ('DEBIT' as const) : ('CREDIT' as const),
        currency: account.currencyCode,
      };
    });

    const accountHolder = `${account.user.profile?.firstName || ''} ${account.user.profile?.lastName || ''}`.trim() || account.user.username;
    const fromDateStr = startDate ? new Date(startDate).toISOString().slice(0, 10) : 'Inception';
    const toDateStr = endDate ? new Date(endDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

    const pdfBuffer = StatementGeneratorUtil.generatePdfStatement({
      accountHolder,
      accountNumber: account.accountNumber,
      accountType: account.type,
      currency: account.currencyCode,
      startDate,
      endDate,
      openingBalance: account.currentBalance.toString(),
      closingBalance: account.availableBalance.toString(),
      totalCredits: totalCredits.toFixed(4),
      totalDebits: totalDebits.toFixed(4),
      transactions: statementTxs,
    });

    const filename = `silverhawk_statement_${account.accountNumber}_${fromDateStr}_to_${toDateStr}.pdf`;
    return { filename, buffer: pdfBuffer };
  }
}

