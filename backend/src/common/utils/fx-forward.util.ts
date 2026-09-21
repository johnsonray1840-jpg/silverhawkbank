import Decimal from 'decimal.js';

export enum ForwardContractStatus {
  ACTIVE = 'ACTIVE',
  MATURED = 'MATURED',
  SETTLED = 'SETTLED',
  ROLLED_OVER = 'ROLLED_OVER',
  MARGIN_CALL = 'MARGIN_CALL',
  CANCELLED = 'CANCELLED',
}

export enum SettlementType {
  PHYSICAL_DELIVERY = 'PHYSICAL_DELIVERY', // Exchange full principal amounts in base and quote currencies
  CASH_SETTLED = 'CASH_SETTLED',           // Settle only net Mark-to-Market PnL difference
}

export enum ContractDirection {
  BUY_BASE = 'BUY_BASE',   // Importer buying base currency (e.g. Buying EUR with USD)
  SELL_BASE = 'SELL_BASE', // Exporter selling base currency (e.g. Selling EUR for USD)
}

export interface ForwardRateCalculationResult {
  spotRate: string;
  forwardRate: string;
  forwardPoints: string;
  baseInterestRatePct: number;
  quoteInterestRatePct: number;
  tenorDays: number;
  maturityDate: Date;
  initialMarginPct: number;
  collateralRequired: string;
  notionalBaseAmount: string;
  notionalQuoteAmount: string;
}

export interface MarkToMarketValuation {
  currentSpotRate: string;
  lockedForwardRate: string;
  direction: ContractDirection;
  notionalBaseAmount: string;
  unrealizedPnLQuote: string;      // In quote currency
  unrealizedPnLPercentage: string;
  isProfit: boolean;
  collateralLocked: string;
  effectiveCollateralBalance: string;
  collateralCoverageRatioPct: number;
  isMarginCallRequired: boolean;
  marginDeficitAmount: string;
}

export class FxForwardUtil {
  // Benchmark reference central bank interest rates (%) for Covered Interest Rate Parity
  static readonly BENCHMARK_RATES: Record<string, number> = {
    USD: 5.25, // US Fed Funds
    EUR: 3.75, // ECB Main Refinancing Rate
    GBP: 5.00, // Bank of England
    JPY: 0.25, // Bank of Japan
    CAD: 4.50, // Bank of Canada
    AUD: 4.35, // RBA Cash Rate
    CHF: 1.25, // Swiss National Bank
    NGN: 26.75, // Central Bank of Nigeria
  };

  /**
   * Calculates institutional Covered Interest Rate Parity (CIRP) Forward Outright Rate & Points:
   * Formula: F = S * (1 + r_quote * (d / 360)) / (1 + r_base * (d / 360))
   */
  static calculateForwardRate(
    baseCurrency: string,
    quoteCurrency: string,
    spotRate: number | string | Decimal,
    notionalBaseAmount: number | string | Decimal,
    tenorDays: number,
    marginPct: number = 10,
  ): ForwardRateCalculationResult {
    const spotDec = new Decimal(spotRate.toString());
    const notionalBaseDec = new Decimal(notionalBaseAmount.toString());

    if (spotDec.lessThanOrEqualTo(0)) {
      throw new Error('Spot exchange rate must be greater than zero');
    }
    if (notionalBaseDec.lessThanOrEqualTo(0)) {
      throw new Error('Notional base amount must be greater than zero');
    }
    if (tenorDays <= 0) {
      throw new Error('Tenor days must be at least 1 day');
    }

    const rBase = this.BENCHMARK_RATES[baseCurrency.toUpperCase()] ?? 4.0;
    const rQuote = this.BENCHMARK_RATES[quoteCurrency.toUpperCase()] ?? 4.0;

    const rBaseFactor = new Decimal(1).plus(
      new Decimal(rBase).dividedBy(100).times(new Decimal(tenorDays).dividedBy(360)),
    );
    const rQuoteFactor = new Decimal(1).plus(
      new Decimal(rQuote).dividedBy(100).times(new Decimal(tenorDays).dividedBy(360)),
    );

    // Forward Rate = Spot * (rQuoteFactor / rBaseFactor)
    const forwardRateDec = spotDec.times(rQuoteFactor).dividedBy(rBaseFactor).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
    const forwardPointsDec = forwardRateDec.minus(spotDec).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);

