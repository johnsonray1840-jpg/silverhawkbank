import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  LedgerAccountType,
  LedgerEntryType,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { PlatformSettingsUtil } from '../../common/utils/platform-settings.util';
import { ProcessReferralRewardDto, QueryReferralsDto } from './dto/referral.dto';

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
  ) {}

  /**
   * Get customer's unique referral code, shareable URL and program terms
   */
  async getMyReferralCode(userId: string) {
    let user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, referralCode: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Ensure user has a referral code
    if (!user.referralCode) {
      const generatedCode = `REF-${user.username.toUpperCase()}`;
      user = await this.prisma.user.update({
        where: { id: userId },
        data: { referralCode: generatedCode },
        select: { id: true, username: true, referralCode: true },
      });
    }

    const bonusSetting = PlatformSettingsUtil.DEFINITIONS['referral_bonus_amount']?.defaultValue || '25.00';
    const baseUrl = process.env.APP_URL || process.env.FRONTEND_URL || '';
    const referralLink = baseUrl ? `${baseUrl}/register?ref=${user.referralCode}` : `/register?ref=${user.referralCode}`;

    return {
      referralCode: user.referralCode,
      referralLink,
      rewardAmount: bonusSetting,
      currency: 'USD',
      programTerms: `Earn $${bonusSetting} for every qualified client who opens an account and completes identity verification.`,
    };
  }

  /**
   * Get referral statistics for customer dashboard
   */
  async getReferralStats(userId: string) {
    const referredUsers = await this.prisma.user.findMany({
      where: { referredById: userId },
      select: {
        id: true,
        status: true,
        createdAt: true,
        kycProfile: {
          select: {
            status: true,
          },
        },
      },
    });

    const totalReferred = referredUsers.length;
    const activeReferrals = referredUsers.filter(
      (u) => u.status === 'ACTIVE' && u.kycProfile?.status === 'APPROVED',
    ).length;

    const commissions = await this.prisma.referralCommission.findMany({
      where: { referrerId: userId },
    });

    let totalEarned = new Decimal(0);
    let pendingEarnings = new Decimal(0);

    for (const comm of commissions) {
      const amount = new Decimal(comm.amount);
      if (comm.isPaid) {
        totalEarned = totalEarned.plus(amount);
      } else {
        pendingEarnings = pendingEarnings.plus(amount);
      }
    }

    return {
      totalReferred,
      activeReferrals,
      pendingReferrals: totalReferred - activeReferrals,
      totalEarned: totalEarned.toFixed(2),
      pendingEarnings: pendingEarnings.toFixed(2),
      currency: 'USD',
    };
  }

  /**
   * List referred users with masked identities
   */
  async getReferredUsers(userId: string, query?: QueryReferralsDto) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Number(query?.limit) || 20);
    const skip = (page - 1) * limit;

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where: { referredById: userId } }),
      this.prisma.user.findMany({
        where: { referredById: userId },
        select: {
          id: true,
          username: true,
          status: true,
          createdAt: true,
          profile: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
          kycProfile: {
            select: {
              status: true,
            },
          },
          referredCommissions: {
            where: { referrerId: userId },
            select: {
              amount: true,
              isPaid: true,
              paidAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const formatted = users.map((u) => {
      const first = u.profile?.firstName || u.username;
      const last = u.profile?.lastName || '';
      const maskedName = `${first.charAt(0)}*** ${last ? last.charAt(0) + '***' : ''}`.trim();
      const commission = u.referredCommissions[0];

      return {
        id: u.id,
        maskedName,
        username: `${u.username.substring(0, 2)}***`,
        joinDate: u.createdAt,
        accountStatus: u.status,
        kycStatus: u.kycProfile?.status || 'NOT_SUBMITTED',
        rewardStatus: commission?.isPaid ? 'PAID' : commission ? 'PENDING' : 'NOT_QUALIFIED',
        rewardAmount: commission ? commission.amount.toString() : null,
      };
    });

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      referredUsers: formatted,
    };
  }

  /**
   * List customer referral reward payout history
   */
  async getReferralHistory(userId: string, query?: QueryReferralsDto) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Number(query?.limit) || 20);
    const skip = (page - 1) * limit;

    const where: any = { referrerId: userId };
    if (query?.isPaid !== undefined) {
      where.isPaid = query.isPaid;
    }

    const [total, commissions] = await Promise.all([
      this.prisma.referralCommission.count({ where }),
      this.prisma.referralCommission.findMany({
        where,
        include: {
          referredUser: {
            select: {
              id: true,
              username: true,
              profile: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      history: commissions.map((c) => ({
        id: c.id,
        amount: c.amount.toString(),
        currency: c.currencyCode,
        isPaid: c.isPaid,
        paidAt: c.paidAt,
        createdAt: c.createdAt,
        referredUser: c.referredUser?.username || 'Client',
      })),
    };
  }

  /**
   * Process & disburse qualifying referral reward with General Ledger double-entry record
   */
  async processQualifyingReward(adminId: string, dto: ProcessReferralRewardDto) {
    const referredUser = await this.prisma.user.findUnique({
      where: { id: dto.referredUserId },
      include: { referredBy: { include: { bankAccounts: true, profile: true } } },
    });

    if (!referredUser) {
      throw new NotFoundException('Referred user not found');
    }

    if (!referredUser.referredById || !referredUser.referredBy) {
      throw new BadRequestException('User was not referred by any registered customer');
    }

    const referrer = referredUser.referredBy;

    // Check if commission already paid for this referred user
    const existingCommission = await this.prisma.referralCommission.findFirst({
      where: {
        referredUserId: dto.referredUserId,
        referrerId: referrer.id,
        isPaid: true,
      },
    });

    if (existingCommission) {
      throw new BadRequestException('Referral reward has already been disbursed for this referred customer');
    }

    // Determine reward amount
    const rewardAmount = dto.customAmount
      ? new Decimal(dto.customAmount)
      : new Decimal(PlatformSettingsUtil.DEFINITIONS['referral_bonus_amount']?.defaultValue || '25.00');

    if (rewardAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Reward amount must be greater than zero');
    }

    const currencyCode = dto.currencyCode || 'USD';

    // Find referrer's active account in matching currency, or primary account
    let targetAccount = referrer.bankAccounts.find((a) => a.currencyCode === currencyCode && !a.isFrozen);
    if (!targetAccount) {
      targetAccount = referrer.bankAccounts.find((a) => !a.isFrozen) || referrer.bankAccounts[0];
    }

    if (!targetAccount) {
      throw new BadRequestException('Referrer has no open bank accounts to receive bonus payment');
    }

    const rewardRef = CryptoUtil.generateTransactionReference('REF');

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create or update ReferralCommission
      const commission = await tx.referralCommission.create({
        data: {
          referrerId: referrer.id,
          referredUserId: dto.referredUserId,
          amount: rewardAmount.toFixed(4),
          currencyCode: targetAccount.currencyCode,
          isPaid: true,
          paidAt: new Date(),
        },
      });

      // 2. Create business transaction
      const transaction = await tx.transaction.create({
        data: {
          reference: rewardRef,
          userId: referrer.id,
          destinationAccountId: targetAccount.id,
          type: TransactionType.DEPOSIT,
          amount: rewardAmount.toFixed(4),
          fee: '0.0000',
          netAmount: rewardAmount.toFixed(4),
          currencyCode: targetAccount.currencyCode,
          status: TransactionStatus.SUCCESS,
          description: dto.note || `Referral bonus reward for inviting @${referredUser.username}`,
          metadata: {
            rewardType: 'CUSTOMER_REFERRAL_BONUS',
            referredUserId: dto.referredUserId,
            commissionId: commission.id,
          },
        },
      });

      // 3. Credit referrer bank account
      const updatedAccount = await tx.bankAccount.update({
        where: { id: targetAccount.id },
        data: {
          currentBalance: { increment: rewardAmount.toFixed(4) },
          availableBalance: { increment: rewardAmount.toFixed(4) },
        },
      });

      // 4. Post Double-Entry General Ledger balancing records
      const expenseAccountCode = '5020-MARKETING-REFERRALS';
      const customerLiabilityCode = `2010-${targetAccount.accountNumber}`;

      const expenseLedgerAccount = await tx.ledgerAccount.upsert({
        where: { accountCode: expenseAccountCode },
        update: {},
        create: {
          accountCode: expenseAccountCode,
          name: 'Customer Referral Marketing & Rewards Expense',
          type: LedgerAccountType.EXPENSE,
          currencyCode: targetAccount.currencyCode,
        },
      });

      const customerLedgerAccount = await tx.ledgerAccount.upsert({
        where: { accountCode: customerLiabilityCode },
        update: {},
        create: {
          accountCode: customerLiabilityCode,
          name: `Customer Deposit Liability #${targetAccount.accountNumber}`,
          type: LedgerAccountType.LIABILITY,
          currencyCode: targetAccount.currencyCode,
        },
      });

      const journal = await tx.journalTransaction.create({
        data: {
          transactionId: transaction.id,
          reference: `JRN-${rewardRef}`,
          description: `Disbursement of customer referral reward for referee #${dto.referredUserId}`,
        },
      });

      // Debit Marketing Expense Account
      await tx.ledgerEntry.create({
        data: {
          journalTransactionId: journal.id,
          ledgerAccountId: expenseLedgerAccount.id,
          entryType: LedgerEntryType.DEBIT,
          amount: rewardAmount.toFixed(4),
          currencyCode: targetAccount.currencyCode,
          exchangeRate: '1.000000',
        },
      });

      // Credit Customer Deposit Liability Account
      await tx.ledgerEntry.create({
        data: {
          journalTransactionId: journal.id,
          ledgerAccountId: customerLedgerAccount.id,
          entryType: LedgerEntryType.CREDIT,
          amount: rewardAmount.toFixed(4),
          currencyCode: targetAccount.currencyCode,
          exchangeRate: '1.000000',
        },
      });

      // 5. In-App Notification
      await tx.notification.create({
        data: {
          userId: referrer.id,
          title: 'Referral Bonus Received',
          message: `Congratulations! You received a ${targetAccount.currencyCode} ${rewardAmount.toFixed(2)} referral reward for referring ${referredUser.username}.`,
          type: 'REFERRAL',
        },
      });

      // 6. Audit Trail
      await tx.auditLog.create({
        data: {
          actorId: adminId || 'usr_system_cron',
          action: 'REFERRAL_REWARD_DISBURSED',
          resource: 'ReferralCommission',
          resourceId: commission.id,
          afterState: {
            referrerId: referrer.id,
            referredUserId: dto.referredUserId,
            amount: rewardAmount.toFixed(4),
            currency: targetAccount.currencyCode,
            transactionReference: rewardRef,
          },
        },
      });

      return {
        commission,
        transaction,
        creditedAccount: targetAccount.accountNumber,
        newBalance: updatedAccount.currentBalance.toString(),
      };
    });

    this.logger.log(`Disbursed ${currencyCode} ${rewardAmount} referral bonus to referrer ${referrer.id}`);

    return {
      success: true,
      message: `Referral reward of ${currencyCode} ${rewardAmount.toFixed(2)} successfully disbursed to referrer`,
      data: result,
    };
  }
}

