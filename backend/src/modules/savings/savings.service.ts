import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { EmailService } from '../email/email.service';
import {
  CreateSavingsDto,
  TopUpSavingsDto,
  WithdrawSavingsDto,
  CreateSavingsGoalDto,
  CompoundCalculatorDto,
  ToggleRoundUpDto,
  AccrueInterestDto,
  ProcessRoundUpSweepDto,
  CreateFixedDepositDto,
  FixedDepositCalculatorDto,
} from './dto/create-savings.dto';
import {
  AccountStatus,
  LedgerEntryType,
  SavingsStatus,
  SavingsType,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { SavingsGoalUtil, CompoundingFrequency } from '../../common/utils/savings-goal.util';
import { FixedDepositUtil } from '../../common/utils/fixed-deposit.util';


@Injectable()
export class SavingsService {
  private readonly logger = new Logger(SavingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Determine dynamic annual interest rate based on savings type & tenure
   */
  private calculateInterestRate(type: SavingsType, durationMonths?: number): Decimal {
    if (type === SavingsType.REGULAR) {
      return new Decimal('4.50'); // 4.50% p.a.
    }
    if (type === SavingsType.TARGET) {
      return new Decimal('6.50'); // 6.50% p.a.
    }
    if (type === SavingsType.FIXED_DEPOSIT) {
      const months = durationMonths || 3;
      if (months <= 3) return new Decimal('8.50');
      if (months <= 6) return new Decimal('10.50');
      if (months <= 12) return new Decimal('12.50');
      return new Decimal('15.00'); // > 12 months term deposit
    }
    return new Decimal('5.00');
  }

  /**
   * Calculate accrued interest to date
   */
  private calculateAccruedInterest(
    principal: Decimal,
    ratePct: Decimal,
    startDate: Date,
    targetDate: Date = new Date(),
  ): Decimal {
    const msInDay = 1000 * 60 * 60 * 24;
    const daysElapsed = Math.max(0, Math.floor((targetDate.getTime() - startDate.getTime()) / msInDay));
    const annualRate = ratePct.dividedBy(100);
    // Simple daily accrual: Principal * (Rate / 365) * Days
    const interest = principal.times(annualRate.dividedBy(365)).times(daysElapsed);
    return interest.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  }

  /**
   * Create a new savings account or term lockup
   */
  async createSavings(userId: string, dto: CreateSavingsDto) {
    const bankAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.accountId },
    });

    if (!bankAccount || bankAccount.userId !== userId) {
      throw new ForbiddenException('Invalid funding bank account');
    }

    if (bankAccount.status !== AccountStatus.ACTIVE || bankAccount.isFrozen) {
      throw new ForbiddenException('Funding bank account is frozen or inactive');
    }

    if (dto.type === SavingsType.FIXED_DEPOSIT && !dto.durationMonths) {
      throw new BadRequestException('Duration in months is mandatory for Fixed Term Deposits');
    }

    const startDate = new Date();
    let maturityDate: Date | null = null;
    if (dto.durationMonths && dto.durationMonths > 0) {
      maturityDate = new Date(startDate);
      maturityDate.setMonth(maturityDate.getMonth() + dto.durationMonths);
    }

    const interestRate = this.calculateInterestRate(dto.type, dto.durationMonths);
    const initialDeposit = dto.initialDeposit ? new Decimal(dto.initialDeposit) : new Decimal('0.0000');

    if (initialDeposit.lessThan(0)) {
      throw new BadRequestException('Initial deposit cannot be negative');
    }

    if (dto.type === SavingsType.FIXED_DEPOSIT && initialDeposit.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Fixed Term Deposits require an initial deposit amount');
    }

    const targetAmount = dto.targetAmount ? new Decimal(dto.targetAmount).toFixed(4) : null;
    const autoDebitAmount = dto.autoDebitAmount ? new Decimal(dto.autoDebitAmount).toFixed(4) : null;

    const result = await this.prisma.$transaction(async (tx) => {
      // If initial deposit > 0, deduct from bank account and lock in savings
      if (initialDeposit.greaterThan(0)) {
        const availableBalance = new Decimal(bankAccount.availableBalance.toString());
        if (availableBalance.lessThan(initialDeposit)) {
          throw new BadRequestException('INSUFFICIENT_FUNDS: Available balance is insufficient for initial deposit');
        }

        // Deduct from bank account
        await tx.bankAccount.update({
          where: { id: bankAccount.id },
          data: {
            currentBalance: { decrement: initialDeposit.toFixed(4) },
            availableBalance: { decrement: initialDeposit.toFixed(4) },
            ledgerBalance: { decrement: initialDeposit.toFixed(4) },
          },
        });
      }

      // Create Savings Account record
      const savingsAccount = await tx.savingsAccount.create({
        data: {
          userId,
          accountId: bankAccount.id,
          type: dto.type,
          title: dto.title,
          targetAmount,
          currentAmount: initialDeposit.toFixed(4),
          interestRate: interestRate.toFixed(2),
          startDate,
          maturityDate,
          autoDebitFrequency: dto.autoDebitFrequency || 'NONE',
          autoDebitAmount,
          status: SavingsStatus.ACTIVE,
        },
      });

      // If initial deposit was made, record transaction and double entry
      if (initialDeposit.greaterThan(0)) {
        const txRef = CryptoUtil.generateTransactionReference('SAV-DEP');

        const businessTx = await tx.transaction.create({
          data: {
            reference: txRef,
            userId,
            sourceAccountId: bankAccount.id,
            type: TransactionType.SAVINGS_DEPOSIT,
            amount: initialDeposit.toFixed(4),
            fee: '0.0000',
            netAmount: initialDeposit.toFixed(4),
            currencyCode: bankAccount.currencyCode,
            status: TransactionStatus.SUCCESS,
            description: `Initial funding for savings: ${dto.title}`,
            metadata: {
              savingsAccountId: savingsAccount.id,
              savingsType: dto.type,
              title: dto.title,
            },
          },
        });

        // Double-entry General Ledger posting
        // Debit: 2010-<acc> (Customer Current Liability)
        // Credit: 2020-<acc> (Customer Savings Deposit Liability)
        const currentAccLedgerCode = `2010-${bankAccount.accountNumber}`;
        const savingsLedgerCode = `2020-${bankAccount.accountNumber}`;

        await this.ledgerService.postJournalEntry(
          tx,
          {
            reference: `JRN-${txRef}`,
            transactionId: businessTx.id,
            description: `Initial funding for savings plan: ${dto.title}`,
            entries: [
              {
                accountCode: currentAccLedgerCode,
                entryType: LedgerEntryType.DEBIT,
                amount: initialDeposit.toFixed(4),
                currencyCode: bankAccount.currencyCode,
              },
              {
                accountCode: savingsLedgerCode,
                entryType: LedgerEntryType.CREDIT,
                amount: initialDeposit.toFixed(4),
                currencyCode: bankAccount.currencyCode,
              },
            ],
          },
          userId,
        );

        // Notification
        await tx.notification.create({
          data: {
            userId,
            title: 'Savings Plan Created',
            message: `Your ${dto.type.replace('_', ' ')} plan "${dto.title}" was successfully created with an initial deposit of ${bankAccount.currencyCode} ${initialDeposit.toFixed(2)}.`,
            type: 'SAVINGS',
          },
        });
      } else {
        await tx.notification.create({
          data: {
            userId,
            title: 'Savings Plan Created',
            message: `Your ${dto.type.replace('_', ' ')} plan "${dto.title}" has been created. Start saving to earn ${interestRate.toFixed(2)}% p.a.!`,
            type: 'SAVINGS',
          },
        });
      }

      return savingsAccount;
    });

    return {
      message: 'Savings plan created successfully',
      savingsAccount: result,
    };
  }

  /**
   * Top up / deposit additional funds into an existing savings account
   */
  async topUpSavings(userId: string, savingsId: string, dto: TopUpSavingsDto) {
    const savings = await this.prisma.savingsAccount.findUnique({
      where: { id: savingsId },
      include: { account: true },
    });

    if (!savings || savings.userId !== userId) {
      throw new NotFoundException('Savings account not found');
    }

    if (savings.status !== SavingsStatus.ACTIVE) {
      throw new BadRequestException('Cannot top up a savings plan that is matured or closed');
    }

    if (savings.type === SavingsType.FIXED_DEPOSIT) {
      throw new BadRequestException('Fixed Term Deposits cannot accept incremental top-ups after initial lockup');
    }

    const topUpAmount = new Decimal(dto.amount);
    if (topUpAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Top-up amount must be greater than zero');
    }

    // Verify PIN
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.pinHash) {
      throw new BadRequestException('Transaction PIN is not configured on your account.');
    }
    const isPinValid = await CryptoUtil.verify(user.pinHash, dto.pin);
    if (!isPinValid) {
      throw new BadRequestException('Invalid transaction authorization PIN');
    }

    const bankAccount = savings.account;
    if (bankAccount.status !== AccountStatus.ACTIVE || bankAccount.isFrozen) {
      throw new ForbiddenException('Linked bank account is inactive or frozen');
    }

    const txRef = CryptoUtil.generateTransactionReference('SAV-TOP');

    const result = await this.prisma.$transaction(async (tx) => {
      const currentAcc = await tx.bankAccount.findUnique({ where: { id: bankAccount.id } });
      const availableBalance = new Decimal(currentAcc!.availableBalance.toString());

      if (availableBalance.lessThan(topUpAmount)) {
        throw new BadRequestException('INSUFFICIENT_FUNDS: Available bank balance is insufficient for top-up');
      }

      // Deduct from bank account
      await tx.bankAccount.update({
        where: { id: bankAccount.id },
        data: {
          currentBalance: { decrement: topUpAmount.toFixed(4) },
          availableBalance: { decrement: topUpAmount.toFixed(4) },
          ledgerBalance: { decrement: topUpAmount.toFixed(4) },
        },
      });

      // Increment savings balance
      const updatedSavings = await tx.savingsAccount.update({
        where: { id: savings.id },
        data: {
          currentAmount: { increment: topUpAmount.toFixed(4) },
        },
      });

      // Create Transaction record
      const businessTx = await tx.transaction.create({
        data: {
          reference: txRef,
          userId,
          sourceAccountId: bankAccount.id,
          type: TransactionType.SAVINGS_DEPOSIT,
          amount: topUpAmount.toFixed(4),
          fee: '0.0000',
          netAmount: topUpAmount.toFixed(4),
          currencyCode: bankAccount.currencyCode,
          status: TransactionStatus.SUCCESS,
          description: `Top-up for savings: ${savings.title}`,
          metadata: {
            savingsAccountId: savings.id,
            savingsType: savings.type,
            title: savings.title,
          },
        },
      });

      // Double entry ledger
      await this.ledgerService.postJournalEntry(
        tx,
        {
          reference: `JRN-${txRef}`,
          transactionId: businessTx.id,
          description: `Top-up for savings plan: ${savings.title}`,
          entries: [
            {
              accountCode: `2010-${bankAccount.accountNumber}`,
              entryType: LedgerEntryType.DEBIT,
              amount: topUpAmount.toFixed(4),
              currencyCode: bankAccount.currencyCode,
            },
            {
              accountCode: `2020-${bankAccount.accountNumber}`,
              entryType: LedgerEntryType.CREDIT,
              amount: topUpAmount.toFixed(4),
              currencyCode: bankAccount.currencyCode,
            },
          ],
        },
        userId,
      );

      // Notification
      await tx.notification.create({
        data: {
          userId,
          title: 'Savings Top-Up Successful',
          message: `Added ${bankAccount.currencyCode} ${topUpAmount.toFixed(2)} to your savings "${savings.title}". New balance: ${bankAccount.currencyCode} ${new Decimal(updatedSavings.currentAmount.toString()).toFixed(2)}.`,
          type: 'SAVINGS',
        },
      });

      return { updatedSavings, businessTx };
    });

    return {
      message: 'Savings top-up successful',
      savingsAccount: result.updatedSavings,
      transaction: result.businessTx,
    };
  }

  /**
   * Withdraw / Liquidate / Redeem savings back into funding bank account
   */
  async withdrawSavings(userId: string, savingsId: string, dto: WithdrawSavingsDto) {
    const savings = await this.prisma.savingsAccount.findUnique({
      where: { id: savingsId },
      include: { account: true, user: { include: { profile: true } } },
    });

    if (!savings || savings.userId !== userId) {
      throw new NotFoundException('Savings account not found');
    }

    if (savings.status === SavingsStatus.CLOSED || savings.status === SavingsStatus.BROKEN) {
      throw new BadRequestException('This savings plan is already liquidated or closed');
    }

    const currentSavingsAmount = new Decimal(savings.currentAmount.toString());
    if (currentSavingsAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Savings plan has zero balance to withdraw');
    }

    // Verify PIN
    const user = savings.user;
    if (!user || !user.pinHash) {
      throw new BadRequestException('Transaction PIN is not configured on your account.');
    }
    const isPinValid = await CryptoUtil.verify(user.pinHash, dto.pin);
    if (!isPinValid) {
      throw new BadRequestException('Invalid transaction authorization PIN');
    }

    const now = new Date();
    const isFixedDeposit = savings.type === SavingsType.FIXED_DEPOSIT;
    const isPremature = isFixedDeposit && savings.maturityDate && now < savings.maturityDate;

    // Fixed deposit early liquidation rules
    let penalty = new Decimal('0.0000');
    let accruedInterest = this.calculateAccruedInterest(
      currentSavingsAmount,
      new Decimal(savings.interestRate.toString()),
      savings.startDate,
      now,
    );

    if (isPremature) {
      if (!dto.isEarlyLiquidationConsent) {
        // Compute penalty: Forfeit 50% of accrued interest + 1.0% early break fee
        const earlyBreakPenalty = currentSavingsAmount.times(new Decimal('0.0100'));
        const totalEstimatedPenalty = accruedInterest.times(new Decimal('0.50')).plus(earlyBreakPenalty);
        throw new BadRequestException({
          code: 'EARLY_LIQUIDATION_WARNING',
          message: `Breaking this Fixed Term Deposit before maturity (${savings.maturityDate?.toISOString().split('T')[0]}) incurs an early liquidation penalty of ${savings.account.currencyCode} ${totalEstimatedPenalty.toFixed(2)}. Please confirm consent to proceed.`,
          penaltyAmount: totalEstimatedPenalty.toFixed(4),
          accruedInterest: accruedInterest.toFixed(4),
        });
      }

      // Early liquidation confirmed: forfeit interest + charge 1% break fee
      const earlyBreakPenalty = currentSavingsAmount.times(new Decimal('0.0100'));
      penalty = earlyBreakPenalty;
      accruedInterest = new Decimal('0.0000'); // Accrued interest forfeited
    }

    // Determine withdrawal amount
    let withdrawalAmount = dto.amount ? new Decimal(dto.amount) : currentSavingsAmount;
    if (isFixedDeposit) {
      // Fixed deposits must be liquidated in full
      withdrawalAmount = currentSavingsAmount;
    }

    if (withdrawalAmount.greaterThan(currentSavingsAmount)) {
      throw new BadRequestException('Withdrawal amount exceeds available savings balance');
    }

    const netPayout = withdrawalAmount.plus(accruedInterest).minus(penalty);
    if (netPayout.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Net liquidation payout must be greater than zero');
    }

    const txRef = CryptoUtil.generateTransactionReference('SAV-WTH');
    const bankAccount = savings.account;

    const result = await this.prisma.$transaction(async (tx) => {
      // Credit principal + net interest to bank account
      await tx.bankAccount.update({
        where: { id: bankAccount.id },
        data: {
          currentBalance: { increment: netPayout.toFixed(4) },
          availableBalance: { increment: netPayout.toFixed(4) },
          ledgerBalance: { increment: netPayout.toFixed(4) },
        },
      });

      // Update savings balance & status
      const remainingSavings = currentSavingsAmount.minus(withdrawalAmount);
      let nextStatus: SavingsStatus = savings.status;

      if (isFixedDeposit) {
        nextStatus = isPremature ? SavingsStatus.BROKEN : SavingsStatus.MATURED;
      } else if (remainingSavings.isZero()) {
        nextStatus = SavingsStatus.CLOSED;
      }

      const updatedSavings = await tx.savingsAccount.update({
        where: { id: savings.id },
        data: {
          currentAmount: remainingSavings.toFixed(4),
          status: nextStatus,
        },
      });

      // Create Transaction record
      const businessTx = await tx.transaction.create({
        data: {
          reference: txRef,
          userId,
          sourceAccountId: bankAccount.id,
          type: TransactionType.SAVINGS_WITHDRAWAL,
          amount: withdrawalAmount.toFixed(4),
          fee: penalty.toFixed(4),
          netAmount: netPayout.toFixed(4),
          currencyCode: bankAccount.currencyCode,
          status: TransactionStatus.SUCCESS,
          description: `Savings withdrawal: ${savings.title}${isPremature ? ' (Premature liquidation)' : ''}`,
          metadata: {
            savingsAccountId: savings.id,
            savingsType: savings.type,
            accruedInterest: accruedInterest.toFixed(4),
            penalty: penalty.toFixed(4),
          },
        },
      });

      // Balanced Double Entry Posting:
      // Debit: 2020-<acc> (Customer Savings Liability) [withdrawalAmount]
      // (If interest paid: Debit 5010 Interest Expense) [accruedInterest]
      // (If penalty charged: Credit 4030 Early Liquidation Penalty Revenue) [penalty]
      // Credit: 2010-<acc> (Customer Current Liability) [netPayout]
      const currentAccLedgerCode = `2010-${bankAccount.accountNumber}`;
      const savingsLedgerCode = `2020-${bankAccount.accountNumber}`;

      const journalEntries: any[] = [
        {
          accountCode: savingsLedgerCode,
          entryType: LedgerEntryType.DEBIT,
          amount: withdrawalAmount.toFixed(4),
          currencyCode: bankAccount.currencyCode,
        },
      ];

      if (accruedInterest.greaterThan(0)) {
        journalEntries.push({
          accountCode: '5010', // Interest Expense
          entryType: LedgerEntryType.DEBIT,
          amount: accruedInterest.toFixed(4),
          currencyCode: bankAccount.currencyCode,
        });
      }

      if (penalty.greaterThan(0)) {
        journalEntries.push({
          accountCode: '4030', // Penalties & Fines Income
          entryType: LedgerEntryType.CREDIT,
          amount: penalty.toFixed(4),
          currencyCode: bankAccount.currencyCode,
        });
      }

      journalEntries.push({
        accountCode: currentAccLedgerCode,
        entryType: LedgerEntryType.CREDIT,
        amount: netPayout.toFixed(4),
        currencyCode: bankAccount.currencyCode,
      });

      await this.ledgerService.postJournalEntry(
        tx,
        {
          reference: `JRN-${txRef}`,
          transactionId: businessTx.id,
          description: `Savings liquidation payout for ${savings.title}`,
          entries: journalEntries,
        },
        userId,
      );

      // Notification
      await tx.notification.create({
        data: {
          userId,
          title: 'Savings Withdrawal Completed',
          message: `Credited ${bankAccount.currencyCode} ${netPayout.toFixed(2)} to your main account from "${savings.title}".`,
          type: 'SAVINGS',
        },
      });

      return { updatedSavings, businessTx, netPayout };
    });

    // Send Credit Alert Email
    const updatedBank = await this.prisma.bankAccount.findUnique({ where: { id: bankAccount.id } });
    const userName = user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user.username;

    await this.emailService.sendCreditAlert({
      to: user.email,
      recipientName: userName,
      amount: result.netPayout.toFixed(4),
      currency: bankAccount.currencyCode,
      senderName: `Silverhawk Savings Vault (${savings.title})`,
      accountNumber: bankAccount.accountNumber,
      reference: txRef,
      description: `Savings redemption payout for ${savings.title}`,
      availableBalance: updatedBank!.availableBalance.toString(),
    });

    return {
      message: 'Savings withdrawal processed successfully',
      payoutAmount: result.netPayout.toFixed(4),
      accruedInterest: accruedInterest.toFixed(4),
      penalty: penalty.toFixed(4),
      savingsAccount: result.updatedSavings,
      transaction: result.businessTx,
    };
  }

  /**
   * List all savings accounts for a customer with computed stats
   */
  async getSavingsList(userId: string) {
    const savingsList = await this.prisma.savingsAccount.findMany({
      where: { userId },
      include: { account: true },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const formatted = savingsList.map((s) => {
      const current = new Decimal(s.currentAmount.toString());
      const target = s.targetAmount ? new Decimal(s.targetAmount.toString()) : null;
      const progressPct = target && target.greaterThan(0)
        ? current.dividedBy(target).times(100).toNumber()
        : null;

      const rate = new Decimal(s.interestRate.toString());
      const accruedInterest = s.status === SavingsStatus.ACTIVE
        ? this.calculateAccruedInterest(current, rate, s.startDate, now)
        : new Decimal('0.0000');

      let daysRemaining: number | null = null;
      if (s.maturityDate) {
        const diffMs = s.maturityDate.getTime() - now.getTime();
        daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      }

      return {
        ...s,
        progressPercentage: progressPct ? Math.min(100, progressPct) : null,
        accruedInterest: accruedInterest.toFixed(4),
        daysRemaining,
      };
    });

    const totalSavingsBalance = savingsList.reduce(
      (acc, curr) => acc.plus(new Decimal(curr.currentAmount.toString())),
      new Decimal('0.0000'),
    );

    return {
      totalSavingsBalance: totalSavingsBalance.toFixed(4),
      count: savingsList.length,
      savings: formatted,
    };
  }

  /**
   * Get savings account by ID
   */
  async getSavingsById(userId: string, savingsId: string) {
    const savings = await this.prisma.savingsAccount.findUnique({
      where: { id: savingsId },
      include: { account: true },
    });

    if (!savings || savings.userId !== userId) {
      throw new NotFoundException('Savings account not found');
    }

    const now = new Date();
    const current = new Decimal(savings.currentAmount.toString());
    const target = savings.targetAmount ? new Decimal(savings.targetAmount.toString()) : null;
    const progressPct = target && target.greaterThan(0)
      ? current.dividedBy(target).times(100).toNumber()
      : null;

    const rate = new Decimal(savings.interestRate.toString());
    const accruedInterest = savings.status === SavingsStatus.ACTIVE
      ? this.calculateAccruedInterest(current, rate, savings.startDate, now)
      : new Decimal('0.0000');

    let daysRemaining: number | null = null;
    if (savings.maturityDate) {
      const diffMs = savings.maturityDate.getTime() - now.getTime();
      daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    }

    return {
      ...savings,
      progressPercentage: progressPct ? Math.min(100, progressPct) : null,
      accruedInterest: accruedInterest.toFixed(4),
      daysRemaining,
    };
  }

  /**
   * Admin: List all savings accounts with portfolio metrics
   */
  async adminListSavings(query?: { type?: SavingsType; status?: SavingsStatus }) {
    const where: any = {};
    if (query?.type) where.type = query.type;
    if (query?.status) where.status = query.status;

    const savings = await this.prisma.savingsAccount.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            profile: true,
          },
        },
        account: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalPortfolioVolume = savings.reduce(
      (acc, curr) => acc.plus(new Decimal(curr.currentAmount.toString())),
      new Decimal('0.0000'),
    );

    return {
      totalPortfolioVolume: totalPortfolioVolume.toFixed(4),
      totalCount: savings.length,
      savings,
    };
  }

  // ==============================================================================
  // PHASE 35: HIGH-YIELD SAVINGS GOALS, COMPOUND SIMULATOR & ROUND-UPS
  // ==============================================================================

  /**
   * Create a High-Yield Savings Goal with target amount, milestone date & auto-save rules
   */
  async createSavingsGoal(userId: string, dto: CreateSavingsGoalDto) {
    const bankAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.accountId },
    });

    if (!bankAccount || bankAccount.userId !== userId) {
      throw new ForbiddenException('Invalid funding bank account');
    }

    const targetAmount = new Decimal(dto.targetAmount);
    if (targetAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Target goal amount must be greater than zero');
    }

    const initialDeposit = dto.initialDeposit ? new Decimal(dto.initialDeposit) : new Decimal(0);
    if (initialDeposit.greaterThan(0)) {
      if (new Decimal(bankAccount.availableBalance.toString()).lessThan(initialDeposit)) {
        throw new BadRequestException('Insufficient available checking balance for initial goal deposit');
      }
    }

    const interestRate = new Decimal('7.25'); // 7.25% p.a. High-Yield Goal Tier
    const targetDate = dto.targetDate ? new Date(dto.targetDate) : null;
    const categoryTag = dto.category ? `[${dto.category.toUpperCase()}] ` : '';
    const fullTitle = `${categoryTag}${dto.title}`.slice(0, 150);

    const goal = await this.prisma.$transaction(async (tx) => {
      const savingsAccount = await tx.savingsAccount.create({
        data: {
          userId,
          accountId: dto.accountId,
          type: SavingsType.TARGET,
          title: fullTitle,
          targetAmount,
          currentAmount: initialDeposit,
          interestRate,
          startDate: new Date(),
          maturityDate: targetDate,
          autoDebitFrequency: dto.autoDebitFrequency || 'NONE',
          autoDebitAmount: dto.autoDebitAmount ? new Decimal(dto.autoDebitAmount) : null,
          status: SavingsStatus.ACTIVE,
        },
      });

      if (initialDeposit.greaterThan(0)) {
        const txRef = CryptoUtil.generateTransactionReference('GOAL-INIT');

        await tx.bankAccount.update({
          where: { id: dto.accountId },
          data: {
            currentBalance: { decrement: initialDeposit.toFixed(4) },
            availableBalance: { decrement: initialDeposit.toFixed(4) },
            ledgerBalance: { decrement: initialDeposit.toFixed(4) },
          },
        });

        const businessTx = await tx.transaction.create({
          data: {
            reference: txRef,
            userId,
            sourceAccountId: bankAccount.id,
            type: TransactionType.SAVINGS_DEPOSIT,
            status: TransactionStatus.SUCCESS,
            amount: initialDeposit.toFixed(4),
            fee: '0.0000',
            netAmount: initialDeposit.toFixed(4),
            currencyCode: bankAccount.currencyCode,
            description: `Initial funding for Savings Goal: ${dto.title}`,
            metadata: {
              savingsAccountId: savingsAccount.id,
              savingsType: 'GOAL',
              category: dto.category || 'GENERAL',
            },
          },
        });

        const currentAccLedgerCode = `2010-${bankAccount.accountNumber}`;
        const savingsLedgerCode = `2020-${bankAccount.accountNumber}`;

        await this.ledgerService.postJournalEntry(
          tx,
          {
            reference: `JRN-${txRef}`,
            transactionId: businessTx.id,
            description: `Initial funding for Savings Goal: ${dto.title}`,
            entries: [
              {
                accountCode: currentAccLedgerCode,
                entryType: LedgerEntryType.DEBIT,
                amount: initialDeposit.toFixed(4),
                currencyCode: bankAccount.currencyCode,
              },
              {
                accountCode: savingsLedgerCode,
                entryType: LedgerEntryType.CREDIT,
                amount: initialDeposit.toFixed(4),
                currencyCode: bankAccount.currencyCode,
              },
            ],
          },
          userId,
        );
      }

      return savingsAccount;
    });

    const progress = SavingsGoalUtil.evaluateGoalProgress(
      goal.currentAmount.toString(),
      goal.targetAmount?.toString() || null,
      goal.maturityDate,
    );

    return {
      goal,
      progress,
      message: `Savings goal "${dto.title}" initialized successfully at 7.25% APY!`,
    };
  }

  /**
   * List all user savings goals enriched with progress metrics & compound interest
   */
  async getUserGoals(userId: string) {
    const goals = await this.prisma.savingsAccount.findMany({
      where: { userId },
      include: { account: true },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();

    const enrichedGoals = goals.map((g) => {
      const current = new Decimal(g.currentAmount.toString());
      const rate = new Decimal(g.interestRate.toString());
      const accrued = g.status === SavingsStatus.ACTIVE
        ? this.calculateAccruedInterest(current, rate, g.startDate, now)
        : new Decimal('0.0000');

      const progress = SavingsGoalUtil.evaluateGoalProgress(
        current.toString(),
        g.targetAmount?.toString() || null,
        g.maturityDate,
      );

      return {
        ...g,
        accruedInterest: accrued.toFixed(4),
        progress,
      };
    });

    return {
      goals: enrichedGoals,
      totalCount: enrichedGoals.length,
      totalSavingsVolume: enrichedGoals.reduce(
        (sum, item) => sum.plus(new Decimal(item.currentAmount.toString())),
        new Decimal('0.0000'),
      ).toFixed(2),
    };
  }

  /**
   * Interactive Compound Interest Projection Simulator
   */
  calculateCompoundSchedule(dto: CompoundCalculatorDto) {
    const principal = new Decimal(dto.principal);
    const monthly = dto.monthlyContribution ? new Decimal(dto.monthlyContribution) : new Decimal(0);
    const rate = dto.annualRatePct ? new Decimal(dto.annualRatePct) : new Decimal('7.25');
    const freq = dto.frequency || CompoundingFrequency.MONTHLY;

    return SavingsGoalUtil.calculateCompoundGrowth(
      principal,
      monthly,
      rate,
      dto.years,
      freq,
    );
  }

  /**
   * Toggle or configure spare change round-up sweeps for checking account
   */
  async toggleRoundUp(userId: string, goalId: string, dto: ToggleRoundUpDto) {
    const goal = await this.prisma.savingsAccount.findUnique({
      where: { id: goalId },
    });

    if (!goal || goal.userId !== userId) {
      throw new NotFoundException('Target savings goal not found');
    }

    return {
      success: true,
      roundUpEnabled: dto.enabled,
      multiplier: dto.multiplier || 1,
      targetGoalId: goalId,
      message: dto.enabled
        ? `Spare-change round-up sweep activated with ${dto.multiplier || 1}x multiplier!`
        : 'Spare-change round-up sweep disabled.',
    };
  }

  /**
   * Process a spare change sweep from transaction debit
   */
  async processSpareChangeRoundUp(userId: string, dto: ProcessRoundUpSweepDto) {
    const sweepCalc = SavingsGoalUtil.calculateSpareChange(dto.transactionAmount, 1, 1);
    const sweepAmount = new Decimal(sweepCalc.totalSweepAmount);

    if (sweepAmount.lessThanOrEqualTo(0)) {
      return { swept: false, sweepAmount: '0.00' };
    }

    // Find destination goal or default active target savings
    const targetGoal = dto.targetSavingsId
      ? await this.prisma.savingsAccount.findUnique({ where: { id: dto.targetSavingsId } })
      : await this.prisma.savingsAccount.findFirst({
          where: { userId, status: SavingsStatus.ACTIVE },
          orderBy: { createdAt: 'desc' },
        });

    if (!targetGoal || targetGoal.userId !== userId) {
      return { swept: false, reason: 'No active savings goal configured for round-up' };
    }

    const sourceAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.sourceAccountId },
    });

    if (!sourceAccount || sourceAccount.userId !== userId || new Decimal(sourceAccount.availableBalance.toString()).lessThan(sweepAmount)) {
      return { swept: false, reason: 'Insufficient source balance for sweep' };
    }

    const sweepRef = CryptoUtil.generateTransactionReference('SWEEP-RND');

    await this.prisma.$transaction(async (tx) => {
      await tx.bankAccount.update({
        where: { id: sourceAccount.id },
        data: {
          currentBalance: { decrement: sweepAmount.toFixed(4) },
          availableBalance: { decrement: sweepAmount.toFixed(4) },
          ledgerBalance: { decrement: sweepAmount.toFixed(4) },
        },
      });

      await tx.savingsAccount.update({
        where: { id: targetGoal.id },
        data: {
          currentAmount: { increment: sweepAmount.toFixed(4) },
        },
      });

      await tx.transaction.create({
        data: {
          reference: sweepRef,
          userId,
          sourceAccountId: sourceAccount.id,
          type: TransactionType.SAVINGS_DEPOSIT,
          status: TransactionStatus.SUCCESS,
          amount: sweepAmount.toFixed(4),
          fee: '0.0000',
          netAmount: sweepAmount.toFixed(4),
          currencyCode: sourceAccount.currencyCode,
          description: `Auto-Save Round-Up Sweep to: ${targetGoal.title}`,
          metadata: {
            savingsAccountId: targetGoal.id,
            spareChange: sweepCalc.spareChange,
            originalTransactionAmount: dto.transactionAmount,
          },
        },
      });
    });

    return {
      swept: true,
      sweepAmount: sweepAmount.toFixed(2),
      targetGoalTitle: targetGoal.title,
      reference: sweepRef,
    };
  }

  /**
   * Platform-Wide Compound Interest Accrual and Double-Entry Settlement
   */
  async accrueAndDisburseCompoundInterest(dto: AccrueInterestDto) {
    const activeSavings = await this.prisma.savingsAccount.findMany({
      where: { status: SavingsStatus.ACTIVE },
      include: { account: true, user: true },
    });

    const now = dto.asOfDate ? new Date(dto.asOfDate) : new Date();
    let totalAccruedYield = new Decimal('0.0000');
    let processedCount = 0;
    const payouts: Array<{ savingsId: string; title: string; interestCredited: string; newBalance: string }> = [];

    for (const sav of activeSavings) {
      const principal = new Decimal(sav.currentAmount.toString());
      if (principal.lessThanOrEqualTo(0)) continue;

      const rate = new Decimal(sav.interestRate.toString());
      // Calculate 1 day's or monthly yield fraction
      const dailyYield = principal.times(rate.dividedBy(100).dividedBy(365)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

      if (dailyYield.greaterThan(0)) {
        totalAccruedYield = totalAccruedYield.plus(dailyYield);
        processedCount++;

        if (!dto.dryRun) {
          const payoutRef = CryptoUtil.generateTransactionReference('YIELD-PAY');
          const newBal = principal.plus(dailyYield);

          await this.prisma.$transaction(async (tx) => {
            await tx.savingsAccount.update({
              where: { id: sav.id },
              data: {
                currentAmount: { increment: dailyYield.toFixed(4) },
              },
            });

            const businessTx = await tx.transaction.create({
              data: {
                reference: payoutRef,
                userId: sav.userId,
                destinationAccountId: sav.account.id,
                type: TransactionType.SAVINGS_DEPOSIT,
                status: TransactionStatus.SUCCESS,
                amount: dailyYield.toFixed(4),
                fee: '0.0000',
                netAmount: dailyYield.toFixed(4),
                currencyCode: sav.account.currencyCode,
                description: `Daily Compound Interest Credit: ${sav.title} (${sav.interestRate}% APY)`,
                metadata: {
                  savingsAccountId: sav.id,
                  type: 'INTEREST_YIELD',
                },
              },
            });

            // Double-entry: Debit Bank Interest Expense (5010), Credit Customer Savings Vault (2020)
            const savingsLedgerCode = `2020-${sav.account.accountNumber}`;
            await this.ledgerService.postJournalEntry(
              tx,
              {
                reference: `JRN-${payoutRef}`,
                transactionId: businessTx.id,
                description: `Compound Interest Yield Payout: ${sav.title}`,
                entries: [
                  {
                    accountCode: '5010-INTEREST-EXPENSE',
                    entryType: LedgerEntryType.DEBIT,
                    amount: dailyYield.toFixed(4),
                    currencyCode: sav.account.currencyCode,
                  },
                  {
                    accountCode: savingsLedgerCode,
                    entryType: LedgerEntryType.CREDIT,
                    amount: dailyYield.toFixed(4),
                    currencyCode: sav.account.currencyCode,
                  },
                ],
              },
              sav.userId,
            );
          });

          payouts.push({
            savingsId: sav.id,
            title: sav.title,
            interestCredited: dailyYield.toFixed(4),
            newBalance: newBal.toFixed(4),
          });
        }
      }
    }

    return {
      dryRun: dto.dryRun || false,
      processedCount,
      totalAccruedYield: totalAccruedYield.toFixed(4),
      payouts,
      timestamp: now.toISOString(),
      message: dto.dryRun
        ? `Simulated compound yield calculation: $${totalAccruedYield.toFixed(2)} across ${processedCount} active vaults.`
        : `Accrued and disbursed $${totalAccruedYield.toFixed(2)} compound interest across ${processedCount} vaults.`,
    };
  }

  // ==============================================================================
  // PHASE 36: FIXED TERM DEPOSITS (FDR) ENGINE & EARLY BREAK RULES
  // ==============================================================================

  /**
   * Get available Fixed Deposit tenure tiers and corresponding APR yield rates
   */
  getFixedDepositTenureTiers() {
    return {
      tiers: FixedDepositUtil.TENURE_TIERS,
      earlyBreakFeePercentage: FixedDepositUtil.EARLY_BREAK_FEE_PCT.toFixed(2),
      earlyInterestForfeitPercentage: FixedDepositUtil.EARLY_INTEREST_FORFEIT_PCT.toFixed(2),
    };
  }

  /**
   * Calculate precise Fixed Deposit quotation and projected maturity yield
   */
  calculateFixedDepositQuote(dto: FixedDepositCalculatorDto) {
    return FixedDepositUtil.calculateFdrQuote(
      dto.principal,
      dto.durationMonths,
      dto.customRate,
    );
  }

  /**
   * Get real-time premature liquidation penalty quote for an active fixed deposit
   */
  async getEarlyLiquidationQuote(userId: string, savingsId: string) {
    const savings = await this.prisma.savingsAccount.findUnique({
      where: { id: savingsId },
      include: { account: true },
    });

    if (!savings || savings.userId !== userId) {
      throw new NotFoundException('Fixed Term Deposit record not found');
    }

    if (savings.type !== SavingsType.FIXED_DEPOSIT) {
      throw new BadRequestException('Target savings account is not a Fixed Term Deposit');
    }

    const principal = new Decimal(savings.currentAmount.toString());
    const rate = new Decimal(savings.interestRate.toString());
    const maturityDate = savings.maturityDate || new Date();

    const quote = FixedDepositUtil.calculateEarlyLiquidation(
      savings.id,
      principal,
      rate,
      savings.startDate,
      maturityDate,
      new Date(),
    );

    return {
      ...quote,
      currency: savings.account.currencyCode,
      title: savings.title,
      accountNumber: savings.account.accountNumber,
    };
  }

  /**
   * Book a new Fixed Term Deposit with PIN security verification & double-entry ledger lockup
   */
  async createFixedDeposit(userId: string, dto: CreateFixedDepositDto) {
    const bankAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.accountId },
    });

    if (!bankAccount || bankAccount.userId !== userId) {
      throw new ForbiddenException('Invalid funding bank account');
    }

    if (bankAccount.status !== AccountStatus.ACTIVE || bankAccount.isFrozen) {
      throw new ForbiddenException('Funding bank account is frozen or inactive');
    }

    const principal = new Decimal(dto.principal);
    if (principal.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Principal deposit amount must be greater than zero');
    }

    // Verify PIN
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.pinHash) {
      throw new BadRequestException('Transaction PIN is not configured on your account.');
    }
    const isPinValid = await CryptoUtil.verify(user.pinHash, dto.pin);
    if (!isPinValid) {
      throw new BadRequestException('Invalid transaction authorization PIN');
    }

    const availableBalance = new Decimal(bankAccount.availableBalance.toString());
    if (availableBalance.lessThan(principal)) {
      throw new BadRequestException('INSUFFICIENT_FUNDS: Available balance is insufficient for fixed term deposit lockup');
    }

    const quote = FixedDepositUtil.calculateFdrQuote(principal, dto.durationMonths);
    const title = dto.title || `${dto.durationMonths}-Month Fixed Term Deposit (${quote.interestRate}% APY)`;
    const startDate = new Date();
    const maturityDate = new Date(quote.maturityDate);

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Deduct principal from checking/current account
      await tx.bankAccount.update({
        where: { id: bankAccount.id },
        data: {
          currentBalance: { decrement: principal.toFixed(4) },
          availableBalance: { decrement: principal.toFixed(4) },
          ledgerBalance: { decrement: principal.toFixed(4) },
        },
      });

      // 2. Create Fixed Deposit Savings Account
      const savingsAccount = await tx.savingsAccount.create({
        data: {
          userId,
          accountId: bankAccount.id,
          type: SavingsType.FIXED_DEPOSIT,
          title,
          targetAmount: quote.maturityAmount,
          currentAmount: principal.toFixed(4),
          interestRate: quote.interestRate,
          startDate,
          maturityDate,
          autoDebitFrequency: 'NONE',
          status: SavingsStatus.ACTIVE,
        },
      });

      // 3. Create FixedDeposit specific relational entity if desired
      const depositRef = CryptoUtil.generateTransactionReference('FDR-REC');
      const fixedDeposit = await tx.fixedDeposit.create({
        data: {
          userId,
          accountId: bankAccount.id,
          depositReference: depositRef,
          principalAmount: principal.toFixed(4),
          interestRate: quote.interestRate,
          projectedReturn: quote.accruedInterestAtMaturity,
          tenureDays: quote.tenureDays,
          startDate,
          maturityDate,
          isLiquidatedEarly: false,
          liquidationPenalty: '0.0000',
          status: SavingsStatus.ACTIVE,
        },
      });

      // 4. Record Transaction
      const txRef = CryptoUtil.generateTransactionReference('SAV-FDR');
      const businessTx = await tx.transaction.create({
        data: {
          reference: txRef,
          userId,
          sourceAccountId: bankAccount.id,
          type: TransactionType.SAVINGS_DEPOSIT,
          amount: principal.toFixed(4),
          fee: '0.0000',
          netAmount: principal.toFixed(4),
          currencyCode: bankAccount.currencyCode,
          status: TransactionStatus.SUCCESS,
          description: `Fixed Term Deposit Lockup: ${title}`,
          metadata: {
            savingsAccountId: savingsAccount.id,
            fixedDepositId: fixedDeposit.id,
            depositReference: depositRef,
            durationMonths: dto.durationMonths,
            interestRate: quote.interestRate,
            maturityDate: maturityDate.toISOString(),
            projectedReturn: quote.accruedInterestAtMaturity,
            maturityAmount: quote.maturityAmount,
            autoRollOver: dto.autoRollOver || false,
          },
        },
      });

      // 5. Double-entry General Ledger posting
      // Debit: 2010-<acc> (Customer Current Liability)
      // Credit: 2020-<acc> (Customer Fixed Term Deposit Liability)
      const currentAccLedgerCode = `2010-${bankAccount.accountNumber}`;
      const savingsLedgerCode = `2020-${bankAccount.accountNumber}`;

      await this.ledgerService.postJournalEntry(
        tx,
        {
          reference: `JRN-${txRef}`,
          transactionId: businessTx.id,
          description: `Fixed Term Deposit Lockup: ${title}`,
          entries: [
            {
              accountCode: currentAccLedgerCode,
              entryType: LedgerEntryType.DEBIT,
              amount: principal.toFixed(4),
              currencyCode: bankAccount.currencyCode,
            },
            {
              accountCode: savingsLedgerCode,
              entryType: LedgerEntryType.CREDIT,
              amount: principal.toFixed(4),
              currencyCode: bankAccount.currencyCode,
            },
          ],
        },
        userId,
      );

      // 6. Notification
      await tx.notification.create({
        data: {
          userId,
          title: 'Fixed Term Deposit Booked',
          message: `Your Fixed Term Deposit of ${bankAccount.currencyCode} ${principal.toFixed(2)} is locked at ${quote.interestRate}% APY until ${maturityDate.toISOString().split('T')[0]}. Projected maturity payout: ${bankAccount.currencyCode} ${quote.maturityAmount}.`,
          type: 'SAVINGS',
        },
      });

      return { savingsAccount, fixedDeposit, businessTx, quote };
    });

    return {
      message: 'Fixed Term Deposit booked successfully',
      savingsAccount: result.savingsAccount,
      fixedDeposit: result.fixedDeposit,
      transaction: result.businessTx,
      quote: result.quote,
    };
  }
}


