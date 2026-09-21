import Decimal from 'decimal.js';

export enum EscrowStatus {
  CREATED = 'CREATED',
  FUNDED = 'FUNDED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  DISPUTED = 'DISPUTED',
  REFUNDED = 'REFUNDED',
  CANCELLED = 'CANCELLED',
}

export enum MilestoneStatus {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  DISPUTED = 'DISPUTED',
  RELEASED = 'RELEASED',
}

export enum DisputeRuling {
  RELEASE_TO_SELLER = 'RELEASE_TO_SELLER',
  REFUND_TO_BUYER = 'REFUND_TO_BUYER',
  SPLIT_SETTLEMENT = 'SPLIT_SETTLEMENT',
}

export interface EscrowMilestoneItem {
  id: string;
  title: string;
  description?: string;
  amount: string;
  percentage: number;
  status: MilestoneStatus;
  deliverableProof?: string;
  submittedAt?: Date;
  approvedAt?: Date;
  releasedAt?: Date;
}

export interface SplitSettlementResult {
  buyerRefundAmount: string;
  sellerDisbursementAmount: string;
  totalSettled: string;
}

export class SmartEscrowUtil {
  /**
   * Validate and compute milestone amounts based on percentage or direct amounts
   */
  static validateAndComputeMilestones(
    totalAmount: Decimal | string | number,
    milestones: { title: string; description?: string; amount?: number; percentage?: number }[],
  ): EscrowMilestoneItem[] {
    const total = new Decimal(totalAmount.toString());
    if (total.lessThanOrEqualTo(0)) {
      throw new Error('Total escrow contract amount must be greater than zero');
    }

    if (!milestones || milestones.length === 0) {
      throw new Error('At least one milestone is required in an escrow contract');
    }

    let calculatedSum = new Decimal(0);
    const computedMilestones: EscrowMilestoneItem[] = [];

    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      let itemAmount: Decimal;
      let pct: number;

      if (m.percentage !== undefined && m.percentage > 0) {
        pct = m.percentage;
        itemAmount = total.times(pct).dividedBy(100);
      } else if (m.amount !== undefined && m.amount > 0) {
        itemAmount = new Decimal(m.amount.toString());
        pct = itemAmount.dividedBy(total).times(100).toNumber();
      } else {
        throw new Error(`Milestone #${i + 1} must specify either a valid amount or percentage`);
      }

      calculatedSum = calculatedSum.plus(itemAmount);

      computedMilestones.push({
        id: `ms_${i + 1}`,
        title: m.title,
        description: m.description,
        amount: itemAmount.toFixed(4),
        percentage: parseFloat(pct.toFixed(2)),
        status: MilestoneStatus.PENDING,
      });
    }

    // Ensure sum matches total within epsilon (0.01)
    if (calculatedSum.minus(total).abs().greaterThan(0.01)) {
      throw new Error(
        `Milestone sum (${calculatedSum.toFixed(2)}) does not equal total contract amount (${total.toFixed(2)})`,
      );
    }

    return computedMilestones;
  }

  /**
   * Check if statutory buyer inspection window (e.g. 72 hours) has expired
   */
  static isInspectionWindowExpired(submittedAt: Date, inspectionWindowHours: number = 72): boolean {
    const elapsedMs = Date.now() - new Date(submittedAt).getTime();
    const allowedMs = inspectionWindowHours * 60 * 60 * 1000;
    return elapsedMs >= allowedMs;
  }

  /**
   * Calculate precise dispute split settlement
   */
  static calculateSplitSettlement(
    escrowAmount: Decimal | string | number,
    buyerPercentage: number,
    sellerPercentage: number,
  ): SplitSettlementResult {
    const total = new Decimal(escrowAmount.toString());

    if (buyerPercentage + sellerPercentage !== 100) {
      throw new Error('Buyer and seller split percentages must sum exactly to 100%');
    }

    const buyerRefund = total.times(buyerPercentage).dividedBy(100);
    const sellerDisbursement = total.times(sellerPercentage).dividedBy(100);

    return {
      buyerRefundAmount: buyerRefund.toFixed(4),
      sellerDisbursementAmount: sellerDisbursement.toFixed(4),
      totalSettled: buyerRefund.plus(sellerDisbursement).toFixed(4),
    };
  }
}

