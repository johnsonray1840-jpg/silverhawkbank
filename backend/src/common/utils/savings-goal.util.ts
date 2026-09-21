import Decimal from 'decimal.js';

export enum GoalCategory {
  EMERGENCY = 'EMERGENCY',
  REAL_ESTATE = 'REAL_ESTATE',
  TRAVEL = 'TRAVEL',
  VEHICLE = 'VEHICLE',
  WEALTH = 'WEALTH',
  RETIREMENT = 'RETIREMENT',
  EDUCATION = 'EDUCATION',
  CUSTOM = 'CUSTOM',
}

export enum CompoundingFrequency {
  DAILY = 365,
  MONTHLY = 12,
  QUARTERLY = 4,
  ANNUALLY = 1,
}

export interface CompoundProjectionYear {
  year: number;
  startingBalance: string;
  contributions: string;
  interestEarned: string;
  totalInterestEarned: string;
  endingBalance: string;
}

export interface CompoundProjectionResult {
  initialPrincipal: string;
  totalContributions: string;
  totalInterestEarned: string;
  futureValue: string;
  annualRatePct: string;
  years: number;
  compoundingFrequency: string;
  schedule: CompoundProjectionYear[];
}

export interface RoundUpResult {
  originalAmount: string;
  roundedAmount: string;
  spareChange: string;
  multiplier: number;
  totalSweepAmount: string;
}

export interface EarlyWithdrawalPenaltyResult {
  principal: string;
  grossAccruedInterest: string;
  penaltyPercentage: string;
  penaltyAmount: string;
  netPayableInterest: string;
  totalDisbursement: string;
  isEarly: boolean;
}

export interface GoalMilestoneProgress {
  currentAmount: string;
  targetAmount: string;
  percentComplete: number;
  remainingAmount: string;
  daysRemaining: number | null;
  projectedCompletionDate: string | null;
  status: 'ON_TRACK' | 'AHEAD' | 'BEHIND' | 'COMPLETED';
}

export class SavingsGoalUtil {
  /**
   * Calculates precise future value and year-by-year schedule with regular contributions & compounding
   * Formula: FV = P*(1 + r/n)^(nt) + PMT * [ ((1 + r/n)^(nt) - 1) / (r/n) ]
   */
  static calculateCompoundGrowth(
    principalInput: number | string | Decimal,
    monthlyContributionInput: number | string | Decimal,
    annualRatePctInput: number | string | Decimal,
    years: number,
    frequency: CompoundingFrequency = CompoundingFrequency.MONTHLY,
  ): CompoundProjectionResult {
    const P = new Decimal(principalInput || 0);
    const PMT = new Decimal(monthlyContributionInput || 0);
    const annualRate = new Decimal(annualRatePctInput || 0).dividedBy(100);
    const n = new Decimal(frequency);

    const schedule: CompoundProjectionYear[] = [];
    let currentBalance = new Decimal(P);
    let cumulativeContributions = new Decimal(0);
    let cumulativeInterest = new Decimal(0);

    const ratePerPeriod = annualRate.dividedBy(n);
    const periodsPerYear = frequency;
    const monthsPerPeriod = 12 / periodsPerYear;

    for (let yr = 1; yr <= years; yr++) {
      const yearStartBalance = currentBalance;
      let yearContributions = new Decimal(0);
      let yearInterest = new Decimal(0);

      for (let p = 0; p < periodsPerYear; p++) {
        const periodContribution = PMT.times(monthsPerPeriod);
        yearContributions = yearContributions.plus(periodContribution);
        currentBalance = currentBalance.plus(periodContribution);

        const interestForPeriod = currentBalance.times(ratePerPeriod);
        yearInterest = yearInterest.plus(interestForPeriod);
        currentBalance = currentBalance.plus(interestForPeriod);
      }

      cumulativeContributions = cumulativeContributions.plus(yearContributions);
      cumulativeInterest = cumulativeInterest.plus(yearInterest);

      schedule.push({
        year: yr,
        startingBalance: yearStartBalance.toFixed(2),
        contributions: yearContributions.toFixed(2),
        interestEarned: yearInterest.toFixed(2),
        totalInterestEarned: cumulativeInterest.toFixed(2),
        endingBalance: currentBalance.toFixed(2),
      });
    }

    return {
      initialPrincipal: P.toFixed(2),
      totalContributions: cumulativeContributions.toFixed(2),
      totalInterestEarned: cumulativeInterest.toFixed(2),
      futureValue: currentBalance.toFixed(2),
      annualRatePct: new Decimal(annualRatePctInput).toFixed(2),
      years,
      compoundingFrequency: frequency === CompoundingFrequency.DAILY ? 'DAILY' : frequency === CompoundingFrequency.MONTHLY ? 'MONTHLY' : frequency === CompoundingFrequency.QUARTERLY ? 'QUARTERLY' : 'ANNUALLY',
      schedule,
    };
  }

