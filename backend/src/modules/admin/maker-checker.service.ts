import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { AuditChainUtil } from '../../common/utils/audit-chain.util';

export enum MakerCheckerActionType {
  MANUAL_ADJUSTMENT = 'MANUAL_ADJUSTMENT',
  KYC_TIER_OVERRIDE = 'KYC_TIER_OVERRIDE',
  FEE_WAIVER = 'FEE_WAIVER',
  AML_OVERRIDE = 'AML_OVERRIDE',
  TREASURY_DISBURSEMENT = 'TREASURY_DISBURSEMENT',
  ACCOUNT_FREEZE_OVERRIDE = 'ACCOUNT_FREEZE_OVERRIDE',
}

export enum ProposalStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export interface MakerCheckerProposal {
  id: string;
  actionType: MakerCheckerActionType;
  makerId: string;
  makerRole: string;
  makerReason: string;
  payload: Record<string, any>;
  amount?: number;
  currency?: string;
  status: ProposalStatus;
  createdAt: string;
  checkerId?: string;
  checkerRole?: string;
  checkerNotes?: string;
  resolvedAt?: string;
  auditSignature?: string;
}

@Injectable()
export class MakerCheckerService {
  private proposals: Map<string, MakerCheckerProposal> = new Map();

  /**
   * Maker initiates a dual-control governance proposal
   */
  public createProposal(dto: {
    actionType: MakerCheckerActionType;
    makerId: string;
    makerRole: string;
    makerReason: string;
    payload: Record<string, any>;
    amount?: number;
    currency?: string;
  }): MakerCheckerProposal {
    if (!dto.makerReason || dto.makerReason.trim().length < 5) {
      throw new BadRequestException('A valid maker reason (min 5 chars) is required');
    }

    const proposalId = `PROP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const proposal: MakerCheckerProposal = {
      id: proposalId,
      actionType: dto.actionType,
      makerId: dto.makerId,
      makerRole: dto.makerRole,
      makerReason: dto.makerReason.trim(),
      payload: dto.payload || {},
      amount: dto.amount,
      currency: dto.currency || 'USD',
      status: ProposalStatus.PENDING_REVIEW,
      createdAt: new Date().toISOString(),
    };

    this.proposals.set(proposalId, proposal);
    return proposal;
  }

  /**
   * Checker adjudicates and approves or rejects the proposal
   */
  public resolveProposal(
    proposalId: string,
    checkerId: string,
    checkerRole: string,
    decision: 'APPROVE' | 'REJECT',
    checkerNotes: string,
  ): MakerCheckerProposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new NotFoundException(`Proposal ${proposalId} not found`);
    }

    if (proposal.status !== ProposalStatus.PENDING_REVIEW) {
      throw new BadRequestException(`Proposal is already ${proposal.status} and cannot be modified`);
    }

    // Strict Segregation of Duties: Maker cannot check/approve their own proposal
    if (proposal.makerId === checkerId) {
      throw new ForbiddenException(
        'Segregation of Duties Violation: Maker cannot act as Checker on their own proposal',
      );
    }

    const resolvedAt = new Date().toISOString();
    const status = decision === 'APPROVE' ? ProposalStatus.APPROVED : ProposalStatus.REJECTED;

    // Cryptographic audit signature linking Maker + Checker + Payload
    const signaturePayload = `${proposal.id}|${proposal.actionType}|${proposal.makerId}|${checkerId}|${status}|${resolvedAt}|${JSON.stringify(proposal.payload)}`;
    const auditSignature = crypto.createHash('sha256').update(signaturePayload, 'utf8').digest('hex');

    proposal.status = status;
    proposal.checkerId = checkerId;
    proposal.checkerRole = checkerRole;
    proposal.checkerNotes = checkerNotes.trim();
    proposal.resolvedAt = resolvedAt;
    proposal.auditSignature = auditSignature;

    this.proposals.set(proposalId, proposal);
    return proposal;
  }

  /**
   * Returns all pending Maker-Checker review proposals
   */
  public listPendingProposals(): MakerCheckerProposal[] {
    return Array.from(this.proposals.values()).filter(
      (p) => p.status === ProposalStatus.PENDING_REVIEW,
    );
  }

  /**
   * Returns a specific proposal by ID
   */
  public getProposal(proposalId: string): MakerCheckerProposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new NotFoundException(`Proposal ${proposalId} not found`);
    }
    return proposal;
  }
}

