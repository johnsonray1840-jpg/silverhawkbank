import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateSharedVaultDto,
  AddVaultMemberDto,
  InitiateTreasuryTransferDto,
  ApproveTransferDto,
  RejectTransferDto,
  ConfigureSweepRuleDto,
} from './dto/treasury.dto';
import {
  TreasuryRole,
  MultiSigRequestStatus,
  TreasuryMultiSigUtil,
  SweepCalculationResult,
} from '../../common/utils/treasury-multisig.util';
import { AccountStatus, AccountType, TransactionStatus, TransactionType } from '@prisma/client';
import Decimal from 'decimal.js';
import * as crypto from 'crypto';

export interface InMemoryVaultMember {
  userId: string;
  role: TreasuryRole;
  joinedAt: Date;
}

export interface InMemorySweepRule {
  targetMinBalance: number;
  targetMaxBalance: number;
  destinationAccountId: string;
  updatedAt: Date;
}

export interface InMemoryVault {
  id: string;
  name: string;
  description?: string;
  currencyCode: string;
  requiredApprovals: number;
  instantSpendLimit: number;
  bankAccountId: string;
  ownerId: string;
  members: InMemoryVaultMember[];
  sweepRule?: InMemorySweepRule;
  createdAt: Date;
}

export interface InMemoryTransferRequest {
  id: string;
  vaultId: string;
  sourceAccountId: string;
  destinationAccountNumber: string;
  destinationBankCode: string;
  amount: number;
  currency: string;
  memo: string;
  initiatedBy: string;
  requiredSignatures: number;
  status: MultiSigRequestStatus;
  approvals: {
    signerId: string;
    role: TreasuryRole;
    approvedAt: Date;
    comment?: string;
  }[];
  rejectionReason?: string;
  expiresAt: Date;
  createdAt: Date;
}

@Injectable()
export class TreasuryService {
  private readonly logger = new Logger(TreasuryService.name);

  // High-performance thread-safe state store for Treasury governance
  private vaults: Map<string, InMemoryVault> = new Map();
  private requests: Map<string, InMemoryTransferRequest> = new Map();

  constructor(private prisma: PrismaService) {}

  /**
   * Create a new Multi-Party Shared Treasury Vault
   */
  async createSharedVault(userId: string, dto: CreateSharedVaultDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw new NotFoundException('User not found');

    // Find or create an underlying dedicated active bank account for this treasury vault
    let bankAccount = await this.prisma.bankAccount.findFirst({
      where: { userId, currencyCode: dto.currencyCode, status: AccountStatus.ACTIVE },
    });

    if (!bankAccount) {
      // Create new checking account if none exists
      const accountNum = '19' + Math.floor(10000000 + Math.random() * 90000000).toString();
      bankAccount = await this.prisma.bankAccount.create({
        data: {
          userId,
          accountNumber: accountNum,
          accountName: dto.name,
          type: AccountType.BUSINESS,
          currencyCode: dto.currencyCode,
          currentBalance: new Decimal(0),
          availableBalance: new Decimal(0),
          status: AccountStatus.ACTIVE,
        },
      });
    }

    const vaultId = `vlt_${crypto.randomBytes(8).toString('hex')}`;
    const vault: InMemoryVault = {
      id: vaultId,
      name: dto.name,
      description: dto.description,
      currencyCode: dto.currencyCode,
      requiredApprovals: dto.requiredApprovals,
      instantSpendLimit: dto.instantSpendLimit || 0,
      bankAccountId: bankAccount.id,
      ownerId: userId,
      members: [
        {
          userId,
          role: TreasuryRole.OWNER,
          joinedAt: new Date(),
        },
      ],
      createdAt: new Date(),
    };

    this.vaults.set(vaultId, vault);

    this.logger.log(`Created Shared Treasury Vault: ${vault.name} (${vaultId}) for user ${userId}`);

    return {
      vaultId,
      name: vault.name,
      currencyCode: vault.currencyCode,
      requiredApprovals: vault.requiredApprovals,
      instantSpendLimit: vault.instantSpendLimit,
      bankAccountNumber: bankAccount.accountNumber,
      availableBalance: bankAccount.availableBalance.toString(),
      role: TreasuryRole.OWNER,
      createdAt: vault.createdAt,
    };
  }

