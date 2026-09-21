import Decimal from 'decimal.js';

// Configure Decimal global precision to 28 digits with Half-Even (Banker's) rounding
Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -12,
  toExpPos: 28,
});

export class MoneyUtil {
  public static readonly DEFAULT_DECIMAL_PLACES = 4;
  public static readonly HIGH_PRECISION_PLACES = 8;
  public static readonly DISPLAY_DECIMAL_PLACES = 2;

  /**
   * Convert any numeric value (string, number, Decimal) safely to Decimal
   */
  public static toDecimal(value: string | number | Decimal | bigint): Decimal {
    if (value === null || value === undefined) {
      return new Decimal('0.0000');
    }
    if (value instanceof Decimal) {
      return value;
    }
    return new Decimal(value.toString());
  }

  /**
   * Deterministic addition
   */
  public static add(
    a: string | number | Decimal,
    b: string | number | Decimal,
    places: number = MoneyUtil.DEFAULT_DECIMAL_PLACES,
  ): Decimal {
    return this.toDecimal(a).plus(this.toDecimal(b)).toDecimalPlaces(places);
  }

  /**
   * Deterministic subtraction
   */
  public static subtract(
    a: string | number | Decimal,
    b: string | number | Decimal,
    places: number = MoneyUtil.DEFAULT_DECIMAL_PLACES,
  ): Decimal {
    return this.toDecimal(a).minus(this.toDecimal(b)).toDecimalPlaces(places);
  }

  /**
   * Deterministic multiplication
   */
  public static multiply(
    a: string | number | Decimal,
    b: string | number | Decimal,
    places: number = MoneyUtil.DEFAULT_DECIMAL_PLACES,
  ): Decimal {
    return this.toDecimal(a).times(this.toDecimal(b)).toDecimalPlaces(places);
  }

  /**
   * Deterministic division with zero-division guard
   */
  public static divide(
    a: string | number | Decimal,
    b: string | number | Decimal,
    places: number = MoneyUtil.DEFAULT_DECIMAL_PLACES,
  ): Decimal {
    const divisor = this.toDecimal(b);
    if (divisor.isZero()) {
      throw new Error('DIVISION_BY_ZERO: Cannot divide financial amount by zero');
    }
    return this.toDecimal(a).dividedBy(divisor).toDecimalPlaces(places);
  }

  /**
   * Banker's Rounding (Round half to even)
   */
  public static roundBankers(
    amount: string | number | Decimal,
    decimals: number = MoneyUtil.DEFAULT_DECIMAL_PLACES,
  ): string {
    return this.toDecimal(amount).toFixed(decimals, Decimal.ROUND_HALF_EVEN);
  }

