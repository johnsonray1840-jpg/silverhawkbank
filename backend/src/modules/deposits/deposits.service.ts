import {
  BadRequestException,
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
import { EmailService } from '../email/email.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { InitiateDepositDto } from './dto/initiate-deposit.dto';
import { ReviewDepositDto } from './dto/review-deposit.dto';
import { QueryDepositsDto } from './dto/query-deposits.dto';

@Injectable()
export class DepositsService {
  constructor(
    private prisma: PrismaService,
    private ledgerService: LedgerService,
    private emailService: EmailService,
  ) {}

  /**
   * Get official bank wire and settlement deposit routing instructions
   */
  async getDepositInstructions(currency: string = 'USD') {
    return {
      bankName: 'Silverhawk Bank International',
      accountName: 'Silverhawk Global Settlement Vault',
      accountNumber: '400192837461',
      routingNumber: '021000021',
      swiftBic: 'REMIUS33',
      bankAddress: '100 Financial Plaza, Suite 2500, New York, NY 10005, USA',
      currency: currency.toUpperCase(),
      instructions: 'Please include your unique Silverhawk Account Number in the wire transfer memo/narrative field.',
    };
  }

  /**
   * Customer initiates a wire or manual bank deposit with proof document
   */
  async initiateDeposit(userId: string, dto: InitiateDepositDto) {
    const depositAmount = new Decimal(dto.amount);
    if (depositAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Deposit amount must be greater than zero');
    }

    const account = await this.prisma.bankAccount.findUnique({
      where: { id: dto.accountId },
      include: { user: { include: { profile: true } } },
    });

    if (!account || account.userId !== userId) {
      throw new NotFoundException('Invalid destination bank account');
    }

    const depositRef = CryptoUtil.generateTransactionReference('DEP');

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create Transaction (Status: PENDING)
      const businessTx = await tx.transaction.create({
        data: {
          reference: depositRef,
          userId,
          destinationAccountId: account.id,
          type: TransactionType.DEPOSIT,
          amount: depositAmount.toFixed(4),
          fee: '0.0000',
          netAmount: depositAmount.toFixed(4),
          currencyCode: account.currencyCode,
          status: TransactionStatus.PENDING,
          description: dto.description || `Bank deposit into #${account.accountNumber}`,
          metadata: {
            method: dto.method,
            paymentReference: dto.paymentReference || null,
            proofDocumentUrl: dto.proofDocumentUrl || null,
          },
        },
      });

      // 2. Create Deposit record
      await tx.deposit.create({
        data: {
          transactionId: businessTx.id,
          accountId: account.id,
          method: dto.method,
          paymentReference: dto.paymentReference || null,
          proofDocumentUrl: dto.proofDocumentUrl || null,
        },
      });

      // 3. Notification
      await tx.notification.create({
        data: {
          userId,
          title: 'Deposit Initiated',
          message: `Your deposit request #${depositRef} for ${account.currencyCode} ${depositAmount.toFixed(2)} is pending verification.`,
          type: 'DEPOSIT',
        },
      });

      return businessTx;
    });

    // Send email alert
    await this.emailService.sendStatusAlert({
      to: account.user.email,
      customerName: account.user.profile ? `${account.user.profile.firstName} ${account.user.profile.lastName}` : account.user.username,
      amount: depositAmount.toFixed(4),
      currency: account.currencyCode,
      status: 'PENDING',
      reference: depositRef,
      type: 'DEPOSIT',
    });

    return {
      message: 'Deposit request submitted successfully. Funds will be credited once verified by the settlement desk.',
      reference: depositRef,
      transaction: result,
    };
  }

  /**
   * Admin: List pending and historical deposits
   */
  async getDeposits(queryDto: QueryDepositsDto, userId?: string) {
    const { page = 1, limit = 20, status, startDate, endDate } = queryDto;
    const skip = (page - 1) * limit;

    const where: Prisma.DepositWhereInput = {};

    if (userId) {
      where.account = { userId };
    }

    if (status) {
      where.transaction = { status };
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [deposits, total] = await Promise.all([
      this.prisma.deposit.findMany({
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
      this.prisma.deposit.count({ where }),
    ]);

    return {
      data: deposits,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Admin: Approve or reject a pending deposit
   */
  async reviewDeposit(depositId: string, dto: ReviewDepositDto, adminId?: string) {
    const deposit = await this.prisma.deposit.findUnique({
      where: { id: depositId },
      include: {
        account: {
          include: {
            user: { include: { profile: true } },
          },
        },
        transaction: true,
      },
    });

    if (!deposit) {
      throw new NotFoundException('Deposit record not found');
    }

    if (deposit.transaction.status !== TransactionStatus.PENDING) {
      throw new BadRequestException(`Deposit has already been finalized with status: ${deposit.transaction.status}`);
    }

    const amount = new Decimal(deposit.transaction.amount.toString());
    const isApproved = dto.action === TransactionStatus.SUCCESS;

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Update Transaction and Deposit
      const updatedTx = await tx.transaction.update({
        where: { id: deposit.transactionId },
        data: { status: dto.action },
      });

      await tx.deposit.update({
        where: { id: deposit.id },
        data: { approvedBy: adminId || 'ADMIN' },
      });

      if (isApproved) {
        // 2. Increment Customer Bank Account Balance
        await tx.bankAccount.update({
          where: { id: deposit.accountId },
          data: {
            currentBalance: { increment: amount.toFixed(4) },
            availableBalance: { increment: amount.toFixed(4) },
            ledgerBalance: { increment: amount.toFixed(4) },
          },
        });

        // 3. Post Double-Entry Journal: Debit Cash/Vault Asset (1010), Credit Customer Liability (2010-<acc>)
        const customerLedgerAccountCode = `2010-${deposit.account.accountNumber}`;
        const journalEntries: any[] = [
          {
            accountCode: '1010', // Vault / Settlement Asset
            entryType: LedgerEntryType.DEBIT,
            amount: amount.toFixed(4),
            currencyCode: deposit.account.currencyCode,
          },
          {
            accountCode: customerLedgerAccountCode,
            entryType: LedgerEntryType.CREDIT,
            amount: amount.toFixed(4),
            currencyCode: deposit.account.currencyCode,
          },
        ];

        await this.ledgerService.postJournalEntry(
          tx,
          {
            reference: `JRN-${deposit.transaction.reference}`,
            transactionId: deposit.transaction.id,
            description: `Deposit Approval for #${deposit.account.accountNumber}: ${dto.reviewNotes || 'Wire transfer credit'}`,
            entries: journalEntries,
          },
          adminId,
        );

        // 4. In-App Notification
        await tx.notification.create({
          data: {
            userId: deposit.account.userId,
            title: 'Deposit Approved & Credited 🎉',
            message: `Your deposit of ${deposit.account.currencyCode} ${amount.toFixed(2)} has been verified and credited to account #${deposit.account.accountNumber}.`,
            type: 'DEPOSIT',
          },
        });
      } else {
        // Rejected
        await tx.notification.create({
          data: {
            userId: deposit.account.userId,
            title: 'Deposit Request Rejected',
            message: `Your deposit of ${deposit.account.currencyCode} ${amount.toFixed(2)} was not approved. Reason: ${dto.reviewNotes || 'Documentation unverified'}`,
            type: 'DEPOSIT',
          },
        });
      }

      // 5. Audit Log
      await tx.auditLog.create({
        data: {
          actorId: adminId || null,
          actorRole: 'FINANCE_MANAGER',
          action: `DEPOSIT_REVIEW_${dto.action}`,
          resource: 'Deposit',
          resourceId: deposit.id,
          beforeState: { status: deposit.transaction.status },
          afterState: { status: dto.action, notes: dto.reviewNotes || null },
        },
      });

      return updatedTx;
    });

    // 6. Dispatch Rich Transactional Email
    const user = deposit.account.user;
    const customerName = user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user.username;

    if (isApproved) {
      const updatedAccount = await this.prisma.bankAccount.findUnique({ where: { id: deposit.accountId } });
      await this.emailService.sendCreditAlert({
        to: user.email,
        recipientName: customerName,
        amount: amount.toFixed(4),
        currency: deposit.account.currencyCode,
        senderName: 'Bank Wire / Silverhawk Vault',
        accountNumber: deposit.account.accountNumber,
        reference: deposit.transaction.reference,
        description: 'Bank Wire Deposit Credited',
        availableBalance: updatedAccount!.availableBalance.toString(),
      });
    } else {
      await this.emailService.sendStatusAlert({
        to: user.email,
        customerName,
        amount: amount.toFixed(4),
        currency: deposit.account.currencyCode,
        status: 'REJECTED',
        reference: deposit.transaction.reference,
        reason: dto.reviewNotes,
        type: 'DEPOSIT',
      });
    }

    return {
      message: `Deposit successfully ${isApproved ? 'approved and credited' : 'rejected'}`,
      depositId,
      status: dto.action,
      transaction: result,
    };
  }

  /**
   * Link and process IRS Tax Refund direct deposit credit
   */
  async processTaxRefund(
    userId: string,
    dto: { taxYear: string; ssnLast4: string; amount: string; filingType?: string; pin?: string },
  ) {
    const refundAmount = new Decimal(dto.amount || '3450.00');
    if (refundAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Refund amount must be greater than zero');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    if (user.pinHash && dto.pin) {
      const isPinValid = await CryptoUtil.verify(user.pinHash, dto.pin);
      if (!isPinValid) {
        throw new BadRequestException('Invalid security PIN');
      }
    }

    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { userId: user.id, status: 'ACTIVE' },
    });

    if (!bankAccount) {
      throw new BadRequestException('No active primary bank account found for IRS direct deposit');
    }

    const txRef = CryptoUtil.generateTransactionReference('IRS-REF');
    const maskedSsn = `***-**-${dto.ssnLast4 ? dto.ssnLast4.slice(-4) : '9921'}`;

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Credit bank account
      const updatedAccount = await tx.bankAccount.update({
        where: { id: bankAccount.id },
        data: {
          currentBalance: { increment: refundAmount.toFixed(4) },
          availableBalance: { increment: refundAmount.toFixed(4) },
          ledgerBalance: { increment: refundAmount.toFixed(4) },
        },
      });

      // 2. Create Transaction
      const transaction = await tx.transaction.create({
        data: {
          reference: txRef,
          userId: user.id,
          destinationAccountId: bankAccount.id,
          type: TransactionType.DEPOSIT,
          amount: refundAmount.toFixed(4),
          fee: '0.0000',
          netAmount: refundAmount.toFixed(4),
          currencyCode: bankAccount.currencyCode,
          status: TransactionStatus.SUCCESS,
          description: `IRS TREAS 310 TAX REF (${dto.taxYear || '2025'}) ${maskedSsn}`,
          metadata: {
            taxYear: dto.taxYear || '2025',
            filingType: dto.filingType || 'Individual Form 1040',
            ssnLast4: dto.ssnLast4,
            depositChannel: 'US_FED_ACH_DIRECT_DEPOSIT',
            clearingCycle: 'INSTANT_SETTLEMENT',
          },
        },
      });

      return { transaction, updatedAccount };
    });

    // In-app notification
    await this.prisma.notification.create({
      data: {
        userId: user.id,
        title: '💵 IRS Tax Refund Direct Deposit Credited!',
        message: `Your IRS Tax Refund of ${bankAccount.currencyCode} ${refundAmount.toLocaleString()} (${dto.taxYear || '2025'}) has been credited to account #${bankAccount.accountNumber}. Tracing Ref: ${txRef}.`,
        type: 'SYSTEM',
      },
    });

    // Dispatch Credit Alert Email
    const recipientName = user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user.username;
    try {
      await this.emailService.sendCreditAlert({
        to: user.email,
        recipientName,
        accountNumber: bankAccount.accountNumber,
        amount: refundAmount.toFixed(2),
        currency: bankAccount.currencyCode,
        senderName: 'United States Department of the Treasury (IRS Direct Deposit)',
        description: `IRS TREAS 310 TAX REF (${dto.taxYear || '2025'}) Direct Deposit`,
        reference: txRef,
        availableBalance: result.updatedAccount.availableBalance.toString(),
      });
    } catch (e) {
      // non-fatal email log
    }

    return {
      success: true,
      message: `IRS Tax Refund of ${bankAccount.currencyCode} ${refundAmount.toLocaleString()} credited successfully to account #${bankAccount.accountNumber}`,
      transaction: result.transaction,
      availableBalance: result.updatedAccount.availableBalance,
    };
  }

  /**
   * Initialize instant online payment gateway or card deposit checkout
   */
  async initializeGatewayDeposit(
    userId: string,
    dto: { accountId: string; amount: string; currency?: string; gateway?: string; returnUrl?: string },
  ) {
    const depositAmount = new Decimal(dto.amount);
    if (depositAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Deposit amount must be greater than zero');
    }

    const account = await this.prisma.bankAccount.findUnique({
      where: { id: dto.accountId },
      include: { user: { include: { profile: true } } },
    });

    if (!account || account.userId !== userId) {
      throw new NotFoundException('Invalid destination bank account');
    }

    if (account.status !== 'ACTIVE' || account.isFrozen) {
      throw new BadRequestException('Destination account is not active');
    }

    const gatewayName = (dto.gateway || 'STRIPE').toUpperCase();
    const depositRef = CryptoUtil.generateTransactionReference('DEP-GTW');
    const currency = dto.currency ? dto.currency.toUpperCase() : account.currencyCode;

    const result = await this.prisma.$transaction(async (tx) => {
      const businessTx = await tx.transaction.create({
        data: {
          reference: depositRef,
          userId,
          destinationAccountId: account.id,
          type: TransactionType.DEPOSIT,
          amount: depositAmount.toFixed(4),
          fee: '0.0000',
          netAmount: depositAmount.toFixed(4),
          currencyCode: currency,
          status: TransactionStatus.PENDING,
          description: `Online ${gatewayName} Deposit into #${account.accountNumber}`,
          metadata: {
            method: 'GATEWAY',
            gateway: gatewayName,
            checkoutSessionId: `cs_${depositRef}`,
            returnUrl: dto.returnUrl || 'https://silverhawkbank.com/dashboard.html',
          },
        },
      });

      await tx.deposit.create({
        data: {
          transactionId: businessTx.id,
          accountId: account.id,
          method: 'GATEWAY',
          paymentReference: `cs_${depositRef}`,
        },
      });

      return businessTx;
    });

    return {
      message: `${gatewayName} deposit session created successfully`,
      reference: depositRef,
      checkoutUrl: `https://checkout.silverhawkbank.com/pay/${depositRef}?gateway=${gatewayName}&amt=${depositAmount.toFixed(2)}&curr=${currency}`,
      sessionId: `cs_${depositRef}`,
      amount: depositAmount.toFixed(2),
      currency,
      transaction: result,
    };
  }
}

