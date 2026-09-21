import Decimal from 'decimal.js';

export interface FixedDepositTenureTier {
  months: number;
  days: number;
  interestRate: string; // Percentage e.g. "8.50"
  tierLabel: string;
}

export interface FixedDepositQuote {
  principal: string;
  durationMonths: number;
  tenureDays: number;
  interestRate: string;
  startDate: string;
  maturityDate: string;
  accruedInterestAtMaturity: string;
  maturityAmount: string;
  effectiveAnnualYield: string;
  earlyBreakFeePercentage: string;
  earlyBreakFeeAmount: string;
}

export interface EarlyLiquidationQuote {
  fixedDepositId: string;
  principal: string;
  interestRate: string;
  startDate: string;
  maturityDate: string;
  daysElapsed: number;
  totalTenureDays: number;
  isMatured: boolean;
  grossAccruedInterest: string;
  interestForfeited: string;
  payableAccruedInterest: string;
  earlyBreakFeeRate: string;
  earlyBreakFee: string;
  totalPenalty: string;
  netDisbursement: string;
}

export class FixedDepositUtil {
  public static readonly TENURE_TIERS: FixedDepositTenureTier[] = [
    { months: 1, days: 30, interestRate: '7.00', tierLabel: '1 Month Starter Term' },
    { months: 3, days: 90, interestRate: '8.50', tierLabel: '3 Months Prime Term' },
    { months: 6, days: 180, interestRate: '10.50', tierLabel: '6 Months High-Yield Term' },
    { months: 12, days: 365, interestRate: '12.50', tierLabel: '12 Months Annual Growth Term' },
    { months: 24, days: 730, interestRate: '14.00', tierLabel: '24 Months Multi-Year Vault' },
    { months: 36, days: 1095, interestRate: '15.00', tierLabel: '36 Months Sovereign Term' },
  ];

  public static readonly EARLY_BREAK_FEE_PCT = new Decimal('1.00'); // 1.00% of principal
  public static readonly EARLY_INTEREST_FORFEIT_PCT = new Decimal('50.00'); // 50% of accrued interest forfeited

  /**
   * Determine interest rate based on tenure in months
   */
  public static getInterestRateForDuration(durationMonths: number): Decimal {
    if (durationMonths <= 1) return new Decimal('7.00');
    if (durationMonths <= 3) return new Decimal('8.50');
    if (durationMonths <= 6) return new Decimal('10.50');
    if (durationMonths <= 12) return new Decimal('12.50');
    if (durationMonths <= 24) return new Decimal('14.00');
    return new Decimal('15.00');
  }

  /**
   * Calculate precise Fixed Term Deposit projection & quotation
   */
  public static calculateFdrQuote(
    principalInput: number | string | Decimal,
    durationMonths: number,
    customRate?: number | string | Decimal,
    startDate: Date = new Date(),
  ): FixedDepositQuote {
    const principal = new Decimal(principalInput || 0);
    const rate = customRate ? new Decimal(customRate) : this.getInterestRateForDuration(durationMonths);

    const tenureDays = Math.round(durationMonths * 30.4375); // Average month length
    const maturityDate = new Date(startDate);
    maturityDate.setMonth(maturityDate.getMonth() + durationMonths);

    // Exact simple annual interest formula: Interest = Principal * (Rate / 100) * (DurationMonths / 12)
    const annualRateDecimal = rate.dividedBy(100);
    const interest = principal.times(annualRateDecimal).times(new Decimal(durationMonths).dividedBy(12));
    const maturityAmount = principal.plus(interest);

    // Early break fee preview
    const earlyBreakFee = principal.times(this.EARLY_BREAK_FEE_PCT.dividedBy(100));

    return {
      principal: principal.toFixed(4),
      durationMonths,
      tenureDays,
      interestRate: rate.toFixed(2),
      startDate: startDate.toISOString(),
      maturityDate: maturityDate.toISOString(),
      accruedInterestAtMaturity: interest.toFixed(4),
      maturityAmount: maturityAmount.toFixed(4),
      effectiveAnnualYield: rate.toFixed(2),
      earlyBreakFeePercentage: this.EARLY_BREAK_FEE_PCT.toFixed(2),
      earlyBreakFeeAmount: earlyBreakFee.toFixed(4),
    };
  }

