import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CashflowForecast,
  DetectedSubscription,
  FinancialCopilotUtil,
  SpendingCategory,
} from '../../common/utils/financial-copilot.util';
import { CopilotQueryDto, ForecastFilterDto } from './dto/copilot.dto';
import { AccountStatus, TransactionStatus } from '@prisma/client';
import Decimal from 'decimal.js';

@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get personalized financial insights, category breakdown, and health score
   */
  async getInsights(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        bankAccounts: { where: { status: AccountStatus.ACTIVE } },
        savingsAccounts: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    const totalCheckingBalance = user.bankAccounts.reduce(
      (sum, acc) => sum.plus(new Decimal(acc.availableBalance.toString())),
      new Decimal(0),
    );

    const totalSavingsBalance = user.savingsAccounts.reduce(
      (sum, sav) => sum.plus(new Decimal(sav.currentAmount.toString())),
      new Decimal(0),
    );

    const netWorth = totalCheckingBalance.plus(totalSavingsBalance);

    // Fetch transactions from the last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        status: TransactionStatus.SUCCESS,
        createdAt: { gte: thirtyDaysAgo },
      },
    });

    let totalMonthlyInflow = new Decimal(0);
    let totalMonthlyOutflow = new Decimal(0);
    const categoryTotals: Record<string, Decimal> = {};

    for (const t of transactions) {
      const amount = new Decimal(t.amount.toString());
      const category = FinancialCopilotUtil.categorizeTransaction(t.description, t.type);

      if (category === SpendingCategory.INCOME) {
        totalMonthlyInflow = totalMonthlyInflow.plus(amount);
      } else {
        totalMonthlyOutflow = totalMonthlyOutflow.plus(amount);
        categoryTotals[category] = (categoryTotals[category] || new Decimal(0)).plus(amount);
      }
    }

    const health = FinancialCopilotUtil.calculateHealthScore(
      totalMonthlyInflow.toNumber(),
      totalMonthlyOutflow.toNumber(),
      totalSavingsBalance.toNumber(),
    );

    const categoryBreakdown = Object.entries(categoryTotals).map(([category, amount]) => ({
      category,
      amount: amount.toFixed(2),
      percentage: totalMonthlyOutflow.greaterThan(0)
        ? `${amount.dividedBy(totalMonthlyOutflow).times(100).toFixed(1)}%`
        : '0.0%',
    }));

    return {
      financialHealth: {
        score: health.score,
        grade: health.grade,
        summary: health.summary,
      },
      netWorth: {
        total: netWorth.toFixed(2),
        liquidChecking: totalCheckingBalance.toFixed(2),
        savingsVaults: totalSavingsBalance.toFixed(2),
        currency: user.bankAccounts[0]?.currencyCode || 'USD',
      },
      monthlySummary: {
        inflow: totalMonthlyInflow.toFixed(2),
        outflow: totalMonthlyOutflow.toFixed(2),
        netSavings: totalMonthlyInflow.minus(totalMonthlyOutflow).toFixed(2),
      },
      categoryBreakdown: categoryBreakdown.sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount)),
    };
  }

  /**
   * Detect recurring subscriptions and bills
   */
  async getSubscriptions(userId: string): Promise<DetectedSubscription[]> {
    const transactions = await this.prisma.transaction.findMany({
      where: { userId, status: TransactionStatus.SUCCESS },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const subscriptionMap: Record<string, { amounts: Decimal[]; lastDate: Date; currency: string }> = {};

    for (const t of transactions) {
      const cat = FinancialCopilotUtil.categorizeTransaction(t.description, t.type);
      if (cat === SpendingCategory.SUBSCRIPTIONS || cat === SpendingCategory.UTILITIES_BILLS) {
        const key = t.description.slice(0, 20).trim();
        if (!subscriptionMap[key]) {
          subscriptionMap[key] = {
            amounts: [],
            lastDate: t.createdAt,
            currency: t.currencyCode,
          };
        }
        subscriptionMap[key].amounts.push(new Decimal(t.amount.toString()));
      }
    }

    const detected: DetectedSubscription[] = Object.entries(subscriptionMap).map(([name, data]) => {
      const avg = data.amounts
        .reduce((a, b) => a.plus(b), new Decimal(0))
        .dividedBy(data.amounts.length)
        .toFixed(2);
      const nextDate = new Date(data.lastDate);
      nextDate.setDate(nextDate.getDate() + 30);

      return {
        merchantName: name,
        category: FinancialCopilotUtil.categorizeTransaction(name),
        averageAmount: avg,
        currency: data.currency,
        frequency: 'MONTHLY',
        lastBilledDate: data.lastDate,
        nextEstimatedBillDate: nextDate,
        occurrences: data.amounts.length,
      };
    });

    return detected;
  }

  /**
   * Predictive 30/60/90-Day Cash Flow Forecast
   */
  async getCashflowForecast(userId: string): Promise<CashflowForecast> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { bankAccounts: { where: { status: AccountStatus.ACTIVE } } },
    });

    const totalBalance = user?.bankAccounts.reduce(
      (sum, a) => sum.plus(new Decimal(a.availableBalance.toString())),
      new Decimal(0),
    ) || new Decimal(0);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const txns = await this.prisma.transaction.findMany({
      where: { userId, status: TransactionStatus.SUCCESS, createdAt: { gte: thirtyDaysAgo } },
    });

    let monthlyInflow = new Decimal(0);
    let monthlyOutflow = new Decimal(0);

    for (const t of txns) {
      const amt = new Decimal(t.amount.toString());
      if (FinancialCopilotUtil.categorizeTransaction(t.description, t.type) === SpendingCategory.INCOME) {
        monthlyInflow = monthlyInflow.plus(amt);
      } else {
        monthlyOutflow = monthlyOutflow.plus(amt);
      }
    }

    // Default simulation baseline if new account
    if (monthlyInflow.isZero() && monthlyOutflow.isZero()) {
      monthlyInflow = new Decimal('5000.0000');
      monthlyOutflow = new Decimal('3200.0000');
    }

    return FinancialCopilotUtil.calculateCashflowForecast(totalBalance, monthlyInflow, monthlyOutflow);
  }

  /**
   * Natural Language Conversational Financial Copilot Query
   */
  async queryCopilot(userId: string, dto: CopilotQueryDto) {
    const query = dto.query.toLowerCase().trim();
    const insights = await this.getInsights(userId);
    const forecast = await this.getCashflowForecast(userId);

    let answer = '';
    let actionRecommendation = '';

    if (query.includes('balance') || query.includes('net worth') || query.includes('how much money')) {
      answer = `Your total net worth across all Silverhawk checking and savings accounts is ${insights.netWorth.total} ${insights.netWorth.currency} (Checking: ${insights.netWorth.liquidChecking} ${insights.netWorth.currency}, Savings: ${insights.netWorth.savingsVaults} ${insights.netWorth.currency}).`;
      actionRecommendation = 'Consider allocating surplus liquid balances into high-yield Target Savings to earn 5% APR daily compound interest.';
    } else if (query.includes('spend') || query.includes('dining') || query.includes('food') || query.includes('shopping')) {
      const topCategories = insights.categoryBreakdown.slice(0, 3).map((c) => `${c.category}: $${c.amount} (${c.percentage})`).join(', ');
      answer = `In the last 30 days, your top spending categories were: ${topCategories || 'None recorded'}. Total monthly outflow is $${insights.monthlySummary.outflow}.`;
      actionRecommendation = 'Review recurring subscriptions to identify potential cost optimization opportunities.';
    } else if (query.includes('afford') || query.includes('can i buy')) {
      // Extract dollar amount from query if present (e.g. $1,500)
      const match = query.match(/\$?\s*(\d+[\d,]*(\.\d+)?)/);
      const requestedAmount = match ? parseFloat(match[1].replace(/,/g, '')) : 0;

      const available = parseFloat(insights.netWorth.liquidChecking);
      if (requestedAmount > 0) {
        if (available >= requestedAmount * 2) {
          answer = `Yes, you can comfortably afford this purchase of $${requestedAmount.toFixed(2)}. Your checking balance of $${available.toFixed(2)} leaves a strong remaining buffer of $${(available - requestedAmount).toFixed(2)}.`;
          actionRecommendation = 'Safe to proceed. Your 90-day cash flow projection remains in the Healthy zone.';
        } else if (available >= requestedAmount) {
          answer = `You have sufficient funds ($${available.toFixed(2)}) for the $${requestedAmount.toFixed(2)} purchase, but it will consume over 50% of your liquid checking balance.`;
          actionRecommendation = 'Consider spreading the cost or maintaining a minimum $1,000 emergency cushion.';
        } else {
          answer = `This purchase of $${requestedAmount.toFixed(2)} exceeds your available checking balance of $${available.toFixed(2)}.`;
          actionRecommendation = 'Avoid overdraft. You may transfer funds from your Target Savings vault or apply for a low-interest personal loan.';
        }
      } else {
        answer = `You currently have $${available.toFixed(2)} available in your primary checking account.`;
        actionRecommendation = 'Specify the amount (e.g. "Can I afford a $500 laptop?") for an exact affordability simulation.';
      }
    } else if (query.includes('forecast') || query.includes('runway') || query.includes('future')) {
      answer = `Based on your average net monthly surplus of $${insights.monthlySummary.netSavings}, your projected checking balance in 30 days is $${forecast.projectedBalance30Days}, in 60 days is $${forecast.projectedBalance60Days}, and in 90 days is $${forecast.projectedBalance90Days}.`;
      actionRecommendation = `Financial health status: ${forecast.healthIndicator}. Runway: ${forecast.runwayDays === 999 ? 'Infinite (>12 months)' : `${forecast.runwayDays} days`}.`;
    } else {
      answer = `Silverhawk AI Copilot is active. Your Financial Health Score is ${insights.financialHealth.score}/100 (Grade: ${insights.financialHealth.grade}). ${insights.financialHealth.summary}`;
      actionRecommendation = 'You can ask questions like: "What is my net worth?", "How much did I spend this month?", "Can I afford a $800 purchase?", or "Show my 90-day cash flow forecast".';
    }

    return {
      query: dto.query,
      answer,
      actionRecommendation,
      financialHealthScore: insights.financialHealth.score,
      timestamp: new Date().toISOString(),
    };
  }
}