  /**
   * Calculates spare change round-up for debit/purchase transactions
   * e.g. $14.35 -> $15.00 ($0.65 spare change). With 2x multiplier -> $1.30 sweep.
   */
  static calculateSpareChange(
    transactionAmount: number | string | Decimal,
    roundToNearest: number = 1,
    multiplier: number = 1,
  ): RoundUpResult {
    const amt = new Decimal(transactionAmount);
    if (amt.lessThanOrEqualTo(0)) {
      return {
        originalAmount: amt.toFixed(2),
        roundedAmount: amt.toFixed(2),
        spareChange: '0.00',
        multiplier: Math.max(1, multiplier),
        totalSweepAmount: '0.00',
      };
    }

    const unit = new Decimal(roundToNearest);
    const quotient = amt.dividedBy(unit).ceil();
    let rounded = quotient.times(unit);

    // If already exactly at round threshold, sweep full 1 unit
    if (rounded.equals(amt)) {
      rounded = rounded.plus(unit);
    }

    const spareChange = rounded.minus(amt);
    const totalSweep = spareChange.times(Math.max(1, multiplier));

    return {
      originalAmount: amt.toFixed(2),
      roundedAmount: rounded.toFixed(2),
      spareChange: spareChange.toFixed(2),
      multiplier: Math.max(1, multiplier),
      totalSweepAmount: totalSweep.toFixed(2),
    };
  }

  /**
   * Computes early termination penalty if fixed lockup is broken prior to maturity
   */
  static calculateEarlyWithdrawalPenalty(
    principalAmount: number | string | Decimal,
    accruedInterest: number | string | Decimal,
    isMatured: boolean,
    penaltyRatePct: number = 50,
  ): EarlyWithdrawalPenaltyResult {
    const P = new Decimal(principalAmount);
    const grossInterest = new Decimal(accruedInterest);

    if (isMatured) {
      return {
        principal: P.toFixed(2),
        grossAccruedInterest: grossInterest.toFixed(2),
        penaltyPercentage: '0.00',
        penaltyAmount: '0.00',
        netPayableInterest: grossInterest.toFixed(2),
        totalDisbursement: P.plus(grossInterest).toFixed(2),
        isEarly: false,
      };
    }

    const penaltyPct = new Decimal(penaltyRatePct).dividedBy(100);
    const penaltyAmount = grossInterest.times(penaltyPct).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const netInterest = grossInterest.minus(penaltyAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const totalDisbursement = P.plus(netInterest).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    return {
      principal: P.toFixed(2),
      grossAccruedInterest: grossInterest.toFixed(2),
      penaltyPercentage: penaltyRatePct.toFixed(2),
      penaltyAmount: penaltyAmount.toFixed(2),
      netPayableInterest: netInterest.toFixed(2),
      totalDisbursement: totalDisbursement.toFixed(2),
      isEarly: true,
    };
  }

  /**
   * Computes milestone percentage, remaining target, and velocity
   */
  static evaluateGoalProgress(
    currentAmount: number | string | Decimal,
    targetAmount: number | string | Decimal | null,
    targetDate: Date | string | null,
  ): GoalMilestoneProgress {
    const current = new Decimal(currentAmount || 0);
    const target = targetAmount ? new Decimal(targetAmount) : null;

    if (!target || target.lessThanOrEqualTo(0)) {
      return {
        currentAmount: current.toFixed(2),
        targetAmount: '0.00',
        percentComplete: 100,
        remainingAmount: '0.00',
        daysRemaining: null,
        projectedCompletionDate: null,
        status: 'COMPLETED',
      };
    }

    const percent = Math.min(100, current.dividedBy(target).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber());
    const remaining = Decimal.max(0, target.minus(current));

    let daysRemaining: number | null = null;
    let status: 'ON_TRACK' | 'AHEAD' | 'BEHIND' | 'COMPLETED' = 'ON_TRACK';

    if (percent >= 100) {
      status = 'COMPLETED';
    } else if (targetDate) {
      const targetTime = new Date(targetDate).getTime();
      const now = Date.now();
      const diffDays = Math.ceil((targetTime - now) / (1000 * 60 * 60 * 24));
      daysRemaining = Math.max(0, diffDays);

      if (diffDays <= 0) {
        status = 'BEHIND';
      } else if (percent >= 75) {
        status = 'AHEAD';
      } else {
        status = 'ON_TRACK';
      }
    }

    return {
      currentAmount: current.toFixed(2),
      targetAmount: target.toFixed(2),
      percentComplete: percent,
      remainingAmount: remaining.toFixed(2),
      daysRemaining,
      projectedCompletionDate: targetDate ? new Date(targetDate).toISOString().split('T')[0] : null,
      status,
    };
  }
}
