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
  BlockCardDto,
  IssueCardDto,
  RevealCardDto,
  SimulateCardTransactionDto,
  UpdateCardLimitsDto,
} from './dto/cards.dto';
import {
  AccountStatus,
  CardBrand,
  CardStatus,
  CardType,
  LedgerEntryType,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { CryptoUtil } from '../../common/utils/crypto.util';
import * as crypto from 'crypto';

@Injectable()
export class CardsService {
  private readonly logger = new Logger(CardsService.name);
  private readonly encryptionKey = process.env.JWT_SECRET || 'silverhawk-banking-secret-key-32b!';

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Helper to generate card details and encrypt payload
   */
  private generateCardCredentials(brand: CardBrand, holderName: string) {
    const bin = brand === CardBrand.VISA ? '453289' : '539981';
    const middle = Math.floor(100000 + Math.random() * 900000).toString();
    const last4 = Math.floor(1000 + Math.random() * 9000).toString();
    const fullPan = `${bin}${middle}${last4}`;
    const maskedPan = `${bin.substring(0, 4)} ${bin.substring(4, 6)}** **** ${last4}`;
    const cvv = Math.floor(100 + Math.random() * 900).toString();

    const now = new Date();
    const expiryMonth = now.getMonth() + 1;
    const expiryYear = now.getFullYear() + 3;

    // Encrypt PAN and CVV into tokenReference
    const sensitivePayload = JSON.stringify({ pan: fullPan, cvv, expiryMonth, expiryYear, holderName });
    const cipher = crypto.createCipheriv('aes-256-cbc', crypto.scryptSync(this.encryptionKey, 'salt', 32), Buffer.alloc(16, 0));
    let encrypted = cipher.update(sensitivePayload, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return {
      fullPan,
      maskedPan,
      cvv,
      expiryMonth,
      expiryYear,
      tokenReference: encrypted,
    };
  }

  /**
   * Decrypt tokenReference to retrieve raw card details
   */
  private decryptCardCredentials(tokenReference: string): {
    pan: string;
    cvv: string;
    expiryMonth: number;
    expiryYear: number;
    holderName: string;
  } {
    try {
      const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.scryptSync(this.encryptionKey, 'salt', 32), Buffer.alloc(16, 0));
      let decrypted = decipher.update(tokenReference, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return JSON.parse(decrypted);
    } catch {
      throw new BadRequestException('Failed to decrypt card credentials');
    }
  }

  /**
   * Issue virtual or physical debit card
   */
  async issueCard(userId: string, dto: IssueCardDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.pinHash) {
      throw new BadRequestException('Transaction PIN is not configured on your account.');
    }

    const isPinValid = await CryptoUtil.verify(user.pinHash, dto.pin);
    if (!isPinValid) {
      throw new BadRequestException('Invalid transaction authorization PIN');
    }

    const bankAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.accountId },
    });

    if (!bankAccount || bankAccount.userId !== userId) {
      throw new ForbiddenException('Invalid bank account for card issuance');
    }

    if (bankAccount.status !== AccountStatus.ACTIVE || bankAccount.isFrozen) {
      throw new ForbiddenException('Bank account is frozen or inactive');
    }

    // Physical card issuance charges a fee (e.g. $10.00 / ₦5,000)
    const isPhysical = dto.cardType === CardType.PHYSICAL;
    const cardFee = isPhysical ? new Decimal('10.0000') : new Decimal('0.0000');

    if (isPhysical) {
      const availableBalance = new Decimal(bankAccount.availableBalance.toString());
      if (availableBalance.lessThan(cardFee)) {
        throw new BadRequestException(
          `INSUFFICIENT_FUNDS: Physical card issuance requires a fee of ${bankAccount.currencyCode} ${cardFee.toFixed(2)}`,
        );
      }
    }

    const cardHolderName = user.profile
      ? `${user.profile.firstName} ${user.profile.lastName}`.toUpperCase()
      : user.username.toUpperCase();

    const cardData = this.generateCardCredentials(dto.brand, cardHolderName);
    const spendingLimitMonthly = dto.spendingLimitMonthly
      ? new Decimal(dto.spendingLimitMonthly).toFixed(4)
      : '5000.0000';
    const spendingLimitDaily = dto.spendingLimitDaily
      ? new Decimal(dto.spendingLimitDaily).toFixed(4)
      : '1000.0000';

    const result = await this.prisma.$transaction(async (tx) => {
      if (isPhysical && cardFee.greaterThan(0)) {
        // Deduct fee from account
        await tx.bankAccount.update({
          where: { id: bankAccount.id },
          data: {
            currentBalance: { decrement: cardFee.toFixed(4) },
            availableBalance: { decrement: cardFee.toFixed(4) },
            ledgerBalance: { decrement: cardFee.toFixed(4) },
          },
        });

        const txRef = CryptoUtil.generateTransactionReference('CRD-FEE');

        // Create transaction record
        const businessTx = await tx.transaction.create({
          data: {
            reference: txRef,
            userId,
            sourceAccountId: bankAccount.id,
            type: TransactionType.FEE,
            amount: cardFee.toFixed(4),
            fee: '0.0000',
            netAmount: cardFee.toFixed(4),
            currencyCode: bankAccount.currencyCode,
            status: TransactionStatus.SUCCESS,
            description: `Physical Card Issuance Fee (${dto.brand})`,
          },
        });

        // Post General Ledger journal entry (Debit Customer Liability, Credit Fee Income 4010)
        await this.ledgerService.postJournalEntry(
          tx,
          {
            reference: `JRN-${txRef}`,
            transactionId: businessTx.id,
            description: `Physical Card Issuance Fee for ${bankAccount.accountNumber}`,
            entries: [
              {
                accountCode: `2010-${bankAccount.accountNumber}`,
                entryType: LedgerEntryType.DEBIT,
                amount: cardFee.toFixed(4),
                currencyCode: bankAccount.currencyCode,
              },
              {
                accountCode: '4010', // Fee Income
                entryType: LedgerEntryType.CREDIT,
                amount: cardFee.toFixed(4),
                currencyCode: bankAccount.currencyCode,
              },
            ],
          },
          userId,
        );
      }

      const appRef = CryptoUtil.generateTransactionReference('CRD-APP');

      // Create Card record with PENDING_APPROVAL status for administrative underwriting
      const card = await tx.card.create({
        data: {
          userId,
          accountId: bankAccount.id,
          cardType: dto.cardType,
          brand: dto.brand,
          cardHolderName,
          maskedPan: cardData.maskedPan,
          tokenReference: cardData.tokenReference,
          expiryMonth: cardData.expiryMonth,
          expiryYear: cardData.expiryYear,
          spendingLimitMonthly,
          spendingLimitDaily,
          isFrozen: false,
          status: CardStatus.PENDING_APPROVAL,
          applicationReference: appRef,
        },
      });

      // Notification
      await tx.notification.create({
        data: {
          userId,
          title: 'Card Application Under Review',
          message: `Your application for a ${dto.brand} ${dto.cardType.toLowerCase()} debit card (Ref: ${appRef}) has been submitted for underwriting review.`,
          type: 'CARD',
        },
      });

      return card;
    });

    return {
      message: `Your ${dto.brand} ${dto.cardType.toLowerCase()} card application has been submitted and is pending administrative approval.`,
      applicationReference: result.applicationReference,
      card: {
        id: result.id,
        cardType: result.cardType,
        brand: result.brand,
        cardHolderName: result.cardHolderName,
        maskedPan: result.maskedPan,
        expiryMonth: result.expiryMonth,
        expiryYear: result.expiryYear,
        spendingLimitMonthly: result.spendingLimitMonthly,
        spendingLimitDaily: result.spendingLimitDaily,
        isFrozen: result.isFrozen,
        status: result.status,
        applicationReference: result.applicationReference,
        createdAt: result.createdAt,
      },
    };
  }

  /**
   * Securely reveal full PAN and CVV with PIN verification
   */
  async revealCardDetails(userId: string, cardId: string, dto: RevealCardDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.pinHash) {
      throw new BadRequestException('Transaction PIN is not configured on your account.');
    }

    const isPinValid = await CryptoUtil.verify(user.pinHash, dto.pin);
    if (!isPinValid) {
      throw new BadRequestException('Invalid transaction authorization PIN');
    }

    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      include: { account: true },
    });

    if (!card || card.userId !== userId) {
      throw new NotFoundException('Card not found');
    }

    if (card.status !== CardStatus.ACTIVE) {
      throw new BadRequestException(
        `Card is currently ${card.status}. Details can only be viewed once your application is approved by Card Operations.`
      );
    }

    const decrypted = this.decryptCardCredentials(card.tokenReference);

    return {
      id: card.id,
      cardHolderName: card.cardHolderName,
      pan: decrypted.pan,
      maskedPan: card.maskedPan,
      cvv: decrypted.cvv,
      expiryMonth: card.expiryMonth,
      expiryYear: card.expiryYear,
      brand: card.brand,
      cardType: card.cardType,
      isFrozen: card.isFrozen,
      status: card.status,
      linkedAccount: {
        accountNumber: card.account.accountNumber,
        currencyCode: card.account.currencyCode,
      },
    };
  }

  /**
   * Toggle freeze / unfreeze card
   */
  async toggleCardFreeze(userId: string, cardId: string) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });

    if (!card || card.userId !== userId) {
      throw new NotFoundException('Card not found');
    }

    if (card.status !== CardStatus.ACTIVE) {
      throw new BadRequestException(`Cannot freeze/unfreeze card with status: ${card.status}`);
    }

    const newFrozenState = !card.isFrozen;
    const updated = await this.prisma.card.update({
      where: { id: cardId },
      data: { isFrozen: newFrozenState },
    });

    await this.prisma.notification.create({
      data: {
        userId,
        title: newFrozenState ? 'Card Frozen' : 'Card Unfrozen',
        message: `Your ${card.brand} card ending in ${card.maskedPan.slice(-4)} is now ${newFrozenState ? 'temporarily frozen' : 'active'}.`,
        type: 'CARD',
      },
    });

    return {
      message: `Card ${newFrozenState ? 'frozen' : 'unfrozen'} successfully`,
      isFrozen: newFrozenState,
      card: updated,
    };
  }

  /**
   * Block card permanently (e.g. stolen/compromised)
   */
  async blockCard(userId: string, cardId: string, dto: BlockCardDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.pinHash) {
      throw new BadRequestException('Transaction PIN is not configured on your account.');
    }

    const isPinValid = await CryptoUtil.verify(user.pinHash, dto.pin);
    if (!isPinValid) {
      throw new BadRequestException('Invalid transaction authorization PIN');
    }

    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card || card.userId !== userId) {
      throw new NotFoundException('Card not found');
    }

    const updated = await this.prisma.card.update({
      where: { id: cardId },
      data: {
        status: CardStatus.BLOCKED,
        isFrozen: true,
      },
    });

    await this.prisma.notification.create({
      data: {
        userId,
        title: 'Card Permanently Blocked',
        message: `Your ${card.brand} card ending in ${card.maskedPan.slice(-4)} has been blocked. Reason: ${dto.reason || 'Customer request'}.`,
        type: 'CARD',
      },
    });

    return {
      message: 'Card permanently blocked',
      card: updated,
    };
  }

  /**
   * Update card spending limits
   */
  async updateCardLimits(userId: string, cardId: string, dto: UpdateCardLimitsDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.pinHash) {
      throw new BadRequestException('Transaction PIN is not configured on your account.');
    }

    const isPinValid = await CryptoUtil.verify(user.pinHash, dto.pin);
    if (!isPinValid) {
      throw new BadRequestException('Invalid transaction authorization PIN');
    }

    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card || card.userId !== userId) {
      throw new NotFoundException('Card not found');
    }

    const data: any = {};
    if (dto.spendingLimitMonthly) {
      data.spendingLimitMonthly = new Decimal(dto.spendingLimitMonthly).toFixed(4);
    }
    if (dto.spendingLimitDaily) {
      data.spendingLimitDaily = new Decimal(dto.spendingLimitDaily).toFixed(4);
    }

    const updated = await this.prisma.card.update({
      where: { id: cardId },
      data,
    });

    return {
      message: 'Card limits updated successfully',
      spendingLimitDaily: updated.spendingLimitDaily.toString(),
      spendingLimitMonthly: updated.spendingLimitMonthly.toString(),
    };
  }

  /**
   * Simulate POS / Online card payment
   */
  async simulateCardTransaction(cardId: string, dto: SimulateCardTransactionDto) {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      include: {
        account: true,
        user: { include: { profile: true } },
      },
    });

    if (!card) {
      throw new NotFoundException('Card not found');
    }

    if (card.status !== CardStatus.ACTIVE || card.isFrozen) {
      throw new ForbiddenException('Card is inactive or currently frozen');
    }

    const now = new Date();
    if (
      card.expiryYear < now.getFullYear() ||
      (card.expiryYear === now.getFullYear() && card.expiryMonth < now.getMonth() + 1)
    ) {
      throw new BadRequestException('Card has expired');
    }

    const purchaseAmount = new Decimal(dto.amount);
    if (purchaseAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Transaction amount must be greater than zero');
    }

    // Daily limit check
    const dailyLimit = new Decimal(card.spendingLimitDaily.toString());
    if (purchaseAmount.greaterThan(dailyLimit)) {
      throw new BadRequestException(`Amount exceeds card daily limit of ${dailyLimit.toFixed(2)}`);
    }

    const bankAccount = card.account;
    const availableBalance = new Decimal(bankAccount.availableBalance.toString());
    if (availableBalance.lessThan(purchaseAmount)) {
      throw new BadRequestException('INSUFFICIENT_FUNDS: Linked account has insufficient available balance');
    }

    const txRef = CryptoUtil.generateTransactionReference('POS-TX');

    const result = await this.prisma.$transaction(async (tx) => {
      // Deduct from bank account
      await tx.bankAccount.update({
        where: { id: bankAccount.id },
        data: {
          currentBalance: { decrement: purchaseAmount.toFixed(4) },
          availableBalance: { decrement: purchaseAmount.toFixed(4) },
          ledgerBalance: { decrement: purchaseAmount.toFixed(4) },
        },
      });

      // Create transaction record
      const businessTx = await tx.transaction.create({
        data: {
          reference: txRef,
          userId: card.userId,
          sourceAccountId: bankAccount.id,
          type: TransactionType.CARD_PURCHASE,
          amount: purchaseAmount.toFixed(4),
          fee: '0.0000',
          netAmount: purchaseAmount.toFixed(4),
          currencyCode: bankAccount.currencyCode,
          status: TransactionStatus.SUCCESS,
          description: `Card POS Purchase at ${dto.merchantName}`,
          metadata: {
            cardId: card.id,
            cardBrand: card.brand,
            maskedPan: card.maskedPan,
            merchantName: dto.merchantName,
            merchantCity: dto.merchantCity || null,
            merchantCountry: dto.merchantCountry || null,
          },
        },
      });

      // Create CardTransaction record
      const cardTx = await tx.cardTransaction.create({
        data: {
          cardId: card.id,
          transactionId: businessTx.id,
          merchantName: dto.merchantName,
          merchantCity: dto.merchantCity || null,
          merchantCountry: dto.merchantCountry || null,
        },
      });

      // Double-entry General Ledger posting:
      // Debit: 2010-<acc> (Customer Current Liability) [purchaseAmount]
      // Credit: 1020 (Card Interchange / Clearing Settlement Asset) [purchaseAmount]
      await this.ledgerService.postJournalEntry(
        tx,
        {
          reference: `JRN-${txRef}`,
          transactionId: businessTx.id,
          description: `Card Purchase at ${dto.merchantName}`,
          entries: [
            {
              accountCode: `2010-${bankAccount.accountNumber}`,
              entryType: LedgerEntryType.DEBIT,
              amount: purchaseAmount.toFixed(4),
              currencyCode: bankAccount.currencyCode,
            },
            {
              accountCode: '1020', // Clearing Settlement Asset
              entryType: LedgerEntryType.CREDIT,
              amount: purchaseAmount.toFixed(4),
              currencyCode: bankAccount.currencyCode,
            },
          ],
        },
        card.userId,
      );

      // Notification
      await tx.notification.create({
        data: {
          userId: card.userId,
          title: 'Card Purchase Approved',
          message: `Approved ${bankAccount.currencyCode} ${purchaseAmount.toFixed(2)} purchase at ${dto.merchantName} using card ending in ${card.maskedPan.slice(-4)}.`,
          type: 'CARD',
        },
      });

      return { businessTx, cardTx };
    });

    // Send Debit Alert Email
    const updatedBank = await this.prisma.bankAccount.findUnique({ where: { id: bankAccount.id } });
    const userName = card.user.profile
      ? `${card.user.profile.firstName} ${card.user.profile.lastName}`
      : card.user.username;

    await this.emailService.sendDebitAlert({
      to: card.user.email,
      senderName: userName,
      amount: purchaseAmount.toFixed(4),
      currency: bankAccount.currencyCode,
      recipientName: `${dto.merchantName} (POS/Web)`,
      accountNumber: bankAccount.accountNumber,
      reference: txRef,
      description: `Debit Card Payment at ${dto.merchantName}`,
      availableBalance: updatedBank!.availableBalance.toString(),
    });

    return {
      message: 'Card transaction authorized and settled',
      reference: txRef,
      transaction: result.businessTx,
      cardTransaction: result.cardTx,
    };
  }

  /**
   * List customer's cards
   */
  async getUserCards(userId: string) {
    const cards = await this.prisma.card.findMany({
      where: { userId },
      include: { account: true },
      orderBy: { createdAt: 'desc' },
    });

    return {
      count: cards.length,
      cards: cards.map((c) => ({
        id: c.id,
        accountId: c.accountId,
        accountNumber: c.account.accountNumber,
        currencyCode: c.account.currencyCode,
        cardType: c.cardType,
        brand: c.brand,
        cardHolderName: c.cardHolderName,
        maskedPan: c.maskedPan,
        expiryMonth: c.expiryMonth,
        expiryYear: c.expiryYear,
        spendingLimitMonthly: c.spendingLimitMonthly.toString(),
        spendingLimitDaily: c.spendingLimitDaily.toString(),
        isFrozen: c.isFrozen,
        status: c.status,
        applicationReference: c.applicationReference,
        rejectionReason: c.rejectionReason,
        approvedAt: c.approvedAt,
        createdAt: c.createdAt,
      })),
    };
  }

  /**
   * Single card info with recent transactions
   */
  async getCardById(userId: string, cardId: string) {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      include: {
        account: true,
        transactions: {
          include: { transaction: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!card || card.userId !== userId) {
      throw new NotFoundException('Card not found');
    }

    return {
      id: card.id,
      accountId: card.accountId,
      accountNumber: card.account.accountNumber,
      currencyCode: card.account.currencyCode,
      cardType: card.cardType,
      brand: card.brand,
      cardHolderName: card.cardHolderName,
      maskedPan: card.maskedPan,
      expiryMonth: card.expiryMonth,
      expiryYear: card.expiryYear,
      spendingLimitMonthly: card.spendingLimitMonthly.toString(),
      spendingLimitDaily: card.spendingLimitDaily.toString(),
      isFrozen: card.isFrozen,
      status: card.status,
      applicationReference: card.applicationReference,
      rejectionReason: card.rejectionReason,
      approvedAt: card.approvedAt,
      createdAt: card.createdAt,
      recentTransactions: card.transactions,
    };
  }

  /**
   * Admin: List all cards across bank
   */
  async adminListCards(query?: { status?: CardStatus; cardType?: CardType; brand?: CardBrand }) {
    const where: any = {};
    if (query?.status) where.status = query.status;
    if (query?.cardType) where.cardType = query.cardType;
    if (query?.brand) where.brand = query.brand;

    const cards = await this.prisma.card.findMany({
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

    return {
      count: cards.length,
      cards,
    };
  }
}
