import Decimal from 'decimal.js';

export enum TreasuryRole {
  OWNER = 'OWNER',
  APPROVER = 'APPROVER',
  INITIATOR = 'INITIATOR',
  AUDITOR = 'AUDITOR',
}

export enum MultiSigRequestStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  EXECUTED = 'EXECUTED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum SweepType {
  TARGET_BALANCE_SWEEP = 'TARGET_BALANCE_SWEEP', // Sweep excess balance > max
  ZERO_BALANCE_REPLENISH = 'ZERO_BALANCE_REPLENISH', // Replenish if balance < min
}

export interface MultiSigApproval {
  signerId: string;
  signerName: string;
  role: TreasuryRole;
  approvedAt: Date;
  comment?: string;
}

export interface TreasuryTransferRequest {
  id: string;
  vaultId: string;
  sourceAccountId: string;
  destinationAccountNumber: string;
  destinationBankCode: string;
  amount: string;
  currency: string;
  memo: string;
  initiatedBy: string;
  requiredSignatures: number;
  currentSignatures: number;
  status: MultiSigRequestStatus;
  approvals: MultiSigApproval[];
  expiresAt: Date;
  createdAt: Date;
}

export interface SweepCalculationResult {
  sweepType: SweepType;
  actionRequired: boolean;
  amount: string;
  currentBalance: string;
  projectedBalanceAfterSweep: string;
}

export class TreasuryMultiSigUtil {
  /**
   * Check if a role is permitted to initiate spending requests
   */
  static canInitiate(role: TreasuryRole): boolean {
    return [TreasuryRole.OWNER, TreasuryRole.APPROVER, TreasuryRole.INITIATOR].includes(role);
  }

  /**
   * Check if a role is permitted to sign/approve multi-sig requests
   */
  static canApprove(role: TreasuryRole): boolean {
    return [TreasuryRole.OWNER, TreasuryRole.APPROVER].includes(role);
  }

  /**
   * Check if a role has admin privileges (add members, edit rules)
   */
  static isAdmin(role: TreasuryRole): boolean {
    return role === TreasuryRole.OWNER;
  }

  /**
   * Evaluate if approval quorum threshold (M-of-N) has been reached
   */
  static evaluateQuorum(
    requiredSignatures: number,
    approvalsCount: number,
  ): { isQuorumReached: boolean; remainingSignatures: number } {
    const remaining = Math.max(0, requiredSignatures - approvalsCount);
    return {
      isQuorumReached: approvalsCount >= requiredSignatures,
      remainingSignatures: remaining,
    };
  }

  /**
   * Determine if a transfer amount can bypass multi-sig (instant spend limit)
   */
  static isInstantSpendAllowed(
    amount: Decimal | string | number,
    instantSpendLimit: Decimal | string | number,
  ): boolean {
    const amt = new Decimal(amount.toString());
    const limit = new Decimal(instantSpendLimit.toString());
    return amt.lessThanOrEqualTo(limit);
  }

  /**
   * Calculate Target Balance / Zero-Balance liquidity sweep delta
   */
  static calculateSweepDelta(
    currentBalance: Decimal | string | number,
    targetMin: Decimal | string | number,
    targetMax: Decimal | string | number,
  ): SweepCalculationResult {
    const bal = new Decimal(currentBalance.toString());
    const min = new Decimal(targetMin.toString());
    const max = new Decimal(targetMax.toString());

    if (bal.greaterThan(max)) {
      // Excess balance: sweep surplus above max
      const sweepAmount = bal.minus(max);
      return {
        sweepType: SweepType.TARGET_BALANCE_SWEEP,
        actionRequired: true,
        amount: sweepAmount.toFixed(4),
        currentBalance: bal.toFixed(4),
        projectedBalanceAfterSweep: max.toFixed(4),
      };
    } else if (bal.lessThan(min)) {
      // Deficit balance: replenish back up to target min (or midpoint)
      const replenishAmount = min.minus(bal);
      return {
        sweepType: SweepType.ZERO_BALANCE_REPLENISH,
        actionRequired: true,
        amount: replenishAmount.toFixed(4),
        currentBalance: bal.toFixed(4),
        projectedBalanceAfterSweep: min.toFixed(4),
      };
    }

    return {
      sweepType: SweepType.TARGET_BALANCE_SWEEP,
      actionRequired: false,
      amount: '0.0000',
      currentBalance: bal.toFixed(4),
      projectedBalanceAfterSweep: bal.toFixed(4),
    };
  }
}

