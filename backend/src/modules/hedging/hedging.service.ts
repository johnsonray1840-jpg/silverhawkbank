import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateForwardQuoteDto,
  BookForwardContractDto,
  SettleForwardContractDto,
  RolloverForwardContractDto,
} from './dto/hedging.dto';
import {
  FxForwardUtil,
  ForwardContractStatus,
  SettlementType,
  ContractDirection,
  ForwardRateCalculationResult,
  MarkToMarketValuation,
} from '../../common/utils/fx-forward.util';
import { AccountStatus, TransactionStatus, TransactionType } from '@prisma/client';
import Decimal from 'decimal.js';
import * as crypto from 'crypto';

export interface StoredForwardContract {
  id: string;
  contractNumber: string;
  userId: string;
  collateralAccountId: string;
  baseCurrency: string;
  quoteCurrency: string;
  direction: ContractDirection;
  notionalBaseAmount: string;
  notionalQuoteAmount: string;
  spotRateAtBooking: string;
  lockedForwardRate: string;
  forwardPoints: string;
  tenorDays: number;
  initialMarginPct: number;
  collateralLocked: string;
  settlementType: SettlementType;
  status: ForwardContractStatus;
  bookingDate: Date;
  maturityDate: Date;
  settledAt?: Date;
  settlementDetails?: {
    settledSpotRate: string;
    finalPnL: string;
    settlementType: SettlementType;
    payoutAccountId?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class HedgingService {
  private readonly logger = new Logger(HedgingService.name);

  // In-memory persistent high-performance store for Forward Exchange Contracts
  private contracts: Map<string, StoredForwardContract> = new Map();

  // Benchmark reference spot rates (Quote per 1 Base)
  private readonly DEFAULT_SPOT_RATES: Record<string, number> = {
    'EUR/USD': 1.0850,
    'GBP/USD': 1.2950,
    'USD/JPY': 155.20,
    'USD/CAD': 1.3650,
    'USD/CHF': 0.8950,
    'USD/NGN': 1600.00,
    'EUR/GBP': 0.8380,
    'EUR/JPY': 168.40,
    'GBP/EUR': 1.1930,
  };

  constructor(private prisma: PrismaService) {}

  /**
   * Helper to retrieve or calculate real-time spot rate between two currencies
   */
  getSpotRate(baseCurrency: string, quoteCurrency: string): number {
    const directPair = `${baseCurrency.toUpperCase()}/${quoteCurrency.toUpperCase()}`;
    if (this.DEFAULT_SPOT_RATES[directPair]) {
      return this.DEFAULT_SPOT_RATES[directPair];
    }

    const inversePair = `${quoteCurrency.toUpperCase()}/${baseCurrency.toUpperCase()}`;
    if (this.DEFAULT_SPOT_RATES[inversePair]) {
      return Number((1 / this.DEFAULT_SPOT_RATES[inversePair]).toFixed(6));
    }

    // Default parity fallback
    return 1.0;
  }

  /**
   * Request a guaranteed forward rate quote for institutional treasury hedging
   */
  async getForwardQuote(dto: CreateForwardQuoteDto) {
    const spotRate = this.getSpotRate(dto.baseCurrency, dto.quoteCurrency);
    const quoteResult = FxForwardUtil.calculateForwardRate(
      dto.baseCurrency,
      dto.quoteCurrency,
      spotRate,
      dto.notionalBaseAmount,
      dto.tenorDays,
      10, // 10% standard institutional collateral margin
    );

    const quoteId = `QUOTE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    return {
      quoteId,
      baseCurrency: dto.baseCurrency.toUpperCase(),
      quoteCurrency: dto.quoteCurrency.toUpperCase(),
      direction: dto.direction,
      ...quoteResult,
      validUntil: new Date(Date.now() + 60 * 1000).toISOString(), // Valid for 60 seconds
    };
  }

  /**
   * Book and execute a Forward Exchange Contract (FEC) with collateral lock
   */
  async bookContract(userId: string, dto: BookForwardContractDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('User not found');

    const collateralAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.collateralAccountId },
    });
    if (!collateralAccount) throw new NotFoundException('Collateral bank account not found');
    if (collateralAccount.userId !== userId) throw new ForbiddenException('Access denied to collateral bank account');
    if (collateralAccount.status !== AccountStatus.ACTIVE) throw new BadRequestException('Collateral bank account is not active');

    const spotRate = this.getSpotRate(dto.baseCurrency, dto.quoteCurrency);
    const calculation = FxForwardUtil.calculateForwardRate(
      dto.baseCurrency,
      dto.quoteCurrency,
      spotRate,
      dto.notionalBaseAmount,
      dto.tenorDays,
      10,
    );

    const collateralRequiredDec = new Decimal(calculation.collateralRequired);
    const collateralAvailableDec = new Decimal(collateralAccount.availableBalance);

    if (collateralAvailableDec.lessThan(collateralRequiredDec)) {
      throw new BadRequestException(
        `Insufficient available balance for initial collateral margin. Required: ${dto.quoteCurrency.toUpperCase()} ${calculation.collateralRequired}, Available: ${dto.quoteCurrency.toUpperCase()} ${collateralAccount.availableBalance}`,
      );
    }

    const contractId = crypto.randomUUID();
    const contractNumber = `FEC-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
    const collateralHoldAmt = collateralRequiredDec.toNumber();

    // Atomically lock collateral margin (decrement available balance while holding current balance)
    await this.prisma.$transaction(async (tx) => {
      await tx.bankAccount.update({
        where: { id: collateralAccount.id },
        data: {
          availableBalance: { decrement: collateralHoldAmt },
        },
      });

      await tx.transaction.create({
        data: {
          userId,
          sourceAccountId: collateralAccount.id,
          type: TransactionType.TRANSFER_INTERNAL,
          amount: collateralHoldAmt,
          netAmount: collateralHoldAmt,
          currencyCode: dto.quoteCurrency.toUpperCase(),
          status: TransactionStatus.SUCCESS,
          description: `[FX Forward Collateral Margin Locked] Contract #${contractNumber} (${dto.baseCurrency.toUpperCase()}/${dto.quoteCurrency.toUpperCase()} ${dto.notionalBaseAmount})`,
          reference: `HOLD-${contractNumber}`,
        },
      });
    });

    const contract: StoredForwardContract = {
      id: contractId,
      contractNumber,
      userId,
      collateralAccountId: collateralAccount.id,
      baseCurrency: dto.baseCurrency.toUpperCase(),
      quoteCurrency: dto.quoteCurrency.toUpperCase(),
      direction: dto.direction,
      notionalBaseAmount: calculation.notionalBaseAmount,
      notionalQuoteAmount: calculation.notionalQuoteAmount,
      spotRateAtBooking: calculation.spotRate,
      lockedForwardRate: calculation.forwardRate,
      forwardPoints: calculation.forwardPoints,
      tenorDays: dto.tenorDays,
      initialMarginPct: 10,
      collateralLocked: calculation.collateralRequired,
      settlementType: dto.settlementType,
      status: ForwardContractStatus.ACTIVE,
      bookingDate: new Date(),
      maturityDate: calculation.maturityDate,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.contracts.set(contractId, contract);
    this.logger.log(`Booked FX Forward Contract #${contractNumber} for user ${userId}. Locked Rate: ${contract.lockedForwardRate}`);

    return {
      success: true,
      message: 'FX Forward Exchange Contract booked successfully. Collateral margin reserved.',
      contract,
    };
  }

  /**
   * Get single contract with real-time Mark-to-Market (MTM) valuation
   */
  async getContract(userId: string, contractId: string, currentSpotOverride?: number) {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new NotFoundException('Forward contract not found');
    if (contract.userId !== userId) throw new ForbiddenException('Access denied to forward contract');

    const currentSpot = currentSpotOverride || this.getSpotRate(contract.baseCurrency, contract.quoteCurrency);
    const mtm = FxForwardUtil.calculateMarkToMarket(
      contract.direction,
      contract.notionalBaseAmount,
      contract.lockedForwardRate,
      currentSpot,
      contract.collateralLocked,
      70,
    );

    return {
      contract,
      markToMarket: mtm,
    };
  }

  /**
   * List all forward contracts with real-time MTM summary
   */
  async listContracts(userId: string, status?: ForwardContractStatus) {
    const userContracts = Array.from(this.contracts.values()).filter(
      (c) => c.userId === userId && (!status || c.status === status),
    );

    return userContracts.map((contract) => {
      const currentSpot = this.getSpotRate(contract.baseCurrency, contract.quoteCurrency);
      const mtm = FxForwardUtil.calculateMarkToMarket(
        contract.direction,
        contract.notionalBaseAmount,
        contract.lockedForwardRate,
        currentSpot,
        contract.collateralLocked,
      );
      return {
        contract,
        markToMarket: mtm,
      };
    });
  }

  /**
   * Settle forward contract at maturity (Physical Delivery or Cash Settled Net PnL)
   */
  async settleContract(userId: string, contractId: string, dto: SettleForwardContractDto) {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new NotFoundException('Forward contract not found');
    if (contract.userId !== userId) throw new ForbiddenException('Access denied to forward contract');

    if (
      contract.status !== ForwardContractStatus.ACTIVE &&
      contract.status !== ForwardContractStatus.MATURED &&
      contract.status !== ForwardContractStatus.MARGIN_CALL
    ) {
      throw new BadRequestException(`Cannot settle contract in ${contract.status} status`);
    }

    const collateralAccount = await this.prisma.bankAccount.findUnique({
      where: { id: contract.collateralAccountId },
    });
    if (!collateralAccount) throw new NotFoundException('Collateral bank account not found');

    const currentSpot = this.getSpotRate(contract.baseCurrency, contract.quoteCurrency);
    const mtm = FxForwardUtil.calculateMarkToMarket(
      contract.direction,
      contract.notionalBaseAmount,
      contract.lockedForwardRate,
      currentSpot,
      contract.collateralLocked,
    );

    const collateralReleaseAmt = new Decimal(contract.collateralLocked).toNumber();
    const pnlQuoteAmt = new Decimal(mtm.unrealizedPnLQuote).toNumber();

    await this.prisma.$transaction(async (tx) => {
      // 1. Release locked collateral back into available balance
      await tx.bankAccount.update({
        where: { id: collateralAccount.id },
        data: {
          availableBalance: { increment: collateralReleaseAmt },
        },
      });

      // 2. Settle Cash PnL or Delivery
      if (contract.settlementType === SettlementType.CASH_SETTLED) {
        if (pnlQuoteAmt !== 0) {
          await tx.bankAccount.update({
            where: { id: collateralAccount.id },
            data: {
              currentBalance: { increment: pnlQuoteAmt },
              availableBalance: { increment: pnlQuoteAmt },
            },
          });

          await tx.transaction.create({
            data: {
              userId,
              destinationAccountId: collateralAccount.id,
              type: pnlQuoteAmt > 0 ? TransactionType.DEPOSIT : TransactionType.WITHDRAWAL,
              amount: Math.abs(pnlQuoteAmt),
              netAmount: Math.abs(pnlQuoteAmt),
              currencyCode: contract.quoteCurrency,
              status: TransactionStatus.SUCCESS,
              description: `[FX Forward Cash Settlement PnL] Contract #${contract.contractNumber} (${mtm.isProfit ? 'Profit' : 'Loss'})`,
              reference: `SETTLE-CASH-${contract.contractNumber}`,
            },
          });
        }
      } else {
        // Physical Delivery settlement record
        await tx.transaction.create({
          data: {
            userId,
            destinationAccountId: collateralAccount.id,
            type: TransactionType.TRANSFER_INTERNAL,
            amount: new Decimal(contract.notionalBaseAmount).toNumber(),
            netAmount: new Decimal(contract.notionalQuoteAmount).toNumber(),
            currencyCode: contract.baseCurrency,
            status: TransactionStatus.SUCCESS,
            description: `[FX Forward Physical Delivery Settled] #${contract.contractNumber} @ rate ${contract.lockedForwardRate}`,
            reference: `SETTLE-PHYS-${contract.contractNumber}`,
          },
        });
      }
    });

    contract.status = ForwardContractStatus.SETTLED;
    contract.settledAt = new Date();
    contract.settlementDetails = {
      settledSpotRate: currentSpot.toString(),
      finalPnL: mtm.unrealizedPnLQuote,
      settlementType: contract.settlementType,
      payoutAccountId: dto.settlementAccountId || collateralAccount.id,
    };
    contract.updatedAt = new Date();

    this.logger.log(`Settled FX Forward #${contract.contractNumber} with final PnL: ${contract.quoteCurrency} ${mtm.unrealizedPnLQuote}`);

    return {
      success: true,
      message: 'FX Forward Contract settled successfully. Collateral released and PnL posted.',
      settlement: contract.settlementDetails,
      contract,
    };
  }

  /**
   * Rollover forward contract tenor to a new future date with swap points adjustment
   */
  async rolloverContract(userId: string, contractId: string, dto: RolloverForwardContractDto) {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new NotFoundException('Forward contract not found');
    if (contract.userId !== userId) throw new ForbiddenException('Access denied to forward contract');

    if (contract.status !== ForwardContractStatus.ACTIVE) {
      throw new BadRequestException(`Cannot rollover contract in ${contract.status} status`);
    }

    const currentSpot = this.getSpotRate(contract.baseCurrency, contract.quoteCurrency);
    const newQuote = FxForwardUtil.calculateForwardRate(
      contract.baseCurrency,
      contract.quoteCurrency,
      currentSpot,
      contract.notionalBaseAmount,
      dto.extensionTenorDays,
      10,
    );

    contract.status = ForwardContractStatus.ROLLED_OVER;
    contract.lockedForwardRate = newQuote.forwardRate;
    contract.forwardPoints = newQuote.forwardPoints;
    contract.tenorDays += dto.extensionTenorDays;
    contract.maturityDate = newQuote.maturityDate;
    contract.updatedAt = new Date();

    this.logger.log(`Rolled over FEC #${contract.contractNumber} for +${dto.extensionTenorDays} days. New rate: ${contract.lockedForwardRate}`);

    return {
      success: true,
      message: `FX Forward Contract successfully rolled over for +${dto.extensionTenorDays} days.`,
      contract,
    };
  }
}
