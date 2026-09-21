import Decimal from 'decimal.js';
import * as crypto from 'crypto';

export interface MdrCalculationResult {
  grossAmount: string;
  mdrRatePct: string;
  flatFee: string;
  totalMdrFee: string;
  netMerchantSettlement: string;
}

export interface PosBillCalculationResult {
  subtotal: string;
  taxAmount: string;
  taxRatePct: string;
  tipAmount: string;
  tipPercentage: string;
  totalPayable: string;
}

export interface PaymentLinkMetadata {
  linkId: string;
  reference: string;
  merchantName: string;
  amount: string;
  currency: string;
  expiresAt: string | null;
  signature: string;
}

export class MerchantPosUtil {
  /**
   * Calculates Merchant Discount Rate (MDR) fee and net settlement amount
   * Standard Default: 1.25% + $0.30 per successful checkout charge
   */
  static calculateMdrFee(
    amountInput: number | string | Decimal,
    ratePct: number = 1.25,
    flatFeeInput: number = 0.30,
  ): MdrCalculationResult {
    const gross = new Decimal(amountInput || 0);
    if (gross.lessThanOrEqualTo(0)) {
      return {
        grossAmount: '0.00',
        mdrRatePct: ratePct.toFixed(2),
        flatFee: flatFeeInput.toFixed(2),
        totalMdrFee: '0.00',
        netMerchantSettlement: '0.00',
      };
    }

    const rate = new Decimal(ratePct).dividedBy(100);
    const variableFee = gross.times(rate);
    const flat = new Decimal(flatFeeInput);
    const totalFee = variableFee.plus(flat).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const netSettlement = gross.minus(totalFee).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    return {
      grossAmount: gross.toFixed(2),
      mdrRatePct: ratePct.toFixed(2),
      flatFee: flat.toFixed(2),
      totalMdrFee: totalFee.toFixed(2),
      netMerchantSettlement: netSettlement.toFixed(2),
    };
  }

  /**
   * Calculates total bill on Virtual POS Terminal including tax and gratuity tip
   */
  static calculatePosBill(
    subtotalInput: number | string | Decimal,
    tipPercentageInput: number = 0,
    customTipInput: number | string | Decimal = 0,
    taxRatePctInput: number = 0,
  ): PosBillCalculationResult {
    const subtotal = new Decimal(subtotalInput || 0);
    const taxRate = new Decimal(taxRatePctInput || 0).dividedBy(100);
    const taxAmount = subtotal.times(taxRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    let tipAmount = new Decimal(0);
    if (new Decimal(customTipInput).greaterThan(0)) {
      tipAmount = new Decimal(customTipInput).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    } else if (tipPercentageInput > 0) {
      const tipRate = new Decimal(tipPercentageInput).dividedBy(100);
      tipAmount = subtotal.times(tipRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    }

    const totalPayable = subtotal.plus(taxAmount).plus(tipAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    return {
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      taxRatePct: taxRatePctInput.toFixed(2),
      tipAmount: tipAmount.toFixed(2),
      tipPercentage: tipPercentageInput.toFixed(2),
      totalPayable: totalPayable.toFixed(2),
    };
  }

  /**
   * Generates secure cryptographic HMAC verification token for hosted payment link
   */
  static generateLinkSignature(
    linkId: string,
    merchantId: string,
    amount: string,
    currency: string,
    secret: string = 'silverhawk_pos_secret_key_2026',
  ): string {
    const payload = `${linkId}:${merchantId}:${amount}:${currency}`;
    return crypto.createHmac('sha256', secret).update(payload).digest('hex').substring(0, 32);
  }

  /**
   * Validates if payment link has expired
   */
  static isLinkExpired(expiresAt: Date | string | null): boolean {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() < Date.now();
  }

  /**
   * Formats a clean 40-column ASCII thermal POS receipt slip
   */
  static formatThermalReceipt(options: {
    merchantName: string;
    terminalId: string;
    reference: string;
    date: Date | string;
    currency: string;
    subtotal: string;
    tax: string;
    tip: string;
    total: string;
    cardPanMasked?: string;
    authCode?: string;
  }): string {
    const dateStr = new Date(options.date).toISOString().replace('T', ' ').substring(0, 19);
    const border = '========================================';
    const divider = '----------------------------------------';

    return [
      border,
      `           ${options.merchantName.toUpperCase().slice(0, 24)}`,
      '         SILVERHAWK MERCHANT TERMINAL',
      `TERMID: ${options.terminalId}     DATE: ${dateStr}`,
      `REF: ${options.reference}`,
      divider,
      `SUBTOTAL:                   ${options.currency} ${options.subtotal.padStart(9)}`,
      `TAX / VAT:                  ${options.currency} ${options.tax.padStart(9)}`,
      `TIP / GRATUITY:             ${options.currency} ${options.tip.padStart(9)}`,
      divider,
      `TOTAL CHARGED:              ${options.currency} ${options.total.padStart(9)}`,
      divider,
      `CARD: ${options.cardPanMasked || 'XXXX-XXXX-XXXX-4242'}    AUTH: ${options.authCode || 'APPRVD-200'}`,
      '           TRANSACTION APPROVED',
      '        THANK YOU FOR YOUR BUSINESS',
      border,
    ].join('\n');
  }
}

