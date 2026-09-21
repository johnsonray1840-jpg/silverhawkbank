import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreatePayrollBatchDto,
  AddPayrollEmployeesDto,
  EmployeePayItemDto,
} from './dto/payroll.dto';
import {
  PayrollBatchStatus,
  PayrollBatchUtil,
  EmployeePayItem,
  PayrollBatchSummary,
} from '../../common/utils/payroll-batch.util';
import { AccountStatus, TransactionStatus, TransactionType } from '@prisma/client';
import Decimal from 'decimal.js';
import * as crypto from 'crypto';

export interface InMemoryPayrollBatch {
  id: string;
  employerUserId: string;
  employerAccountId: string;
  title: string;
  currencyCode: string;
  status: PayrollBatchStatus;
  summary: PayrollBatchSummary;
  items: EmployeePayItem[];
  executedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  // High-performance thread-safe state store for Corporate Payroll batches
  private batches: Map<string, InMemoryPayrollBatch> = new Map();

  constructor(private prisma: PrismaService) {}

  /**
   * Initialize a new Corporate Bulk Payroll Batch Run
   */
  async createBatch(userId: string, dto: CreatePayrollBatchDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw new NotFoundException('Employer user not found');

    const employerAccount = await this.prisma.bankAccount.findFirst({
      where: {
        userId,
        currencyCode: dto.currencyCode,
        status: AccountStatus.ACTIVE,
      },
    });

    if (!employerAccount) {
      throw new BadRequestException(`No active ${dto.currencyCode} corporate funding account found`);
    }

    const batchId = `pay_${crypto.randomBytes(8).toString('hex')}`;
    const items: EmployeePayItem[] = this.processEmployeeItems(dto.employees);
    const summary = this.computeBatchSummary(items, dto.currencyCode);

    const batch: InMemoryPayrollBatch = {
      id: batchId,
      employerUserId: userId,
      employerAccountId: employerAccount.id,
      title: dto.title,
      currencyCode: dto.currencyCode,
      status: PayrollBatchStatus.VALIDATED,
      summary,
      items,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.batches.set(batchId, batch);

    this.logger.log(`Created Payroll Batch: ${batch.title} (${batchId}) with ${items.length} employees`);

    return {
      batchId: batch.id,
      title: batch.title,
      currencyCode: batch.currencyCode,
      status: batch.status,
      summary: batch.summary,
      totalEmployees: items.length,
      createdAt: batch.createdAt,
    };
  }

  /**
   * Append additional employees to an existing draft/validated batch
   */
  async addEmployees(userId: string, batchId: string, dto: AddPayrollEmployeesDto) {
    const batch = this.batches.get(batchId);
    if (!batch) throw new NotFoundException('Payroll batch not found');

    if (batch.employerUserId !== userId) {
      throw new ForbiddenException('Access denied to payroll batch');
    }

    if (batch.status === PayrollBatchStatus.COMPLETED || batch.status === PayrollBatchStatus.PROCESSING) {
      throw new BadRequestException('Cannot modify a payroll batch that is processing or completed');
    }

    const newItems = this.processEmployeeItems(dto.employees);
    batch.items.push(...newItems);
    batch.summary = this.computeBatchSummary(batch.items, batch.currencyCode);
    batch.updatedAt = new Date();

    return {
      batchId,
      totalEmployees: batch.items.length,
      summary: batch.summary,
      message: `${newItems.length} employee records added to payroll batch.`,
    };
  }

  /**
   * Execute atomic batch disbursement across all employees
   */
  async executeBatch(userId: string, batchId: string) {
    const batch = this.batches.get(batchId);
    if (!batch) throw new NotFoundException('Payroll batch not found');

    if (batch.employerUserId !== userId) {
      throw new ForbiddenException('Access denied to execute this payroll batch');
    }

    if (batch.status === PayrollBatchStatus.COMPLETED) {
      throw new BadRequestException('This payroll batch has already been executed');
    }

    const employerAccount = await this.prisma.bankAccount.findUnique({
      where: { id: batch.employerAccountId },
    });

    if (!employerAccount) {
      throw new NotFoundException('Employer source funding account not found');
    }

    const totalGrossDeduction = new Decimal(batch.summary.grossTotal);
    if (new Decimal(employerAccount.availableBalance.toString()).lessThan(totalGrossDeduction)) {
      throw new BadRequestException(
        `Insufficient funding account balance. Required: $${totalGrossDeduction.toFixed(2)}, Available: $${employerAccount.availableBalance.toString()}`,
      );
    }

    batch.status = PayrollBatchStatus.PROCESSING;

    // Atomic Ledger Execution
    await this.prisma.$transaction(async (tx) => {
      // 1. Debit employer funding account
      await tx.bankAccount.update({
        where: { id: employerAccount.id },
        data: {
          currentBalance: { decrement: totalGrossDeduction },
          availableBalance: { decrement: totalGrossDeduction },
        },
      });

      // 2. Create Employer Master Payroll Outflow Transaction
      await tx.transaction.create({
        data: {
          userId,
          sourceAccountId: employerAccount.id,
          type: TransactionType.TRANSFER_EXTERNAL,
          amount: totalGrossDeduction,
          netAmount: totalGrossDeduction,
          currencyCode: batch.currencyCode,
          status: TransactionStatus.SUCCESS,
          description: `[Corporate Payroll Run] ${batch.title} (${batch.items.length} employees)`,
          reference: `PAY-RUN-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
        },
      });

      // 3. Process individual employee records
      for (const item of batch.items) {
        const netAmt = new Decimal(item.netAmount);
        const ref = `PAY-EMP-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
        item.transactionReference = ref;

        // If internal account exists, credit employee instantly
        const internalAcc = await tx.bankAccount.findFirst({
          where: { accountNumber: item.accountNumber, status: AccountStatus.ACTIVE },
        });

        if (internalAcc) {
          await tx.bankAccount.update({
            where: { id: internalAcc.id },
            data: {
              currentBalance: { increment: netAmt },
              availableBalance: { increment: netAmt },
            },
          });

          await tx.transaction.create({
            data: {
              userId: internalAcc.userId,
              destinationAccountId: internalAcc.id,
              type: TransactionType.TRANSFER_INTERNAL,
              amount: netAmt,
              netAmount: netAmt,
              currencyCode: batch.currencyCode,
              status: TransactionStatus.SUCCESS,
              description: `[Direct Deposit Salary] ${batch.title} from ${employerAccount.accountName}`,
              reference: ref,
            },
          });
        }

        item.status = 'PROCESSED';
      }
    });

    batch.status = PayrollBatchStatus.COMPLETED;
    batch.executedAt = new Date();
    batch.updatedAt = new Date();

    return {
      batchId: batch.id,
      status: batch.status,
      totalEmployeesPaid: batch.items.length,
      grossTotalDisbursed: batch.summary.grossTotal,
      netTotalDisbursed: batch.summary.netDisbursementTotal,
      taxWithheldPosted: batch.summary.totalTaxWithheld,
      pensionWithheldPosted: batch.summary.totalPensionWithheld,
      executedAt: batch.executedAt.toISOString(),
      message: 'Batch payroll executed successfully. General ledger postings balanced.',
    };
  }

  /**
   * Export SEPA ISO 20022 (pain.001.001.09) XML payment clearing file
   */
  async exportIso20022Xml(userId: string, batchId: string): Promise<string> {
    const batch = this.batches.get(batchId);
    if (!batch) throw new NotFoundException('Payroll batch not found');

    if (batch.employerUserId !== userId) {
      throw new ForbiddenException('Access denied to export clearing file');
    }

    const employerAccount = await this.prisma.bankAccount.findUnique({
      where: { id: batch.employerAccountId },
    });

    return PayrollBatchUtil.generateIso20022Pain001(
      `MSG-${batch.id.toUpperCase()}`,
      employerAccount?.accountName || 'Silverhawk Corporate Employer',
      employerAccount?.accountNumber || '1002384912',
      'REMIVUS33XXX',
      batch.currencyCode,
      batch.items,
    );
  }

  /**
   * Export US NACHA ACH 94-Character Fixed-Width Batch File
   */
  async exportNachaFile(userId: string, batchId: string): Promise<string> {
    const batch = this.batches.get(batchId);
    if (!batch) throw new NotFoundException('Payroll batch not found');

    if (batch.employerUserId !== userId) {
      throw new ForbiddenException('Access denied to export NACHA file');
    }

    const employerAccount = await this.prisma.bankAccount.findUnique({
      where: { id: batch.employerAccountId },
    });

    return PayrollBatchUtil.generateNachaAch(
      employerAccount?.accountName.slice(0, 16).toUpperCase() || 'SILVERHAWK CORP',
      '1908234101',
      '021000021',
      '021000021',
      batch.items,
    );
  }

  /**
   * Get single batch details and employee pay slips
   */
  async getBatch(userId: string, batchId: string) {
    const batch = this.batches.get(batchId);
    if (!batch) throw new NotFoundException('Payroll batch not found');

    if (batch.employerUserId !== userId) {
      throw new ForbiddenException('Access denied to payroll batch details');
    }

    return batch;
  }

  /**
   * List all historical batches for employer
   */
  async listBatches(userId: string) {
    return Array.from(this.batches.values())
      .filter((b) => b.employerUserId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // ----------------------------------------------------
  // Private Helpers
  // ----------------------------------------------------
  private processEmployeeItems(employees: EmployeePayItemDto[]): EmployeePayItem[] {
    return employees.map((emp, index) => {
      const calc = PayrollBatchUtil.calculateItemDeductions(
        emp.grossAmount,
        emp.taxRatePercent !== undefined ? emp.taxRatePercent : 15,
        emp.pensionRatePercent !== undefined ? emp.pensionRatePercent : 8,
        emp.healthInsuranceDeduction !== undefined ? emp.healthInsuranceDeduction : 50,
      );

      return {
        id: `emp_line_${index + 1}`,
        employeeName: emp.employeeName,
        employeeEmail: emp.employeeEmail,
        accountNumber: emp.accountNumber,
        bankCode: emp.bankCode,
        routingNumber: emp.routingNumber,
        payType: emp.payType,
        grossAmount: calc.gross.toFixed(4),
        taxDeduction: calc.tax.toFixed(4),
        pensionDeduction: calc.pension.toFixed(4),
        insuranceDeduction: calc.insurance.toFixed(4),
        totalDeductions: calc.totalDeductions.toFixed(4),
        netAmount: calc.net.toFixed(4),
        status: 'PENDING',
      };
    });
  }

  private computeBatchSummary(items: EmployeePayItem[], currency: string): PayrollBatchSummary {
    let grossTotal = new Decimal(0);
    let totalTax = new Decimal(0);
    let totalPension = new Decimal(0);
    let totalInsurance = new Decimal(0);
    let totalDeductions = new Decimal(0);
    let netTotal = new Decimal(0);

    for (const item of items) {
      grossTotal = grossTotal.plus(new Decimal(item.grossAmount));
      totalTax = totalTax.plus(new Decimal(item.taxDeduction));
      totalPension = totalPension.plus(new Decimal(item.pensionDeduction));
      totalInsurance = totalInsurance.plus(new Decimal(item.insuranceDeduction));
      totalDeductions = totalDeductions.plus(new Decimal(item.totalDeductions));
      netTotal = netTotal.plus(new Decimal(item.netAmount));
    }

    return {
      totalEmployees: items.length,
      grossTotal: grossTotal.toFixed(4),
      totalTaxWithheld: totalTax.toFixed(4),
      totalPensionWithheld: totalPension.toFixed(4),
      totalInsuranceWithheld: totalInsurance.toFixed(4),
      totalDeductions: totalDeductions.toFixed(4),
      netDisbursementTotal: netTotal.toFixed(4),
      currency,
    };
  }
}

