import Decimal from 'decimal.js';

export enum FeeCategory {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  TRANSFER_INTERNAL = 'TRANSFER_INTERNAL',
  TRANSFER_EXTERNAL = 'TRANSFER_EXTERNAL',
  LOAN_PROCESSING = 'LOAN_PROCESSING',
  LOAN_LATE_PENALTY = 'LOAN_LATE_PENALTY',
  CURRENCY_CONVERSION = 'CURRENCY_CONVERSION',
  CARD_ISSUANCE = 'CARD_ISSUANCE',
  CARD_MAINTENANCE = 'CARD_MAINTENANCE',
  ACCOUNT_MAINTENANCE = 'ACCOUNT_MAINTENANCE',
}

export interface FeeCalculationRule {
  category: FeeCategory;
  currencyCode: string;
  flatFee: string; // e.g. "25.0000"
  percentageFee: string; // e.g. "0.50" (0.50%)
  minFee: string; // e.g. "0.0000"
  maxFee?: string | null; // e.g. "250.0000"
  isActive: boolean;
}

export interface CalculatedFeeResult {
  category: FeeCategory;
  nominalAmount: string;
  flatFee: string;
  percentageFeeRate: string;
  variableFee: string;
  totalFee: string;
  netPayableAmount: string;
  ledgerRevenueCode: string;
  description: string;
}

export class FeeEngineUtil {
  public static readonly PROHIBITED_DECEPTIVE_TERMS = new Set([
    'unlock_funds',
    'unlock',
    'clearance',
    'clearance_fee',
    'cot',
    'cost_of_transfer',
    'imf',
    'imf_code',
    'tax_release',
    'anti_terror_cert',
    'anti_money_laundering_stamp',
    'diplomatic_delivery_charge',
    'funds_activation_charge',
  ]);

  public static readonly DEFAULT_RULES: Record<FeeCategory, { flat: string; pct: string; min: string; max?: string }> = {
    [FeeCategory.DEPOSIT]: { flat: '0.0000', pct: '0.00', min: '0.0000' }, // Free standard deposits
    [FeeCategory.WITHDRAWAL]: { flat: '10.0000', pct: '0.25', min: '10.0000', max: '250.0000' }, // $10 flat + 0.25%
    [FeeCategory.TRANSFER_INTERNAL]: { flat: '0.0000', pct: '0.00', min: '0.0000' }, // 100% Free peer-to-peer
    [FeeCategory.TRANSFER_EXTERNAL]: { flat: '25.0000', pct: '0.50', min: '25.0000', max: '500.0000' }, // SWIFT Wire $25 + 0.50%
    [FeeCategory.LOAN_PROCESSING]: { flat: '50.0000', pct: '1.00', min: '50.0000', max: '1000.0000' }, // 1.00% origination fee
    [FeeCategory.LOAN_LATE_PENALTY]: { flat: '25.0000', pct: '2.00', min: '25.0000' }, // 2.00% overdue penalty
    [FeeCategory.CURRENCY_CONVERSION]: { flat: '0.0000', pct: '0.50', min: '0.0000' }, // 0.50% FX margin
    [FeeCategory.CARD_ISSUANCE]: { flat: '10.0000', pct: '0.00', min: '10.0000' }, // $10 physical card
    [FeeCategory.CARD_MAINTENANCE]: { flat: '2.0000', pct: '0.00', min: '2.0000' }, // $2/month maintenance
    [FeeCategory.ACCOUNT_MAINTENANCE]: { flat: '5.0000', pct: '0.00', min: '5.0000' }, // $5/month basic checking
  };

  /**
   * Validate that a fee category is legitimate and strictly reject deceptive fee schemes
   */
  public static validateFeeCategory(categoryKey: string): FeeCategory {
    const normalized = categoryKey.toLowerCase().trim().replace(/[-\s]/g, '_');

    for (const term of this.PROHIBITED_DECEPTIVE_TERMS) {
      if (normalized === term || normalized.includes(term)) {
        throw new Error(`PROHIBITED_FEE_TYPE: '${categoryKey}' represents a deceptive non-compliant fee category`);
      }
    }

    const match = Object.values(FeeCategory).find(
      (c) => c.toLowerCase() === normalized,
    );

    if (!match) {
      throw new Error(`INVALID_FEE_CATEGORY: '${categoryKey}' is not a recognized commercial banking fee`);
    }

    return match;
  }

  /**
   * Calculate precise fee breakdown server-side
   */
  public static calculateFee(
    category: FeeCategory,
    amountInput: number | string | Decimal,
    currencyCode: string = 'USD',
    customRule?: Partial<FeeCalculationRule>,
  ): CalculatedFeeResult {
    const amount = new Decimal(amountInput || 0);
    const defaults = this.DEFAULT_RULES[category];

    const flatFee = new Decimal(customRule?.flatFee || defaults.flat);
    const percentageFee = new Decimal(customRule?.percentageFee || defaults.pct);
    const minFee = new Decimal(customRule?.minFee || defaults.min);
    const maxFee = customRule?.maxFee ? new Decimal(customRule.maxFee) : defaults.max ? new Decimal(defaults.max) : null;

    // Variable fee = amount * (percentage / 100)
    const variableFee = amount.times(percentageFee.dividedBy(100)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

    let totalFee = flatFee.plus(variableFee);

    // Apply minimum fee floor
    if (totalFee.lessThan(minFee)) {
      totalFee = minFee;
    }

    // Apply maximum fee ceiling if configured
    if (maxFee && totalFee.greaterThan(maxFee)) {
      totalFee = maxFee;
    }

    totalFee = totalFee.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    const netPayable = amount.minus(totalFee).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

    let ledgerRevenueCode = '4010-FEE-INCOME';
    if (category === FeeCategory.CARD_ISSUANCE || category === FeeCategory.CARD_MAINTENANCE) {
      ledgerRevenueCode = '4020-CARD-FEES';
    } else if (category === FeeCategory.LOAN_LATE_PENALTY) {
      ledgerRevenueCode = '4030-PENALTY-INCOME';
    } else if (category === FeeCategory.CURRENCY_CONVERSION) {
      ledgerRevenueCode = '4040-FX-SPREAD-INCOME';
    }

    return {
      category,
      nominalAmount: amount.toFixed(4),
      flatFee: flatFee.toFixed(4),
      percentageFeeRate: percentageFee.toFixed(2),
      variableFee: variableFee.toFixed(4),
      totalFee: totalFee.toFixed(4),
      netPayableAmount: Decimal.max(0, netPayable).toFixed(4),
      ledgerRevenueCode,
      description: `${category.replace(/_/g, ' ')} Tariff (${currencyCode} ${flatFee.toFixed(2)} + ${percentageFee.toFixed(2)}%)`,
    };
  }
}
