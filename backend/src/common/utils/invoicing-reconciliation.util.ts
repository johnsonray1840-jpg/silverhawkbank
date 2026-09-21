import Decimal from 'decimal.js';

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  FACTORING_REQUESTED = 'FACTORING_REQUESTED',
  FACTORED = 'FACTORED',
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED',
}

export enum FactoringStatus {
  NONE = 'NONE',
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  DISBURSED = 'DISBURSED',
  REPAID = 'REPAID',
  REJECTED = 'REJECTED',
}

export interface EarlyPaymentTerms {
  discountPercentage: number; // e.g. 2 for 2% discount
  discountDays: number;       // e.g. 10 days
  netDays: number;            // e.g. 30 days
}

export interface InvoiceLineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number; // e.g. 20 for 20%
}

export interface ComputedInvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: string;
  taxRate: number;
  lineSubtotal: string;
  taxAmount: string;
  totalAmount: string;
}

export interface InvoiceCalculationResult {
  subtotal: string;
  totalTax: string;
  totalAmount: string;
  lineItems: ComputedInvoiceLineItem[];
  earlyDiscountAmount?: string;
  earlyDiscountEligibleUntil?: Date;
  amountDueWithEarlyDiscount?: string;
}

export interface FactoringCalculationResult {
  invoiceAmount: string;
  advanceRatePct: number;
  advanceAmount: string;
  factoringFeePct: number;
  factoringFeeAmount: string;
  reserveAmount: string;
  netAdvanceDisbursed: string;
}

export interface ReconciliationMatchResult {
  matched: boolean;
  confidenceScore: number; // 0 to 100
  matchReason: string;
  matchedInvoiceId?: string;
  matchedInvoiceNumber?: string;
  amountMatchType: 'EXACT' | 'EARLY_DISCOUNT' | 'PARTIAL' | 'OVERPAYMENT' | 'NONE';
  settlementAmount: string;
  earlyDiscountApplied: boolean;
}

