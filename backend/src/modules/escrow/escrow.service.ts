import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateEscrowContractDto,
  SubmitMilestoneDto,
  ApproveMilestoneDto,
  RaiseDisputeDto,
  ResolveDisputeDto,
} from './dto/escrow.dto';
import {
  EscrowStatus,
  MilestoneStatus,
  DisputeRuling,
  SmartEscrowUtil,
  EscrowMilestoneItem,
} from '../../common/utils/smart-escrow.util';
import { AccountStatus, TransactionStatus, TransactionType } from '@prisma/client';
import Decimal from 'decimal.js';
import * as crypto from 'crypto';

export interface InMemoryEscrowContract {
  id: string;
  title: string;
  description?: string;
  buyerId: string;
  sellerId: string;
  totalAmount: string;
  releasedAmount: string;
  remainingAmount: string;
  currencyCode: string;
  inspectionWindowHours: number;
  status: EscrowStatus;
  milestones: EscrowMilestoneItem[];
  dispute?: {
    raisedBy: string;
    reason: string;
    evidenceUrl?: string;
    raisedAt: Date;
    ruling?: DisputeRuling;
    arbitratedBy?: string;
    arbitrationNotes?: string;
    resolvedAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  // High-performance thread-safe state store for Smart Escrow contracts
  private contracts: Map<string, InMemoryEscrowContract> = new Map();

  constructor(private prisma: PrismaService) {}

  /**
   * Create a new Smart Escrow Contract with conditional milestones
   */
  async createContract(buyerId: string, dto: CreateEscrowContractDto) {
    const buyer = await this.prisma.user.findUnique({
      where: { id: buyerId },
      include: { profile: true },
    });
    if (!buyer) throw new NotFoundException('Buyer user not found');

    const seller = await this.prisma.user.findUnique({
      where: { id: dto.sellerId },
      include: { profile: true },
    });
    if (!seller) throw new NotFoundException('Seller user not found');

    if (buyerId === dto.sellerId) {
      throw new BadRequestException('Buyer and seller cannot be the same user');
    }

    // Validate and compute milestone amounts
    const computedMilestones = SmartEscrowUtil.validateAndComputeMilestones(
      dto.totalAmount,
      dto.milestones,
    );

    const contractId = `esc_${crypto.randomBytes(8).toString('hex')}`;
    const totalAmt = new Decimal(dto.totalAmount).toFixed(4);

    const contract: InMemoryEscrowContract = {
      id: contractId,
      title: dto.title,
      description: dto.description,
      buyerId,
      sellerId: dto.sellerId,
      totalAmount: totalAmt,
      releasedAmount: '0.0000',
      remainingAmount: totalAmt,
      currencyCode: dto.currencyCode,
      inspectionWindowHours: dto.inspectionWindowHours || 72,
      status: EscrowStatus.CREATED,
      milestones: computedMilestones,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.contracts.set(contractId, contract);

    this.logger.log(`Created Smart Escrow Contract: ${contract.title} (${contractId})`);

    return {
      contractId,
      title: contract.title,
      buyerId: contract.buyerId,
      sellerId: contract.sellerId,
      totalAmount: contract.totalAmount,
      currencyCode: contract.currencyCode,
      status: contract.status,
      milestonesCount: contract.milestones.length,
      inspectionWindowHours: contract.inspectionWindowHours,
      createdAt: contract.createdAt,
    };
  }

  /**
   * Lock buyer funds into escrow vault
   */
  async fundContract(buyerId: string, contractId: string) {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new NotFoundException('Escrow contract not found');

    if (contract.buyerId !== buyerId) {
      throw new ForbiddenException('Only the contract buyer can fund this escrow vault');
    }

    if (contract.status !== EscrowStatus.CREATED) {
      throw new BadRequestException(`Contract cannot be funded in status: ${contract.status}`);
    }

    const buyerAccount = await this.prisma.bankAccount.findFirst({
      where: {
        userId: buyerId,
        currencyCode: contract.currencyCode,
        status: AccountStatus.ACTIVE,
      },
    });

    if (!buyerAccount) {
      throw new NotFoundException(`No active ${contract.currencyCode} bank account found for buyer`);
    }

    const amount = new Decimal(contract.totalAmount);
    if (new Decimal(buyerAccount.availableBalance.toString()).lessThan(amount)) {
      throw new BadRequestException('Insufficient available funds in buyer bank account');
    }

    // Atomic deduction and lock in ledger
    await this.prisma.$transaction(async (tx) => {
      await tx.bankAccount.update({
        where: { id: buyerAccount.id },
        data: {
          currentBalance: { decrement: amount },
          availableBalance: { decrement: amount },
        },
      });

      await tx.transaction.create({
        data: {
          userId: buyerId,
          sourceAccountId: buyerAccount.id,
          type: TransactionType.TRANSFER_INTERNAL,
          amount,
          netAmount: amount,
          currencyCode: contract.currencyCode,
          status: TransactionStatus.SUCCESS,
          description: `[Escrow Deposit Lock] ${contract.title} (${contract.id})`,
          reference: `ESC-LOCK-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
        },
      });
    });

    contract.status = EscrowStatus.FUNDED;
    contract.updatedAt = new Date();

    return {
      contractId: contract.id,
      status: contract.status,
      totalAmountLocked: contract.totalAmount,
      currencyCode: contract.currencyCode,
      message: 'Escrow vault funded successfully. Milestone fulfillment may proceed.',
    };
  }

  /**
   * Seller submits milestone deliverable proof
   */
  async submitMilestone(
    sellerId: string,
    contractId: string,
    milestoneId: string,
    dto: SubmitMilestoneDto,
  ) {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new NotFoundException('Escrow contract not found');

    if (contract.sellerId !== sellerId) {
      throw new ForbiddenException('Only the designated contractor/seller can submit deliverables');
    }

    if (contract.status !== EscrowStatus.FUNDED && contract.status !== EscrowStatus.IN_PROGRESS) {
      throw new BadRequestException(`Cannot submit deliverables when contract is ${contract.status}`);
    }

    const milestone = contract.milestones.find((m) => m.id === milestoneId);
    if (!milestone) throw new NotFoundException('Milestone not found in contract');

    if (milestone.status === MilestoneStatus.RELEASED || milestone.status === MilestoneStatus.APPROVED) {
      throw new BadRequestException('This milestone has already been approved/settled');
    }

    milestone.status = MilestoneStatus.SUBMITTED;
    milestone.deliverableProof = dto.deliverableProof;
    milestone.submittedAt = new Date();

    contract.status = EscrowStatus.IN_PROGRESS;
    contract.updatedAt = new Date();

    return {
      contractId,
      milestoneId,
      title: milestone.title,
      status: milestone.status,
      deliverableProof: milestone.deliverableProof,
      submittedAt: milestone.submittedAt,
      inspectionWindowHours: contract.inspectionWindowHours,
      message: 'Deliverable proof submitted. Buyer inspection window is now active.',
    };
  }

  /**
   * Buyer approves milestone and releases payment to seller
   */
  async approveMilestone(
    buyerId: string,
    contractId: string,
    milestoneId: string,
    dto?: ApproveMilestoneDto,
  ) {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new NotFoundException('Escrow contract not found');

    if (contract.buyerId !== buyerId) {
      throw new ForbiddenException('Only the buyer can approve milestone releases');
    }

    const milestone = contract.milestones.find((m) => m.id === milestoneId);
    if (!milestone) throw new NotFoundException('Milestone not found in contract');

    if (milestone.status !== MilestoneStatus.SUBMITTED) {
      throw new BadRequestException(`Milestone cannot be approved in state: ${milestone.status}`);
    }

    // Find seller bank account for disbursement
    let sellerAccount = await this.prisma.bankAccount.findFirst({
      where: {
        userId: contract.sellerId,
        currencyCode: contract.currencyCode,
        status: AccountStatus.ACTIVE,
      },
    });

    if (!sellerAccount) {
      // Auto-provision if needed
      const accountNum = '10' + Math.floor(10000000 + Math.random() * 90000000).toString();
      sellerAccount = await this.prisma.bankAccount.create({
        data: {
          userId: contract.sellerId,
          accountNumber: accountNum,
          accountName: 'Escrow Settlement Receiving Account',
          currencyCode: contract.currencyCode,
          status: AccountStatus.ACTIVE,
        },
      });
    }

    const releaseAmount = new Decimal(milestone.amount);

    // Atomic credit to seller
    await this.prisma.$transaction(async (tx) => {
      await tx.bankAccount.update({
        where: { id: sellerAccount.id },
        data: {
          currentBalance: { increment: releaseAmount },
          availableBalance: { increment: releaseAmount },
        },
      });

      await tx.transaction.create({
        data: {
          userId: contract.sellerId,
          destinationAccountId: sellerAccount.id,
          type: TransactionType.TRANSFER_INTERNAL,
          amount: releaseAmount,
          netAmount: releaseAmount,
          currencyCode: contract.currencyCode,
          status: TransactionStatus.SUCCESS,
          description: `[Escrow Milestone Settlement] ${contract.title} - ${milestone.title}`,
          reference: `ESC-REL-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
        },
      });
    });

    milestone.status = MilestoneStatus.RELEASED;
    milestone.approvedAt = new Date();
    milestone.releasedAt = new Date();

    const released = new Decimal(contract.releasedAmount).plus(releaseAmount);
    const remaining = new Decimal(contract.totalAmount).minus(released);

    contract.releasedAmount = released.toFixed(4);
    contract.remainingAmount = remaining.toFixed(4);

    // If all milestones released, complete contract
    const allReleased = contract.milestones.every((m) => m.status === MilestoneStatus.RELEASED);
    if (allReleased) {
      contract.status = EscrowStatus.COMPLETED;
    }

    contract.updatedAt = new Date();

    return {
      contractId,
      milestoneId,
      amountReleased: releaseAmount.toFixed(2),
      currencyCode: contract.currencyCode,
      totalReleased: contract.releasedAmount,
      totalRemaining: contract.remainingAmount,
      contractStatus: contract.status,
      message: 'Milestone approved and funds disbursed to seller account.',
    };
  }

  /**
   * Raise formal contract dispute
   */
  async raiseDispute(userId: string, contractId: string, dto: RaiseDisputeDto) {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new NotFoundException('Escrow contract not found');

    if (contract.buyerId !== userId && contract.sellerId !== userId) {
      throw new ForbiddenException('Only participating contract parties can raise a dispute');
    }

    if (contract.status === EscrowStatus.COMPLETED || contract.status === EscrowStatus.REFUNDED) {
      throw new BadRequestException('Cannot dispute a settled or refunded escrow contract');
    }

    contract.status = EscrowStatus.DISPUTED;
    contract.dispute = {
      raisedBy: userId,
      reason: dto.disputeReason,
      evidenceUrl: dto.evidenceUrl,
      raisedAt: new Date(),
    };
    contract.updatedAt = new Date();

    return {
      contractId,
      status: contract.status,
      dispute: contract.dispute,
      message: 'Dispute filed. Escrow vault frozen pending compliance arbitrator resolution.',
    };
  }

  /**
   * Arbitrator resolves dispute with binding settlement
   */
  async resolveDispute(arbitratorId: string, contractId: string, dto: ResolveDisputeDto) {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new NotFoundException('Escrow contract not found');

    if (contract.status !== EscrowStatus.DISPUTED) {
      throw new BadRequestException('Contract is not currently in DISPUTED status');
    }

    const remainingDecimal = new Decimal(contract.remainingAmount);
    if (remainingDecimal.isZero()) {
      throw new BadRequestException('No remaining funds in escrow vault to arbitrate');
    }

    let buyerAmount = new Decimal(0);
    let sellerAmount = new Decimal(0);

    if (dto.ruling === DisputeRuling.RELEASE_TO_SELLER) {
      sellerAmount = remainingDecimal;
    } else if (dto.ruling === DisputeRuling.REFUND_TO_BUYER) {
      buyerAmount = remainingDecimal;
    } else if (dto.ruling === DisputeRuling.SPLIT_SETTLEMENT) {
      if (!dto.buyerSplitPercentage || !dto.sellerSplitPercentage) {
        throw new BadRequestException('Split percentages are required for SPLIT_SETTLEMENT ruling');
      }
      const split = SmartEscrowUtil.calculateSplitSettlement(
        remainingDecimal,
        dto.buyerSplitPercentage,
        dto.sellerSplitPercentage,
      );
      buyerAmount = new Decimal(split.buyerRefundAmount);
      sellerAmount = new Decimal(split.sellerDisbursementAmount);
    }

    // Execute atomic settlements
    await this.prisma.$transaction(async (tx) => {
      if (buyerAmount.greaterThan(0)) {
        const buyerAcc = await tx.bankAccount.findFirst({
          where: { userId: contract.buyerId, currencyCode: contract.currencyCode },
        });
        if (buyerAcc) {
          await tx.bankAccount.update({
            where: { id: buyerAcc.id },
            data: {
              currentBalance: { increment: buyerAmount },
              availableBalance: { increment: buyerAmount },
            },
          });
        }
      }

      if (sellerAmount.greaterThan(0)) {
        const sellerAcc = await tx.bankAccount.findFirst({
          where: { userId: contract.sellerId, currencyCode: contract.currencyCode },
        });
        if (sellerAcc) {
          await tx.bankAccount.update({
            where: { id: sellerAcc.id },
            data: {
              currentBalance: { increment: sellerAmount },
              availableBalance: { increment: sellerAmount },
            },
          });
        }
      }
    });

    contract.status = buyerAmount.equals(remainingDecimal) ? EscrowStatus.REFUNDED : EscrowStatus.COMPLETED;
    contract.remainingAmount = '0.0000';
    if (contract.dispute) {
      contract.dispute.ruling = dto.ruling;
      contract.dispute.arbitratedBy = arbitratorId;
      contract.dispute.arbitrationNotes = dto.arbitrationNotes;
      contract.dispute.resolvedAt = new Date();
    }

    contract.updatedAt = new Date();

    return {
      contractId,
      status: contract.status,
      ruling: dto.ruling,
      buyerRefunded: buyerAmount.toFixed(2),
      sellerDisbursed: sellerAmount.toFixed(2),
      arbitrationNotes: dto.arbitrationNotes,
      message: 'Dispute resolved and funds disbursed according to binding arbitration.',
    };
  }

  /**
   * Get single contract
   */
  async getContract(userId: string, contractId: string) {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new NotFoundException('Escrow contract not found');

    if (contract.buyerId !== userId && contract.sellerId !== userId) {
      throw new ForbiddenException('Access denied to escrow contract details');
    }

    return contract;
  }

  /**
   * List contracts for a user (as buyer or seller)
   */
  async listUserContracts(userId: string) {
    return Array.from(this.contracts.values())
      .filter((c) => c.buyerId === userId || c.sellerId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