  /**
   * Format currency for user display ($1,234.56)
   */
  public static formatDisplay(
    amount: string | number | Decimal,
    currencySymbol: string = '$',
    decimals: number = MoneyUtil.DISPLAY_DECIMAL_PLACES,
  ): string {
    const dec = this.toDecimal(amount);
    const parts = dec.toFixed(decimals, Decimal.ROUND_HALF_EVEN).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${currencySymbol}${parts.join('.')}`;
  }

  /**
   * Calculate percentage fee with optional cap
   */
  public static calculateFee(
    amount: string | number | Decimal,
    flatFee: string | number | Decimal = '0.0000',
    percentageFee: string | number | Decimal = '0.00',
    maxFee?: string | number | Decimal | null,
  ): { flat: Decimal; percentage: Decimal; total: Decimal } {
    const decAmount = this.toDecimal(amount);
    const decFlat = this.toDecimal(flatFee);
    const decPct = this.toDecimal(percentageFee);

    const calculatedPct = decAmount.times(decPct).dividedBy(100);
    let total = decFlat.plus(calculatedPct);

    if (maxFee !== null && maxFee !== undefined) {
      const decMax = this.toDecimal(maxFee);
      if (decMax.greaterThan(0) && total.greaterThan(decMax)) {
        total = decMax;
      }
    }

    return {
      flat: decFlat.toDecimalPlaces(4),
      percentage: calculatedPct.toDecimalPlaces(4),
      total: total.toDecimalPlaces(4),
    };
  }

  /**
   * French Amortization Installment Calculation (EMI)
   * Formula: PMT = (P * r * (1 + r)^n) / ((1 + r)^n - 1)
   */
  public static calculateLoanInstallment(
    principal: string | number | Decimal,
    annualInterestRatePercent: string | number | Decimal,
    tenureMonths: number,
  ): {
    monthlyInstallment: Decimal;
    totalRepayable: Decimal;
    totalInterest: Decimal;
  } {
    const P = this.toDecimal(principal);
    const annualRate = this.toDecimal(annualInterestRatePercent).dividedBy(100);
    const r = annualRate.dividedBy(12); // Monthly rate
    const n = new Decimal(tenureMonths);

    if (r.isZero()) {
      const monthlyInstallment = P.dividedBy(n).toDecimalPlaces(4);
      return {
        monthlyInstallment,
        totalRepayable: P,
        totalInterest: new Decimal('0.0000'),
      };
    }

    // (1 + r)^n
    const onePlusRToN = new Decimal(1).plus(r).pow(n);
    // (P * r * (1 + r)^n) / ((1 + r)^n - 1)
    const numerator = P.times(r).times(onePlusRToN);
    const denominator = onePlusRToN.minus(1);
    const monthlyInstallment = numerator.dividedBy(denominator).toDecimalPlaces(4);

    const totalRepayable = monthlyInstallment.times(n).toDecimalPlaces(4);
    const totalInterest = totalRepayable.minus(P).toDecimalPlaces(4);

    return {
      monthlyInstallment,
      totalRepayable,
      totalInterest,
    };
  }

  /**
   * Split a loan repayment into principal, interest, fee, and penalty portions
   */
  public static splitLoanRepayment(
    paymentAmount: string | number | Decimal,
    penaltyDue: string | number | Decimal = '0.0000',
    feeDue: string | number | Decimal = '0.0000',
    interestDue: string | number | Decimal = '0.0000',
    principalDue: string | number | Decimal = '0.0000',
  ): {
    penaltyPaid: Decimal;
    feePaid: Decimal;
    interestPaid: Decimal;
    principalPaid: Decimal;
    excessPaid: Decimal;
  } {
    let remaining = this.toDecimal(paymentAmount);

    const decPenaltyDue = this.toDecimal(penaltyDue);
    const decFeeDue = this.toDecimal(feeDue);
    const decInterestDue = this.toDecimal(interestDue);
    const decPrincipalDue = this.toDecimal(principalDue);

    // 1. Pay penalty first
    const penaltyPaid = Decimal.min(remaining, decPenaltyDue).toDecimalPlaces(4);
    remaining = remaining.minus(penaltyPaid);

    // 2. Pay fees second
    const feePaid = Decimal.min(remaining, decFeeDue).toDecimalPlaces(4);
    remaining = remaining.minus(feePaid);

    // 3. Pay interest third
    const interestPaid = Decimal.min(remaining, decInterestDue).toDecimalPlaces(4);
    remaining = remaining.minus(interestPaid);

    // 4. Pay principal fourth
    const principalPaid = Decimal.min(remaining, decPrincipalDue).toDecimalPlaces(4);
    remaining = remaining.minus(principalPaid);

    // Any remaining goes to excess/early principal reduction
    const excessPaid = remaining.toDecimalPlaces(4);

    return {
      penaltyPaid,
      feePaid,
      interestPaid,
      principalPaid,
      excessPaid,
    };
  }

  /**
   * Compound Interest Calculator: A = P(1 + r/n)^(nt)
   */
  public static calculateCompoundGrowth(
    principal: string | number | Decimal,
    annualRatePercent: string | number | Decimal,
    periodsPerYear: number = 12,
    totalPeriods: number = 12,
  ): {
    futureValue: Decimal;
    totalYield: Decimal;
  } {
    const P = this.toDecimal(principal);
    const r = this.toDecimal(annualRatePercent).dividedBy(100);
    const n = new Decimal(periodsPerYear);
    const t = new Decimal(totalPeriods).dividedBy(n);

    // (1 + r/n)^(nt)
    const base = new Decimal(1).plus(r.dividedBy(n));
    const exponent = n.times(t);
    const factor = base.pow(exponent);

    const futureValue = P.times(factor).toDecimalPlaces(4);
    const totalYield = futureValue.minus(P).toDecimalPlaces(4);

    return { futureValue, totalYield };
  }
}

