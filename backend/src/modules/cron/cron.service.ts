import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { StandingOrdersService } from '../transfers/standing-orders.service';
import { Decimal } from 'decimal.js';
import {
  AccountStatus,
  AutoDebitFrequency,
  CardStatus,
  KycStatus,
  LedgerEntryType,
  LoanScheduleStatus,
  LoanStatus,
  SavingsStatus,
  SavingsType,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';

import { CryptoUtil } from '../../common/utils/crypto.util';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly standingOrdersService: StandingOrdersService,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ===========================================================================
  // 1. FIXED TERM DEPOSIT (FDR) MATURITY SETTLEMENT DAEMON
  // Runs hourly: Settle principal + earned interest, update status, post ledger
  // ===========================================================================
  @Cron(CronExpression.EVERY_HOUR)
  async handleFixedDepositMaturity() {
    this.logger.log('Executing automated fixed term deposit maturity sweep daemon...');
    const now = new Date();

    const dueDeposits = await this.prisma.savingsAccount.findMany({
      where: {
        type: SavingsType.FIXED_DEPOSIT,
        status: SavingsStatus.ACTIVE,
        maturityDate: {
          lte: now,
        },
      },
      include: {
        account: true,
        user: {
          include: { profile: true },
        },
      },
    });

    let settledCount = 0;
    let totalPayoutVolume = new Decimal('0.0000');

    for (const savings of dueDeposits) {
      try {
        const principal = new Decimal(savings.currentAmount.toString());
        if (principal.lte(0)) {
          await this.prisma.savingsAccount.update({
            where: { id: savings.id },
            data: { status: SavingsStatus.MATURED },
          });
          continue;
        }

        const rate = new Decimal(savings.interestRate.toString());
        const msInDay = 1000 * 60 * 60 * 24;
        const maturityDate = savings.maturityDate || now;
        const daysElapsed = Math.max(1, Math.floor((maturityDate.getTime() - savings.startDate.getTime()) / msInDay));
        const annualRate = rate.dividedBy(100);
        const accruedInterest = principal.times(annualRate.dividedBy(365)).times(daysElapsed).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
        const totalPayout = principal.plus(accruedInterest);

        await this.prisma.$transaction(async (tx) => {
          // Idempotency check: verify record is still ACTIVE inside transaction
          const currentRecord = await tx.savingsAccount.findUnique({
            where: { id: savings.id },
          });

          if (!currentRecord || currentRecord.status !== SavingsStatus.ACTIVE) {
            return;
          }

          // 1. Mark savings account as MATURED with 0 remaining balance
          await tx.savingsAccount.update({
            where: { id: savings.id },
            data: {
              status: SavingsStatus.MATURED,
              currentAmount: '0.0000',
            },
          });

          // 2. Update relational FixedDeposit records if present
          await tx.fixedDeposit.updateMany({
            where: {
              accountId: savings.accountId,
              userId: savings.userId,
              status: SavingsStatus.ACTIVE,
            },
            data: {
              status: SavingsStatus.MATURED,
            },
          });

          // 3. Credit principal + interest to customer bank account
          await tx.bankAccount.update({
            where: { id: savings.accountId },
            data: {
              currentBalance: { increment: totalPayout.toFixed(4) },
              availableBalance: { increment: totalPayout.toFixed(4) },
              ledgerBalance: { increment: totalPayout.toFixed(4) },
            },
          });

          // 4. Record Transaction
          const ref = CryptoUtil.generateTransactionReference('FDR-MAT');
          const txn = await tx.transaction.create({
            data: {
              reference: ref,
              userId: savings.userId,
              destinationAccountId: savings.accountId,
              type: TransactionType.SAVINGS_WITHDRAWAL,
              amount: principal.toFixed(4),
              fee: '0.0000',
              tax: '0.0000',
              netAmount: totalPayout.toFixed(4),
              currencyCode: savings.account.currencyCode,
              status: TransactionStatus.SUCCESS,
              description: `Fixed Term Deposit Maturity Payout: ${savings.title}`,
              metadata: {
                savingsAccountId: savings.id,
                type: 'FIXED_DEPOSIT_MATURITY',
                principal: principal.toFixed(4),
                accruedInterest: accruedInterest.toFixed(4),
                maturityDate: maturityDate.toISOString(),
                interestRate: rate.toFixed(2),
              },
            },
          });

          // 5. General Ledger Double-Entry Posting
          const bankLedger = await tx.ledgerAccount.findUnique({
            where: { bankAccountId: savings.accountId },
          });
          const expenseLedger = await tx.ledgerAccount.findFirst({
            where: { accountCode: '5020' },
          });

          if (bankLedger) {
            const journal = await tx.journalTransaction.create({
              data: {
                reference: `JRN-${ref}`,
                transactionId: txn.id,
                description: `Fixed Deposit Maturity Settlement: ${savings.title}`,
              },
            });

            const entries: any[] = [
              {
                journalTransactionId: journal.id,
                ledgerAccountId: bankLedger.id,
                entryType: LedgerEntryType.CREDIT,
                amount: totalPayout.toFixed(4),
                currencyCode: savings.account.currencyCode,
                exchangeRate: '1.000000',
              },
            ];

            if (expenseLedger && accruedInterest.gt(0)) {
              entries.push({
                journalTransactionId: journal.id,
                ledgerAccountId: expenseLedger.id,
                entryType: LedgerEntryType.DEBIT,
                amount: accruedInterest.toFixed(4),
                currencyCode: savings.account.currencyCode,
                exchangeRate: '1.000000',
              });
            }

            await tx.ledgerEntry.createMany({ data: entries });
          }

          // 6. In-App Notification
          await tx.notification.create({
            data: {
              userId: savings.userId,
              title: 'Fixed Deposit Matured & Paid Out',
              message: `Your Fixed Deposit "${savings.title}" has matured! Principal of ${savings.account.currencyCode} ${principal.toFixed(2)} plus earned interest of ${savings.account.currencyCode} ${accruedInterest.toFixed(2)} (${totalPayout.toFixed(2)} total) has been credited to your account.`,
              type: 'SAVINGS',
            },
          });
        });

        // 7. Email Notification
        const user = savings.user;
        const userName = user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user.username;
        const updatedAcc = await this.prisma.bankAccount.findUnique({ where: { id: savings.accountId } });

        await this.emailService.sendCreditAlert({
          to: user.email,
          recipientName: userName,
          amount: totalPayout.toFixed(4),
          currency: savings.account.currencyCode,
          senderName: `Silverhawk Treasury (FDR Maturity Vault)`,
          accountNumber: savings.account.accountNumber,
          reference: `FDR-MAT-${savings.id.slice(0, 8)}`,
          description: `Fixed Term Deposit Maturity Payout: ${savings.title}`,
          availableBalance: updatedAcc ? updatedAcc.availableBalance.toString() : '0.0000',
        });

        settledCount++;
        totalPayoutVolume = totalPayoutVolume.plus(totalPayout);
      } catch (err: any) {
        this.logger.error(`Error processing fixed deposit maturity for ${savings.id}: ${err?.message}`);
      }
    }

    this.logger.log(`Fixed Deposit maturity sweep completed. Settled: ${settledCount} vaults, Disbursed: $${totalPayoutVolume.toFixed(2)}`);
    return {
      settledCount,
      totalPayoutVolume: totalPayoutVolume.toFixed(4),
    };
  }

  // ===========================================================================
  // 2. DAILY SAVINGS INTEREST ACCRUAL ENGINE
  // Runs daily at midnight: Calculates compound daily interest, idempotent per day
  // ===========================================================================
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailySavingsInterestAccrual() {
    this.logger.log('Executing daily savings compound interest accrual daemon...');
    const todayStr = new Date().toISOString().slice(0, 10);

    const activeSavings = await this.prisma.savingsAccount.findMany({
      where: {
        status: SavingsStatus.ACTIVE,
        type: { not: SavingsType.FIXED_DEPOSIT },
      },
      include: {
        account: true,
        user: true,
      },
    });

    let processedCount = 0;
    let totalInterestAccrued = new Decimal('0.0000');

    for (const savings of activeSavings) {
      try {
        const principal = new Decimal(savings.currentAmount.toString());
        if (principal.lte(0)) continue;

        // Daily interest = Principal * (APR / 100 / 365)
        const annualRate = new Decimal(savings.interestRate.toString()).dividedBy(100);
        const dailyInterest = principal.times(annualRate.dividedBy(365)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
        if (dailyInterest.lte(0)) continue;

        const idempotencyRef = `ACCR-SAV-${savings.id.slice(0, 8)}-${todayStr}`;

        // Check if already accrued today
        const existingTxn = await this.prisma.transaction.findUnique({
          where: { reference: idempotencyRef },
        });

        if (existingTxn) {
          continue; // Idempotent skip
        }

        await this.prisma.$transaction(async (tx) => {
          // 1. Credit Savings Account balance
          await tx.savingsAccount.update({
            where: { id: savings.id },
            data: {
              currentAmount: { increment: dailyInterest.toFixed(4) },
            },
          });

          // 2. Record Transaction
          const txn = await tx.transaction.create({
            data: {
              reference: idempotencyRef,
              userId: savings.userId,
              sourceAccountId: savings.accountId,
              type: TransactionType.SAVINGS_DEPOSIT,
              amount: dailyInterest.toFixed(4),
              fee: '0.0000',
              tax: '0.0000',
              netAmount: dailyInterest.toFixed(4),
              currencyCode: savings.account.currencyCode,
              status: TransactionStatus.SUCCESS,
              description: `Daily Compound Interest Yield (${savings.interestRate}% APR) for ${todayStr}`,
              metadata: {
                savingsAccountId: savings.id,
                accrualDate: todayStr,
                annualRate: savings.interestRate.toString(),
                principal: principal.toFixed(4),
                dailyInterest: dailyInterest.toFixed(4),
              },
            },
          });

          // 3. Post General Ledger Entries
          const bankLedger = await tx.ledgerAccount.findUnique({
            where: { bankAccountId: savings.accountId },
          });
          const expenseLedger = await tx.ledgerAccount.findFirst({
            where: { accountCode: '5020' },
          });

          if (bankLedger && expenseLedger) {
            const journal = await tx.journalTransaction.create({
              data: {
                reference: `JRN-${idempotencyRef}`,
                transactionId: txn.id,
                description: `Daily Savings Interest Accrual: ${savings.title} (${todayStr})`,
              },
            });

            await tx.ledgerEntry.createMany({
              data: [
                {
                  journalTransactionId: journal.id,
                  ledgerAccountId: expenseLedger.id,
                  entryType: LedgerEntryType.DEBIT,
                  amount: dailyInterest.toFixed(4),
                  currencyCode: savings.account.currencyCode,
                  exchangeRate: '1.000000',
                },
                {
                  journalTransactionId: journal.id,
                  ledgerAccountId: bankLedger.id,
                  entryType: LedgerEntryType.CREDIT,
                  amount: dailyInterest.toFixed(4),
                  currencyCode: savings.account.currencyCode,
                  exchangeRate: '1.000000',
                },
              ],
            });
          }
        });

        processedCount++;
        totalInterestAccrued = totalInterestAccrued.plus(dailyInterest);
      } catch (err: any) {
        this.logger.error(`Failed to accrue interest for savings account ${savings.id}: ${err?.message}`);
      }
    }

    this.logger.log(`Savings interest accrual completed. Processed ${processedCount} accounts. Total accrued: $${totalInterestAccrued.toFixed(4)}`);
    return { processedCount, totalInterestAccrued: totalInterestAccrued.toFixed(4) };
  }

  // ===========================================================================
  // 3. RECURRING SAVINGS AUTO-DEBIT SWEEPER
  // Runs daily at 02:00: Sweeps active savings with auto-debit configurations
  // ===========================================================================
  @Cron('0 2 * * *')
  async handleSavingsRecurringInstallments() {
    this.logger.log('Executing automated recurring savings installment sweeps...');
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday
    const dayOfMonth = now.getDate(); // 1-31
    const todayStr = now.toISOString().slice(0, 10);

    const recurringSavings = await this.prisma.savingsAccount.findMany({
      where: {
        status: SavingsStatus.ACTIVE,
        autoDebitFrequency: { not: AutoDebitFrequency.NONE },
        autoDebitAmount: { gt: 0 },
      },
      include: {
        account: true,
        user: { include: { profile: true } },
      },
    });

    let debitedCount = 0;
    let totalDebitedVolume = new Decimal('0.0000');

    for (const savings of recurringSavings) {
      try {
        let isDue = false;
        if (savings.autoDebitFrequency === AutoDebitFrequency.DAILY) {
          isDue = true;
        } else if (savings.autoDebitFrequency === AutoDebitFrequency.WEEKLY && dayOfWeek === 1) {
          // Monday weekly sweep
          isDue = true;
        } else if (savings.autoDebitFrequency === AutoDebitFrequency.MONTHLY && dayOfMonth === 1) {
          // 1st of month sweep
          isDue = true;
        }

        if (!isDue || !savings.autoDebitAmount) continue;

        const debitAmount = new Decimal(savings.autoDebitAmount.toString());
        const idempotencyKey = `RECUR-SAV-${savings.id.slice(0, 8)}-${todayStr}`;

        const existingTxn = await this.prisma.transaction.findUnique({
          where: { reference: idempotencyKey },
        });
        if (existingTxn) continue;

        // Check if bank account has sufficient balance
        const bankAccount = await this.prisma.bankAccount.findUnique({
          where: { id: savings.accountId },
        });

        if (!bankAccount || new Decimal(bankAccount.availableBalance.toString()).lt(debitAmount)) {
          this.logger.warn(`Skipping recurring savings ${savings.id}: insufficient balance in ${savings.accountId}`);
          continue;
        }

        await this.prisma.$transaction(async (tx) => {
          // 1. Debit Bank Account
          await tx.bankAccount.update({
            where: { id: savings.accountId },
            data: {
              currentBalance: { decrement: debitAmount.toFixed(4) },
              availableBalance: { decrement: debitAmount.toFixed(4) },
            },
          });

          // 2. Credit Savings Vault
          await tx.savingsAccount.update({
            where: { id: savings.id },
            data: {
              currentAmount: { increment: debitAmount.toFixed(4) },
            },
          });

          // 3. Record Transaction
          await tx.transaction.create({
            data: {
              reference: idempotencyKey,
              userId: savings.userId,
              sourceAccountId: savings.accountId,
              type: TransactionType.SAVINGS_DEPOSIT,
              amount: debitAmount.toFixed(4),
              fee: '0.0000',
              tax: '0.0000',
              netAmount: debitAmount.toFixed(4),
              currencyCode: savings.account.currencyCode,
              status: TransactionStatus.SUCCESS,
              description: `Recurring Auto-Save Installment: ${savings.title}`,
              metadata: {
                savingsAccountId: savings.id,
                frequency: savings.autoDebitFrequency,
                autoDebitAmount: debitAmount.toFixed(4),
              },
            },
          });

          // 4. In-App Notification
          await tx.notification.create({
            data: {
              userId: savings.userId,
              title: 'Auto-Save Installment Debited',
              message: `Your recurring auto-save installment of ${savings.account.currencyCode} ${debitAmount.toFixed(2)} was successfully added to "${savings.title}".`,
              type: 'SAVINGS',
            },
          });
        });

        debitedCount++;
        totalDebitedVolume = totalDebitedVolume.plus(debitAmount);
      } catch (err: any) {
        this.logger.error(`Failed recurring savings debit for ${savings.id}: ${err?.message}`);
      }
    }

    this.logger.log(`Recurring savings sweep completed. Processed: ${debitedCount}, Total volume: $${totalDebitedVolume.toFixed(2)}`);
    return { debitedCount, totalDebitedVolume: totalDebitedVolume.toFixed(4) };
  }

  // ===========================================================================
  // 4. LOAN UPCOMING DUE REMINDERS DAEMON
  // Runs daily at 08:00: Sends proactive alerts 3 days before EMI due date
  // ===========================================================================
  @Cron('0 8 * * *')
  async handleLoanReminders() {
    this.logger.log('Executing automated loan upcoming due reminder daemon...');
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const upcomingSchedules = await this.prisma.loanSchedule.findMany({
      where: {
        status: LoanScheduleStatus.PENDING,
        dueDate: {
          gte: now,
          lte: threeDaysFromNow,
        },
        loan: {
          status: LoanStatus.ACTIVE,
        },
      },
      include: {
        loan: {
          include: {
            user: { include: { profile: true } },
            account: true,
          },
        },
      },
    });

    let remindedCount = 0;
    for (const schedule of upcomingSchedules) {
      try {
        const user = schedule.loan.user;
        const dueDateFormatted = new Date(schedule.dueDate).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });

        // Check if reminder was already sent today for this installment
        const reminderRef = `LOAN-REM-${schedule.id}-${schedule.installmentNumber}`;
        const existingNotif = await this.prisma.notification.findFirst({
          where: {
            userId: user.id,
            title: 'Upcoming Loan Repayment Due',
            message: { contains: `installment #${schedule.installmentNumber}` },
          },
        });

        if (!existingNotif) {
          await this.notificationsService.dispatchMultiChannelNotification({
            userId: user.id,
            title: 'Upcoming Loan Repayment Due',
            message: `Friendly reminder: Your loan installment #${schedule.installmentNumber} of ${schedule.loan.account.currencyCode} ${new Decimal(schedule.totalDue.toString()).toFixed(2)} is due on ${dueDateFormatted}. Please ensure sufficient funds in account ${schedule.loan.account.accountNumber}.`,
            type: 'LOAN',
            emailSubject: `Upcoming Loan Installment #${schedule.installmentNumber} Due Reminder`,
            emailHtml: `<p>Dear ${user.profile?.firstName || user.username},</p><p>This is a reminder that your loan installment #${schedule.installmentNumber} of <strong>${schedule.loan.account.currencyCode} ${new Decimal(schedule.totalDue.toString()).toFixed(2)}</strong> is scheduled for auto-debit on <strong>${dueDateFormatted}</strong>.</p><p>Thank you for banking with Silverhawk.</p>`,
            smsMessage: `Silverhawk Alert: Loan installment #${schedule.installmentNumber} of ${schedule.loan.account.currencyCode} ${new Decimal(schedule.totalDue.toString()).toFixed(2)} is due on ${dueDateFormatted}.`,
          });
          remindedCount++;
        }
      } catch (err: any) {
        this.logger.error(`Error sending loan reminder for schedule ${schedule.id}: ${err?.message}`);
      }
    }

    this.logger.log(`Loan reminders completed. Dispatched reminders to ${remindedCount} borrowers.`);
    return { remindedCount };
  }

  // ===========================================================================
  // 5. AUTOMATED LOAN EMI AUTO-DEBIT DAEMON
  // Runs daily at 01:00: Sweeps due installments, executes atomic debit
  // ===========================================================================
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleAutomatedLoanRepayments() {
    this.logger.log('Executing automated loan repayment auto-debit daemon...');
    const now = new Date();

    const pendingSchedules = await this.prisma.loanSchedule.findMany({
      where: {
        status: LoanScheduleStatus.PENDING,
        dueDate: {
          lte: now,
        },
        loan: {
          status: LoanStatus.ACTIVE,
        },
      },
      include: {
        loan: {
          include: {
            account: true,
            user: { include: { profile: true } },
          },
        },
      },
    });

    let settledCount = 0;
    for (const schedule of pendingSchedules) {
      try {
        const totalDue = new Decimal(schedule.totalDue.toString());
        const userAccount = schedule.loan.account;

        if (new Decimal(userAccount.availableBalance.toString()).gte(totalDue)) {
          // Perform atomic debit and settle schedule
          await this.prisma.$transaction(async (tx) => {
            // Debit bank account
            await tx.bankAccount.update({
              where: { id: userAccount.id },
              data: {
                currentBalance: { decrement: totalDue.toFixed(4) },
                availableBalance: { decrement: totalDue.toFixed(4) },
              },
            });

            // Mark schedule as PAID
            await tx.loanSchedule.update({
              where: { id: schedule.id },
              data: {
                status: LoanScheduleStatus.PAID,
                amountPaid: totalDue.toFixed(4),
                paidAt: now,
              },
            });

            // Update remaining loan balance
            const newRemaining = Decimal.max(
              0,
              new Decimal(schedule.loan.outstandingBalance.toString()).minus(schedule.principalDue.toString()),
            );

            const isFullyRepaid = newRemaining.lte(0);
            await tx.loanApplication.update({
              where: { id: schedule.loanId },
              data: {
                outstandingBalance: newRemaining.toFixed(4),
                status: isFullyRepaid ? LoanStatus.COMPLETED : LoanStatus.ACTIVE,
              },
            });

            // If loan record exists, update it too
            const existingLoan = await tx.loan.findFirst({ where: { applicationId: schedule.loanId } });
            if (existingLoan) {
              await tx.loan.update({
                where: { id: existingLoan.id },
                data: {
                  outstandingBalance: newRemaining.toFixed(4),
                  amountPaid: { increment: totalDue.toFixed(4) },
                  status: isFullyRepaid ? LoanStatus.COMPLETED : LoanStatus.ACTIVE,
                },
              });
            }

            // Record transaction
            const ref = CryptoUtil.generateTransactionReference('EMI-DEBIT');
            await tx.transaction.create({
              data: {
                reference: ref,
                userId: schedule.loan.userId,
                sourceAccountId: userAccount.id,
                type: TransactionType.LOAN_REPAYMENT,
                amount: totalDue.toFixed(4),
                fee: '0.0000',
                tax: '0.0000',
                netAmount: totalDue.toFixed(4),
                currencyCode: userAccount.currencyCode,
                status: TransactionStatus.SUCCESS,
                description: `Auto-Debit Loan EMI Installment #${schedule.installmentNumber}`,
                metadata: {
                  loanId: schedule.loanId,
                  installmentNumber: schedule.installmentNumber,
                  principalPaid: schedule.principalDue.toString(),
                  interestPaid: schedule.interestDue.toString(),
                },
              },
            });

            // Notification
            await tx.notification.create({
              data: {
                userId: schedule.loan.userId,
                title: 'Loan Installment Repayment Succeeded',
                message: `Auto-debit of ${userAccount.currencyCode} ${totalDue.toFixed(2)} for installment #${schedule.installmentNumber} was successful. Remaining balance: ${userAccount.currencyCode} ${newRemaining.toFixed(2)}.`,
                type: 'LOAN',
              },
            });
          });

          settledCount++;
        }
      } catch (err: any) {
        this.logger.error(`Error processing loan schedule ${schedule.id}: ${err?.message}`);
      }
    }

    this.logger.log(`Loan auto-debit completed. Settled ${settledCount} schedules.`);
    return { settledCount };
  }

  // ===========================================================================
  // 6. LOAN OVERDUE PROCESSING & CONTRACTUAL LATE PENALTY DAEMON
  // Runs daily at 03:00: Assesses late penalty, updates status to OVERDUE
  // ===========================================================================
  @Cron('0 3 * * *')
  async handleLoanOverdueProcessing() {
    this.logger.log('Executing loan overdue processing and penalty assessment daemon...');
    const now = new Date();

    const overdueSchedules = await this.prisma.loanSchedule.findMany({
      where: {
        status: { in: [LoanScheduleStatus.PENDING, LoanScheduleStatus.OVERDUE] },
        dueDate: {
          lt: now,
        },
        loan: {
          status: { in: [LoanStatus.ACTIVE, LoanStatus.DEFAULTED] },
        },
      },
      include: {
        loan: {
          include: {
            product: true,
            account: true,
            user: { include: { profile: true } },
          },
        },
      },
    });

    let overdueCount = 0;
    let penaltyAssessedCount = 0;
    let totalPenaltiesVolume = new Decimal('0.0000');

    for (const schedule of overdueSchedules) {
      try {
        const principalDue = new Decimal(schedule.principalDue.toString());
        const latePenaltyPct = schedule.loan.product?.latePenaltyPercentage
          ? new Decimal(schedule.loan.product.latePenaltyPercentage.toString())
          : new Decimal('2.00');

        // Penalty = principalDue * (latePenaltyPct / 100)
        const penaltyAmount = principalDue.times(latePenaltyPct.dividedBy(100)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

        // Check if penalty has already been assessed on this schedule (feeDue > 0)
        const hasPenaltyBeenAssessed = new Decimal(schedule.feeDue.toString()).gt(0);

        await this.prisma.$transaction(async (tx) => {
          if (!hasPenaltyBeenAssessed && penaltyAmount.gt(0)) {
            // Assess late penalty fee on schedule
            await tx.loanSchedule.update({
              where: { id: schedule.id },
              data: {
                status: LoanScheduleStatus.OVERDUE,
                feeDue: penaltyAmount.toFixed(4),
                totalDue: { increment: penaltyAmount.toFixed(4) },
              },
            });

            // Update loan application outstanding balance
            await tx.loanApplication.update({
              where: { id: schedule.loanId },
              data: {
                outstandingBalance: { increment: penaltyAmount.toFixed(4) },
              },
            });

            // Post Penalty Transaction
            const ref = CryptoUtil.generateTransactionReference('LATE-PENALTY');
            await tx.transaction.create({
              data: {
                reference: ref,
                userId: schedule.loan.userId,
                destinationAccountId: schedule.loan.accountId,
                type: TransactionType.FEE,
                amount: penaltyAmount.toFixed(4),
                fee: '0.0000',
                tax: '0.0000',
                netAmount: penaltyAmount.toFixed(4),
                currencyCode: schedule.loan.account.currencyCode,
                status: TransactionStatus.SUCCESS,
                description: `Contractual Late Repayment Penalty (${latePenaltyPct}% on Installment #${schedule.installmentNumber})`,
                metadata: {
                  loanId: schedule.loanId,
                  installmentNumber: schedule.installmentNumber,
                  penaltyPercentage: latePenaltyPct.toFixed(2),
                },
              },
            });

            penaltyAssessedCount++;
            totalPenaltiesVolume = totalPenaltiesVolume.plus(penaltyAmount);
          } else {
            // Just ensure schedule status is OVERDUE
            await tx.loanSchedule.update({
              where: { id: schedule.id },
              data: { status: LoanScheduleStatus.OVERDUE },
            });
          }
        });

        // Dispatch urgent overdue warning
        const user = schedule.loan.user;
        await this.notificationsService.dispatchMultiChannelNotification({
          userId: user.id,
          title: 'URGENT: Overdue Loan Repayment Alert',
          message: `Your loan installment #${schedule.installmentNumber} is past due. A late penalty fee of ${schedule.loan.account.currencyCode} ${penaltyAmount.toFixed(2)} has been assessed. Please fund your account immediately to prevent credit default.`,
          type: 'LOAN',
          emailSubject: `URGENT: Overdue Loan Installment #${schedule.installmentNumber}`,
          emailHtml: `<p>Dear ${user.profile?.firstName || user.username},</p><p>Your loan installment #${schedule.installmentNumber} is currently <strong>OVERDUE</strong>. A contractual late penalty fee of <strong>${schedule.loan.account.currencyCode} ${penaltyAmount.toFixed(2)}</strong> has been applied.</p><p>Please settle the outstanding balance immediately to avoid credit reporting escalation.</p>`,
          smsMessage: `Silverhawk Urgent: Loan installment #${schedule.installmentNumber} is overdue. Late fee applied. Please fund your account immediately.`,
        });

        overdueCount++;
      } catch (err: any) {
        this.logger.error(`Error processing overdue loan schedule ${schedule.id}: ${err?.message}`);
      }
    }

    this.logger.log(`Overdue loan processing completed. Flagged ${overdueCount} schedules, assessed ${penaltyAssessedCount} penalties totaling $${totalPenaltiesVolume.toFixed(2)}.`);
    return { overdueCount, penaltyAssessedCount, totalPenaltiesVolume: totalPenaltiesVolume.toFixed(4) };
  }

  // ===========================================================================
  // 7. SCHEDULED STANDING ORDERS & RECURRING TRANSFERS DAEMON
  // Runs hourly: Sweeps and executes due recurring wire / standing orders
  // ===========================================================================
  @Cron(CronExpression.EVERY_HOUR)
  async handleScheduledStandingOrders() {
    this.logger.log('Executing automated standing orders recurring daemon...');
    const result = await this.standingOrdersService.processDueStandingOrders();
    this.logger.log(
      `Standing orders sweep completed. Processed: ${result.processed}, Executed: ${result.executed}, Failed: ${result.failed}`,
    );
    return result;
  }

  // ===========================================================================
  // 8. KYC DOCUMENT EXPIRATION CHECK DAEMON
  // Runs daily at 04:00: Sweeps documents expiring within 30 days or past due
  // ===========================================================================
  @Cron('0 4 * * *')
  async handleKycExpirationCheck() {
    this.logger.log('Executing daily KYC document expiration check daemon...');
    const now = new Date();
    const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const expiringDocs = await this.prisma.kycDocument.findMany({
      where: {
        expiryDate: {
          lte: thirtyDaysAhead,
        },
        status: { in: [KycStatus.APPROVED, KycStatus.PENDING] },
      },
      include: {
        kycProfile: {
          include: {
            user: { include: { profile: true } },
          },
        },
      },
    });

    let expiredCount = 0;
    let warnedCount = 0;

    for (const doc of expiringDocs) {
      try {
        const isPastExpiry = doc.expiryDate && doc.expiryDate <= now;
        const user = doc.kycProfile.user;

        if (isPastExpiry) {
          // Document has expired
          await this.prisma.kycDocument.update({
            where: { id: doc.id },
            data: { status: KycStatus.REJECTED, rejectionReason: 'Document expired on ' + doc.expiryDate?.toISOString().slice(0, 10) },
          });

          await this.notificationsService.dispatchMultiChannelNotification({
            userId: user.id,
            title: 'KYC Document Expired',
            message: `Your submitted ${doc.documentType} has expired. Please upload an updated valid identification document in your profile to maintain full banking privileges.`,
            type: 'COMPLIANCE',
          });
          expiredCount++;
        } else {
          // Expiring within 30 days warning
          const expiryDateStr = doc.expiryDate?.toISOString().slice(0, 10);
          await this.notificationsService.dispatchMultiChannelNotification({
            userId: user.id,
            title: 'KYC Document Expiring Soon',
            message: `Your ${doc.documentType} will expire on ${expiryDateStr}. Please prepare a renewed identification document for verification.`,
            type: 'COMPLIANCE',
          });
          warnedCount++;
        }
      } catch (err: any) {
        this.logger.error(`Error processing KYC doc expiration for ${doc.id}: ${err?.message}`);
      }
    }

    this.logger.log(`KYC expiration check completed. Flagged ${expiredCount} expired documents, sent ${warnedCount} renewal warnings.`);
    return { expiredCount, warnedCount };
  }

  // ===========================================================================
  // 9. VIRTUAL & PHYSICAL CARD EXPIRY SWEEPER
  // Runs 1st of every month: Marks expired debit/credit cards
  // ===========================================================================
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async handleCardExpirySweep() {
    this.logger.log('Executing monthly card expiry sweep...');
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const cards = await this.prisma.card.findMany({
      where: {
        status: CardStatus.ACTIVE,
      },
    });

    let expiredCount = 0;
    for (const card of cards) {
      const isExpired =
        card.expiryYear < currentYear ||
        (card.expiryYear === currentYear && card.expiryMonth < currentMonth);

      if (isExpired) {
        await this.prisma.card.update({
          where: { id: card.id },
          data: { status: CardStatus.EXPIRED },
        });
        expiredCount++;
      }
    }

    this.logger.log(`Card expiry sweep completed. Updated ${expiredCount} expired cards.`);
    return { expiredCount };
  }

  // ===========================================================================
  // 10. OTP EXPIRATION & PURGE DAEMON
  // Runs hourly: Purges expired or used OTPs to maintain cryptographic hygiene
  // ===========================================================================
  @Cron(CronExpression.EVERY_HOUR)
  async handleOtpExpiration() {
    this.logger.log('Executing hourly OTP cleanup and expiration daemon...');
    const now = new Date();

    const deleted = await this.prisma.otpVerification.deleteMany({
      where: {
        OR: [
          { isUsed: true },
          { expiresAt: { lte: now } },
        ],
      },
    });

    this.logger.log(`OTP cleanup completed. Purged ${deleted.count} expired/consumed tokens.`);
    return { purgedOtps: deleted.count };
  }

  // ===========================================================================
  // 11. SESSION CLEANUP & STALE NOTIFICATION PRUNING
  // Runs weekly: Purges dead sessions > 30 days and read notifications > 90 days
  // ===========================================================================
  @Cron(CronExpression.EVERY_WEEK)
  async handleSessionCleanupAndNotificationPruning() {
    this.logger.log('Executing weekly session and notification maintenance daemon...');
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [deletedSessions, prunedNotifications] = await Promise.all([
      this.prisma.session.deleteMany({
        where: {
          OR: [
            { isRevoked: true },
            { expiresAt: { lte: thirtyDaysAgo } },
          ],
        },
      }),
      this.prisma.notification.deleteMany({
        where: {
          isRead: true,
          createdAt: { lte: ninetyDaysAgo },
        },
      }),
    ]);

    this.logger.log(`Maintenance completed. Purged ${deletedSessions.count} dead sessions and pruned ${prunedNotifications.count} stale notifications.`);
    return {
      purgedSessions: deletedSessions.count,
      prunedNotifications: prunedNotifications.count,
    };
  }
}
