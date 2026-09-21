import Decimal from 'decimal.js';

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface RiskEvaluationInput {
  amount: string | Decimal;
  currency: string;
  transfersCountLast15Mins: number;
  totalOutflowToday: string | Decimal;
  dailyLimit: string | Decimal;
  isNewBeneficiary: boolean;
  isInternational: boolean;
}

export interface RiskEvaluationResult {
  score: number; // 0 to 100
  level: RiskLevel;
  requiresStepUp2FA: boolean;
  requiresAdminReview: boolean;
  flags: string[];
}

export class RiskEngineUtil {
  /**
   * Evaluate financial transaction risk based on velocity, amount, destination, and beneficiary age
   */
  static evaluateTransactionRisk(input: RiskEvaluationInput): RiskEvaluationResult {
    let score = 0;
    const flags: string[] = [];

    const amount = new Decimal(input.amount);
    const totalOutflowToday = new Decimal(input.totalOutflowToday);
    const dailyLimit = new Decimal(input.dailyLimit);

    // 1. High Velocity Check (> 3 transfers in 15 mins)
    if (input.transfersCountLast15Mins >= 5) {
      score += 35;
      flags.push('CRITICAL_VELOCITY_EXCEEDED');
    } else if (input.transfersCountLast15Mins >= 3) {
      score += 20;
      flags.push('HIGH_VELOCITY_WARNING');
    }

    // 2. High-Value Transaction Check (single transaction > 50% of daily limit)
    if (dailyLimit.greaterThan(0) && amount.greaterThan(dailyLimit.times(0.5))) {
      score += 25;
      flags.push('HIGH_VALUE_THRESHOLD');
    }

    // 3. Daily Outflow Exhaustion (> 80% of daily limit reached)
    if (dailyLimit.greaterThan(0) && totalOutflowToday.plus(amount).greaterThan(dailyLimit.times(0.8))) {
      score += 20;
      flags.push('DAILY_LIMIT_NEAR_EXHAUSTION');
    }

    // 4. New Beneficiary Cooling Period Check
    if (input.isNewBeneficiary) {
      score += 15;
      flags.push('NEW_BENEFICIARY_FIRST_TRANSFER');
    }

    // 5. Cross-Border / International Wire
    if (input.isInternational) {
      score += 10;
      flags.push('CROSS_BORDER_WIRE');
    }

    // Determine Risk Level & Actions
    let level = RiskLevel.LOW;
    let requiresStepUp2FA = false;
    let requiresAdminReview = false;

    if (score >= 70) {
      level = RiskLevel.CRITICAL;
      requiresStepUp2FA = true;
      requiresAdminReview = true;
    } else if (score >= 45) {
      level = RiskLevel.HIGH;
      requiresStepUp2FA = true;
      requiresAdminReview = false;
    } else if (score >= 25) {
      level = RiskLevel.MEDIUM;
      requiresStepUp2FA = false;
      requiresAdminReview = false;
    }

    return {
      score: Math.min(score, 100),
      level,
      requiresStepUp2FA,
      requiresAdminReview,
      flags,
    };
  }
}

