import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { EmailService } from '../email/email.service';
import {
  ApplyLoanDto,
  CalculateLoanDto,
  CreateLoanProductDto,
  RepayLoanDto,
  ReviewLoanDto,
} from './dto/create-loan.dto';
import {
  AccountStatus,
  KycTier,
  LedgerEntryType,
  LoanInterestType,
  LoanScheduleStatus,
  LoanStatus,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { CryptoUtil } from '../../common/utils/crypto.util';

@Injectable()
export class LoansService {
  private readonly logger = new Logger(LoansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Calculate EMI and amortization breakdown
   */
  calculateAmortizationSchedule(
    principal: Decimal,
    annualRatePct: Decimal,
    tenureMonths: number,
    interestType: LoanInterestType = LoanInterestType.REDUCING_BALANCE,
    startDate: Date = new Date(),
  ) {
    const r = annualRatePct.dividedBy(100).dividedBy(12); // monthly interest rate
    let monthlyInstallment: Decimal;
    let totalInterest = new Decimal('0.0000');
    const schedule: {
      installmentNumber: number;
      dueDate: Date;
      principalDue: Decimal;
      interestDue: Decimal;
      totalDue: Decimal;
      balanceRemaining: Decimal;
    }[] = [];

    if (interestType === LoanInterestType.FLAT) {
      // Flat rate calculation
      totalInterest = principal
        .times(annualRatePct.dividedBy(100))
        .times(new Decimal(tenureMonths).dividedBy(12))
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

      const totalRepayable = principal.plus(totalInterest);
      monthlyInstallment = totalRepayable
        .dividedBy(tenureMonths)
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

      const monthlyPrincipal = principal
        .dividedBy(tenureMonths)
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
      const monthlyInterest = totalInterest
        .dividedBy(tenureMonths)
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

      let runningBalance = principal;

      for (let i = 1; i <= tenureMonths; i++) {
        const dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + i);

        const pDue = i === tenureMonths ? runningBalance : monthlyPrincipal;
        runningBalance = runningBalance.minus(pDue);

        schedule.push({
          installmentNumber: i,
          dueDate,
          principalDue: pDue,
          interestDue: monthlyInterest,
          totalDue: pDue.plus(monthlyInterest),
          balanceRemaining: Decimal.max(0, runningBalance),
        });
      }
    } else {
      // Reducing balance EMI calculation: P * r * (1+r)^n / ((1+r)^n - 1)
      if (r.isZero()) {
        monthlyInstallment = principal
          .dividedBy(tenureMonths)
          .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
      } else {
        const onePlusRToN = new Decimal(1).plus(r).pow(tenureMonths);
        const numerator = principal.times(r).times(onePlusRToN);
        const denominator = onePlusRToN.minus(1);
        monthlyInstallment = numerator
          .dividedBy(denominator)
          .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
      }

      let runningBalance = principal;

      for (let i = 1; i <= tenureMonths; i++) {
        const dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + i);

        const interestForMonth = runningBalance
          .times(r)
          .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
        totalInterest = totalInterest.plus(interestForMonth);

        let principalForMonth = monthlyInstallment.minus(interestForMonth);
        if (i === tenureMonths || principalForMonth.greaterThan(runningBalance)) {
          principalForMonth = runningBalance;
        }

        runningBalance = runningBalance.minus(principalForMonth);

        schedule.push({
          installmentNumber: i,
          dueDate,
          principalDue: principalForMonth,
          interestDue: interestForMonth,
          totalDue: principalForMonth.plus(interestForMonth),
          balanceRemaining: Decimal.max(0, runningBalance),
        });
      }
    }

    const totalRepayable = principal.plus(totalInterest);

    return {
      principal: principal.toFixed(4),
      annualRate: annualRatePct.toFixed(2),
      tenureMonths,
      monthlyInstallment: monthlyInstallment.toFixed(4),
      totalInterest: totalInterest.toFixed(4),
      totalRepayable: totalRepayable.toFixed(4),
      schedule,
    };
  }

  /**
   * Public loan repayment calculator
   */
  async calculateLoan(dto: CalculateLoanDto) {
    const product = await this.prisma.loanProduct.findUnique({
      where: { id: dto.productId },
    });

    if (!product || !product.isActive) {
      throw new NotFoundException('Loan product not found or inactive');
    }

    const principal = new Decimal(dto.amount);
    const minAmount = new Decimal(product.minAmount.toString());
    const maxAmount = new Decimal(product.maxAmount.toString());

    if (principal.lessThan(minAmount) || principal.greaterThan(maxAmount)) {
      throw new BadRequestException(
        `Principal amount must be between ${minAmount.toFixed(2)} and ${maxAmount.toFixed(2)}`,
      );
    }

    if (
      dto.tenureMonths < product.minTenureMonths ||
      dto.tenureMonths > product.maxTenureMonths
    ) {
      throw new BadRequestException(
        `Tenure must be between ${product.minTenureMonths} and ${product.maxTenureMonths} months`,
      );
    }

    const rate = new Decimal(product.interestRate.toString());
    const calculation = this.calculateAmortizationSchedule(
      principal,
      rate,
      dto.tenureMonths,
      product.interestType,
    );

    const feePct = new Decimal(product.processingFeePercentage.toString()).dividedBy(100);
    const processingFee = principal.times(feePct).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

    return {
      product: {
        id: product.id,
        name: product.name,
        interestType: product.interestType,
      },
      ...calculation,
      processingFee: processingFee.toFixed(4),
      netDisbursement: principal.minus(processingFee).toFixed(4),
    };
  }

  /**
   * Submit loan application
   */
  async applyForLoan(userId: string, dto: ApplyLoanDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true, kycProfile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // KYC check: user must be at least TIER_1 to apply for credit
    if (user.kycProfile && user.kycProfile.tier === KycTier.TIER_0) {
      throw new ForbiddenException(
        'KYC_TIER_REQUIRED: Please complete Tier 1 identity verification before applying for a loan.',
      );
    }

    const product = await this.prisma.loanProduct.findUnique({
      where: { id: dto.productId },
    });

    if (!product || !product.isActive) {
      throw new NotFoundException('Loan product not found or inactive');
    }

    const bankAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.accountId },
    });

    if (!bankAccount || bankAccount.userId !== userId) {
      throw new ForbiddenException('Invalid disbursement bank account');
    }

    if (bankAccount.status !== AccountStatus.ACTIVE || bankAccount.isFrozen) {
      throw new ForbiddenException('Disbursement bank account is inactive or frozen');
    }

    const principal = new Decimal(dto.principalAmount);
    const minAmount = new Decimal(product.minAmount.toString());
    const maxAmount = new Decimal(product.maxAmount.toString());

    if (principal.lessThan(minAmount) || principal.greaterThan(maxAmount)) {
      throw new BadRequestException(
        `Principal amount must be between ${minAmount.toFixed(2)} and ${maxAmount.toFixed(2)}`,
      );
    }

    if (
      dto.tenureMonths < product.minTenureMonths ||
      dto.tenureMonths > product.maxTenureMonths
    ) {
      throw new BadRequestException(
        `Tenure must be between ${product.minTenureMonths} and ${product.maxTenureMonths} months`,
      );
    }

    const rate = new Decimal(product.interestRate.toString());
    const calc = this.calculateAmortizationSchedule(
      principal,
      rate,
      dto.tenureMonths,
      product.interestType,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      // Create Loan Application
      const application = await tx.loanApplication.create({
        data: {
          userId,
          productId: product.id,
          accountId: bankAccount.id,
          principalAmount: principal.toFixed(4),
          tenureMonths: dto.tenureMonths,
          interestRate: rate.toFixed(2),
          interestAmount: calc.totalInterest,
          totalRepayable: calc.totalRepayable,
          outstandingBalance: calc.totalRepayable,
          monthlyInstallment: calc.monthlyInstallment,
          purpose: dto.purpose,
          status: LoanStatus.SUBMITTED,
        },
      });

      // Pre-create amortization schedule entries
      for (const item of calc.schedule) {
        await tx.loanSchedule.create({
          data: {
            loanId: application.id,
            installmentNumber: item.installmentNumber,
            dueDate: item.dueDate,
            principalDue: item.principalDue.toFixed(4),
            interestDue: item.interestDue.toFixed(4),
            feeDue: '0.0000',
            totalDue: item.totalDue.toFixed(4),
            amountPaid: '0.0000',
            status: LoanScheduleStatus.PENDING,
          },
        });
      }

      // Notification
      await tx.notification.create({
        data: {
          userId,
          title: 'Loan Application Submitted',
          message: `Your application for ${product.name} of ${bankAccount.currencyCode} ${principal.toFixed(2)} has been received and is currently under underwriting review.`,
          type: 'LOAN',
        },
      });

      return application;
    });

    return {
      message: 'Loan application submitted successfully and sent for underwriting',
      application: result,
    };
  }

  /**
   * Repay loan installment
   */
  async repayLoan(userId: string, loanId: string, dto: RepayLoanDto) {
    const loan = await this.prisma.loanApplication.findUnique({
      where: { id: loanId },
      include: {
        account: true,
        user: { include: { profile: true } },
        product: true,
        schedules: {
          where: { status: { in: [LoanScheduleStatus.PENDING, LoanScheduleStatus.PARTIAL, LoanScheduleStatus.OVERDUE] } },
          orderBy: { installmentNumber: 'asc' },
        },
      },
    });

    if (!loan || loan.userId !== userId) {
      throw new NotFoundException('Loan application not found');
    }

    if (
      loan.status !== LoanStatus.ACTIVE &&
      loan.status !== LoanStatus.DISBURSED
    ) {
      throw new BadRequestException(
        `Loan is not currently active for repayment (Current status: ${loan.status})`,
      );
    }

    const repayAmount = new Decimal(dto.amount);
    if (repayAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Repayment amount must be greater than zero');
    }

    const outstanding = new Decimal(loan.outstandingBalance.toString());
    if (repayAmount.greaterThan(outstanding)) {
      throw new BadRequestException(
        `Repayment amount of ${repayAmount.toFixed(2)} exceeds total outstanding balance of ${outstanding.toFixed(2)}`,
      );
    }

    // Verify PIN
    const user = loan.user;
    if (!user.pinHash) {
      throw new BadRequestException('Transaction PIN is not configured on your account.');
    }
    const isPinValid = await CryptoUtil.verify(user.pinHash, dto.pin);
    if (!isPinValid) {
      throw new BadRequestException('Invalid transaction authorization PIN');
    }

    const bankAccount = loan.account;
    if (bankAccount.status !== AccountStatus.ACTIVE || bankAccount.isFrozen) {
      throw new ForbiddenException('Linked repayment bank account is inactive or frozen');
    }

    const txRef = CryptoUtil.generateTransactionReference('LOAN-RPY');

    const result = await this.prisma.$transaction(async (tx) => {
      const currentBank = await tx.bankAccount.findUnique({ where: { id: bankAccount.id } });
      const availableBalance = new Decimal(currentBank!.availableBalance.toString());

      if (availableBalance.lessThan(repayAmount)) {
        throw new BadRequestException('INSUFFICIENT_FUNDS: Available balance is insufficient for loan repayment');
      }

      // Deduct repayment amount from bank account
      await tx.bankAccount.update({
        where: { id: bankAccount.id },
        data: {
          currentBalance: { decrement: repayAmount.toFixed(4) },
          availableBalance: { decrement: repayAmount.toFixed(4) },
          ledgerBalance: { decrement: repayAmount.toFixed(4) },
        },
      });

      // Allocate repayment across unpaid installments: principal vs interest
      let remainingPayment = repayAmount;
      let totalPrincipalPaid = new Decimal('0.0000');
      let totalInterestPaid = new Decimal('0.0000');

      for (const schedule of loan.schedules) {
        if (remainingPayment.isZero()) break;

        const totalDue = new Decimal(schedule.totalDue.toString());
        const amountAlreadyPaid = new Decimal(schedule.amountPaid.toString());
        const pendingForSchedule = totalDue.minus(amountAlreadyPaid);

        const principalDue = new Decimal(schedule.principalDue.toString());
        const interestDue = new Decimal(schedule.interestDue.toString());

        if (remainingPayment.greaterThanOrEqualTo(pendingForSchedule)) {
          // Full payment of this schedule installment
          await tx.loanSchedule.update({
            where: { id: schedule.id },
            data: {
              amountPaid: totalDue.toFixed(4),
              status: LoanScheduleStatus.PAID,
              paidAt: new Date(),
            },
          });

          const unpaidPrincipalPortion = principalDue.minus(amountAlreadyPaid.greaterThan(principalDue) ? principalDue : amountAlreadyPaid);
          totalPrincipalPaid = totalPrincipalPaid.plus(Decimal.max(0, unpaidPrincipalPortion));
          totalInterestPaid = totalInterestPaid.plus(interestDue);

          remainingPayment = remainingPayment.minus(pendingForSchedule);
        } else {
          // Partial payment of this schedule installment
          const newAmountPaid = amountAlreadyPaid.plus(remainingPayment);
          await tx.loanSchedule.update({
            where: { id: schedule.id },
            data: {
              amountPaid: newAmountPaid.toFixed(4),
              status: LoanScheduleStatus.PARTIAL,
            },
          });

          // Attribute partial payment to interest first then principal
          if (remainingPayment.lessThanOrEqualTo(interestDue)) {
            totalInterestPaid = totalInterestPaid.plus(remainingPayment);
          } else {
            totalInterestPaid = totalInterestPaid.plus(interestDue);
            totalPrincipalPaid = totalPrincipalPaid.plus(remainingPayment.minus(interestDue));
          }

          remainingPayment = new Decimal('0.0000');
        }
      }

      // Update loan outstanding balance
      const newOutstanding = outstanding.minus(repayAmount);
      const isCompleted = newOutstanding.isZero() || newOutstanding.lessThan(new Decimal('0.01'));

      const updatedLoan = await tx.loanApplication.update({
        where: { id: loan.id },
        data: {
          outstandingBalance: Decimal.max(0, newOutstanding).toFixed(4),
          status: isCompleted ? LoanStatus.COMPLETED : LoanStatus.ACTIVE,
        },
      });

      // Create Transaction record
      const businessTx = await tx.transaction.create({
        data: {
          reference: txRef,
          userId,
          sourceAccountId: bankAccount.id,
          type: TransactionType.LOAN_REPAYMENT,
          amount: repayAmount.toFixed(4),
          fee: '0.0000',
          netAmount: repayAmount.toFixed(4),
          currencyCode: bankAccount.currencyCode,
          status: TransactionStatus.SUCCESS,
          description: `Repayment for ${loan.product.name} (#${loan.id.substring(0, 8)})`,
          metadata: {
            loanId: loan.id,
            principalPortion: totalPrincipalPaid.toFixed(4),
            interestPortion: totalInterestPaid.toFixed(4),
            remainingOutstanding: Decimal.max(0, newOutstanding).toFixed(4),
          },
        },
      });

      // Double-entry General Ledger posting:
      // Debit: 2010-<acc> (Customer Current Liability) [repayAmount]
      // Credit: 1030 (Loans & Advances Asset / Principal) [totalPrincipalPaid]
      // Credit: 4020 (Loan Interest Income) [totalInterestPaid]
      const currentAccLedgerCode = `2010-${bankAccount.accountNumber}`;
      const journalEntries: any[] = [
        {
          accountCode: currentAccLedgerCode,
          entryType: LedgerEntryType.DEBIT,
          amount: repayAmount.toFixed(4),
          currencyCode: bankAccount.currencyCode,
        },
      ];

      if (totalPrincipalPaid.greaterThan(0)) {
        journalEntries.push({
          accountCode: '1030', // Loans & Advances Asset
          entryType: LedgerEntryType.CREDIT,
          amount: totalPrincipalPaid.toFixed(4),
          currencyCode: bankAccount.currencyCode,
        });
      }

      if (totalInterestPaid.greaterThan(0)) {
        journalEntries.push({
          accountCode: '4020', // Loan Interest Income
          entryType: LedgerEntryType.CREDIT,
          amount: totalInterestPaid.toFixed(4),
          currencyCode: bankAccount.currencyCode,
        });
      }

      // If there's a fractional rounding difference between principal + interest and total, assign to Interest Income
      const totalCredits = totalPrincipalPaid.plus(totalInterestPaid);
      if (!totalCredits.equals(repayAmount)) {
        const diff = repayAmount.minus(totalCredits);
        // adjust last entry or add
        if (journalEntries.length > 1) {
          journalEntries[1].amount = new Decimal(journalEntries[1].amount).plus(diff).toFixed(4);
        }
      }

      await this.ledgerService.postJournalEntry(
        tx,
        {
          reference: `JRN-${txRef}`,
          transactionId: businessTx.id,
          description: `Loan Repayment for ${loan.product.name}`,
          entries: journalEntries,
        },
        userId,
      );

      // Notification
      await tx.notification.create({
        data: {
          userId,
          title: isCompleted ? 'Loan Fully Paid Off!' : 'Loan Repayment Received',
          message: isCompleted
            ? `Congratulations! Your loan #${loan.id.substring(0, 8)} has been fully settled and closed.`
            : `Successfully debited ${bankAccount.currencyCode} ${repayAmount.toFixed(2)} towards loan repayment. Remaining balance: ${bankAccount.currencyCode} ${Decimal.max(0, newOutstanding).toFixed(2)}.`,
          type: 'LOAN',
        },
      });

      return { updatedLoan, businessTx, isCompleted };
    });

    // Send Debit Alert Email
    const updatedBank = await this.prisma.bankAccount.findUnique({ where: { id: bankAccount.id } });
    const userName = user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user.username;

    await this.emailService.sendDebitAlert({
      to: user.email,
      senderName: userName,
      amount: repayAmount.toFixed(4),
      currency: bankAccount.currencyCode,
      recipientName: `Silverhawk Credit Desk (${loan.product.name})`,
      accountNumber: bankAccount.accountNumber,
      reference: txRef,
      description: `Loan Installment Repayment (#${loan.id.substring(0, 8)})`,
      availableBalance: updatedBank!.availableBalance.toString(),
    });

    return {
      message: result.isCompleted ? 'Loan fully settled and closed!' : 'Loan repayment processed successfully',
      outstandingBalance: result.updatedLoan.outstandingBalance.toString(),
      isCompleted: result.isCompleted,
      transaction: result.businessTx,
    };
  }

  /**
   * List all loan products
   */
  async getLoanProducts() {
    return this.prisma.loanProduct.findMany({
      where: { isActive: true },
      orderBy: { minAmount: 'asc' },
    });
  }

  /**
   * List customer's loan applications
   */
  async getUserLoans(userId: string) {
    const loans = await this.prisma.loanApplication.findMany({
      where: { userId },
      include: {
        product: true,
        account: true,
        schedules: {
          orderBy: { installmentNumber: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const activeLoans = loans.filter((l) => l.status === LoanStatus.ACTIVE || l.status === LoanStatus.DISBURSED);
    const totalOutstanding = activeLoans.reduce(
      (acc, curr) => acc.plus(new Decimal(curr.outstandingBalance.toString())),
      new Decimal('0.0000'),
    );

    return {
      totalOutstanding: totalOutstanding.toFixed(4),
      count: loans.length,
      loans,
    };
  }

  /**
   * Single loan details with full schedule
   */
  async getLoanById(userId: string, loanId: string) {
    const loan = await this.prisma.loanApplication.findUnique({
      where: { id: loanId },
      include: {
        product: true,
        account: true,
        schedules: {
          orderBy: { installmentNumber: 'asc' },
        },
      },
    });

    if (!loan || loan.userId !== userId) {
      throw new NotFoundException('Loan not found');
    }

    return loan;
  }

  /**
   * Admin: List all loans across the bank
   */
  async adminListLoans(query?: { status?: LoanStatus; productId?: string }) {
    const where: any = {};
    if (query?.status) where.status = query.status;
    if (query?.productId) where.productId = query.productId;

    const loans = await this.prisma.loanApplication.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            profile: true,
            kycProfile: true,
          },
        },
        product: true,
        account: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalPortfolioOutstanding = loans.reduce(
      (acc, curr) => acc.plus(new Decimal(curr.outstandingBalance.toString())),
      new Decimal('0.0000'),
    );

    return {
      totalPortfolioOutstanding: totalPortfolioOutstanding.toFixed(4),
      count: loans.length,
      loans,
    };
  }

  /**
   * Admin: Review loan application (APPROVE or REJECT)
   */
  async adminReviewLoan(adminId: string, loanId: string, dto: ReviewLoanDto) {
    const loan = await this.prisma.loanApplication.findUnique({
      where: { id: loanId },
      include: { user: true, product: true },
    });

    if (!loan) {
      throw new NotFoundException('Loan application not found');
    }

    if (loan.status !== LoanStatus.SUBMITTED && loan.status !== LoanStatus.UNDER_REVIEW) {
      throw new BadRequestException(`Cannot review loan with status: ${loan.status}`);
    }

    const updated = await this.prisma.loanApplication.update({
      where: { id: loanId },
      data: {
        status: dto.status,
        reviewedBy: adminId,
        reviewNotes: dto.reviewNotes || null,
      },
    });

    // Notify user
    await this.prisma.notification.create({
      data: {
        userId: loan.userId,
        title: dto.status === LoanStatus.APPROVED ? 'Loan Approved!' : 'Loan Application Declined',
        message: dto.status === LoanStatus.APPROVED
          ? `Your application for ${loan.product.name} (#${loan.id.substring(0, 8)}) has been APPROVED and is queued for fund disbursement.`
          : `Your application for ${loan.product.name} (#${loan.id.substring(0, 8)}) was not approved. Note: ${dto.reviewNotes || 'Does not meet credit requirements.'}`,
        type: 'LOAN',
      },
    });

    return {
      message: `Loan application status updated to ${dto.status}`,
      application: updated,
    };
  }

  /**
   * Admin: Disburse approved loan directly into customer bank account
   */
  async adminDisburseLoan(adminId: string, loanId: string) {
    const loan = await this.prisma.loanApplication.findUnique({
      where: { id: loanId },
      include: {
        user: { include: { profile: true } },
        product: true,
        account: true,
      },
    });

    if (!loan) {
      throw new NotFoundException('Loan application not found');
    }

    if (loan.status !== LoanStatus.APPROVED) {
      throw new BadRequestException('Only APPROVED loans can be disbursed');
    }

    const principal = new Decimal(loan.principalAmount.toString());
    const feePct = new Decimal(loan.product.processingFeePercentage.toString()).dividedBy(100);
    const processingFee = principal.times(feePct).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    const netDisbursement = principal.minus(processingFee);

    const bankAccount = loan.account;
    const txRef = CryptoUtil.generateTransactionReference('LOAN-DSB');

    const result = await this.prisma.$transaction(async (tx) => {
      // Credit net disbursement to bank account
      await tx.bankAccount.update({
        where: { id: bankAccount.id },
        data: {
          currentBalance: { increment: netDisbursement.toFixed(4) },
          availableBalance: { increment: netDisbursement.toFixed(4) },
          ledgerBalance: { increment: netDisbursement.toFixed(4) },
        },
      });

      // Update loan status to ACTIVE / DISBURSED
      const updatedLoan = await tx.loanApplication.update({
        where: { id: loan.id },
        data: {
          status: LoanStatus.ACTIVE,
          disbursedAt: new Date(),
        },
      });

      // Create transaction record
      const businessTx = await tx.transaction.create({
        data: {
          reference: txRef,
          userId: loan.userId,
          sourceAccountId: bankAccount.id,
          type: TransactionType.LOAN_DISBURSEMENT,
          amount: principal.toFixed(4),
          fee: processingFee.toFixed(4),
          netAmount: netDisbursement.toFixed(4),
          currencyCode: bankAccount.currencyCode,
          status: TransactionStatus.SUCCESS,
          description: `Disbursement for ${loan.product.name} (#${loan.id.substring(0, 8)})`,
          metadata: {
            loanId: loan.id,
            principal: principal.toFixed(4),
            processingFee: processingFee.toFixed(4),
            netDisbursement: netDisbursement.toFixed(4),
          },
        },
      });

      // Double-entry General Ledger:
      // Debit: 1030 (Loans & Advances Asset) [principal]
      // Credit: 2010-<acc> (Customer Current Liability) [netDisbursement]
      // Credit: 4010 (Fee Income / Loan Processing) [processingFee]
      const currentAccLedgerCode = `2010-${bankAccount.accountNumber}`;
      const journalEntries: any[] = [
        {
          accountCode: '1030', // Loans & Advances Asset
          entryType: LedgerEntryType.DEBIT,
          amount: principal.toFixed(4),
          currencyCode: bankAccount.currencyCode,
        },
        {
          accountCode: currentAccLedgerCode,
          entryType: LedgerEntryType.CREDIT,
          amount: netDisbursement.toFixed(4),
          currencyCode: bankAccount.currencyCode,
        },
      ];

      if (processingFee.greaterThan(0)) {
        journalEntries.push({
          accountCode: '4010', // Fee Income
          entryType: LedgerEntryType.CREDIT,
          amount: processingFee.toFixed(4),
          currencyCode: bankAccount.currencyCode,
        });
      }

      await this.ledgerService.postJournalEntry(
        tx,
        {
          reference: `JRN-${txRef}`,
          transactionId: businessTx.id,
          description: `Disbursement of Loan #${loan.id.substring(0, 8)} to ${bankAccount.accountNumber}`,
          entries: journalEntries,
        },
        adminId,
      );

      // Notification
      await tx.notification.create({
        data: {
          userId: loan.userId,
          title: 'Loan Disbursed!',
          message: `Your loan of ${bankAccount.currencyCode} ${principal.toFixed(2)} has been disbursed. ${bankAccount.currencyCode} ${netDisbursement.toFixed(2)} (net of fees) has been credited to your account #${bankAccount.accountNumber}.`,
          type: 'LOAN',
        },
      });

      return { updatedLoan, businessTx };
    });

    // Send Credit Alert Email
    const updatedBank = await this.prisma.bankAccount.findUnique({ where: { id: bankAccount.id } });
    const userName = loan.user.profile
      ? `${loan.user.profile.firstName} ${loan.user.profile.lastName}`
      : loan.user.username;

    await this.emailService.sendCreditAlert({
      to: loan.user.email,
      recipientName: userName,
      amount: netDisbursement.toFixed(4),
      currency: bankAccount.currencyCode,
      senderName: `Silverhawk Credit Facility (${loan.product.name})`,
      accountNumber: bankAccount.accountNumber,
      reference: txRef,
      description: `Loan Disbursement (#${loan.id.substring(0, 8)})`,
      availableBalance: updatedBank!.availableBalance.toString(),
    });

    return {
      message: 'Loan disbursed successfully and funds credited to customer bank account',
      loan: result.updatedLoan,
      transaction: result.businessTx,
    };
  }

  /**
   * Admin: Create new loan product
   */
  async createLoanProduct(dto: CreateLoanProductDto) {
    return this.prisma.loanProduct.create({
      data: {
        name: dto.name,
        description: dto.description || null,
        minAmount: new Decimal(dto.minAmount).toFixed(4),
        maxAmount: new Decimal(dto.maxAmount).toFixed(4),
        interestRate: new Decimal(dto.interestRate).toFixed(2),
        interestType: dto.interestType || LoanInterestType.REDUCING_BALANCE,
        minTenureMonths: dto.minTenureMonths,
        maxTenureMonths: dto.maxTenureMonths,
        processingFeePercentage: dto.processingFeePercentage
          ? new Decimal(dto.processingFeePercentage).toFixed(2)
          : '1.00',
        latePenaltyPercentage: dto.latePenaltyPercentage
          ? new Decimal(dto.latePenaltyPercentage).toFixed(2)
          : '2.00',
        isActive: true,
      },
    });
  }
}