  /**
   * List all shared vaults accessible to the user
   */
  async listUserVaults(userId: string) {
    const accessibleVaults = Array.from(this.vaults.values()).filter((v) =>
      v.members.some((m) => m.userId === userId),
    );

    const results = [];
    for (const v of accessibleVaults) {
      const member = v.members.find((m) => m.userId === userId)!;
      const bankAccount = await this.prisma.bankAccount.findUnique({
        where: { id: v.bankAccountId },
      });

      results.push({
        vaultId: v.id,
        name: v.name,
        description: v.description,
        currencyCode: v.currencyCode,
        requiredApprovals: v.requiredApprovals,
        instantSpendLimit: v.instantSpendLimit,
        bankAccountNumber: bankAccount?.accountNumber || 'N/A',
        availableBalance: bankAccount?.availableBalance.toString() || '0.0000',
        myRole: member.role,
        memberCount: v.members.length,
        createdAt: v.createdAt,
      });
    }

    return results;
  }

  /**
   * Add a member to a shared treasury vault
   */
  async addVaultMember(userId: string, vaultId: string, dto: AddVaultMemberDto) {
    const vault = this.vaults.get(vaultId);
    if (!vault) throw new NotFoundException('Treasury vault not found');

    const requesterMember = vault.members.find((m) => m.userId === userId);
    if (!requesterMember || !TreasuryMultiSigUtil.isAdmin(requesterMember.role)) {
      throw new ForbiddenException('Only vault Owners can add members or modify roles');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      include: { profile: true },
    });
    if (!targetUser) throw new NotFoundException('Invited user not found on platform');

    const existingIndex = vault.members.findIndex((m) => m.userId === dto.userId);
    if (existingIndex >= 0) {
      vault.members[existingIndex].role = dto.role;
    } else {
      vault.members.push({
        userId: dto.userId,
        role: dto.role,
        joinedAt: new Date(),
      });
    }

    const memberName = targetUser.profile
      ? `${targetUser.profile.firstName} ${targetUser.profile.lastName}`
      : targetUser.username;