    const notionalQuoteDec = notionalBaseDec.times(forwardRateDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    // Required Collateral Margin (e.g. 10% of quote equivalent)
    const marginDec = new Decimal(marginPct).dividedBy(100);
    const collateralRequiredDec = notionalQuoteDec.times(marginDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const maturityDate = new Date(Date.now() + tenorDays * 24 * 60 * 60 * 1000);

    return {
      spotRate: spotDec.toFixed(6),
      forwardRate: forwardRateDec.toFixed(6),
      forwardPoints: forwardPointsDec.toFixed(6),
      baseInterestRatePct: rBase,
      quoteInterestRatePct: rQuote,
      tenorDays,
      maturityDate,
      initialMarginPct: marginPct,
      collateralRequired: collateralRequiredDec.toFixed(2),
      notionalBaseAmount: notionalBaseDec.toFixed(2),
      notionalQuoteAmount: notionalQuoteDec.toFixed(2),
    };
  }

  /**
   * Real-time Mark-to-Market (MTM) valuation and margin call safety health check.
   */
  static calculateMarkToMarket(
    direction: ContractDirection,
    notionalBaseAmount: number | string | Decimal,
    lockedForwardRate: number | string | Decimal,
    currentSpotRate: number | string | Decimal,
    collateralLocked: number | string | Decimal,
    maintenanceMarginThresholdPct: number = 70, // Margin call if effective collateral < 70% of initial
  ): MarkToMarketValuation {
    const notionalBaseDec = new Decimal(notionalBaseAmount.toString());
    const forwardRateDec = new Decimal(lockedForwardRate.toString());
    const spotRateDec = new Decimal(currentSpotRate.toString());
    const collateralDec = new Decimal(collateralLocked.toString());

    // For BUY_BASE: PnL = Notional * (Current Spot - Locked Forward Rate)
    // For SELL_BASE: PnL = Notional * (Locked Forward Rate - Current Spot)
    let pnlQuoteDec: Decimal;
    if (direction === ContractDirection.BUY_BASE) {
      pnlQuoteDec = notionalBaseDec.times(spotRateDec.minus(forwardRateDec)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    } else {
      pnlQuoteDec = notionalBaseDec.times(forwardRateDec.minus(spotRateDec)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    }

    const lockedQuoteValue = notionalBaseDec.times(forwardRateDec);
    const pnlPercentageDec = lockedQuoteValue.isZero()
      ? new Decimal(0)
      : pnlQuoteDec.dividedBy(lockedQuoteValue).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    // Effective Collateral = Initial Collateral + Unrealized PnL
    const effectiveCollateralDec = collateralDec.plus(pnlQuoteDec);
    const coverageRatioPct = collateralDec.isZero()
      ? 100
      : effectiveCollateralDec.dividedBy(collateralDec).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

    const isMarginCallRequired = coverageRatioPct < maintenanceMarginThresholdPct;
    const maintenanceRequiredDec = collateralDec.times(new Decimal(maintenanceMarginThresholdPct).dividedBy(100));
    const deficitDec = isMarginCallRequired
      ? Decimal.max(0, maintenanceRequiredDec.minus(effectiveCollateralDec)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : new Decimal(0);

    return {
      currentSpotRate: spotRateDec.toFixed(6),
      lockedForwardRate: forwardRateDec.toFixed(6),
      direction,
      notionalBaseAmount: notionalBaseDec.toFixed(2),
      unrealizedPnLQuote: pnlQuoteDec.toFixed(2),
      unrealizedPnLPercentage: pnlPercentageDec.toFixed(2),
      isProfit: pnlQuoteDec.greaterThanOrEqualTo(0),
      collateralLocked: collateralDec.toFixed(2),
      effectiveCollateralBalance: effectiveCollateralDec.toFixed(2),
      collateralCoverageRatioPct: coverageRatioPct,
      isMarginCallRequired,
      marginDeficitAmount: deficitDec.toFixed(2),
    };
  }
}

