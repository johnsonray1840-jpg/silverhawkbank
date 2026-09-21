import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  AccountStatus,
  LedgerEntryType,
  Prisma,
  TransactionStatus,
  TransactionType,
  WithdrawalStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { EmailService } from '../email/email.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { RequestWithdrawalDto } from './dto/request-withdrawal.dto';
import { ReviewWithdrawalDto } from './dto/review-withdrawal.dto';
import { QueryWithdrawalsDto } from './dto/query-withdrawals.dto';

@Injectable()
export class WithdrawalsService {
  constructor(
    private prisma: PrismaService,
    private ledgerService: LedgerService,
    private emailService: EmailService,
  ) {}

  /**
   * Customer initiates a local or international wire withdrawal request
   */
  async requestWithdrawal(userId: string, dto: RequestWithdrawalDto) {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.transaction.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        include: { withdrawal: true },
      });
      if (existing) {
        return {
          message: 'Withdrawal request recorded (idempotent replay)',
          transaction: existing,
        };
      }
    }

    const withdrawAmount = new Decimal(dto.amount);
    if (withdrawAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Withdrawal amount must be greater than zero');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.pinHash) {
      throw new BadRequestException('Transaction PIN is not set. Please configure your PIN in security settings.');
    }

    const isPinValid = await CryptoUtil.verify(user.pinHash, dto.pin);
    if (!isPinValid) {
      throw new BadRequestException('Invalid transaction authorization PIN');
    }

    // Calculate withdrawal fee (1.0% with minimum $5.00)
    const feeSetting = await this.prisma.systemSetting.findUnique({ where: { key: 'withdrawal_fee_pct' } });
    const feePct = new Decimal(feeSetting?.value || '1.00').dividedBy(100);
    const calculatedFee = withdrawAmount.times(feePct);
    const fee = Decimal.max(calculatedFee, new Decimal('5.0000'));
    const totalDeduction = withdrawAmount.plus(fee);

    const withdrawalRef = CryptoUtil.generateTransactionReference('WTH');

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Lock Source Bank Account
      const account = await tx.bankAccount.findUnique({
        where: { id: dto.accountId },
      });

      if (!account || account.userId !== userId) {
        throw new ForbiddenException('Invalid source bank account');
      }

      if (account.status !== AccountStatus.ACTIVE || account.isFrozen) {
        throw new ForbiddenException('Bank account is frozen or inactive');
      }

      const availableBalance = new Decimal(account.availableBalance.toString());
      if (availableBalance.lessThan(totalDeduction)) {
        throw new BadRequestException('INSUFFICIENT_FUNDS: Available balance is insufficient for withdrawal amount + processing fee');
      }

      // Check daily limits
      const dailyLimit = new Decimal(account.dailyWithdrawalLimit.toString());
      if (withdrawAmount.greaterThan(dailyLimit)) {
        throw new BadRequestException(`Withdrawal exceeds your daily limit of ${dailyLimit.toFixed(2)} ${account.currencyCode}`);
      }

      // 2. Debit Account Balance (Held in clearing escrow until payout completion)
      await tx.bankAccount.update({
        where: { id: account.id },
        data: {
          currentBalance: { decrement: totalDeduction.toFixed(4) },
          availableBalance: { decrement: totalDeduction.toFixed(4) },
          ledgerBalance: { decrement: totalDeduction.toFixed(4) },
        },
      });

      const destinationDetails = {
        method: dto.method || 'BANK_WIRE',
        bankName: dto.bankName,
        accountName: dto.accountName,
        accountNumber: dto.accountNumber,
        routingNumber: dto.routingNumber || null,
        swiftBic: dto.swiftBic || null,
        country: dto.country || 'International',
        beneficiaryAddress: dto.beneficiaryAddress || null,
      };

      // 3. Create Transaction Record (Status: PROCESSING)
      const businessTx = await tx.transaction.create({
        data: {
          reference: withdrawalRef,
          idempotencyKey: dto.idempotencyKey || null,
          userId,
          sourceAccountId: account.id,
          type: TransactionType.WITHDRAWAL,
          amount: withdrawAmount.toFixed(4),
          fee: fee.toFixed(4),
          netAmount: withdrawAmount.toFixed(4),
          currencyCode: account.currencyCode,
          status: TransactionStatus.PROCESSING,
          description: `Withdrawal to ${dto.bankName} (${dto.accountNumber})`,
          metadata: destinationDetails,
        },
      });

      // 4. Create Withdrawal Entity
      await tx.withdrawal.create({
        data: {
          transactionId: businessTx.id,
          accountId: account.id,
          destinationDetails,
          status: WithdrawalStatus.REQUESTED,
        },
      });

      // 5. Audit Log
      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorRole: 'CUSTOMER',
          action: 'WITHDRAWAL_REQUEST',
          resource: 'Withdrawal',
          resourceId: businessTx.id,
          beforeState: { availableBalance: account.availableBalance.toString() },
          afterState: {
            amount: withdrawAmount.toFixed(4),
            fee: fee.toFixed(4),
            reference: withdrawalRef,
            destination: destinationDetails,
          },
        },
      });

      // 6. In-App Notification
      await tx.notification.create({
        data: {
          userId,
          title: 'Withdrawal Request Submitted',
          message: `Your withdrawal of ${account.currencyCode} ${withdrawAmount.toFixed(2)} to ${dto.bankName} (#${dto.accountNumber}) is currently being processed.`,
          type: 'WITHDRAWAL',
        },
      });

      return businessTx;
    });

    // 6. Dispatch Debit Alert Email
    const account = await this.prisma.bankAccount.findUnique({ where: { id: dto.accountId } });
    const customerName = user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user.username;

    await this.emailService.sendDebitAlert({
      to: user.email,
      senderName: customerName,
      amount: withdrawAmount.toFixed(4),
      currency: account!.currencyCode,
      recipientName: `${dto.accountName} (${dto.bankName})`,
      accountNumber: account!.accountNumber,
      reference: withdrawalRef,
      description: `Outbound wire payout to ${dto.bankName}`,
      availableBalance: account!.availableBalance.toString(),
    });

    return {
      message: 'Withdrawal request submitted successfully and queued for payout processing',
      reference: withdrawalRef,
      transaction: result,
    };
  }

  /**
   * List customer or global withdrawals with filters
   */
  async getWithdrawals(queryDto: QueryWithdrawalsDto, userId?: string) {
    const { page = 1, limit = 20, status, startDate, endDate } = queryDto;
    const skip = (page - 1) * limit;

    const where: Prisma.WithdrawalWhereInput = {};

    if (userId) {
      where.account = { userId };
    }

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [withdrawals, total] = await Promise.all([
      this.prisma.withdrawal.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          account: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  username: true,
                  profile: true,
                },
              },
            },
          },
          transaction: true,
        },
      }),
      this.prisma.withdrawal.count({ where }),
    ]);

    return {
      data: withdrawals,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Admin: Review, approve, complete, or reject a withdrawal request
   */
  async reviewWithdrawal(withdrawalId: string, dto: ReviewWithdrawalDto, adminId?: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: {
        account: {
          include: {
            user: { include: { profile: true } },
          },
        },
        transaction: true,
      },
    });

    if (!withdrawal) {
      throw new NotFoundException('Withdrawal record not found');
    }

    if (
      withdrawal.status === WithdrawalStatus.COMPLETED ||
      withdrawal.status === WithdrawalStatus.REJECTED
    ) {
      throw new BadRequestException(`Withdrawal has already been finalized with status: ${withdrawal.status}`);
    }

    const amount = new Decimal(withdrawal.transaction.amount.toString());
    const fee = new Decimal(withdrawal.transaction.fee.toString());
    const totalDeduction = amount.plus(fee);
    const isCompleted = dto.status === WithdrawalStatus.COMPLETED || dto.status === WithdrawalStatus.APPROVED;

    const result = await this.prisma.$transaction(async (tx) => {
      if (isCompleted) {
        // 1. Update Withdrawal and Transaction status
        await tx.withdrawal.update({
          where: { id: withdrawal.id },
          data: {
            status: WithdrawalStatus.COMPLETED,
            approvedBy: adminId || 'ADMIN',
          },
        });

        await tx.transaction.update({
          where: { id: withdrawal.transactionId },
          data: { status: TransactionStatus.SUCCESS },
        });

        // 2. Post Double-Entry Journal: Debit Customer Liability (2010-<acc>), Credit Vault Asset (1010), Credit Fee Revenue (4010)
        const customerLedgerAccountCode = `2010-${withdrawal.account.accountNumber}`;
        const journalEntries: any[] = [
          {
            accountCode: customerLedgerAccountCode,
            entryType: LedgerEntryType.DEBIT,
            amount: totalDeduction.toFixed(4),
            currencyCode: withdrawal.account.currencyCode,
          },
          {
            accountCode: '1010', // Cash / Vault Settlement Asset
            entryType: LedgerEntryType.CREDIT,
            amount: amount.toFixed(4),
            currencyCode: withdrawal.account.currencyCode,
          },
        ];

        if (fee.greaterThan(0)) {
          journalEntries.push({
            accountCode: '4010', // Fee Revenue
            entryType: LedgerEntryType.CREDIT,
            amount: fee.toFixed(4),
            currencyCode: withdrawal.account.currencyCode,
          });
        }

        await this.ledgerService.postJournalEntry(
          tx,
          {
            reference: `JRN-${withdrawal.transaction.reference}`,
            transactionId: withdrawal.transaction.id,
            description: `Withdrawal Settlement for #${withdrawal.account.accountNumber}`,
            entries: journalEntries,
          },
          adminId,
        );

        // 3. Notification
        await tx.notification.create({
          data: {
            userId: withdrawal.account.userId,
            title: 'Withdrawal Completed',
            message: `Your withdrawal of ${withdrawal.account.currencyCode} ${amount.toFixed(2)} has been cleared and settled to your external bank account.`,
            type: 'WITHDRAWAL',
          },
        });
      } else if (dto.status === WithdrawalStatus.REJECTED) {
        // Reject: Re-credit customer bank account
        await tx.bankAccount.update({
          where: { id: withdrawal.accountId },
          data: {
            currentBalance: { increment: totalDeduction.toFixed(4) },
            availableBalance: { increment: totalDeduction.toFixed(4) },
            ledgerBalance: { increment: totalDeduction.toFixed(4) },
          },
        });

        await tx.withdrawal.update({
          where: { id: withdrawal.id },
          data: {
            status: WithdrawalStatus.REJECTED,
            approvedBy: adminId || 'ADMIN',
            rejectionReason: dto.reason || 'Verification failed',
          },
        });

        await tx.transaction.update({
          where: { id: withdrawal.transactionId },
          data: { status: TransactionStatus.FAILED },
        });

        await tx.notification.create({
          data: {
            userId: withdrawal.account.userId,
            title: 'Withdrawal Rejected',
            message: `Your withdrawal of ${withdrawal.account.currencyCode} ${amount.toFixed(2)} was rejected and funds were refunded to your account. Reason: ${dto.reason || 'Information mismatch'}`,
            type: 'WITHDRAWAL',
          },
        });
      }

      // 4. Audit Log
      await tx.auditLog.create({
        data: {
          actorId: adminId || null,
          actorRole: 'FINANCE_MANAGER',
          action: `WITHDRAWAL_REVIEW_${dto.status}`,
          resource: 'Withdrawal',
          resourceId: withdrawal.id,
          beforeState: { status: withdrawal.status },
          afterState: { status: dto.status, reason: dto.reason || null },
        },
      });

      return withdrawal;
    });

    // 5. Dispatch Status Update Email
    const user = withdrawal.account.user;
    const customerName = user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user.username;

    await this.emailService.sendStatusAlert({
      to: user.email,
      customerName,
      amount: amount.toFixed(4),
      currency: withdrawal.account.currencyCode,
      status: dto.status,
      reference: withdrawal.transaction.reference,
      reason: dto.reason,
      type: 'WITHDRAWAL',
    });

    return {
      message: `Withdrawal request successfully ${isCompleted ? 'completed' : 'rejected'}`,
      withdrawalId,
      status: dto.status,
    };
  }

  /**
   * Admin: Execute an immutable compensating reversal on a settled withdrawal
   */
  async reverseWithdrawal(withdrawalId: string, reason: string, adminId?: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: {
        account: true,
        transaction: {
          include: {
            journalTransaction: {
              include: { entries: { include: { ledgerAccount: true } } },
            },
          },
        },
      },
    });

    if (!withdrawal) {
      throw new NotFoundException('Withdrawal record not found');
    }

    if (withdrawal.status === WithdrawalStatus.REVERSED) {
      throw new BadRequestException('This withdrawal has already been reversed');
    }

    if (withdrawal.status !== WithdrawalStatus.COMPLETED) {
      throw new BadRequestException('Only completed withdrawals can be reversed');
    }

    const amount = new Decimal(withdrawal.transaction.amount.toString());
    const fee = new Decimal(withdrawal.transaction.fee.toString());
    const totalRefund = amount.plus(fee);
    const reversalRef = CryptoUtil.generateTransactionReference('REV-WTH');

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Mark withdrawal & original transaction as REVERSED
      await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: WithdrawalStatus.REVERSED },
      });

      await tx.transaction.update({
        where: { id: withdrawal.transactionId },
        data: { status: TransactionStatus.REVERSED },
      });

      // 2. Re-credit customer bank account
      await tx.bankAccount.update({
        where: { id: withdrawal.accountId },
        data: {
          currentBalance: { increment: totalRefund.toFixed(4) },
          availableBalance: { increment: totalRefund.toFixed(4) },
          ledgerBalance: { increment: totalRefund.toFixed(4) },
        },
      });

      // 3. Create Compensating Reversal Transaction
      const reversalTx = await tx.transaction.create({
        data: {
          reference: reversalRef,
          userId: withdrawal.account.userId,
          destinationAccountId: withdrawal.accountId,
          type: TransactionType.REVERSAL,
          amount: amount.toFixed(4),
          fee: '0.0000',
          netAmount: totalRefund.toFixed(4),
          currencyCode: withdrawal.account.currencyCode,
          status: TransactionStatus.SUCCESS,
          description: `Withdrawal Reversal (${withdrawal.transaction.reference}): ${reason}`,
          metadata: {
            originalTransactionReference: withdrawal.transaction.reference,
            originalWithdrawalId: withdrawal.id,
            reason,
            reversedBy: adminId || 'SYSTEM_ADMIN',
          },
        },
      });

      // 4. Reverse Double-Entry Journal Postings
      const customerLedgerAccountCode = `2010-${withdrawal.account.accountNumber}`;
      await this.ledgerService.postJournalEntry(
        tx,
        {
          reference: `JRN-${reversalRef}`,
          transactionId: reversalTx.id,
          description: `Compensating Reversal for JRN-${withdrawal.transaction.reference}`,
          entries: [
            {
              accountCode: '1010', // Vault / Settlement Asset
              entryType: LedgerEntryType.DEBIT,
              amount: amount.toFixed(4),
              currencyCode: withdrawal.account.currencyCode,
            },
            {
              accountCode: customerLedgerAccountCode,
              entryType: LedgerEntryType.CREDIT,
              amount: totalRefund.toFixed(4),
              currencyCode: withdrawal.account.currencyCode,
            },
            ...(fee.greaterThan(0)
              ? [
                  {
                    accountCode: '4010', // Fee reversal
                    entryType: LedgerEntryType.DEBIT,
                    amount: fee.toFixed(4),
                    currencyCode: withdrawal.account.currencyCode,
                  },
                ]
              : []),
          ],
        },
        adminId,
      );

      // 5. Audit Log
      await tx.auditLog.create({
        data: {
          actorId: adminId || null,
          actorRole: 'ADMIN',
          action: 'WITHDRAWAL_REVERSAL',
          resource: 'Withdrawal',
          resourceId: withdrawal.id,
          beforeState: { status: withdrawal.status },
          afterState: { status: WithdrawalStatus.REVERSED, reversalReference: reversalRef, reason },
        },
      });

      // 6. Notify Customer
      await tx.notification.create({
        data: {
          userId: withdrawal.account.userId,
          title: 'Withdrawal Reversed & Refunded',
          message: `Your withdrawal ${withdrawal.transaction.reference} for ${withdrawal.account.currencyCode} ${amount.toFixed(2)} was reversed and funds were returned to account #${withdrawal.account.accountNumber}. Reason: ${reason}`,
          type: 'WITHDRAWAL',
        },
      });

      return reversalTx;
    });

    return {
      message: 'Withdrawal successfully reversed with balance restoration and compensating ledger entries',
      reversalReference: reversalRef,
      transaction: result,
    };
  }
}