  /**
   * Calculate accrued interest up to a target date
   */
  public static calculateAccruedInterest(
    principalInput: number | string | Decimal,
    ratePctInput: number | string | Decimal,
    startDate: Date,
    targetDate: Date = new Date(),
  ): Decimal {
    const principal = new Decimal(principalInput || 0);
    const ratePct = new Decimal(ratePctInput || 0);
    const msInDay = 1000 * 60 * 60 * 24;
    const daysElapsed = Math.max(0, Math.floor((targetDate.getTime() - startDate.getTime()) / msInDay));
    const annualRate = ratePct.dividedBy(100);

    // Daily accrual: Principal * (Rate / 365) * Days
    const interest = principal.times(annualRate.dividedBy(365)).times(daysElapsed);
    return interest.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  }

  /**
   * Compute comprehensive early liquidation breakdown with penalties
   */
  public static calculateEarlyLiquidation(
    fixedDepositId: string,
    principalInput: number | string | Decimal,
    ratePctInput: number | string | Decimal,
    startDate: Date,
    maturityDate: Date,
    evaluationDate: Date = new Date(),
  ): EarlyLiquidationQuote {
    const principal = new Decimal(principalInput || 0);
    const ratePct = new Decimal(ratePctInput || 0);

    const msInDay = 1000 * 60 * 60 * 24;
    const totalTenureDays = Math.max(1, Math.round((maturityDate.getTime() - startDate.getTime()) / msInDay));
    const daysElapsed = Math.max(0, Math.floor((evaluationDate.getTime() - startDate.getTime()) / msInDay));

    const isMatured = evaluationDate.getTime() >= maturityDate.getTime();
    const grossAccruedInterest = this.calculateAccruedInterest(principal, ratePct, startDate, evaluationDate);

    if (isMatured) {
      return {
        fixedDepositId,
        principal: principal.toFixed(4),
        interestRate: ratePct.toFixed(2),
        startDate: startDate.toISOString(),
        maturityDate: maturityDate.toISOString(),
        daysElapsed,
        totalTenureDays,
        isMatured: true,
        grossAccruedInterest: grossAccruedInterest.toFixed(4),
        interestForfeited: '0.0000',
        payableAccruedInterest: grossAccruedInterest.toFixed(4),
        earlyBreakFeeRate: '0.00',
        earlyBreakFee: '0.0000',
        totalPenalty: '0.0000',
        netDisbursement: principal.plus(grossAccruedInterest).toFixed(4),
      };
    }

    // Premature break penalty:
    // 1. Forfeit 50% of accrued interest
    const interestForfeited = grossAccruedInterest.times(this.EARLY_INTEREST_FORFEIT_PCT.dividedBy(100)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    const payableAccruedInterest = grossAccruedInterest.minus(interestForfeited);

    // 2. Charge 1.00% early break fee on principal
    const earlyBreakFee = principal.times(this.EARLY_BREAK_FEE_PCT.dividedBy(100)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    const totalPenalty = interestForfeited.plus(earlyBreakFee);

    const netDisbursement = principal.plus(payableAccruedInterest).minus(earlyBreakFee);

    return {
      fixedDepositId,
      principal: principal.toFixed(4),
      interestRate: ratePct.toFixed(2),
      startDate: startDate.toISOString(),
      maturityDate: maturityDate.toISOString(),
      daysElapsed,
      totalTenureDays,
      isMatured: false,
      grossAccruedInterest: grossAccruedInterest.toFixed(4),
      interestForfeited: interestForfeited.toFixed(4),
      payableAccruedInterest: payableAccruedInterest.toFixed(4),
      earlyBreakFeeRate: this.EARLY_BREAK_FEE_PCT.toFixed(2),
      earlyBreakFee: earlyBreakFee.toFixed(4),
      totalPenalty: totalPenalty.toFixed(4),
      netDisbursement: Decimal.max(0, netDisbursement).toFixed(4),
    };
  }
}