export class InvoicingReconciliationUtil {
  /**
   * Calculates subtotal, VAT/tax amounts, totals, and early payment discount window.
   */
  static calculateInvoice(
    items: InvoiceLineItemInput[],
    earlyTerms?: EarlyPaymentTerms,
    issueDate: Date = new Date(),
  ): InvoiceCalculationResult {
    if (!items || items.length === 0) {
      throw new Error('Invoice must contain at least one line item');
    }

    let subtotalDec = new Decimal(0);
    let totalTaxDec = new Decimal(0);

    const computedItems: ComputedInvoiceLineItem[] = items.map((item, index) => {
      const qty = new Decimal(item.quantity || 1);
      const price = new Decimal(item.unitPrice || 0);
      const taxRate = new Decimal(item.taxRate || 0);

      if (qty.lessThanOrEqualTo(0)) {
        throw new Error(`Line item #${index + 1} quantity must be greater than 0`);
      }
      if (price.lessThan(0)) {
        throw new Error(`Line item #${index + 1} unit price cannot be negative`);
      }

      const lineSubtotal = qty.times(price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const lineTax = lineSubtotal.times(taxRate.dividedBy(100)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const lineTotal = lineSubtotal.plus(lineTax);

      subtotalDec = subtotalDec.plus(lineSubtotal);
      totalTaxDec = totalTaxDec.plus(lineTax);

      return {
        id: `ITEM-${index + 1}`,
        description: item.description,
        quantity: qty.toNumber(),
        unitPrice: price.toFixed(2),
        taxRate: taxRate.toNumber(),
        lineSubtotal: lineSubtotal.toFixed(2),
        taxAmount: lineTax.toFixed(2),
        totalAmount: lineTotal.toFixed(2),
      };
    });

    const totalDec = subtotalDec.plus(totalTaxDec);

    let earlyDiscountAmount: string | undefined;
    let earlyDiscountEligibleUntil: Date | undefined;
    let amountDueWithEarlyDiscount: string | undefined;

    if (earlyTerms && earlyTerms.discountPercentage > 0 && earlyTerms.discountDays > 0) {
      const discountPct = new Decimal(earlyTerms.discountPercentage).dividedBy(100);
      const discountDec = totalDec.times(discountPct).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const discountedTotal = totalDec.minus(discountDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      const discountExpiry = new Date(issueDate.getTime() + earlyTerms.discountDays * 24 * 60 * 60 * 1000);

      earlyDiscountAmount = discountDec.toFixed(2);
      earlyDiscountEligibleUntil = discountExpiry;
      amountDueWithEarlyDiscount = discountedTotal.toFixed(2);
    }

    return {
      subtotal: subtotalDec.toFixed(2),
      totalTax: totalTaxDec.toFixed(2),
      totalAmount: totalDec.toFixed(2),
      lineItems: computedItems,
      earlyDiscountAmount,
      earlyDiscountEligibleUntil,
      amountDueWithEarlyDiscount,
    };
  }

  /**
   * Computes invoice factoring financing terms.
   * e.g. 85% immediate liquidity advance, 1.5% factoring fee, 15% reserve.
   */
  static calculateFactoringTerms(
    invoiceAmount: number | string | Decimal,
    advanceRatePct: number = 85,
    factoringFeePct: number = 1.5,
  ): FactoringCalculationResult {
    const invAmountDec = new Decimal(invoiceAmount.toString());
    if (invAmountDec.lessThanOrEqualTo(0)) {
      throw new Error('Invoice amount for factoring must be greater than zero');
    }

    if (advanceRatePct <= 0 || advanceRatePct > 100) {
      throw new Error('Advance rate percentage must be between 1 and 100');
    }

    if (factoringFeePct < 0 || factoringFeePct > 20) {
      throw new Error('Factoring fee percentage must be between 0% and 20%');
    }

    const advanceRateDec = new Decimal(advanceRatePct).dividedBy(100);
    const feeRateDec = new Decimal(factoringFeePct).dividedBy(100);

    const advanceAmountDec = invAmountDec.times(advanceRateDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const feeAmountDec = invAmountDec.times(feeRateDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const reserveAmountDec = invAmountDec.minus(advanceAmountDec).minus(feeAmountDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    return {
      invoiceAmount: invAmountDec.toFixed(2),
      advanceRatePct,
      advanceAmount: advanceAmountDec.toFixed(2),
      factoringFeePct,
      factoringFeeAmount: feeAmountDec.toFixed(2),
      reserveAmount: reserveAmountDec.toFixed(2),
      netAdvanceDisbursed: advanceAmountDec.toFixed(2),
    };
  }

  /**
   * Smart AR Reconciliation matcher: Matches an incoming bank payment to open invoices
   * using exact invoice number, reference tokens, counterparty tax ID/name, and amounts.
   */
  static matchPaymentToInvoices(
    payment: {
      amount: number | string;
      reference?: string;
      senderName?: string;
      senderTaxId?: string;
      paymentDate?: Date;
    },
    openInvoices: Array<{
      id: string;
      invoiceNumber: string;
      clientName?: string;
      clientTaxId?: string;
      totalAmount: string;
      remainingBalance: string;
      earlyDiscountAmount?: string;
      earlyDiscountEligibleUntil?: Date;
      issueDate: Date;
      dueDate: Date;
    }>,
  ): ReconciliationMatchResult {
    const payAmountDec = new Decimal(payment.amount.toString());
    const payDate = payment.paymentDate || new Date();
    const cleanRef = (payment.reference || '').toUpperCase().trim();
    const cleanSender = (payment.senderName || '').toUpperCase().trim();
    const cleanTaxId = (payment.senderTaxId || '').toUpperCase().trim();

    if (openInvoices.length === 0) {
      return {
        matched: false,
        confidenceScore: 0,
        matchReason: 'No open invoices available for reconciliation',
        amountMatchType: 'NONE',
        settlementAmount: payAmountDec.toFixed(2),
        earlyDiscountApplied: false,
      };
    }

    let bestMatch: {
      invoice: (typeof openInvoices)[0];
      confidence: number;
      reason: string;
      matchType: 'EXACT' | 'EARLY_DISCOUNT' | 'PARTIAL' | 'OVERPAYMENT';
      settlementAmount: string;
      earlyDiscountApplied: boolean;
    } | null = null;

    for (const inv of openInvoices) {
      let score = 0;
      const reasons: string[] = [];
      let earlyDiscountEligible = false;
      const invBalanceDec = new Decimal(inv.remainingBalance || inv.totalAmount);
      const invTotalDec = new Decimal(inv.totalAmount);

      // 1. Direct Invoice Number Match in Reference (+60 points)
      const invNumClean = inv.invoiceNumber.toUpperCase().trim();
      if (cleanRef.includes(invNumClean)) {
        score += 60;
        reasons.push(`Invoice #${inv.invoiceNumber} explicitly matched in payment reference`);
      }

      // 2. Tax ID match (+25 points)
      if (cleanTaxId && inv.clientTaxId && cleanTaxId === inv.clientTaxId.toUpperCase().trim()) {
        score += 25;
        reasons.push(`Client Tax ID match (${inv.clientTaxId})`);
      }

      // 3. Client Name partial match (+15 points)
      if (cleanSender && inv.clientName) {
        const invClientUpper = inv.clientName.toUpperCase();
        if (cleanSender.includes(invClientUpper) || invClientUpper.includes(cleanSender)) {
          score += 15;
          reasons.push(`Client name similarity match (${inv.clientName})`);
        }
      }

      // 4. Amount Matching Analysis
      let matchType: 'EXACT' | 'EARLY_DISCOUNT' | 'PARTIAL' | 'OVERPAYMENT' = 'EXACT';
      let settlementAmount = payAmountDec.toFixed(2);

      // Check Early Payment Discount applicability
      if (inv.earlyDiscountAmount && inv.earlyDiscountEligibleUntil) {
        const discountCutoff = new Date(inv.earlyDiscountEligibleUntil);
        if (payDate <= discountCutoff) {
          const discountAmt = new Decimal(inv.earlyDiscountAmount);
          const discountedExpected = invTotalDec.minus(discountAmt);

          if (payAmountDec.equals(discountedExpected)) {
            earlyDiscountEligible = true;
            matchType = 'EARLY_DISCOUNT';
            score += 40;
            reasons.push(`Exact match for Early Payment 2/10 Net 30 discounted amount (${discountedExpected.toFixed(2)})`);
          }
        }
      }

      if (!earlyDiscountEligible) {
        if (payAmountDec.equals(invBalanceDec)) {
          score += 35;
          matchType = 'EXACT';
          reasons.push(`Exact balance match of \$${payAmountDec.toFixed(2)}`);
        } else if (payAmountDec.lessThan(invBalanceDec) && payAmountDec.greaterThan(0)) {
          score += 15;
          matchType = 'PARTIAL';
          reasons.push(`Partial payment of \$${payAmountDec.toFixed(2)} towards balance of \$${invBalanceDec.toFixed(2)}`);
        } else if (payAmountDec.greaterThan(invBalanceDec)) {
          score += 10;
          matchType = 'OVERPAYMENT';
          reasons.push(`Payment amount \$${payAmountDec.toFixed(2)} exceeds remaining balance \$${invBalanceDec.toFixed(2)}`);
        }
      }

      const finalScore = Math.min(100, score);
      if (!bestMatch || finalScore > bestMatch.confidence) {
        bestMatch = {
          invoice: inv,
          confidence: finalScore,
          reason: reasons.join('; ') || 'Heuristic candidate',
          matchType,
          settlementAmount,
          earlyDiscountApplied: earlyDiscountEligible,
        };
      }
    }

    if (bestMatch && bestMatch.confidence >= 50) {
      return {
        matched: true,
        confidenceScore: bestMatch.confidence,
        matchReason: bestMatch.reason,
        matchedInvoiceId: bestMatch.invoice.id,
        matchedInvoiceNumber: bestMatch.invoice.invoiceNumber,
        amountMatchType: bestMatch.matchType,
        settlementAmount: bestMatch.settlementAmount,
        earlyDiscountApplied: bestMatch.earlyDiscountApplied,
      };
    }

    return {
      matched: false,
      confidenceScore: bestMatch ? bestMatch.confidence : 0,
      matchReason: bestMatch ? `Low confidence match (${bestMatch.confidence}%): ${bestMatch.reason}` : 'No matching invoice found',
      amountMatchType: 'NONE',
      settlementAmount: payAmountDec.toFixed(2),
      earlyDiscountApplied: false,
    };
  }
}

