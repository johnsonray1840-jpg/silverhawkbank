import Decimal from 'decimal.js';

export enum SpendingCategory {
  FOOD_DINING = 'FOOD_DINING',
  SHOPPING = 'SHOPPING',
  UTILITIES_BILLS = 'UTILITIES_BILLS',
  SUBSCRIPTIONS = 'SUBSCRIPTIONS',
  TRAVEL_TRANSPORT = 'TRAVEL_TRANSPORT',
  HEALTHCARE = 'HEALTHCARE',
  INVESTMENTS = 'INVESTMENTS',
  INCOME = 'INCOME',
  GENERAL_TRANSFER = 'GENERAL_TRANSFER',
  OTHER = 'OTHER',
}

export interface DetectedSubscription {
  merchantName: string;
  category: SpendingCategory;
  averageAmount: string;
  currency: string;
  frequency: 'MONTHLY' | 'ANNUAL' | 'WEEKLY';
  lastBilledDate: Date;
  nextEstimatedBillDate: Date;
  occurrences: number;
}

export interface CashflowForecast {
  currentBalance: string;
  projectedBalance30Days: string;
  projectedBalance60Days: string;
  projectedBalance90Days: string;
  dailyNetBurnRate: string;
  monthlyRecurringInflow: string;
  monthlyRecurringOutflow: string;
  runwayDays: number;
  healthIndicator: 'HEALTHY' | 'MODERATE' | 'CRITICAL_DEFICIT';
}

export class FinancialCopilotUtil {
  /**
   * Categorize transaction based on keywords and description
   */
  static categorizeTransaction(description: string, type?: string): SpendingCategory {
    const text = description.toLowerCase();

    if (type === 'SAVINGS_DEPOSIT' || text.includes('investment') || text.includes('stocks') || text.includes('crypto')) {
      return SpendingCategory.INVESTMENTS;
    }
    if (text.includes('salary') || text.includes('payroll') || text.includes('deposit') || text.includes('dividend')) {
      return SpendingCategory.INCOME;
    }
    if (
      text.includes('netflix') ||
      text.includes('spotify') ||
      text.includes('apple.com/bill') ||
      text.includes('prime video') ||
      text.includes('chatgpt') ||
      text.includes('github') ||
      text.includes('subscription')
    ) {
      return SpendingCategory.SUBSCRIPTIONS;
    }
    if (
      text.includes('restaurant') ||
      text.includes('uber eats') ||
      text.includes('doordash') ||
      text.includes('starbucks') ||
      text.includes('cafe') ||
      text.includes('coffee') ||
      text.includes('groceries') ||
      text.includes('supermarket') ||
      text.includes('walmart')
    ) {
      return SpendingCategory.FOOD_DINING;
    }
    if (
      text.includes('electric') ||
      text.includes('water') ||
      text.includes('internet') ||
      text.includes('telecom') ||
      text.includes('utility') ||
      text.includes('gas bill')
    ) {
      return SpendingCategory.UTILITIES_BILLS;
    }
    if (
      text.includes('uber') ||
      text.includes('lyft') ||
      text.includes('airline') ||
      text.includes('flight') ||
      text.includes('hotel') ||
      text.includes('airbnb') ||
      text.includes('transit') ||
      text.includes('fuel') ||
      text.includes('shell')
    ) {
      return SpendingCategory.TRAVEL_TRANSPORT;
    }
    if (
      text.includes('pharmacy') ||
      text.includes('hospital') ||
      text.includes('doctor') ||
      text.includes('dental') ||
      text.includes('health') ||
      text.includes('clinic')
    ) {
      return SpendingCategory.HEALTHCARE;
    }
    if (text.includes('amazon') || text.includes('ebay') || text.includes('target') || text.includes('store') || text.includes('pos')) {
      return SpendingCategory.SHOPPING;
    }
    if (text.includes('transfer') || text.includes('p2p') || text.includes('wire')) {
      return SpendingCategory.GENERAL_TRANSFER;
    }

    return SpendingCategory.OTHER;
  }

  /**
   * Forecast cash-flow for 30, 60, and 90 days
   */
  static calculateCashflowForecast(
    currentBalance: string | Decimal,
    monthlyIncome: string | Decimal,
    monthlyExpenses: string | Decimal,
  ): CashflowForecast {
    const bal = new Decimal(currentBalance);
    const inc = new Decimal(monthlyIncome);
    const exp = new Decimal(monthlyExpenses);

    const monthlyNet = inc.minus(exp);
    const dailyNet = monthlyNet.dividedBy(30);

    const proj30 = bal.plus(monthlyNet);
    const proj60 = bal.plus(monthlyNet.times(2));
    const proj90 = bal.plus(monthlyNet.times(3));

    let runwayDays = 999;
    if (dailyNet.isNegative()) {
      runwayDays = Math.max(0, Math.floor(bal.dividedBy(dailyNet.abs()).toNumber()));
    }

    let healthIndicator: 'HEALTHY' | 'MODERATE' | 'CRITICAL_DEFICIT' = 'HEALTHY';
    if (runwayDays < 30 || proj30.isNegative()) {
      healthIndicator = 'CRITICAL_DEFICIT';
    } else if (runwayDays < 90 || proj90.lessThan(bal.times(0.5))) {
      healthIndicator = 'MODERATE';
    }

    return {
      currentBalance: bal.toFixed(4),
      projectedBalance30Days: proj30.toFixed(4),
      projectedBalance60Days: proj60.toFixed(4),
      projectedBalance90Days: proj90.toFixed(4),
      dailyNetBurnRate: dailyNet.toFixed(4),
      monthlyRecurringInflow: inc.toFixed(4),
      monthlyRecurringOutflow: exp.toFixed(4),
      runwayDays,
      healthIndicator,
    };
  }

  /**
   * Compute 0–100 Financial Health Score
   */
  static calculateHealthScore(
    monthlyIncome: number,
    monthlyExpenses: number,
    totalSavings: number,
  ): { score: number; grade: string; summary: string } {
    let score = 50;

    // 1. Savings to Income Buffer
    if (monthlyExpenses > 0) {
      const emergencyMonths = totalSavings / monthlyExpenses;
      if (emergencyMonths >= 6) score += 25;
      else if (emergencyMonths >= 3) score += 15;
      else if (emergencyMonths >= 1) score += 5;
    }

    // 2. Savings Rate (Income > Expenses)
    if (monthlyIncome > 0) {
      const savingsRate = (monthlyIncome - monthlyExpenses) / monthlyIncome;
      if (savingsRate >= 0.3) score += 25;
      else if (savingsRate >= 0.15) score += 15;
      else if (savingsRate > 0) score += 5;
      else score -= 15;
    }

    score = Math.max(0, Math.min(100, score));

    let grade = 'B';
    let summary = 'Solid financial standing with moderate emergency cushion.';

    if (score >= 85) {
      grade = 'A+';
      summary = 'Exceptional financial resilience with strong savings reserves and high cash flow surplus.';
    } else if (score >= 70) {
      grade = 'A';
      summary = 'Healthy financial standing with balanced spending and recurring surplus.';
    } else if (score < 50) {
      grade = 'C';
      summary = 'High outflow relative to income. Consider establishing a 3-month emergency reserve.';
    }

    return { score, grade, summary };
  }
}

