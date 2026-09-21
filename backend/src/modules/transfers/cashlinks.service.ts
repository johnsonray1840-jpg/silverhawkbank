import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { CashlinkStatus, ClaimCashlinkDto, CreateCashlinkDto } from './dto/cashlinks.dto';
import { LedgerEntryType, TransactionStatus, TransactionType } from '@prisma/client';
import Decimal from 'decimal.js';
import * as crypto from 'crypto';

export interface CashlinkRecord {
  id: string;
  code: string;
  creatorUserId: string;
  creatorName: string;
  sourceAccountId: string;
  amount: string;
  currency: string;
  hashedPasscode: string;
  note?: string;
  status: CashlinkStatus;
  expiresAt: Date;
  claimedByUserId?: string;
  claimedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CashlinksService {
  private readonly logger = new Logger(CashlinksService.name);
  private static cashlinksStore: Map<string, CashlinkRecord> = new Map();

  constructor(
    private prisma: PrismaService,
    private ledgerService: LedgerService,
  ) {}

  /**
   * Create shareable cashlink
   */
  async createCashlink(userId: string, dto: CreateCashlinkDto): Promise<{ cashlink: Omit<CashlinkRecord, 'hashedPasscode'>; shareableUrl: string }> {
    const amount = new Decimal(dto.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Cashlink amount must be greater than zero');
    }

    // 1. Validate User & PIN
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.pinHash) throw new BadRequestException('Transaction PIN is not configured');

    const isPinValid = await CryptoUtil.verify(user.pinHash, dto.pin);
    if (!isPinValid) throw new BadRequestException('Invalid transaction authorization PIN');

    // 2. Validate Source Account & Lock Funds
    const sourceAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.sourceAccountId },
    });
    if (!sourceAccount || sourceAccount.userId !== userId) {
      throw new ForbiddenException('Invalid or unowned source account');
    }

    if (new Decimal(sourceAccount.availableBalance.toString()).lessThan(amount)) {
      throw new BadRequestException('Insufficient available balance to create cashlink');
    }

    // Debit source account
    await this.prisma.bankAccount.update({
      where: { id: sourceAccount.id },
      data: {
        currentBalance: { decrement: amount.toString() },
        availableBalance: { decrement: amount.toString() },
      },
    });

    // 3. Hash Passcode & Generate Code
    const hashedPasscode = await CryptoUtil.hash(dto.passcode);
    const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
    const code = `CLK-${randomHex.slice(0, 4)}-${randomHex.slice(4, 8)}`;
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);

    const creatorName = user.profile
      ? `${user.profile.firstName} ${user.profile.lastName}`
      : 'Silverhawk Customer';

    const linkRecord: CashlinkRecord = {
      id: `LNK-${randomHex}`,
      code,
      creatorUserId: userId,
      creatorName,
      sourceAccountId: sourceAccount.id,
      amount: amount.toFixed(4),
      currency: dto.currency || sourceAccount.currencyCode,
      hashedPasscode,
      note: dto.note || 'P2P Cashlink Payment',
      status: CashlinkStatus.ACTIVE,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    CashlinksService.cashlinksStore.set(code, linkRecord);
    this.logger.log(`Cashlink ${code} created for ${amount.toFixed(2)} ${linkRecord.currency} by user ${userId}`);

    const { hashedPasscode: _, ...safeCashlink } = linkRecord;
    return {
      cashlink: safeCashlink,
      shareableUrl: `https://silverhawkbank.com/claim?code=${code}`,
    };
  }

  /**
   * Get public preview of cashlink
   */
  async getCashlinkPreview(code: string): Promise<Omit<CashlinkRecord, 'hashedPasscode'>> {
    const link = CashlinksService.cashlinksStore.get(code);
    if (!link) {
      throw new NotFoundException(`Cashlink ${code} not found`);
    }

    if (link.status === CashlinkStatus.ACTIVE && new Date() > link.expiresAt) {
      link.status = CashlinkStatus.EXPIRED;
    }

    const { hashedPasscode, ...safeRecord } = link;
    return safeRecord;
  }

  /**
   * Claim cashlink into recipient account
   */
  async claimCashlink(claimerUserId: string, dto: ClaimCashlinkDto) {
    const link = CashlinksService.cashlinksStore.get(dto.code);
    if (!link) {
      throw new NotFoundException(`Cashlink ${dto.code} not found`);
    }

    if (link.status !== CashlinkStatus.ACTIVE) {
      throw new BadRequestException(`Cashlink is not active (Status: ${link.status})`);
    }

    if (new Date() > link.expiresAt) {
      link.status = CashlinkStatus.EXPIRED;
      throw new BadRequestException('This cashlink has expired');
    }

    // Verify Passcode
    const isPasscodeValid = await CryptoUtil.verify(link.hashedPasscode, dto.passcode);
    if (!isPasscodeValid) {
      throw new BadRequestException('Incorrect cashlink redemption passcode');
    }

    // Verify Destination Account
    const destAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.destinationAccountId },
    });
    if (!destAccount || destAccount.userId !== claimerUserId) {
      throw new ForbiddenException('Invalid or unowned destination account');
    }

    const claimAmount = new Decimal(link.amount);

    // Credit recipient account & complete transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.bankAccount.update({
        where: { id: destAccount.id },
        data: {
          currentBalance: { increment: claimAmount.toString() },
          availableBalance: { increment: claimAmount.toString() },
        },
      });

      const ref = CryptoUtil.generateTransactionReference('CLK-CLAIM');
      await tx.transaction.create({
        data: {
          reference: ref,
          userId: claimerUserId,
          sourceAccountId: link.sourceAccountId,
          destinationAccountId: destAccount.id,
          type: TransactionType.TRANSFER_INTERNAL,
          amount: claimAmount.toString(),
          fee: '0.0000',
          tax: '0.0000',
          netAmount: claimAmount.toString(),
          currencyCode: link.currency,
          status: TransactionStatus.SUCCESS,
          description: `Cashlink Claim: ${link.code} from ${link.creatorName}`,
        },
      });
    });

    link.status = CashlinkStatus.CLAIMED;
    link.claimedByUserId = claimerUserId;
    link.claimedAt = new Date();
    link.updatedAt = new Date();
    CashlinksService.cashlinksStore.set(dto.code, link);

    this.logger.log(`Cashlink ${dto.code} claimed by user ${claimerUserId}`);

    return {
      message: 'Cashlink claimed successfully',
      code: dto.code,
      amount: link.amount,
      currency: link.currency,
      claimedAt: link.claimedAt,
    };
  }

  /**
   * Cancel cashlink and refund creator
   */
  async cancelCashlink(userId: string, code: string) {
    const link = CashlinksService.cashlinksStore.get(code);
    if (!link || link.creatorUserId !== userId) {
      throw new NotFoundException(`Cashlink ${code} not found or unauthorized`);
    }

    if (link.status !== CashlinkStatus.ACTIVE) {
      throw new BadRequestException(`Only ACTIVE cashlinks can be cancelled (Status: ${link.status})`);
    }

    // Refund source account
    await this.prisma.bankAccount.update({
      where: { id: link.sourceAccountId },
      data: {
        currentBalance: { increment: link.amount },
        availableBalance: { increment: link.amount },
      },
    });

    link.status = CashlinkStatus.CANCELLED;
    link.updatedAt = new Date();
    CashlinksService.cashlinksStore.set(code, link);

    this.logger.log(`Cashlink ${code} cancelled and refunded to user ${userId}`);

    return {
      message: 'Cashlink cancelled and funds refunded successfully',
      code,
      refundedAmount: link.amount,
    };
  }
}