    return {
      vaultId,
      memberId: dto.userId,
      role: dto.role,
      memberName,
      totalMembers: vault.members.length,
    };
  }

  /**
   * List members of a vault
   */
  async listVaultMembers(userId: string, vaultId: string) {
    const vault = this.vaults.get(vaultId);
    if (!vault) throw new NotFoundException('Treasury vault not found');

    const isMember = vault.members.some((m) => m.userId === userId);
    if (!isMember) throw new ForbiddenException('Access denied to vault member registry');

    const memberDetails = [];
    for (const m of vault.members) {
      const u = await this.prisma.user.findUnique({
        where: { id: m.userId },
        include: { profile: true },
      });
      const name = u?.profile
        ? `${u.profile.firstName} ${u.profile.lastName}`
        : u?.username || 'Unknown User';

      memberDetails.push({
        userId: m.userId,
        name,
        email: u?.email,
        role: m.role,
        joinedAt: m.joinedAt,
      });
    }

    return memberDetails;
  }

  /**
   * Initiate a transfer from the Shared Treasury Vault
   */
  async initiateTransfer(userId: string, vaultId: string, dto: InitiateTreasuryTransferDto) {
    const vault = this.vaults.get(vaultId);
    if (!vault) throw new NotFoundException('Treasury vault not found');

    const member = vault.members.find((m) => m.userId === userId);
    if (!member || !TreasuryMultiSigUtil.canInitiate(member.role)) {
      throw new ForbiddenException('Your role is not authorized to initiate treasury disbursements');
    }

    const bankAccount = await this.prisma.bankAccount.findUnique({
      where: { id: vault.bankAccountId },
    });

    if (!bankAccount) throw new NotFoundException('Underlying bank account not found');

    const transferAmount = new Decimal(dto.amount);
    if (new Decimal(bankAccount.availableBalance.toString()).lessThan(transferAmount)) {
      throw new BadRequestException('Insufficient treasury account available balance');
    }

    // Check if within instant spend limit
    const isInstant = TreasuryMultiSigUtil.isInstantSpendAllowed(transferAmount, vault.instantSpendLimit);

    if (isInstant) {
      // Execute instantly via atomic ledger update
      await this.prisma.$transaction(async (tx) => {
        await tx.bankAccount.update({
          where: { id: vault.bankAccountId },
          data: {
            currentBalance: { decrement: transferAmount },
            availableBalance: { decrement: transferAmount },
          },
        });

        await tx.transaction.create({
          data: {
            userId,
            sourceAccountId: vault.bankAccountId,
            type: TransactionType.TRANSFER_EXTERNAL,
            amount: transferAmount,
            netAmount: transferAmount,
            currencyCode: vault.currencyCode,
            status: TransactionStatus.SUCCESS,
            description: `[Treasury Instant] ${dto.memo} to ${dto.destinationAccountNumber}`,
            reference: `TRZ-INST-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
          },
        });
      });

      return {
        status: MultiSigRequestStatus.EXECUTED,
        message: 'Instant transfer executed successfully under pre-approved threshold limit',
        amount: transferAmount.toFixed(2),
        currency: vault.currencyCode,
        executedAt: new Date().toISOString(),
      };
    }

    // Multi-Sig Request queued
    const requestId = `req_${crypto.randomBytes(8).toString('hex')}`;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7-day validity

    const newRequest: InMemoryTransferRequest = {
      id: requestId,
      vaultId,
      sourceAccountId: vault.bankAccountId,
      destinationAccountNumber: dto.destinationAccountNumber,
      destinationBankCode: dto.destinationBankCode || 'SILVERHAWK',
      amount: dto.amount,
      currency: vault.currencyCode,
      memo: dto.memo,
      initiatedBy: userId,
      requiredSignatures: vault.requiredApprovals,
      status: MultiSigRequestStatus.PENDING_APPROVAL,
      approvals: [],
      expiresAt,
      createdAt: new Date(),
    };

    // Auto-approve if initiator is an APPROVER or OWNER
    if (TreasuryMultiSigUtil.canApprove(member.role)) {
      newRequest.approvals.push({
        signerId: userId,
        role: member.role,
        approvedAt: new Date(),
        comment: 'Auto-approved by initiating signer',
      });
    }

    this.requests.set(requestId, newRequest);

    return {
      requestId,
      status: MultiSigRequestStatus.PENDING_APPROVAL,
      amount: transferAmount.toFixed(2),
      currency: vault.currencyCode,
      requiredSignatures: newRequest.requiredSignatures,
      currentSignatures: newRequest.approvals.length,
      remainingSignatures: Math.max(0, newRequest.requiredSignatures - newRequest.approvals.length),
      expiresAt: newRequest.expiresAt,
      message: `Multi-signature transfer request queued. Requires ${newRequest.requiredSignatures} approvals before execution.`,
    };
  }

  /**
   * Sign and approve a pending multi-sig transfer request
   */
  async approveTransfer(userId: string, requestId: string, dto: ApproveTransferDto) {
    const request = this.requests.get(requestId);
    if (!request) throw new NotFoundException('Multi-sig transfer request not found');

    if (request.status !== MultiSigRequestStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`Request cannot be approved in its current state: ${request.status}`);
    }

    const vault = this.vaults.get(request.vaultId);
    if (!vault) throw new NotFoundException('Associated treasury vault not found');

    const member = vault.members.find((m) => m.userId === userId);
    if (!member || !TreasuryMultiSigUtil.canApprove(member.role)) {
      throw new ForbiddenException('Your role does not have signing/approval privileges in this vault');
    }

    const alreadyApproved = request.approvals.some((a) => a.signerId === userId);
    if (alreadyApproved) {
      throw new BadRequestException('You have already signed and approved this transfer request');
    }

    // Record approval signature
    request.approvals.push({
      signerId: userId,
      role: member.role,
      approvedAt: new Date(),
      comment: dto.comment,
    });

    const quorum = TreasuryMultiSigUtil.evaluateQuorum(request.requiredSignatures, request.approvals.length);

    if (quorum.isQuorumReached) {
      // Execute atomically
      const transferAmount = new Decimal(request.amount);
      await this.prisma.$transaction(async (tx) => {
        await tx.bankAccount.update({
          where: { id: request.sourceAccountId },
          data: {
            currentBalance: { decrement: transferAmount },
            availableBalance: { decrement: transferAmount },
          },
        });

        await tx.transaction.create({
          data: {
            userId: request.initiatedBy,
            sourceAccountId: request.sourceAccountId,
            type: TransactionType.TRANSFER_EXTERNAL,
            amount: transferAmount,
            netAmount: transferAmount,
            currencyCode: request.currency,
            status: TransactionStatus.SUCCESS,
            description: `[Treasury MultiSig M-of-N] ${request.memo} to ${request.destinationAccountNumber}`,
            reference: `TRZ-MSIG-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
          },
        });
      });

      request.status = MultiSigRequestStatus.EXECUTED;

      return {
        requestId,
        status: MultiSigRequestStatus.EXECUTED,
        message: 'M-of-N Quorum reached! Transfer executed successfully to ledger.',
        totalApprovals: request.approvals.length,
        requiredSignatures: request.requiredSignatures,
        executedAt: new Date().toISOString(),
      };
    }

    return {
      requestId,
      status: MultiSigRequestStatus.PENDING_APPROVAL,
      message: `Signature verified and recorded. Still requires ${quorum.remainingSignatures} more approval(s).`,
      totalApprovals: request.approvals.length,
      requiredSignatures: request.requiredSignatures,
      remainingSignatures: quorum.remainingSignatures,
    };
  }

  /**
   * Reject a pending multi-sig transfer request
   */
  async rejectTransfer(userId: string, requestId: string, dto: RejectTransferDto) {
    const request = this.requests.get(requestId);
    if (!request) throw new NotFoundException('Multi-sig transfer request not found');

    if (request.status !== MultiSigRequestStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`Request cannot be rejected in status: ${request.status}`);
    }

    const vault = this.vaults.get(request.vaultId);
    if (!vault) throw new NotFoundException('Associated treasury vault not found');

    const member = vault.members.find((m) => m.userId === userId);
    if (!member || !TreasuryMultiSigUtil.canApprove(member.role)) {
      throw new ForbiddenException('Your role does not have authorization to reject requests in this vault');
    }

    request.status = MultiSigRequestStatus.REJECTED;
    request.rejectionReason = dto.reason;

    return {
      requestId,
      status: MultiSigRequestStatus.REJECTED,
      reason: dto.reason,
      rejectedBy: userId,
      rejectedAt: new Date().toISOString(),
    };
  }

  /**
   * List pending requests for a vault
   */
  async listVaultRequests(userId: string, vaultId: string) {
    const vault = this.vaults.get(vaultId);
    if (!vault) throw new NotFoundException('Treasury vault not found');

    const isMember = vault.members.some((m) => m.userId === userId);
    if (!isMember) throw new ForbiddenException('Access denied to vault requests');

    return Array.from(this.requests.values())
      .filter((r) => r.vaultId === vaultId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Configure automated liquidity sweep rule
   */
  async configureSweepRule(userId: string, vaultId: string, dto: ConfigureSweepRuleDto) {
    const vault = this.vaults.get(vaultId);
    if (!vault) throw new NotFoundException('Treasury vault not found');

    const member = vault.members.find((m) => m.userId === userId);
    if (!member || !TreasuryMultiSigUtil.isAdmin(member.role)) {
      throw new ForbiddenException('Only vault Owners can configure automated liquidity sweep rules');
    }

    vault.sweepRule = {
      targetMinBalance: dto.targetMinBalance,
      targetMaxBalance: dto.targetMaxBalance,
      destinationAccountId: dto.destinationAccountId,
      updatedAt: new Date(),
    };

    return {
      vaultId,
      sweepRule: vault.sweepRule,
      message: 'Automated target balance liquidity sweep rule configured successfully.',
    };
  }

  /**
   * Execute automated liquidity sweep calculation & rebalancing
   */
  async executeSweep(userId: string, vaultId: string): Promise<SweepCalculationResult> {
    const vault = this.vaults.get(vaultId);
    if (!vault) throw new NotFoundException('Treasury vault not found');

    const isMember = vault.members.some((m) => m.userId === userId);
    if (!isMember) throw new ForbiddenException('Access denied to vault sweep execution');

    if (!vault.sweepRule) {
      throw new BadRequestException('No automated sweep rule configured for this treasury vault');
    }

    const bankAccount = await this.prisma.bankAccount.findUnique({
      where: { id: vault.bankAccountId },
    });

    if (!bankAccount) throw new NotFoundException('Underlying bank account not found');

    const currentBal = bankAccount.availableBalance.toString();
    const result = TreasuryMultiSigUtil.calculateSweepDelta(
      currentBal,
      vault.sweepRule.targetMinBalance,
      vault.sweepRule.targetMaxBalance,
    );

    if (result.actionRequired && parseFloat(result.amount) > 0) {
      const sweepAmount = new Decimal(result.amount);
      await this.prisma.bankAccount.update({
        where: { id: vault.bankAccountId },
        data: {
          currentBalance: {
            decrement: result.sweepType === 'TARGET_BALANCE_SWEEP' ? sweepAmount : new Decimal(0),
            increment: result.sweepType === 'ZERO_BALANCE_REPLENISH' ? sweepAmount : new Decimal(0),
          },
          availableBalance: {
            decrement: result.sweepType === 'TARGET_BALANCE_SWEEP' ? sweepAmount : new Decimal(0),
            increment: result.sweepType === 'ZERO_BALANCE_REPLENISH' ? sweepAmount : new Decimal(0),
          },
        },
      });
    }

    return result;
  }
}
