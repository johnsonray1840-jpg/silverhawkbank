import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  AdjustBalanceDto,
  AmlScreenDto,
  ApplyLoanPenaltyDto,
  ApproveDepositDto,
  ApproveWithdrawalDto,
  AssignUserRolesDto,
  BatchUpdateSettingsDto,
  CompleteWithdrawalDto,
  CreateGrantProgramDto,
  CreateLoanProductDto,
  CreateRoleDto,
  CreateSarDto,
  CreateStaffUserDto,
  CreateUserAdminDto,
  DisburseLoanDto,
  IssueCardAdminDto,
  ManualTransactionDto,
  ProcessWithdrawalDto,
  RejectDepositDto,
  RejectWithdrawalDto,
  RejectCardDto,
  ReplyTicketDto,
  ResetUserPasswordDto,
  ResetUserPinDto,
  ReverseWithdrawalDto,
  ReviewKycDto,
  ReviewLoanDto,
  UpdateAccountStatusDto,
  UpdateCardStatusAdminDto,
  UpdateGrantStatusDto,
  UpdateLoanProductDto,
  UpdateLoanProductStatusDto,
  UpdateMasterSettingsDto,
  UpdateRolePermissionsDto,
  UpdateSystemSettingDto,
  UpdateTransactionAdminDto,
  UpdateUserAdminDto,
} from './dto/admin.dto';
import Decimal from 'decimal.js';
import {
  AccountStatus,
  AccountType,
  CardBrand,
  CardStatus,
  CardType,
  DepositMethod,
  GrantStatus,
  KycStatus,
  KycTier,
  LedgerAccountType,
  LedgerEntryType,
  LoanInterestType,
  LoanScheduleStatus,
  LoanStatus,
  SavingsStatus,
  SupportTicketStatus,
  TransactionStatus,
  TransactionType,
  UserStatus,
  WithdrawalStatus,
} from '@prisma/client';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { StatementGeneratorUtil } from '../../common/utils/statement-generator.util';
import { EventsGateway } from '../events/events.gateway';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
    private readonly eventsGateway?: EventsGateway,
  ) {}

  // ---------------------------------------------------------------------------
  // 1. EXECUTIVE KPI ANALYTICS DASHBOARD
  // ---------------------------------------------------------------------------
  async getDashboardAnalytics() {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [
      totalUsers,
      activeUsers,
      suspendedUsers,
      totalBankAccounts,
      activeBankAccounts,
      frozenBankAccounts,
      kycPendingCount,
      kycApprovedCount,
      kycRejectedCount,
      // Deposits
      allDepositTxs,
      pendingDepositTxs,
      // Withdrawals
      allWithdrawals,
      pendingWithdrawals,
      // Transfers
      allTransferTxs,
      // Loans
      pendingLoanApps,
      activeLoanApps,
      // Savings & FDR
      activeSavings,
      activeFixedDeposits,
      // Support & Grants
      pendingGrantsCount,
      openSupportTicketsCount,
      // Bank accounts & Recent Transactions
      bankAccounts,
      recentTransactions,
      historicalTxs,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
      this.prisma.user.count({ where: { status: UserStatus.SUSPENDED } }),
      this.prisma.bankAccount.count(),
      this.prisma.bankAccount.count({ where: { status: AccountStatus.ACTIVE, isFrozen: false } }),
      this.prisma.bankAccount.count({ where: { OR: [{ status: AccountStatus.FROZEN }, { isFrozen: true }] } }),
      this.prisma.kycProfile.count({ where: { status: { in: [KycStatus.PENDING, KycStatus.UNDER_REVIEW] } } }),
      this.prisma.kycProfile.count({ where: { status: KycStatus.APPROVED } }),
      this.prisma.kycProfile.count({ where: { status: KycStatus.REJECTED } }),
      // Deposits
      this.prisma.transaction.findMany({
        where: { type: TransactionType.DEPOSIT, status: TransactionStatus.SUCCESS },
        select: { amount: true },
      }),
      this.prisma.transaction.findMany({
        where: { type: TransactionType.DEPOSIT, status: TransactionStatus.PENDING },
        select: { amount: true },
      }),
      // Withdrawals
      this.prisma.transaction.findMany({
        where: { type: TransactionType.WITHDRAWAL, status: TransactionStatus.SUCCESS },
        select: { amount: true },
      }),
      this.prisma.withdrawal.findMany({
        where: { status: WithdrawalStatus.REQUESTED },
        include: { transaction: { select: { amount: true } } },
      }),
      // Transfers
      this.prisma.transaction.findMany({
        where: {
          type: { in: [TransactionType.TRANSFER_INTERNAL, TransactionType.TRANSFER_EXTERNAL] },
          status: TransactionStatus.SUCCESS,
        },
        select: { amount: true },
      }),
      // Loans
      this.prisma.loanApplication.findMany({
        where: { status: { in: [LoanStatus.SUBMITTED, LoanStatus.UNDER_REVIEW, LoanStatus.APPROVED] } },
        select: { principalAmount: true },
      }),
      this.prisma.loanApplication.findMany({
        where: { status: LoanStatus.ACTIVE },
        select: { principalAmount: true, outstandingBalance: true },
      }),
      // Savings & FDR
      this.prisma.savingsAccount.findMany({
        where: { status: SavingsStatus.ACTIVE },
        select: { currentAmount: true },
      }),
      this.prisma.fixedDeposit.findMany({
        where: { status: SavingsStatus.ACTIVE },
        select: { principalAmount: true, projectedReturn: true },
      }),
      // Support & Grants
      this.prisma.grantApplication.count({ where: { status: GrantStatus.PENDING } }),
      this.prisma.supportTicket.count({ where: { status: SupportTicketStatus.OPEN } }),
      // Accounts & Recent Transactions
      this.prisma.bankAccount.findMany({
        select: { currencyCode: true, currentBalance: true, availableBalance: true },
      }),
      this.prisma.transaction.findMany({
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, username: true, profile: true },
          },
          sourceAccount: { select: { accountNumber: true, accountName: true, type: true } },
          destinationAccount: { select: { accountNumber: true, accountName: true, type: true } },
        },
      }),
      // 6-Month historical transactions for chart analytics
      this.prisma.transaction.findMany({
        where: {
          status: TransactionStatus.SUCCESS,
          createdAt: { gte: sixMonthsAgo },
        },
        select: {
          type: true,
          amount: true,
          fee: true,
          createdAt: true,
        },
      }),
    ]);

    // Financial volume aggregations
    const completedDepositsVolume = allDepositTxs.reduce(
      (acc, d) => acc.plus(new Decimal(d.amount.toString())),
      new Decimal('0.0000'),
    );
    const pendingDepositsVolume = pendingDepositTxs.reduce(
      (acc, d) => acc.plus(new Decimal(d.amount.toString())),
      new Decimal('0.0000'),
    );

    const completedWithdrawalsVolume = allWithdrawals.reduce(
      (acc, w) => acc.plus(new Decimal(w.amount.toString())),
      new Decimal('0.0000'),
    );
    const pendingWithdrawalsVolume = pendingWithdrawals.reduce(
      (acc, w) => acc.plus(new Decimal(w.transaction?.amount?.toString() || '0')),
      new Decimal('0.0000'),
    );

    const completedTransfersVolume = allTransferTxs.reduce(
      (acc, t) => acc.plus(new Decimal(t.amount.toString())),
      new Decimal('0.0000'),
    );

    const pendingLoansVolume = pendingLoanApps.reduce(
      (acc, l) => acc.plus(new Decimal(l.principalAmount.toString())),
      new Decimal('0.0000'),
    );
    const activeLoansVolume = activeLoanApps.reduce(
      (acc, l) => acc.plus(new Decimal(l.outstandingBalance?.toString() || l.principalAmount.toString())),
      new Decimal('0.0000'),
    );

    const regularSavingsVolume = activeSavings.reduce(
      (acc, s) => acc.plus(new Decimal(s.currentAmount.toString())),
      new Decimal('0.0000'),
    );
    const fixedDepositVolume = activeFixedDeposits.reduce(
      (acc, f) => acc.plus(new Decimal(f.principalAmount.toString())),
      new Decimal('0.0000'),
    );
    const totalSavingsPortfolio = regularSavingsVolume.plus(fixedDepositVolume);

    // Balances by Currency
    const balancesByCurrency: Record<string, string> = {};
    for (const acc of bankAccounts) {
      const cur = acc.currencyCode;
      const prev = balancesByCurrency[cur] ? new Decimal(balancesByCurrency[cur]) : new Decimal('0.0000');
      balancesByCurrency[cur] = prev.plus(new Decimal(acc.currentBalance.toString())).toFixed(2);
    }

    // 6-Month Financial Charts
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const chartLabels: string[] = [];
    const chartInflows: number[] = [];
    const chartOutflows: number[] = [];
    const chartDeposits: number[] = [];
    const chartWithdrawals: number[] = [];

    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

      chartLabels.push(`${monthNames[d.getMonth()]} ${d.getFullYear().toString().slice(-2)}`);

      let inflow = new Decimal(0);
      let outflow = new Decimal(0);
      let dep = new Decimal(0);
      let wth = new Decimal(0);

      for (const tx of historicalTxs) {
        if (tx.createdAt >= start && tx.createdAt <= end) {
          const amt = new Decimal(tx.amount.toString());
          if (tx.type === TransactionType.DEPOSIT) {
            inflow = inflow.plus(amt);
            dep = dep.plus(amt);
          } else if (tx.type === TransactionType.LOAN_DISBURSEMENT) {
            inflow = inflow.plus(amt);
          } else if (tx.type === TransactionType.WITHDRAWAL) {
            outflow = outflow.plus(amt);
            wth = wth.plus(amt);
          } else if (
            tx.type === TransactionType.TRANSFER_INTERNAL ||
            tx.type === TransactionType.TRANSFER_EXTERNAL ||
            tx.type === TransactionType.CARD_PURCHASE
          ) {
            outflow = outflow.plus(amt).plus(new Decimal(tx.fee?.toString() || '0'));
          }
        }
      }

      chartInflows.push(parseFloat(inflow.toFixed(2)));
      chartOutflows.push(parseFloat(outflow.toFixed(2)));
      chartDeposits.push(parseFloat(dep.toFixed(2)));
      chartWithdrawals.push(parseFloat(wth.toFixed(2)));
    }

    return {
      kpis: {
        // Customer Statistics
        totalCustomers: totalUsers,
        totalUsers,
        activeCustomers: activeUsers,
        activeUsers,
        suspendedUsers,

        // Bank Accounts Statistics
        totalAccounts: totalBankAccounts,
        totalBankAccounts,
        activeBankAccounts,
        frozenBankAccounts,

        // Deposits Statistics
        totalDeposits: completedDepositsVolume.toFixed(2),
        totalDepositsVolume: completedDepositsVolume.toFixed(2),
        totalDepositsCount: allDepositTxs.length,
        pendingDeposits: pendingDepositsVolume.toFixed(2),
        pendingDepositsVolume: pendingDepositsVolume.toFixed(2),
        pendingDepositsCount: pendingDepositTxs.length,

        // Withdrawals Statistics
        totalWithdrawals: completedWithdrawalsVolume.toFixed(2),
        totalWithdrawalsVolume: completedWithdrawalsVolume.toFixed(2),
        totalWithdrawalsCount: allWithdrawals.length,
        pendingWithdrawals: pendingWithdrawalsVolume.toFixed(2),
        pendingWithdrawalsVolume: pendingWithdrawalsVolume.toFixed(2),
        pendingWithdrawalsCount: pendingWithdrawals.length,

        // Transfers Statistics
        totalTransfers: completedTransfersVolume.toFixed(2),
        totalTransfersVolume: completedTransfersVolume.toFixed(2),
        totalTransfersCount: allTransferTxs.length,

        // KYC Statistics
        pendingKyc: kycPendingCount,
        kycPendingCount,
        approvedKyc: kycApprovedCount,
        rejectedKyc: kycRejectedCount,

        // Loans Statistics
        pendingLoans: pendingLoansVolume.toFixed(2),
        pendingLoansCount: pendingLoanApps.length,
        pendingLoansVolume: pendingLoansVolume.toFixed(2),
        activeLoans: activeLoansVolume.toFixed(2),
        activeLoansCount: activeLoanApps.length,
        activeLoansVolume: activeLoansVolume.toFixed(2),
        totalLoanPortfolio: activeLoansVolume.toFixed(2),

        // Savings & Fixed Deposits Statistics
        activeSavingsCount: activeSavings.length,
        totalSavingsVolume: regularSavingsVolume.toFixed(2),
        fixedDepositsCount: activeFixedDeposits.length,
        fixedDepositsVolume: fixedDepositVolume.toFixed(2),
        combinedSavingsPortfolio: totalSavingsPortfolio.toFixed(2),

        // Support & Grants
        pendingGrantsCount,
        openSupportTicketsCount,
      },
      balancesByCurrency,
      recentTransactions,
      charts: {
        monthlyCashFlow: {
          labels: chartLabels,
          inflows: chartInflows,
          outflows: chartOutflows,
        },
        monthlyDepositsVsWithdrawals: {
          labels: chartLabels,
          deposits: chartDeposits,
          withdrawals: chartWithdrawals,
        },
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 2. AUDIT LOGS
  // ---------------------------------------------------------------------------
  async getAuditLogs(query?: {
    actorId?: string;
    action?: string;
    resource?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query?.limit) || 50, 1), 100);
    const offset = query?.offset !== undefined ? Number(query.offset) : (page - 1) * limit;

    const where: any = {};
    if (query?.actorId) where.actorId = query.actorId;
    if (query?.action) where.action = { contains: query.action };
    if (query?.resource) where.resource = { contains: query.resource };
    if (query?.startDate || query?.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }
    if (query?.search) {
      const s = query.search.trim();
      where.OR = [
        { action: { contains: s } },
        { resource: { contains: s } },
        { ipAddress: { contains: s } },
        { userAgent: { contains: s } },
        { actor: { email: { contains: s } } },
        { actor: { username: { contains: s } } },
      ];
    }

    const sortField = query?.sortBy || 'createdAt';
    const sortDir = query?.sortOrder === 'asc' ? 'asc' : 'desc';

    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { [sortField]: sortDir },
        include: {
          actor: {
            select: { id: true, email: true, username: true },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      offset,
      totalPages: Math.ceil(total / limit),
      data: logs,
      logs,
    };
  }

  // ---------------------------------------------------------------------------
  // 3. USER MANAGEMENT (FULL CRUD & 360° DOSSIER)
  // ---------------------------------------------------------------------------
  async getUsers(query?: {
    search?: string;
    role?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query?.status) {
      where.status = query.status as UserStatus;
    }
    if (query?.role) {
      where.roles = {
        some: {
          role: { name: query.role },
        },
      };
    }
    if (query?.startDate || query?.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }
    if (query?.search) {
      const s = query.search.trim();
      where.OR = [
        { email: { contains: s } },
        { username: { contains: s } },
        { profile: { firstName: { contains: s } } },
        { profile: { lastName: { contains: s } } },
        { bankAccounts: { some: { accountNumber: { contains: s } } } },
      ];
    }

    const sortField = query?.sortBy || 'createdAt';
    const sortDir = query?.sortOrder === 'asc' ? 'asc' : 'desc';

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        take: limit,
        skip,
        orderBy: { [sortField]: sortDir },
        include: {
          profile: true,
          kycProfile: true,
          roles: {
            include: { role: true },
          },
          bankAccounts: {
            select: {
              id: true,
              accountNumber: true,
              accountName: true,
              type: true,
              currencyCode: true,
              status: true,
              currentBalance: true,
              availableBalance: true,
            },
          },
          _count: {
            select: {
              transactions: true,
              cards: true,
              loanApplications: true,
              grantApplications: true,
            },
          },
        },
      }),
    ]);

    const formattedUsers = users.map(u => ({
      ...u,
      roleNames: u.roles.map(r => r.role.name),
      primaryAccount: u.bankAccounts[0] || null,
      totalBalance: u.bankAccounts.reduce((acc, a) => acc.plus(new Decimal(a.currentBalance.toString())), new Decimal(0)).toFixed(2),
    }));

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: formattedUsers,
      users: formattedUsers,
    };
  }

  async getUserDetails(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        profile: true,
        kycProfile: {
          include: { documents: true },
        },
        roles: {
          include: {
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        },
        bankAccounts: {
          include: {
            cards: true,
            savings: true,
          },
        },
        cards: true,
        loanApplications: {
          orderBy: { createdAt: 'desc' },
        },
        grantApplications: {
          orderBy: { createdAt: 'desc' },
        },
        transactions: {
          take: 25,
          orderBy: { createdAt: 'desc' },
        },
        sessions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        auditLogs: {
          take: 15,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
    }

    return user;
  }

  async getUserAccounts(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User #${userId} not found`);

    return this.prisma.bankAccount.findMany({
      where: { userId },
      include: {
        currency: true,
        cards: true,
        savings: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUserTransactions(userId: string, query?: { page?: number; limit?: number; type?: string; status?: string; search?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User #${userId} not found`);

    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (query?.status) where.status = query.status as TransactionStatus;
    if (query?.type) where.type = query.type as TransactionType;
    if (query?.search) {
      where.OR = [
        { reference: { contains: query.search } },
        { description: { contains: query.search } },
      ];
    }

    const [total, transactions] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        take: limit,
        skip,
        orderBy: { createdAt: 'desc' },
        include: {
          sourceAccount: { select: { accountNumber: true, accountName: true, type: true } },
          destinationAccount: { select: { accountNumber: true, accountName: true, type: true } },
        },
      }),
    ]);

    return { total, page, limit, totalPages: Math.ceil(total / limit), transactions };
  }

  async getUserKyc(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User #${userId} not found`);

    return this.prisma.kycProfile.findUnique({
      where: { userId },
      include: { documents: true },
    });
  }

  async getUserLoans(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User #${userId} not found`);

    const [applications, activeLoans] = await Promise.all([
      this.prisma.loanApplication.findMany({
        where: { userId },
        include: { product: true, schedules: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.loan.findMany({
        where: { userId },
        include: { product: true, repayments: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { applications, activeLoans };
  }

  async getUserDeposits(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User #${userId} not found`);

    return this.prisma.deposit.findMany({
      where: { account: { userId } },
      include: {
        account: { select: { accountNumber: true, accountName: true, currencyCode: true } },
        transaction: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUserWithdrawals(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User #${userId} not found`);

    return this.prisma.withdrawal.findMany({
      where: { account: { userId } },
      include: {
        account: { select: { accountNumber: true, accountName: true, currencyCode: true } },
        transaction: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async suspendUser(userId: string, reason?: string, adminId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User #${userId} not found`);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.SUSPENDED },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId || null,
        actorRole: 'ADMIN',
        action: 'USER_SUSPENDED_BY_ADMIN',
        resource: 'User',
        resourceId: userId,
        afterState: { status: UserStatus.SUSPENDED, reason: reason || 'Administrative suspension' },
      },
    });

    return { message: 'Customer account suspended successfully', user: updated };
  }

  async activateUser(userId: string, adminId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User #${userId} not found`);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.ACTIVE },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId || null,
        actorRole: 'ADMIN',
        action: 'USER_ACTIVATED_BY_ADMIN',
        resource: 'User',
        resourceId: userId,
        afterState: { status: UserStatus.ACTIVE },
      },
    });

    return { message: 'Customer account activated successfully', user: updated };
  }

  async freezeUser(userId: string, reason?: string, adminId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User #${userId} not found`);

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { status: UserStatus.FROZEN },
      });

      await tx.bankAccount.updateMany({
        where: { userId },
        data: { status: AccountStatus.FROZEN, isFrozen: true },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId || null,
          actorRole: 'ADMIN',
          action: 'USER_AND_ACCOUNTS_FROZEN_BY_ADMIN',
          resource: 'User',
          resourceId: userId,
          afterState: { status: UserStatus.FROZEN, reason: reason || 'Compliance / Risk hold' },
        },
      });

      return updatedUser;
    });

    return { message: 'User and all associated bank accounts frozen successfully', user: result };
  }

  async disableUser(userId: string, reason?: string, adminId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User #${userId} not found`);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.CLOSED },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId || null,
        actorRole: 'ADMIN',
        action: 'USER_DISABLED_BY_ADMIN',
        resource: 'User',
        resourceId: userId,
        afterState: { status: UserStatus.CLOSED, reason: reason || 'Account deactivated / disabled' },
      },
    });

    return { message: 'Customer account disabled successfully', user: updated };
  }

  async createUser(dto: CreateUserAdminDto, adminId: string) {
    const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingEmail) {
      throw new ConflictException('An account with this email already exists');
    }

    const existingUsername = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (existingUsername) {
      throw new ConflictException('This username is already taken');
    }

    const passwordHash = await CryptoUtil.hash(dto.password);
    const pinHash = await CryptoUtil.hash(dto.pin || '1234');
    const currencyCode = (dto.currency || 'USD').toUpperCase();
    const accountType = (dto.accountType as AccountType) || AccountType.CHECKING;
    const initialBal = new Decimal(dto.initialBalance?.toString() || '0.0000');
    const accountNumber = dto.customAccountNumber || CryptoUtil.generateAccountNumber();

    const roleName = dto.role || 'CUSTOMER';
    const roleRecord = await this.prisma.role.findUnique({ where: { name: roleName } });
    if (!roleRecord) {
      throw new BadRequestException(`Role ${roleName} does not exist`);
    }

    const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email.toLowerCase(),
          username: dto.username.toLowerCase(),
          phone: dto.phone || null,
          passwordHash,
          pinHash,
          referralCode,
          status: (dto.status as UserStatus) || UserStatus.ACTIVE,
          isEmailVerified: true,
          profile: {
            create: {
              firstName: dto.firstName,
              lastName: dto.lastName,
              country: dto.country || 'United States',
              addressLine1: dto.address || null,
            },
          },
          kycProfile: {
            create: {
              tier: KycTier.TIER_1,
              status: KycStatus.APPROVED,
            },
          },
          roles: {
            create: {
              roleId: roleRecord.id,
            },
          },
        },
      });

      const bankAccount = await tx.bankAccount.create({
        data: {
          userId: user.id,
          accountNumber,
          accountName: `${dto.firstName} ${dto.lastName} - ${accountType}`,
          type: accountType,
          currencyCode,
          status: AccountStatus.ACTIVE,
          currentBalance: initialBal,
          availableBalance: initialBal,
          ledgerBalance: initialBal,
        },
      });

      // Chart of Accounts liability node
      await tx.ledgerAccount.create({
        data: {
          accountCode: `2010-${accountNumber}`,
          name: `Liability - ${bankAccount.accountName}`,
          type: LedgerAccountType.LIABILITY,
          currencyCode,
          bankAccountId: bankAccount.id,
        },
      });

      // If initial balance provided > 0, post initial deposit transaction
      if (initialBal.gt(0)) {
        await tx.transaction.create({
          data: {
            userId: user.id,
            destinationAccountId: bankAccount.id,
            type: TransactionType.ADJUSTMENT_CREDIT,
            status: TransactionStatus.SUCCESS,
            amount: initialBal,
            fee: new Decimal('0.0000'),
            netAmount: initialBal,
            currencyCode,
            reference: `ADMIN-INIT-${Date.now().toString().slice(-6)}`,
            description: 'Administrative Initial Account Provisioning Credit',
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'USER_CREATED_BY_ADMIN',
          resource: 'User',
          resourceId: user.id,
          afterState: { email: user.email, username: user.username, role: roleName, initialBal: initialBal.toString() },
        },
      });

      return { user, bankAccount };
    });

    return {
      message: 'Customer account created successfully',
      user: result.user,
      account: result.bankAccount,
    };
  }

  async updateUser(id: string, dto: UpdateUserAdminDto, adminId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { profile: true, roles: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const updateData: any = {};
    if (dto.email) updateData.email = dto.email.toLowerCase();
    if (dto.username) updateData.username = dto.username.toLowerCase();
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.status) updateData.status = dto.status as UserStatus;
    if (dto.isEmailVerified !== undefined) updateData.isEmailVerified = dto.isEmailVerified;
    if (dto.twoFactorEnabled !== undefined) updateData.twoFactorEnabled = dto.twoFactorEnabled;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: updateData,
      });

      if (dto.firstName || dto.lastName || dto.country || dto.address) {
        await tx.profile.upsert({
          where: { userId: id },
          create: {
            userId: id,
            firstName: dto.firstName || 'User',
            lastName: dto.lastName || '',
            country: dto.country || 'United States',
            addressLine1: dto.address,
          },
          update: {
            ...(dto.firstName && { firstName: dto.firstName }),
            ...(dto.lastName && { lastName: dto.lastName }),
            ...(dto.country && { country: dto.country }),
            ...(dto.address && { addressLine1: dto.address }),
          },
        });
      }

      if (dto.role) {
        const role = await tx.role.findUnique({ where: { name: dto.role } });
        if (role) {
          await tx.userRole.deleteMany({ where: { userId: id } });
          await tx.userRole.create({
            data: { userId: id, roleId: role.id },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'USER_UPDATED_BY_ADMIN',
          resource: 'User',
          resourceId: id,
          beforeState: { status: user.status, email: user.email },
          afterState: dto as any,
        },
      });
    });

    return { message: 'User updated successfully' };
  }

  async resetUserPassword(id: string, dto: ResetUserPasswordDto, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const passwordHash = await CryptoUtil.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'USER_PASSWORD_RESET_BY_ADMIN',
        resource: 'User',
        resourceId: id,
      },
    });

    return { message: 'Customer password overridden successfully' };
  }

  async resetUserPin(id: string, dto: ResetUserPinDto, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const pinHash = await CryptoUtil.hash(dto.newPin);
    await this.prisma.user.update({
      where: { id },
      data: { pinHash },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'USER_PIN_RESET_BY_ADMIN',
        resource: 'User',
        resourceId: id,
      },
    });

    return { message: 'Customer transaction PIN overridden successfully' };
  }

  async resetUser2fa(id: string, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'USER_2FA_CLEARED_BY_ADMIN',
        resource: 'User',
        resourceId: id,
      },
    });

    return { message: '2FA authentication lock cleared for user' };
  }

  async deleteUser(id: string, adminId: string, hardDelete: boolean = false) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    if (hardDelete) {
      await this.prisma.user.delete({ where: { id } });
      await this.prisma.auditLog.create({
        data: {
          actorId: adminId || 'SYSTEM_ADMIN',
          action: 'USER_PERMANENTLY_DELETED_BY_ADMIN',
          resource: 'User',
          resourceId: id,
          afterState: { email: user.email, username: user.username },
        },
      });
      return { message: 'Customer account and all linked records permanently deleted' };
    } else {
      await this.prisma.user.update({
        where: { id },
        data: { status: UserStatus.CLOSED },
      });

      await this.prisma.auditLog.create({
        data: {
          actorId: adminId || 'SYSTEM_ADMIN',
          action: 'USER_DELETED_CLOSED_BY_ADMIN',
          resource: 'User',
          resourceId: id,
        },
      });

      return { message: 'Customer account closed and archived successfully' };
    }
  }

  async impersonateUser(targetUserId: string, adminId: string, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: {
        profile: true,
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
        bankAccounts: {
          where: { status: AccountStatus.ACTIVE },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User #${targetUserId} not found`);
    }

    const roles = user.roles.map((ur) => ur.role.name);
    const permissions = Array.from(
      new Set(
        user.roles.flatMap((ur) =>
          ur.role.permissions.map((rp) => rp.permission.slug),
        ),
      ),
    );

    const payload = { sub: user.id, email: user.email, username: user.username, roles };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_SECRET', 'super-secret-jwt-key-change-in-production-silverhawk-banking-2026'),
      expiresIn: this.configService.get<string>('JWT_EXPIRATION', '900s'),
    });

    const refreshToken = CryptoUtil.generateSecureToken(32);

    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshToken,
        ipAddress: ipAddress || '127.0.0.1',
        userAgent: userAgent ? `Admin Impersonation (${userAgent.slice(0, 100)})` : 'Admin Impersonation Session',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'ADMIN_IMPERSONATED_USER_SESSION',
        resource: 'User',
        resourceId: targetUserId,
        afterState: { targetEmail: user.email, targetUsername: user.username },
      },
    });

    return {
      message: 'Impersonation session established successfully',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        isEmailVerified: user.isEmailVerified,
        profile: user.profile,
        primaryAccount: user.bankAccounts[0] || null,
        roles,
        permissions,
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 900,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 4. ACCOUNTS & DIRECT DOUBLE-ENTRY LEDGER BALANCE ADJUSTMENTS
  // ---------------------------------------------------------------------------
  async getAccounts(query?: {
    search?: string;
    status?: string;
    type?: string;
    currency?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query?.status) where.status = query.status as AccountStatus;
    if (query?.type) where.type = query.type as AccountType;
    if (query?.currency) where.currencyCode = query.currency.toUpperCase();
    if (query?.search) {
      const s = query.search.trim();
      where.OR = [
        { accountNumber: { contains: s } },
        { accountName: { contains: s } },
        { user: { email: { contains: s } } },
        { user: { username: { contains: s } } },
        { user: { profile: { firstName: { contains: s } } } },
        { user: { profile: { lastName: { contains: s } } } },
      ];
    }

    const sortField = query?.sortBy || 'createdAt';
    const sortDir = query?.sortOrder === 'asc' ? 'asc' : 'desc';

    const [total, accounts] = await Promise.all([
      this.prisma.bankAccount.count({ where }),
      this.prisma.bankAccount.findMany({
        where,
        take: limit,
        skip,
        orderBy: { [sortField]: sortDir },
        include: {
          user: {
            select: { id: true, email: true, username: true, profile: true },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: accounts,
      accounts,
    };
  }

  async adjustAccountBalance(accountId: string, dto: AdjustBalanceDto, adminId: string) {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
      include: { user: true },
    });
    if (!account) throw new NotFoundException('Bank account not found');

    const amountDec = new Decimal(dto.amount.toString());
    if (amountDec.lte(0)) {
      throw new BadRequestException('Adjustment amount must be strictly greater than zero');
    }

    const currentBal = new Decimal(account.currentBalance.toString());
    const availBal = new Decimal(account.availableBalance.toString());
    const ledgerBal = new Decimal(account.ledgerBalance.toString());

    let newCurrentBal: Decimal;
    let newAvailBal: Decimal;
    let newLedgerBal: Decimal;
    let txType: TransactionType;

    if (dto.type === 'CREDIT') {
      newCurrentBal = currentBal.plus(amountDec);
      newAvailBal = availBal.plus(amountDec);
      newLedgerBal = ledgerBal.plus(amountDec);
      txType = TransactionType.ADJUSTMENT_CREDIT;
    } else {
      if (availBal.lt(amountDec)) {
        throw new BadRequestException(`Insufficient funds for debit. Available: ${availBal.toFixed(2)}`);
      }
      newCurrentBal = currentBal.minus(amountDec);
      newAvailBal = availBal.minus(amountDec);
      newLedgerBal = ledgerBal.minus(amountDec);
      txType = TransactionType.ADJUSTMENT_DEBIT;
    }

    const ref = dto.reference || `ADJ-${Date.now().toString().slice(-8)}`;
    const effectiveDate = dto.effectiveDate ? new Date(dto.effectiveDate) : new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Update Bank Account balance
      const updatedAccount = await tx.bankAccount.update({
        where: { id: accountId },
        data: {
          currentBalance: newCurrentBal,
          availableBalance: newAvailBal,
          ledgerBalance: newLedgerBal,
        },
      });

      // 2. Create Transaction Record
      const transaction = await tx.transaction.create({
        data: {
          userId: account.userId,
          ...(dto.type === 'CREDIT' ? { destinationAccountId: account.id } : { sourceAccountId: account.id }),
          type: txType,
          status: TransactionStatus.SUCCESS,
          amount: amountDec,
          fee: new Decimal('0.0000'),
          netAmount: amountDec,
          currencyCode: account.currencyCode,
          reference: ref,
          description: dto.description || `Administrative ${dto.type} adjustment`,
          metadata: {
            adminId,
            category: dto.category || 'ADMIN_LEDGER_ADJUSTMENT',
            previousBalance: currentBal.toString(),
            newBalance: newCurrentBal.toString(),
          },
          createdAt: effectiveDate,
        },
      });

      // 3. User Notification
      await tx.notification.create({
        data: {
          userId: account.userId,
          title: `Account ${dto.type === 'CREDIT' ? 'Credited' : 'Debited'}`,
          message: `Your account #${account.accountNumber} has been ${dto.type === 'CREDIT' ? 'credited with' : 'debited by'} ${account.currencyCode} ${amountDec.toFixed(2)}. Memo: ${dto.description}`,
          type: 'TRANSACTION',
        },
      });

      // 4. Audit Log
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: `ACCOUNT_BALANCE_${dto.type}`,
          resource: 'BankAccount',
          resourceId: accountId,
          beforeState: { currentBalance: currentBal.toString() },
          afterState: { currentBalance: newCurrentBal.toString(), amount: amountDec.toString(), ref },
        },
      });

      return { account: updatedAccount, transaction };
    });

    if (this.eventsGateway) {
      try {
        this.eventsGateway.emitBalanceUpdate(account.userId, {
          accountId: account.id,
          availableBalance: result.account.availableBalance.toString(),
          currentBalance: result.account.currentBalance.toString(),
          currency: account.currencyCode,
        });
        this.eventsGateway.emitTransactionCreated(account.userId, result.transaction);
      } catch (e) {
        // Safe catch for websocket broadcast
      }
    }

    return {
      message: `Account balance ${dto.type === 'CREDIT' ? 'credited' : 'debited'} successfully`,
      newBalance: result.account.currentBalance,
      transaction: result.transaction,
    };
  }

  async updateAccountStatus(accountId: string, dto: UpdateAccountStatusDto, adminId: string) {
    const account = await this.prisma.bankAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Account not found');

    const updated = await this.prisma.bankAccount.update({
      where: { id: accountId },
      data: { status: dto.status as AccountStatus },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'ACCOUNT_STATUS_CHANGE',
        resource: 'BankAccount',
        resourceId: accountId,
        afterState: { status: dto.status },
      },
    });

    return { message: `Account status updated to ${dto.status}`, account: updated };
  }

  // ---------------------------------------------------------------------------
  // 5. TRANSACTIONS & MANUAL CUSTOM INJECTIONS
  // ---------------------------------------------------------------------------
  async getTransactions(query?: {
    search?: string;
    status?: string;
    type?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query?.status) where.status = query.status as TransactionStatus;
    if (query?.type) {
      if ((query.type as any) === 'TRANSFER_DOMESTIC') {
        where.type = TransactionType.TRANSFER_EXTERNAL;
      } else {
        where.type = query.type as TransactionType;
      }
    }
    if (query?.search && query.search.trim()) {
      const s = query.search.trim();
      where.OR = [
        { reference: { contains: s } },
        { description: { contains: s } },
        { user: { email: { contains: s } } },
        { user: { username: { contains: s } } },
        { user: { profile: { firstName: { contains: s } } } },
        { user: { profile: { lastName: { contains: s } } } },
        { sourceAccount: { accountNumber: { contains: s } } },
        { destinationAccount: { accountNumber: { contains: s } } },
      ];
    }

    const [total, transactions] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        take: limit,
        skip,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, username: true, profile: true },
          },
          sourceAccount: {
            select: { id: true, accountNumber: true, accountName: true, currencyCode: true },
          },
          destinationAccount: {
            select: { id: true, accountNumber: true, accountName: true, currencyCode: true },
          },
          deposit: true,
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      transactions,
    };
  }

  async injectTransaction(dto: ManualTransactionDto, adminId: string) {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id: dto.accountId },
      include: { user: true },
    });
    if (!account) throw new NotFoundException('Account not found');

    const amt = new Decimal(dto.amount.toString());
    const ref = dto.reference || `TX-${Date.now().toString().slice(-8)}`;
    const txStatus = (dto.status as TransactionStatus) || TransactionStatus.SUCCESS;
    const effectiveDate = dto.createdAt ? new Date(dto.createdAt) : new Date();

    const txType = dto.type
      ? (dto.type as TransactionType)
      : dto.direction === 'CREDIT'
      ? TransactionType.DEPOSIT
      : TransactionType.TRANSFER_EXTERNAL;

    const result = await this.prisma.$transaction(async (tx) => {
      // If SUCCESS, update balance
      if (txStatus === TransactionStatus.SUCCESS) {
        const mult = dto.direction === 'CREDIT' ? 1 : -1;
        const delta = amt.mul(mult);

        await tx.bankAccount.update({
          where: { id: account.id },
          data: {
            currentBalance: { increment: delta },
            availableBalance: { increment: delta },
            ledgerBalance: { increment: delta },
          },
        });
      }

      const createdTx = await tx.transaction.create({
        data: {
          userId: account.userId,
          ...(dto.direction === 'CREDIT' ? { destinationAccountId: account.id } : { sourceAccountId: account.id }),
          type: txType,
          status: txStatus,
          amount: amt,
          fee: new Decimal('0.0000'),
          netAmount: amt,
          currencyCode: account.currencyCode,
          reference: ref,
          description: dto.description,
          createdAt: effectiveDate,
          metadata: {
            injectedByAdmin: adminId,
            counterpartyName: dto.counterpartyName,
            counterpartyBank: dto.counterpartyBank,
            counterpartyAccount: dto.counterpartyAccount,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'TRANSACTION_INJECTED_BY_ADMIN',
          resource: 'Transaction',
          resourceId: createdTx.id,
          afterState: { ref, amount: amt.toString(), direction: dto.direction, status: txStatus },
        },
      });

      return createdTx;
    });

    return { message: 'Transaction injected successfully', transaction: result };
  }

  async approveTransaction(id: string, adminId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: { sourceAccount: true, destinationAccount: true },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');

    await this.prisma.$transaction(async (tx) => {
      const currentMeta = (transaction.metadata as any) || {};
      const updatedMeta = {
        ...currentMeta,
        reviewStatus: 'APPROVED',
        approvedAt: new Date().toISOString(),
        approvedBy: adminId,
      };

      await tx.transaction.update({
        where: { id },
        data: {
          status: TransactionStatus.SUCCESS,
          metadata: updatedMeta,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'TRANSACTION_APPROVED',
          resource: 'Transaction',
          resourceId: id,
          afterState: { previousStatus: transaction.status, status: TransactionStatus.SUCCESS },
        },
      });
    });

    try {
      await this.notificationsService.dispatchTransferCompleted(transaction.userId, { ...transaction, status: TransactionStatus.SUCCESS });
    } catch (e) {}

    return { message: 'Transaction approved successfully' };
  }

  async rejectTransaction(id: string, reason: string, adminId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: { sourceAccount: true, destinationAccount: true },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');

    await this.prisma.$transaction(async (tx) => {
      // If it was already completed or processing, refund the source account if not already failed/reversed
      const refundAccountId = transaction.sourceAccountId;
      if (
        refundAccountId &&
        transaction.status !== TransactionStatus.FAILED &&
        transaction.status !== TransactionStatus.CANCELLED &&
        transaction.status !== TransactionStatus.REVERSED &&
        (transaction.type === TransactionType.TRANSFER_EXTERNAL ||
          transaction.type === TransactionType.TRANSFER_INTERNATIONAL ||
          transaction.type === TransactionType.WITHDRAWAL)
      ) {
        await tx.bankAccount.update({
          where: { id: refundAccountId },
          data: {
            availableBalance: { increment: transaction.amount },
            currentBalance: { increment: transaction.amount },
            ledgerBalance: { increment: transaction.amount },
          },
        });
      }

      const currentMeta = (transaction.metadata as any) || {};
      const updatedMeta = {
        ...currentMeta,
        reviewStatus: 'REJECTED',
        rejectionReason: reason,
        rejectedAt: new Date().toISOString(),
        rejectedBy: adminId,
      };

      await tx.transaction.update({
        where: { id },
        data: {
          status: TransactionStatus.FAILED,
          metadata: updatedMeta,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'TRANSACTION_REJECTED',
          resource: 'Transaction',
          resourceId: id,
          beforeState: { status: transaction.status },
          afterState: { status: TransactionStatus.FAILED, rejectionReason: reason },
        },
      });
    });

    try {
      await this.notificationsService.dispatchTransferFailed(transaction.userId, { ...transaction, status: TransactionStatus.FAILED }, reason);
    } catch (e) {}

    return { message: 'Transaction rejected and funds restored' };
  }

  async setTransactionPending(id: string, reason: string, adminId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: { sourceAccount: true, destinationAccount: true },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');

    const previousStatus = transaction.status;
    const currentMeta = (transaction.metadata as any) || {};
    const updatedMeta = {
      ...currentMeta,
      reviewStatus: 'PENDING',
      pendingReason: reason || 'Marked pending by admin',
      pendingAt: new Date().toISOString(),
      pendingBy: adminId,
    };

    const updated = await this.prisma.transaction.update({
      where: { id },
      data: {
        status: TransactionStatus.PENDING,
        metadata: updatedMeta,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'TRANSACTION_STATUS_UPDATED',
        resource: 'Transaction',
        resourceId: id,
        beforeState: { status: previousStatus },
        afterState: {
          previousStatus,
          newStatus: TransactionStatus.PENDING,
          reason: reason || 'Marked pending by admin',
          timestamp: new Date().toISOString(),
          adminId,
        },
      },
    });

    try {
      await this.notificationsService.dispatchTransferProcessing(transaction.userId, updated);
    } catch (e) {}

    return { message: 'Transaction status set to PENDING', transaction: updated };
  }

  async reverseTransaction(id: string, adminId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: { sourceAccount: true, destinationAccount: true },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');
    if (transaction.status !== TransactionStatus.SUCCESS) {
      throw new BadRequestException('Only completed transactions can be reversed');
    }

    await this.prisma.$transaction(async (tx) => {
      const isCredit = transaction.type === TransactionType.DEPOSIT || transaction.type === TransactionType.ADJUSTMENT_CREDIT;
      const mult = isCredit ? -1 : 1; // if was credit, debit it back
      const delta = transaction.amount.mul(mult);
      const targetAccountId = transaction.destinationAccountId || transaction.sourceAccountId;

      if (targetAccountId) {
        await tx.bankAccount.update({
          where: { id: targetAccountId },
          data: {
            currentBalance: { increment: delta },
            availableBalance: { increment: delta },
            ledgerBalance: { increment: delta },
          },
        });
      }

      await tx.transaction.update({
        where: { id },
        data: { status: TransactionStatus.REVERSED },
      });

      await tx.transaction.create({
        data: {
          userId: transaction.userId,
          ...(transaction.sourceAccountId ? { destinationAccountId: transaction.sourceAccountId } : { sourceAccountId: transaction.destinationAccountId }),
          type: TransactionType.REVERSAL,
          status: TransactionStatus.SUCCESS,
          amount: transaction.amount,
          fee: new Decimal(0),
          netAmount: transaction.amount,
          currencyCode: transaction.currencyCode,
          reference: `REV-${transaction.reference}`,
          description: `Reversal of transaction ${transaction.reference}`,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'TRANSACTION_REVERSED',
          resource: 'Transaction',
          resourceId: id,
        },
      });
    });

    try {
      await this.notificationsService.dispatchTransferCancelled(transaction.userId, { ...transaction, status: TransactionStatus.REVERSED }, 'Administrative reversal');
    } catch (e) {}

    return { message: 'Transaction reversed and balance adjusted' };
  }

  async setTransactionUnderReview(id: string, reason: string, adminId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: { sourceAccount: true, destinationAccount: true },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');

    const previousStatus = transaction.status;
    const currentMeta = (transaction.metadata as any) || {};
    const updatedMeta = {
      ...currentMeta,
      reviewStatus: 'REQUIRES_REVIEW',
      underReviewReason: reason || 'Flagged for compliance review',
      underReviewAt: new Date().toISOString(),
      underReviewBy: adminId,
    };

    const updated = await this.prisma.transaction.update({
      where: { id },
      data: {
        status: TransactionStatus.PROCESSING,
        metadata: updatedMeta,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'TRANSACTION_STATUS_UPDATED',
        resource: 'Transaction',
        resourceId: id,
        beforeState: { status: previousStatus },
        afterState: {
          previousStatus,
          newStatus: 'REQUIRES_REVIEW',
          actualStatus: TransactionStatus.PROCESSING,
          reason: reason || 'Flagged for compliance review',
          timestamp: new Date().toISOString(),
          adminId,
        },
      },
    });

    try {
      await this.notificationsService.dispatchTransferRequiresReview(transaction.userId, updated, reason);
    } catch (e) {}

    return { message: 'Transaction placed under compliance review', transaction: updated };
  }

  async updateTransaction(id: string, dto: UpdateTransactionAdminDto, adminId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: { sourceAccount: true, destinationAccount: true },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');

    const beforeState: any = {
      status: transaction.status,
      amount: transaction.amount.toString(),
      fee: transaction.fee.toString(),
      description: transaction.description,
      reference: transaction.reference,
      metadata: transaction.metadata,
      createdAt: transaction.createdAt,
    };

    const data: any = {};
    const currentMeta = (transaction.metadata as any) || {};
    const updatedMeta = { ...currentMeta };

    if (dto.description !== undefined) data.description = dto.description;
    if (dto.reference !== undefined) data.reference = dto.reference;

    if (dto.amount !== undefined) {
      const newAmt = new Decimal(dto.amount.toString());
      data.amount = newAmt;
      const currentFee = dto.fee !== undefined ? new Decimal(dto.fee.toString()) : transaction.fee;
      data.netAmount = newAmt.minus(currentFee);
    }

    if (dto.fee !== undefined) {
      const newFee = new Decimal(dto.fee.toString());
      data.fee = newFee;
      const currentAmt = dto.amount !== undefined ? new Decimal(dto.amount.toString()) : transaction.amount;
      data.netAmount = currentAmt.minus(newFee);
    }

    if (dto.counterpartyName !== undefined) updatedMeta.counterpartyName = dto.counterpartyName;
    if (dto.counterpartyBank !== undefined) updatedMeta.counterpartyBank = dto.counterpartyBank;
    if (dto.counterpartyAccount !== undefined) updatedMeta.counterpartyAccount = dto.counterpartyAccount;
    if (dto.internalNotes !== undefined) {
      const notesList = Array.isArray(currentMeta.internalNotesList) ? [...currentMeta.internalNotesList] : [];
      notesList.push({
        note: dto.internalNotes,
        adminId,
        createdAt: new Date().toISOString(),
      });
      updatedMeta.internalNotes = dto.internalNotes;
      updatedMeta.internalNotesList = notesList;
    }

    let resolvedStatus = transaction.status;
    if (dto.status) {
      if (dto.status === 'REQUIRES_REVIEW' || dto.status === 'UNDER_REVIEW') {
        data.status = TransactionStatus.PROCESSING;
        updatedMeta.reviewStatus = 'REQUIRES_REVIEW';
        resolvedStatus = TransactionStatus.PROCESSING;
      } else if (Object.values(TransactionStatus).includes(dto.status as any)) {
        data.status = dto.status as TransactionStatus;
        resolvedStatus = dto.status as TransactionStatus;
        if (dto.status === TransactionStatus.SUCCESS) {
          updatedMeta.reviewStatus = 'APPROVED';
        } else if (dto.status === TransactionStatus.FAILED || dto.status === TransactionStatus.CANCELLED) {
          updatedMeta.reviewStatus = 'REJECTED';
        }
      }
    }

    data.metadata = updatedMeta;

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.transaction.update({
        where: { id },
        data,
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'TRANSACTION_UPDATED_BY_ADMIN',
          resource: 'Transaction',
          resourceId: id,
          beforeState,
          afterState: {
            previousStatus: beforeState.status,
            newStatus: dto.status || beforeState.status,
            resolvedStatus,
            amount: data.amount ? data.amount.toString() : beforeState.amount,
            description: data.description || beforeState.description,
            internalNotes: dto.internalNotes || null,
            reason: dto.reason || null,
            adminId,
            timestamp: new Date().toISOString(),
          },
        },
      });

      return res;
    });

    return { message: 'Transaction modified successfully', transaction: updated };
  }

  async deleteTransaction(id: string, adminId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'TRANSACTION_DELETED_BY_ADMIN',
          resource: 'Transaction',
          resourceId: id,
          beforeState: {
            reference: transaction.reference,
            amount: transaction.amount.toString(),
            status: transaction.status,
            type: transaction.type,
            userId: transaction.userId,
          },
          afterState: {
            deletedAt: new Date().toISOString(),
            adminId,
          },
        },
      });

      // Remove dependent relationships if any before deleting
      await tx.transfer.deleteMany({ where: { transactionId: id } });
      await tx.deposit.deleteMany({ where: { transactionId: id } });
      await tx.withdrawal.deleteMany({ where: { transactionId: id } });
      await tx.cardTransaction.deleteMany({ where: { transactionId: id } });
      await tx.ledgerEntry.deleteMany({
        where: { journalTransaction: { transactionId: id } },
      });
      await tx.journalTransaction.deleteMany({ where: { transactionId: id } });

      await tx.transaction.delete({
        where: { id },
      });
    });

    return { message: 'Transaction deleted successfully' };
  }

  async getPendingTransactions(query?: { page?: number; limit?: number; type?: string }) {
    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {
      status: { in: [TransactionStatus.PENDING, TransactionStatus.PROCESSING] },
    };
    if (query?.type) where.type = query.type as TransactionType;

    const [total, transactions] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        take: limit,
        skip,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, email: true, username: true, profile: true } },
          sourceAccount: { select: { id: true, accountNumber: true, accountName: true, currencyCode: true } },
          destinationAccount: { select: { id: true, accountNumber: true, accountName: true, currencyCode: true } },
          deposit: true,
        },
      }),
    ]);

    return { total, page, limit, totalPages: Math.ceil(total / limit), transactions };
  }

  async getTransactionDetails(id: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, username: true, phone: true, profile: true } },
        sourceAccount: {
          include: { currency: true, user: { select: { id: true, email: true, profile: true } } },
        },
        destinationAccount: {
          include: { currency: true, user: { select: { id: true, email: true, profile: true } } },
        },
        deposit: true,
      },
    });

    if (!transaction) throw new NotFoundException(`Transaction #${id} not found`);

    const auditLogs = await this.prisma.auditLog.findMany({
      where: { resourceId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return { transaction, auditLogs };
  }

  async exportTransactionReport(query: {
    search?: string;
    status?: string;
    type?: string;
    startDate?: string;
    endDate?: string;
    currency?: string;
    format?: 'CSV' | 'PDF';
  }): Promise<{ filename: string; buffer?: Buffer; csv?: string; mimeType: string }> {
    const where: any = {};
    if (query.status) where.status = query.status as TransactionStatus;
    if (query.type) where.type = query.type as TransactionType;
    if (query.currency) where.currencyCode = query.currency.toUpperCase();
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }
    if (query.search) {
      where.OR = [
        { reference: { contains: query.search } },
        { description: { contains: query.search } },
        { user: { email: { contains: query.search } } },
      ];
    }

    const transactions = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { email: true, username: true, profile: true } },
      },
    });

    const format = query.format || 'CSV';
    const fromStr = query.startDate ? query.startDate.slice(0, 10) : 'Inception';
    const toStr = query.endDate ? query.endDate.slice(0, 10) : new Date().toISOString().slice(0, 10);

    let totalCredits = new Decimal(0);
    let totalDebits = new Decimal(0);

    const statementItems = transactions.map((tx) => {
      const isCredit = tx.type === TransactionType.DEPOSIT || tx.type === TransactionType.ADJUSTMENT_CREDIT || tx.type === TransactionType.LOAN_DISBURSEMENT;
      const amt = new Decimal(tx.amount.toString());
      if (isCredit) {
        totalCredits = totalCredits.plus(amt);
      } else {
        totalDebits = totalDebits.plus(amt);
      }
      return {
        id: tx.id,
        reference: tx.reference,
        date: tx.createdAt,
        description: `${tx.user?.email || 'N/A'}: ${tx.description || tx.type}`,
        amount: tx.amount.toString(),
        type: isCredit ? ('CREDIT' as const) : ('DEBIT' as const),
        currency: tx.currencyCode,
      };
    });

    if (format === 'PDF') {
      const buffer = StatementGeneratorUtil.generatePdfStatement({
        bankName: 'SILVERHAWK DIGITAL BANK - GLOBAL TRANSACTION AUDIT REPORT',
        accountHolder: 'CENTRAL AUDIT DESK',
        accountNumber: 'SYSTEM-GLOBAL-LEDGER',
        accountType: 'ADMIN_REPORT',
        currency: query.currency || 'USD',
        startDate: query.startDate,
        endDate: query.endDate,
        openingBalance: '0.0000',
        closingBalance: totalCredits.minus(totalDebits).toFixed(4),
        totalCredits: totalCredits.toFixed(4),
        totalDebits: totalDebits.toFixed(4),
        transactions: statementItems,
      });

      return {
        filename: `admin_transactions_report_${fromStr}_to_${toStr}.pdf`,
        buffer,
        mimeType: 'application/pdf',
      };
    }

    const csv = StatementGeneratorUtil.generateCsvStatement({
      accountHolder: 'CENTRAL AUDIT DESK',
      accountNumber: 'SYSTEM-GLOBAL-LEDGER',
      accountType: 'ADMIN_REPORT',
      currency: query.currency || 'USD',
      startDate: query.startDate,
      endDate: query.endDate,
      openingBalance: '0.0000',
      closingBalance: totalCredits.minus(totalDebits).toFixed(4),
      totalCredits: totalCredits.toFixed(4),
      totalDebits: totalDebits.toFixed(4),
      transactions: statementItems,
    });

    return {
      filename: `admin_transactions_report_${fromStr}_to_${toStr}.csv`,
      csv,
      mimeType: 'text/csv',
    };
  }

  // ---------------------------------------------------------------------------
  // 6. DEPOSITS MANAGEMENT
  // ---------------------------------------------------------------------------
  async getDeposits(query?: {
    status?: string;
    method?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Number(query?.page) || 1;
    const limit = Number(query?.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      type: TransactionType.DEPOSIT,
    };

    if (query?.status) {
      where.status = query.status as TransactionStatus;
    }

    if (query?.method) {
      where.deposit = {
        method: query.method as DepositMethod,
      };
    }

    if (query?.startDate || query?.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    if (query?.search) {
      const s = query.search.trim();
      where.OR = [
        { reference: { contains: s, mode: 'insensitive' } },
        { user: { email: { contains: s, mode: 'insensitive' } } },
        { user: { username: { contains: s, mode: 'insensitive' } } },
        { user: { profile: { firstName: { contains: s, mode: 'insensitive' } } } },
        { user: { profile: { lastName: { contains: s, mode: 'insensitive' } } } },
        { deposit: { paymentReference: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const [total, deposits] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, email: true, username: true, profile: true } },
          destinationAccount: { select: { id: true, accountNumber: true, accountName: true, currencyCode: true, type: true } },
          deposit: true,
        },
      }),
    ]);

    return {
      deposits,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getDepositDetails(id: string) {
    const depositTx = await this.prisma.transaction.findFirst({
      where: {
        OR: [
          { id },
          { deposit: { id } },
          { deposit: { paymentReference: id } },
          { reference: id },
        ],
        type: TransactionType.DEPOSIT,
      },
      include: {
        user: { select: { id: true, email: true, username: true, profile: true } },
        destinationAccount: true,
        deposit: true,
        journalTransaction: {
          include: {
            entries: {
              include: { ledgerAccount: true },
            },
          },
        },
      },
    });

    if (!depositTx) {
      throw new NotFoundException('Deposit record not found');
    }

    return depositTx;
  }

  async approveDeposit(transactionId: string, dto: ApproveDepositDto, adminId: string) {
    const txRecord = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { destinationAccount: true, deposit: true },
    });
    if (!txRecord) throw new NotFoundException('Deposit record not found');
    if (txRecord.status === TransactionStatus.SUCCESS) {
      throw new BadRequestException('Deposit is already approved and credited');
    }

    const targetAccountId = txRecord.destinationAccountId;
    if (!targetAccountId) throw new BadRequestException('No destination bank account linked to deposit');

    await this.prisma.$transaction(async (tx) => {
      // Credit bank account
      await tx.bankAccount.update({
        where: { id: targetAccountId },
        data: {
          currentBalance: { increment: txRecord.amount },
          availableBalance: { increment: txRecord.amount },
          ledgerBalance: { increment: txRecord.amount },
        },
      });

      // Update Transaction
      await tx.transaction.update({
        where: { id: transactionId },
        data: {
          status: TransactionStatus.SUCCESS,
          metadata: { ...((txRecord.metadata as any) || {}), adminNote: dto.note },
        },
      });

      // Update Deposit record if exists
      if (txRecord.deposit) {
        await tx.deposit.update({
          where: { id: txRecord.deposit.id },
          data: { approvedBy: adminId },
        });
      }

      const accountNum = txRecord.destinationAccount?.accountNumber || 'account';
      await tx.notification.create({
        data: {
          userId: txRecord.userId,
          title: 'Deposit Approved & Credited',
          message: `Your deposit of ${txRecord.currencyCode} ${txRecord.amount.toFixed(2)} has been cleared and credited to #${accountNum}.`,
          type: 'DEPOSIT',
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'DEPOSIT_APPROVED_CREDITED',
          resource: 'Deposit',
          resourceId: transactionId,
          afterState: { amount: txRecord.amount.toString(), currency: txRecord.currencyCode },
        },
      });
    });

    return { message: 'Deposit approved and balance credited successfully' };
  }

  async rejectDeposit(transactionId: string, dto: RejectDepositDto, adminId: string) {
    const txRecord = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!txRecord) throw new NotFoundException('Deposit record not found');

    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: TransactionStatus.FAILED,
        metadata: { ...((txRecord.metadata as any) || {}), rejectionReason: dto.reason },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'DEPOSIT_REJECTED',
        resource: 'Deposit',
        resourceId: transactionId,
        afterState: { reason: dto.reason },
      },
    });

    return { message: 'Deposit rejected' };
  }

  // ---------------------------------------------------------------------------
  // 7. WITHDRAWALS MANAGEMENT
  // ---------------------------------------------------------------------------
  async getWithdrawals(query?: {
    status?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Number(query?.page) || 1;
    const limit = Number(query?.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query?.status) {
      where.status = query.status as WithdrawalStatus;
    }

    if (query?.startDate || query?.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    if (query?.search) {
      const s = query.search.trim();
      where.OR = [
        { transaction: { reference: { contains: s, mode: 'insensitive' } } },
        { account: { accountNumber: { contains: s, mode: 'insensitive' } } },
        { account: { user: { email: { contains: s, mode: 'insensitive' } } } },
        { account: { user: { username: { contains: s, mode: 'insensitive' } } } },
        { account: { user: { profile: { firstName: { contains: s, mode: 'insensitive' } } } } },
        { account: { user: { profile: { lastName: { contains: s, mode: 'insensitive' } } } } },
      ];
    }

    const [total, withdrawals] = await Promise.all([
      this.prisma.withdrawal.count({ where }),
      this.prisma.withdrawal.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          transaction: true,
          account: {
            include: {
              user: { select: { id: true, email: true, username: true, profile: true } },
            },
          },
        },
      }),
    ]);

    return {
      withdrawals,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getWithdrawalDetails(id: string) {
    const withdrawal = await this.prisma.withdrawal.findFirst({
      where: {
        OR: [
          { id },
          { transactionId: id },
          { transaction: { reference: id } },
        ],
      },
      include: {
        transaction: {
          include: {
            journalTransaction: {
              include: {
                entries: {
                  include: { ledgerAccount: true },
                },
              },
            },
          },
        },
        account: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                username: true,
                profile: true,
              },
            },
          },
        },
      },
    });

    if (!withdrawal) {
      throw new NotFoundException('Withdrawal request not found');
    }

    return withdrawal;
  }

  async approveWithdrawal(id: string, dto: ApproveWithdrawalDto, adminId: string) {
    const withdrawal = await this.prisma.withdrawal.findFirst({
      where: { OR: [{ id }, { transactionId: id }] },
      include: { transaction: true, account: true },
    });

    if (!withdrawal) throw new NotFoundException('Withdrawal request not found');
    if (withdrawal.status !== WithdrawalStatus.REQUESTED) {
      throw new BadRequestException(`Withdrawal cannot be approved from status ${withdrawal.status}`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: WithdrawalStatus.APPROVED,
          approvedBy: adminId,
          updatedAt: new Date(),
        },
      });

      if (dto.note) {
        await tx.transaction.update({
          where: { id: withdrawal.transactionId },
          data: {
            metadata: {
              ...((withdrawal.transaction.metadata as any) || {}),
              approvalNote: dto.note,
              approvedBy: adminId,
            },
          },
        });
      }

      await tx.notification.create({
        data: {
          userId: withdrawal.transaction.userId,
          title: 'Withdrawal Approved',
          message: `Your withdrawal request of ${withdrawal.transaction.currencyCode} ${withdrawal.transaction.amount.toFixed(2)} has been approved and is queued for processing.`,
          type: 'TRANSACTION',
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'WITHDRAWAL_APPROVED',
          resource: 'Withdrawal',
          resourceId: withdrawal.id,
          afterState: { status: WithdrawalStatus.APPROVED, note: dto.note },
        },
      });

      return res;
    });

    return { message: 'Withdrawal request approved successfully', withdrawal: updated };
  }

  async processWithdrawal(id: string, dto: ProcessWithdrawalDto, adminId: string) {
    const withdrawal = await this.prisma.withdrawal.findFirst({
      where: { OR: [{ id }, { transactionId: id }] },
      include: { transaction: true },
    });

    if (!withdrawal) throw new NotFoundException('Withdrawal request not found');
    if (withdrawal.status !== WithdrawalStatus.REQUESTED && withdrawal.status !== WithdrawalStatus.APPROVED) {
      throw new BadRequestException(`Withdrawal in status ${withdrawal.status} cannot be moved to PROCESSING`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: WithdrawalStatus.PROCESSING,
          updatedAt: new Date(),
        },
      });

      await tx.transaction.update({
        where: { id: withdrawal.transactionId },
        data: {
          status: TransactionStatus.PROCESSING,
          metadata: {
            ...((withdrawal.transaction.metadata as any) || {}),
            providerReference: dto.providerReference || `PRV-${Date.now()}`,
            processingNote: dto.note,
          },
        },
      });

      await tx.notification.create({
        data: {
          userId: withdrawal.transaction.userId,
          title: 'Withdrawal Processing',
          message: `Your withdrawal of ${withdrawal.transaction.currencyCode} ${withdrawal.transaction.amount.toFixed(2)} is now processing through the payment network.`,
          type: 'TRANSACTION',
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'WITHDRAWAL_PROCESSING',
          resource: 'Withdrawal',
          resourceId: withdrawal.id,
          afterState: { status: WithdrawalStatus.PROCESSING, providerReference: dto.providerReference },
        },
      });

      return res;
    });

    return { message: 'Withdrawal is now marked as PROCESSING', withdrawal: updated };
  }

  async completeWithdrawal(id: string, dto: CompleteWithdrawalDto, adminId: string) {
    const withdrawal = await this.prisma.withdrawal.findFirst({
      where: { OR: [{ id }, { transactionId: id }] },
      include: { transaction: true, account: true },
    });

    if (!withdrawal) throw new NotFoundException('Withdrawal request not found');
    if (withdrawal.status === WithdrawalStatus.COMPLETED) {
      throw new BadRequestException('Withdrawal is already completed');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: WithdrawalStatus.COMPLETED,
          updatedAt: new Date(),
        },
      });

      await tx.transaction.update({
        where: { id: withdrawal.transactionId },
        data: {
          status: TransactionStatus.SUCCESS,
          metadata: {
            ...((withdrawal.transaction.metadata as any) || {}),
            settlementReference: dto.settlementReference || `SETTLE-${Date.now()}`,
            completionNote: dto.note,
            completedAt: new Date().toISOString(),
          },
        },
      });

      await tx.notification.create({
        data: {
          userId: withdrawal.transaction.userId,
          title: 'Withdrawal Completed',
          message: `Your payout of ${withdrawal.transaction.currencyCode} ${withdrawal.transaction.amount.toFixed(2)} has completed successfully. Reference: ${withdrawal.transaction.reference}`,
          type: 'TRANSACTION',
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'WITHDRAWAL_COMPLETED',
          resource: 'Withdrawal',
          resourceId: withdrawal.id,
          afterState: { status: WithdrawalStatus.COMPLETED, settlementReference: dto.settlementReference },
        },
      });

      return res;
    });

    return { message: 'Withdrawal completed successfully and settled', withdrawal: updated };
  }

  async rejectWithdrawal(id: string, dto: RejectWithdrawalDto, adminId: string) {
    const withdrawal = await this.prisma.withdrawal.findFirst({
      where: { OR: [{ id }, { transactionId: id }] },
      include: { transaction: true, account: true },
    });

    if (!withdrawal) throw new NotFoundException('Withdrawal request not found');
    if (withdrawal.status === WithdrawalStatus.COMPLETED || withdrawal.status === WithdrawalStatus.REJECTED) {
      throw new BadRequestException(`Cannot reject withdrawal with status ${withdrawal.status}`);
    }

    const amount = withdrawal.transaction.amount;

    await this.prisma.$transaction(async (tx) => {
      // Refund available & current balance to customer account
      await tx.bankAccount.update({
        where: { id: withdrawal.accountId },
        data: {
          currentBalance: { increment: amount },
          availableBalance: { increment: amount },
          ledgerBalance: { increment: amount },
        },
      });

      // Update withdrawal
      await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: WithdrawalStatus.REJECTED,
          rejectionReason: dto.reason,
          updatedAt: new Date(),
        },
      });

      // Update transaction
      await tx.transaction.update({
        where: { id: withdrawal.transactionId },
        data: {
          status: TransactionStatus.FAILED,
          metadata: {
            ...((withdrawal.transaction.metadata as any) || {}),
            rejectionReason: dto.reason,
            rejectedBy: adminId,
          },
        },
      });

      // Notify customer
      await tx.notification.create({
        data: {
          userId: withdrawal.transaction.userId,
          title: 'Withdrawal Request Declined',
          message: `Your withdrawal request of ${withdrawal.transaction.currencyCode} ${amount.toFixed(2)} was declined. Reason: ${dto.reason}. Funds have been restored to your balance.`,
          type: 'TRANSACTION',
        },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'WITHDRAWAL_REJECTED',
          resource: 'Withdrawal',
          resourceId: withdrawal.id,
          afterState: { status: WithdrawalStatus.REJECTED, reason: dto.reason, refundedAmount: amount.toString() },
        },
      });
    });

    return { message: 'Withdrawal rejected and customer funds restored to account' };
  }

  async reverseWithdrawal(id: string, dto: ReverseWithdrawalDto, adminId: string) {
    const withdrawal = await this.prisma.withdrawal.findFirst({
      where: { OR: [{ id }, { transactionId: id }] },
      include: { transaction: true, account: true },
    });

    if (!withdrawal) throw new NotFoundException('Withdrawal record not found');
    if (withdrawal.status !== WithdrawalStatus.COMPLETED) {
      throw new BadRequestException(`Only COMPLETED withdrawals can be reversed. Current status: ${withdrawal.status}`);
    }

    const amount = withdrawal.transaction.amount;
    const reversalRef = `REV-WDL-${Date.now().toString().slice(-8)}`;

    await this.prisma.$transaction(async (tx) => {
      // 1. Credit customer account back
      await tx.bankAccount.update({
        where: { id: withdrawal.accountId },
        data: {
          currentBalance: { increment: amount },
          availableBalance: { increment: amount },
          ledgerBalance: { increment: amount },
        },
      });

      // 2. Mark withdrawal as REVERSED
      await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: WithdrawalStatus.REVERSED,
          updatedAt: new Date(),
        },
      });

      // 3. Mark original transaction as REVERSED
      await tx.transaction.update({
        where: { id: withdrawal.transactionId },
        data: {
          status: TransactionStatus.REVERSED,
          metadata: {
            ...((withdrawal.transaction.metadata as any) || {}),
            reversalReason: dto.reason || 'Administrative reversal',
            reversedBy: adminId,
            reversalReference: reversalRef,
          },
        },
      });

      // 4. Create compensating reversal transaction
      await tx.transaction.create({
        data: {
          userId: withdrawal.transaction.userId,
          destinationAccountId: withdrawal.accountId,
          type: TransactionType.ADJUSTMENT_CREDIT,
          status: TransactionStatus.SUCCESS,
          amount,
          fee: new Decimal('0.0000'),
          netAmount: amount,
          currencyCode: withdrawal.transaction.currencyCode,
          reference: reversalRef,
          description: `Compensating reversal for withdrawal #${withdrawal.transaction.reference}`,
          metadata: {
            originalTransactionId: withdrawal.transactionId,
            reversedBy: adminId,
            reason: dto.reason,
          },
        },
      });

      // 5. Notify customer
      await tx.notification.create({
        data: {
          userId: withdrawal.transaction.userId,
          title: 'Withdrawal Reversal Processed',
          message: `Your withdrawal #${withdrawal.transaction.reference} of ${withdrawal.transaction.currencyCode} ${amount.toFixed(2)} has been reversed and credited back to your account.`,
          type: 'TRANSACTION',
        },
      });

      // 6. Audit Log
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'WITHDRAWAL_REVERSED',
          resource: 'Withdrawal',
          resourceId: withdrawal.id,
          afterState: { status: WithdrawalStatus.REVERSED, reason: dto.reason, reversalReference: reversalRef },
        },
      });
    });

    return { message: `Withdrawal successfully reversed. Reference: ${reversalRef}` };
  }

  // ---------------------------------------------------------------------------
  // 7. GRANTS & BUSINESS SUBSIDIES
  // ---------------------------------------------------------------------------
  async getGrants(query?: { status?: string }) {
    const where: any = {};
    if (query?.status) where.status = query.status as GrantStatus;

    return this.prisma.grantApplication.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, email: true, username: true, profile: true } },
        account: { select: { id: true, accountNumber: true, accountName: true, currencyCode: true } },
      },
    });
  }

  async updateGrantStatus(id: string, dto: UpdateGrantStatusDto, adminId: string) {
    const grant = await this.prisma.grantApplication.findUnique({
      where: { id },
      include: { account: true, user: true },
    });
    if (!grant) throw new NotFoundException('Grant application not found');

    if (dto.status === 'APPROVED') {
      const approvedAmt = dto.approvedAmount ? new Decimal(dto.approvedAmount.toString()) : grant.requestedAmount;
      await this.prisma.grantApplication.update({
        where: { id },
        data: {
          status: GrantStatus.APPROVED,
          approvedAmount: approvedAmt,
          reviewNotes: dto.reviewNotes || 'Approved by commercial underwriting',
        },
      });
      return { message: `Grant application #${grant.applicationRef} approved for ${grant.currencyCode} ${approvedAmt.toFixed(2)}` };
    }

    if (dto.status === 'REJECTED') {
      await this.prisma.grantApplication.update({
        where: { id },
        data: {
          status: GrantStatus.REJECTED,
          reviewNotes: dto.reviewNotes || 'Proposal does not meet underwriting criteria',
        },
      });
      return { message: `Grant application #${grant.applicationRef} rejected` };
    }

    if (dto.status === 'DISBURSED') {
      const amountToDisburse = grant.approvedAmount || grant.requestedAmount;
      const targetAccountId = grant.accountId;
      if (!targetAccountId) throw new BadRequestException('No bank account attached to grant');

      await this.prisma.$transaction(async (tx) => {
        await tx.bankAccount.update({
          where: { id: targetAccountId },
          data: {
            currentBalance: { increment: amountToDisburse },
            availableBalance: { increment: amountToDisburse },
            ledgerBalance: { increment: amountToDisburse },
          },
        });

        const transaction = await tx.transaction.create({
          data: {
            userId: grant.userId,
            destinationAccountId: targetAccountId,
            type: TransactionType.ADJUSTMENT_CREDIT,
            status: TransactionStatus.SUCCESS,
            amount: amountToDisburse,
            fee: new Decimal(0),
            netAmount: amountToDisburse,
            currencyCode: grant.currencyCode,
            reference: `GRNT-DSB-${Date.now().toString().slice(-6)}`,
            description: `Disbursement for ${grant.programName} (${grant.applicationRef})`,
          },
        });

        await tx.grantApplication.update({
          where: { id },
          data: {
            status: GrantStatus.DISBURSED,
            disbursedAt: new Date(),
            transactionId: transaction.id,
          },
        });

        await tx.notification.create({
          data: {
            userId: grant.userId,
            title: 'Grant Award Disbursed',
            message: `Your grant funds of ${grant.currencyCode} ${amountToDisburse.toFixed(2)} have been disbursed to your account.`,
            type: 'GRANT',
          },
        });
      });

      return { message: 'Grant funds disbursed and credited to account' };
    }

    return { message: 'Status updated' };
  }

  // ---------------------------------------------------------------------------
  // 8. TAX REFUNDS & FORM 1099-INT
  // ---------------------------------------------------------------------------
  async getTaxRefunds() {
    return this.prisma.transaction.findMany({
      where: {
        description: { contains: 'IRS Direct Deposit' },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, email: true, username: true, profile: true } },
        destinationAccount: { select: { id: true, accountNumber: true, accountName: true, currencyCode: true } },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 9. KYC & AML / SANCTIONS COMPLIANCE
  // ---------------------------------------------------------------------------
  async getKycProfiles(query?: {
    status?: string;
    tier?: string;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query?.status) where.status = query.status as KycStatus;
    if (query?.tier) where.tier = query.tier as KycTier;
    if (query?.search) {
      const s = query.search.trim();
      where.OR = [
        { user: { email: { contains: s } } },
        { user: { username: { contains: s } } },
        { user: { profile: { firstName: { contains: s } } } },
        { user: { profile: { lastName: { contains: s } } } },
        { reviewNotes: { contains: s } },
        { rejectionReason: { contains: s } },
      ];
    }

    const sortField = query?.sortBy || 'updatedAt';
    const sortDir = query?.sortOrder === 'asc' ? 'asc' : 'desc';

    const [total, submissions] = await Promise.all([
      this.prisma.kycProfile.count({ where }),
      this.prisma.kycProfile.findMany({
        where,
        take: limit,
        skip,
        orderBy: { [sortField]: sortDir },
        include: {
          user: { select: { id: true, email: true, username: true, profile: true } },
          documents: true,
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: submissions,
      submissions,
      profiles: submissions,
    };
  }

  async reviewKyc(id: string, dto: ReviewKycDto, adminId: string) {
    const profile = await this.prisma.kycProfile.findUnique({ where: { id } });
    if (!profile) throw new NotFoundException('KYC profile not found');

    const updated = await this.prisma.kycProfile.update({
      where: { id },
      data: {
        status: dto.status as KycStatus,
        ...(dto.tier && { tier: dto.tier as KycTier }),
        reviewedAt: new Date(),
        reviewNotes: dto.rejectionReason || 'Reviewed by compliance team',
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: `KYC_${dto.status}`,
        resource: 'KycProfile',
        resourceId: id,
        afterState: dto as any,
      },
    });

    return { message: `KYC submission marked as ${dto.status}`, profile: updated };
  }

  async screenAml(dto: AmlScreenDto) {
    const watchlists = [
      { name: 'Viktor Bout', category: 'OFAC SDN', country: 'RU', risk: 'CRITICAL', score: 0.98 },
      { name: 'Suleiman Kerimov', category: 'OFAC SDN', country: 'RU', risk: 'HIGH', score: 0.95 },
      { name: 'North Star Trading LLC', category: 'UN SANCTIONS', country: 'KP', risk: 'CRITICAL', score: 0.94 },
      { name: 'Pablo Escobar Gaviria', category: 'PEP / NARCOTICS', country: 'CO', risk: 'CRITICAL', score: 0.99 },
    ];

    const search = dto.name.toLowerCase().trim();
    const hits = watchlists.filter(w => {
      const matchScore = this.calcSimilarity(search, w.name.toLowerCase());
      return matchScore >= (dto.threshold || 0.65);
    });

    const isFlagged = hits.length > 0;
    return {
      query: dto.name,
      screenedAt: new Date().toISOString(),
      status: isFlagged ? 'FLAGGED_HIT' : 'CLEAR_PASSED',
      hits: hits.map(h => ({
        ...h,
        matchConfidence: `${(this.calcSimilarity(search, h.name.toLowerCase()) * 100).toFixed(1)}%`,
      })),
      recommendation: isFlagged ? 'REJECT_OR_FREEZE' : 'APPROVE_TRANSACTION',
    };
  }

  private calcSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (s1.includes(s2) || s2.includes(s1)) return 0.88;
    return 0.1;
  }

  async createSar(dto: CreateSarDto, adminId: string) {
    const ref = dto.referenceNumber || `SAR-${Date.now().toString().slice(-6)}`;
    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'FINCEN_SAR_FILED',
        resource: 'ComplianceSAR',
        resourceId: ref,
        afterState: dto as any,
      },
    });

    return {
      message: 'FinCEN Suspicious Activity Report (SAR) recorded and filed successfully',
      reference: ref,
      filedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // 10. CARDS & LOANS
  // ---------------------------------------------------------------------------
  async getCards() {
    return this.prisma.card.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, email: true, username: true, profile: true } },
        account: { select: { id: true, accountNumber: true, accountName: true, currencyCode: true } },
      },
    });
  }

  async issueCard(dto: IssueCardAdminDto, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('User not found');

    const account = await this.prisma.bankAccount.findUnique({ where: { id: dto.accountId } });
    if (!account) throw new NotFoundException('Account not found');

    const bin = dto.brand === 'VISA' ? '4111' : '5500';
    const last4 = Math.floor(1000 + Math.random() * 9000).toString();
    const maskedPan = `${bin} •••• •••• ${last4}`;
    const tokenRef = `tok_${Math.random().toString(36).substring(2, 15)}`;

    const card = await this.prisma.card.create({
      data: {
        userId: dto.userId,
        accountId: dto.accountId,
        cardType: dto.cardType as CardType,
        brand: dto.brand as CardBrand,
        cardHolderName: dto.cardHolderName.toUpperCase(),
        maskedPan,
        tokenReference: tokenRef,
        expiryMonth: (new Date().getMonth() + 1),
        expiryYear: (new Date().getFullYear() + 4),
        spendingLimitMonthly: new Decimal(dto.spendingLimitMonthly?.toString() || '5000.0000'),
        spendingLimitDaily: new Decimal(dto.spendingLimitDaily?.toString() || '1000.0000'),
        status: CardStatus.ACTIVE,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'CARD_ISSUED_BY_ADMIN',
        resource: 'Card',
        resourceId: card.id,
        afterState: { maskedPan, cardType: dto.cardType, userId: dto.userId },
      },
    });

    return { message: 'Card issued successfully', card };
  }

  async updateCardStatus(id: string, dto: UpdateCardStatusAdminDto, adminId: string) {
    const card = await this.prisma.card.findUnique({ where: { id } });
    if (!card) throw new NotFoundException('Card not found');

    const isFrozen = dto.status === 'FROZEN';
    const updated = await this.prisma.card.update({
      where: { id },
      data: {
        status: dto.status as CardStatus,
        isFrozen,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: `CARD_STATUS_${dto.status}`,
        resource: 'Card',
        resourceId: id,
      },
    });

    return { message: `Card status changed to ${dto.status}`, card: updated };
  }

  async approveCard(id: string, adminId: string) {
    const card = await this.prisma.card.findUnique({
      where: { id },
      include: { user: true, account: true },
    });
    if (!card) throw new NotFoundException('Card application not found');

    if (card.status !== CardStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`Card is currently ${card.status}, only PENDING_APPROVAL applications can be approved`);
    }

    const updated = await this.prisma.card.update({
      where: { id },
      data: {
        status: CardStatus.ACTIVE,
        approvedAt: new Date(),
        approvedBy: adminId,
        isFrozen: false,
      },
    });

    await this.prisma.notification.create({
      data: {
        userId: card.userId,
        title: '🎉 Card Approved & Activated',
        message: `Your ${card.brand} ${card.cardType.toLowerCase()} debit card ending in ${card.maskedPan.slice(-4)} has been approved by Card Operations and is now active!`,
        type: 'CARD',
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'CARD_APPLICATION_APPROVED',
        resource: 'Card',
        resourceId: id,
        afterState: { status: 'ACTIVE', approvedBy: adminId },
      },
    });

    return { message: 'Card application approved and activated successfully', card: updated };
  }

  async rejectCard(id: string, dto: RejectCardDto, adminId: string) {
    const card = await this.prisma.card.findUnique({
      where: { id },
      include: { user: true, account: true },
    });
    if (!card) throw new NotFoundException('Card application not found');

    if (card.status !== CardStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`Card is currently ${card.status}, only PENDING_APPROVAL applications can be rejected`);
    }

    const reason = dto.reason || 'Application did not satisfy compliance underwriting requirements';

    const updated = await this.prisma.card.update({
      where: { id },
      data: {
        status: CardStatus.REJECTED,
        rejectionReason: reason,
      },
    });

    await this.prisma.notification.create({
      data: {
        userId: card.userId,
        title: 'Card Application Declined',
        message: `Your ${card.brand} ${card.cardType.toLowerCase()} debit card application was declined: ${reason}`,
        type: 'CARD',
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'CARD_APPLICATION_REJECTED',
        resource: 'Card',
        resourceId: id,
        afterState: { status: 'REJECTED', reason },
      },
    });

    return { message: 'Card application rejected successfully', card: updated };
  }

  // ---------------------------------------------------------------------------
  // 10. CARDS MANAGEMENT
  // ---------------------------------------------------------------------------
  // (Cards methods above)

  // ---------------------------------------------------------------------------
  // 11. LOAN PRODUCTS LIFECYCLE
  // ---------------------------------------------------------------------------
  async createLoanProduct(dto: CreateLoanProductDto, adminId: string) {
    const product = await this.prisma.loanProduct.create({
      data: {
        name: dto.name,
        description: dto.description || null,
        minAmount: new Decimal(dto.minAmount.toString()),
        maxAmount: new Decimal(dto.maxAmount.toString()),
        interestRate: new Decimal(dto.interestRate.toString()),
        interestType: (dto.interestType as LoanInterestType) || LoanInterestType.REDUCING_BALANCE,
        minTenureMonths: dto.minTenureMonths,
        maxTenureMonths: dto.maxTenureMonths,
        processingFeePercentage: new Decimal(dto.processingFeePercentage?.toString() || '1.00'),
        latePenaltyPercentage: new Decimal(dto.latePenaltyPercentage?.toString() || '2.00'),
        isActive: dto.isActive !== undefined ? dto.isActive : true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'LOAN_PRODUCT_CREATED',
        resource: 'LoanProduct',
        resourceId: product.id,
        afterState: product as any,
      },
    });

    return { message: 'Loan product created successfully', product };
  }

  async getLoanProducts(query?: { isActive?: boolean }) {
    const where: any = {};
    if (query?.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const products = await this.prisma.loanProduct.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            applications: true,
            loans: true,
          },
        },
      },
    });

    return products;
  }

  async getLoanProductDetails(id: string) {
    const product = await this.prisma.loanProduct.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            applications: true,
            loans: true,
          },
        },
        loans: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { id: true, email: true, username: true } },
          },
        },
      },
    });

    if (!product) throw new NotFoundException('Loan product not found');
    return product;
  }

  async updateLoanProduct(id: string, dto: UpdateLoanProductDto, adminId: string) {
    const existing = await this.prisma.loanProduct.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Loan product not found');

    const updated = await this.prisma.loanProduct.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.minAmount !== undefined && { minAmount: new Decimal(dto.minAmount.toString()) }),
        ...(dto.maxAmount !== undefined && { maxAmount: new Decimal(dto.maxAmount.toString()) }),
        ...(dto.interestRate !== undefined && { interestRate: new Decimal(dto.interestRate.toString()) }),
        ...(dto.interestType && { interestType: dto.interestType as LoanInterestType }),
        ...(dto.minTenureMonths !== undefined && { minTenureMonths: dto.minTenureMonths }),
        ...(dto.maxTenureMonths !== undefined && { maxTenureMonths: dto.maxTenureMonths }),
        ...(dto.processingFeePercentage !== undefined && { processingFeePercentage: new Decimal(dto.processingFeePercentage.toString()) }),
        ...(dto.latePenaltyPercentage !== undefined && { latePenaltyPercentage: new Decimal(dto.latePenaltyPercentage.toString()) }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'LOAN_PRODUCT_UPDATED',
        resource: 'LoanProduct',
        resourceId: id,
        beforeState: existing as any,
        afterState: updated as any,
      },
    });

    return { message: 'Loan product updated successfully', product: updated };
  }

  async setLoanProductStatus(id: string, isActive: boolean, adminId: string) {
    const existing = await this.prisma.loanProduct.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Loan product not found');

    const updated = await this.prisma.loanProduct.update({
      where: { id },
      data: { isActive },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: isActive ? 'LOAN_PRODUCT_ENABLED' : 'LOAN_PRODUCT_DISABLED',
        resource: 'LoanProduct',
        resourceId: id,
      },
    });

    return { message: `Loan product ${isActive ? 'enabled' : 'disabled'} successfully`, product: updated };
  }

  // ---------------------------------------------------------------------------
  // 12. LOAN APPLICATIONS & UNDERWRITING
  // ---------------------------------------------------------------------------
  async getLoanApplications(query?: {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Number(query?.page) || 1;
    const limit = Number(query?.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query?.status) {
      where.status = query.status as LoanStatus;
    }

    if (query?.search) {
      const s = query.search.trim();
      where.OR = [
        { purpose: { contains: s, mode: 'insensitive' } },
        { user: { email: { contains: s, mode: 'insensitive' } } },
        { user: { username: { contains: s, mode: 'insensitive' } } },
        { user: { profile: { firstName: { contains: s, mode: 'insensitive' } } } },
        { user: { profile: { lastName: { contains: s, mode: 'insensitive' } } } },
      ];
    }

    const [total, applications] = await Promise.all([
      this.prisma.loanApplication.count({ where }),
      this.prisma.loanApplication.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              profile: true,
            },
          },
          product: true,
          account: {
            select: {
              id: true,
              accountNumber: true,
              accountName: true,
              currencyCode: true,
              currentBalance: true,
            },
          },
          disbursedLoan: true,
        },
      }),
    ]);

    return {
      applications,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getLoanApplicationDetails(id: string) {
    const application = await this.prisma.loanApplication.findUnique({
      where: { id },
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
        schedules: {
          orderBy: { installmentNumber: 'asc' },
        },
        disbursedLoan: {
          include: {
            repayments: true,
          },
        },
      },
    });

    if (!application) throw new NotFoundException('Loan application not found');
    return application;
  }

  async approveLoanApplication(id: string, dto: ReviewLoanDto, adminId: string) {
    const application = await this.prisma.loanApplication.findUnique({
      where: { id },
      include: { user: true, account: true },
    });
    if (!application) throw new NotFoundException('Loan application not found');

    if (application.status !== LoanStatus.SUBMITTED && application.status !== LoanStatus.UNDER_REVIEW) {
      throw new BadRequestException(`Cannot approve loan with status ${application.status}`);
    }

    const approvedAmount = dto.approvedAmount ? new Decimal(dto.approvedAmount.toString()) : application.principalAmount;

    const updated = await this.prisma.loanApplication.update({
      where: { id },
      data: {
        status: LoanStatus.APPROVED,
        principalAmount: approvedAmount,
        reviewedBy: adminId,
        reviewNotes: dto.reviewNotes || 'Approved by credit committee',
      },
    });

    await this.prisma.notification.create({
      data: {
        userId: application.userId,
        title: 'Loan Application Approved',
        message: `Your credit facility application of ${application.account.currencyCode} ${approvedAmount.toFixed(2)} has been APPROVED. Disbursement is queued.`,
        type: 'TRANSACTION',
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'LOAN_APPLICATION_APPROVED',
        resource: 'LoanApplication',
        resourceId: id,
        afterState: { status: LoanStatus.APPROVED, approvedAmount: approvedAmount.toString() },
      },
    });

    return { message: 'Loan application approved successfully', application: updated };
  }

  async rejectLoanApplication(id: string, dto: ReviewLoanDto, adminId: string) {
    const application = await this.prisma.loanApplication.findUnique({
      where: { id },
      include: { user: true, account: true },
    });
    if (!application) throw new NotFoundException('Loan application not found');

    if (application.status === LoanStatus.ACTIVE || application.status === LoanStatus.DISBURSED) {
      throw new BadRequestException(`Cannot reject already disbursed loan`);
    }

    const updated = await this.prisma.loanApplication.update({
      where: { id },
      data: {
        status: LoanStatus.REJECTED,
        reviewedBy: adminId,
        reviewNotes: dto.reviewNotes || 'Does not satisfy underwriting risk threshold',
      },
    });

    await this.prisma.notification.create({
      data: {
        userId: application.userId,
        title: 'Loan Application Update',
        message: `Your loan application for ${application.account.currencyCode} ${application.principalAmount.toFixed(2)} could not be approved at this time. Notes: ${dto.reviewNotes || 'Underwriting criteria not met.'}`,
        type: 'TRANSACTION',
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'LOAN_APPLICATION_REJECTED',
        resource: 'LoanApplication',
        resourceId: id,
        afterState: { status: LoanStatus.REJECTED, notes: dto.reviewNotes },
      },
    });

    return { message: 'Loan application rejected', application: updated };
  }

  async disburseLoan(applicationId: string, dto: DisburseLoanDto, adminId: string) {
    const app = await this.prisma.loanApplication.findUnique({
      where: { id: applicationId },
      include: { product: true, account: true, user: true },
    });

    if (!app) throw new NotFoundException('Loan application not found');
    if (app.status === LoanStatus.ACTIVE || app.status === LoanStatus.DISBURSED) {
      throw new BadRequestException('Loan application has already been disbursed');
    }

    const principal = dto.approvedAmount ? new Decimal(dto.approvedAmount.toString()) : app.principalAmount;
    const interestRate = dto.interestRate ? new Decimal(dto.interestRate.toString()) : app.interestRate;
    const tenureMonths = app.tenureMonths || 12;

    // Calculate total interest and installment
    const totalInterest = principal.mul(interestRate.div(100)).mul(tenureMonths).div(12);
    const totalRepayable = principal.plus(totalInterest);
    const monthlyInstallment = totalRepayable.div(tenureMonths);

    const loanReference = `LN-${Date.now().toString().slice(-8)}`;
    const currency = app.account.currencyCode;

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Update Application status
      await tx.loanApplication.update({
        where: { id: applicationId },
        data: {
          status: LoanStatus.ACTIVE,
          principalAmount: principal,
          interestRate,
          interestAmount: totalInterest,
          totalRepayable,
          outstandingBalance: totalRepayable,
          monthlyInstallment,
          disbursedAt: new Date(),
          reviewedBy: adminId,
          reviewNotes: dto.notes || app.reviewNotes || 'Disbursed by credit operations',
        },
      });

      // 2. Create Active Loan Entity
      const loan = await tx.loan.create({
        data: {
          userId: app.userId,
          applicationId: app.id,
          productId: app.productId,
          accountId: app.accountId,
          loanReference,
          principalAmount: principal,
          interestAmount: totalInterest,
          totalRepayable,
          amountPaid: new Decimal('0.0000'),
          outstandingBalance: totalRepayable,
          interestRate,
          tenureMonths,
          startDate: new Date(),
          nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          status: LoanStatus.ACTIVE,
        },
      });

      // 3. Generate Loan Schedules (Installments)
      const schedulesData: any[] = [];
      const principalPerMonth = principal.div(tenureMonths);
      const interestPerMonth = totalInterest.div(tenureMonths);

      for (let i = 1; i <= tenureMonths; i++) {
        const dueDate = new Date();
        dueDate.setMonth(dueDate.getMonth() + i);

        schedulesData.push({
          loanId: app.id,
          installmentNumber: i,
          dueDate,
          principalDue: principalPerMonth,
          interestDue: interestPerMonth,
          feeDue: new Decimal('0.0000'),
          totalDue: monthlyInstallment,
          amountPaid: new Decimal('0.0000'),
          status: LoanScheduleStatus.PENDING,
        });
      }

      await tx.loanSchedule.createMany({
        data: schedulesData,
      });

      // 4. Credit customer bank account with loan principal
      await tx.bankAccount.update({
        where: { id: app.accountId },
        data: {
          currentBalance: { increment: principal },
          availableBalance: { increment: principal },
          ledgerBalance: { increment: principal },
        },
      });

      // 5. Create Transaction Record
      const txRecord = await tx.transaction.create({
        data: {
          userId: app.userId,
          destinationAccountId: app.accountId,
          type: TransactionType.LOAN_DISBURSEMENT,
          status: TransactionStatus.SUCCESS,
          amount: principal,
          fee: new Decimal('0.0000'),
          netAmount: principal,
          currencyCode: currency,
          reference: loanReference,
          description: `Credit Facility Disbursement - ${app.product.name} (#${loanReference})`,
          metadata: {
            loanId: loan.id,
            applicationId: app.id,
            tenureMonths,
            totalRepayable: totalRepayable.toString(),
            monthlyInstallment: monthlyInstallment.toString(),
            disbursedBy: adminId,
          },
        },
      });

      // 6. Notify Customer
      await tx.notification.create({
        data: {
          userId: app.userId,
          title: 'Loan Disbursed & Funds Credited',
          message: `Your loan ${loanReference} of ${currency} ${principal.toFixed(2)} has been disbursed to account #${app.account.accountNumber}. Monthly installment: ${currency} ${monthlyInstallment.toFixed(2)}.`,
          type: 'TRANSACTION',
        },
      });

      // 7. Audit Log
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'LOAN_DISBURSED',
          resource: 'Loan',
          resourceId: loan.id,
          afterState: {
            loanReference,
            principal: principal.toString(),
            totalRepayable: totalRepayable.toString(),
            accountId: app.accountId,
          },
        },
      });

      return { loan, transaction: txRecord };
    });

    return {
      message: `Loan successfully disbursed and ${currency} ${principal.toFixed(2)} credited to customer account`,
      ...result,
    };
  }

  // ---------------------------------------------------------------------------
  // 13. ACTIVE LOANS & OVERDUE RECOVERY
  // ---------------------------------------------------------------------------
  async getActiveLoans(query?: { search?: string; page?: number; limit?: number }) {
    const page = Number(query?.page) || 1;
    const limit = Number(query?.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      status: LoanStatus.ACTIVE,
    };

    if (query?.search) {
      const s = query.search.trim();
      where.OR = [
        { loanReference: { contains: s, mode: 'insensitive' } },
        { user: { email: { contains: s, mode: 'insensitive' } } },
        { user: { username: { contains: s, mode: 'insensitive' } } },
        { user: { profile: { firstName: { contains: s, mode: 'insensitive' } } } },
        { user: { profile: { lastName: { contains: s, mode: 'insensitive' } } } },
      ];
    }

    const [total, loans] = await Promise.all([
      this.prisma.loan.count({ where }),
      this.prisma.loan.findMany({
        where,
        skip,
        take: limit,
        orderBy: { nextDueDate: 'asc' },
        include: {
          user: { select: { id: true, email: true, username: true, profile: true } },
          product: true,
          account: { select: { id: true, accountNumber: true, accountName: true, currencyCode: true } },
          repayments: {
            take: 5,
            orderBy: { paidAt: 'desc' },
          },
        },
      }),
    ]);

    return {
      loans,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getOverdueLoans(query?: { page?: number; limit?: number }) {
    const page = Number(query?.page) || 1;
    const limit = Number(query?.limit) || 20;
    const skip = (page - 1) * limit;
    const now = new Date();

    const overdueSchedules = await this.prisma.loanSchedule.findMany({
      where: {
        dueDate: { lt: now },
        status: { in: [LoanScheduleStatus.PENDING, LoanScheduleStatus.PARTIAL] },
      },
      include: {
        loan: {
          include: {
            user: { select: { id: true, email: true, username: true, profile: true } },
            product: true,
            account: true,
            disbursedLoan: true,
          },
        },
      },
      orderBy: { dueDate: 'asc' },
      skip,
      take: limit,
    });

    const total = await this.prisma.loanSchedule.count({
      where: {
        dueDate: { lt: now },
        status: { in: [LoanScheduleStatus.PENDING, LoanScheduleStatus.PARTIAL] },
      },
    });

    const results = overdueSchedules.map((s) => {
      const daysOverdue = Math.floor((now.getTime() - new Date(s.dueDate).getTime()) / (1000 * 60 * 60 * 24));
      const penaltyRate = s.loan.product.latePenaltyPercentage || new Decimal('2.00');
      const unpaidPrincipal = new Decimal(s.principalDue.toString()).minus(new Decimal(s.amountPaid.toString()));
      const calculatedPenalty = unpaidPrincipal.gt(0) ? unpaidPrincipal.mul(penaltyRate.div(100)) : new Decimal('0.0000');

      return {
        scheduleId: s.id,
        installmentNumber: s.installmentNumber,
        dueDate: s.dueDate,
        daysOverdue,
        principalDue: s.principalDue,
        interestDue: s.interestDue,
        totalDue: s.totalDue,
        amountPaid: s.amountPaid,
        outstandingInstallment: new Decimal(s.totalDue.toString()).minus(new Decimal(s.amountPaid.toString())),
        latePenaltyRate: `${penaltyRate}%`,
        suggestedPenalty: calculatedPenalty.toFixed(2),
        borrower: s.loan.user,
        account: s.loan.account,
        loanReference: s.loan.disbursedLoan?.loanReference || s.loan.id,
        loanId: s.loan.disbursedLoan?.id || s.loan.id,
      };
    });

    return {
      overdueLoans: results,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async applyLoanPenalty(loanId: string, dto: ApplyLoanPenaltyDto, adminId: string) {
    const loan = await this.prisma.loan.findFirst({
      where: { OR: [{ id: loanId }, { loanReference: loanId }] },
      include: { product: true, account: true, user: true },
    });

    if (!loan) throw new NotFoundException('Loan not found');

    const penaltyAmount = dto.penaltyAmount
      ? new Decimal(dto.penaltyAmount.toString())
      : loan.outstandingBalance.mul(loan.product.latePenaltyPercentage.div(100));

    await this.prisma.$transaction(async (tx) => {
      // 1. Increase loan outstanding balance
      await tx.loan.update({
        where: { id: loan.id },
        data: {
          outstandingBalance: { increment: penaltyAmount },
          totalRepayable: { increment: penaltyAmount },
        },
      });

      // 2. Increase application balance
      await tx.loanApplication.update({
        where: { id: loan.applicationId },
        data: {
          outstandingBalance: { increment: penaltyAmount },
          totalRepayable: { increment: penaltyAmount },
        },
      });

      // 3. User Notification
      await tx.notification.create({
        data: {
          userId: loan.userId,
          title: 'Late Payment Penalty Notice',
          message: `A late payment penalty fee of ${loan.account.currencyCode} ${penaltyAmount.toFixed(2)} has been assessed on loan #${loan.loanReference}. Reason: ${dto.reason || 'Overdue installment default'}.`,
          type: 'TRANSACTION',
        },
      });

      // 4. Audit Log
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'LOAN_PENALTY_APPLIED',
          resource: 'Loan',
          resourceId: loan.id,
          afterState: { penaltyAmount: penaltyAmount.toString(), reason: dto.reason },
        },
      });
    });

    return {
      message: `Late penalty of ${loan.account.currencyCode} ${penaltyAmount.toFixed(2)} applied successfully to loan #${loan.loanReference}`,
      penaltyAmount: penaltyAmount.toFixed(2),
    };
  }

  async getLoanRepayments(loanId: string) {
    const loan = await this.prisma.loan.findFirst({
      where: { OR: [{ id: loanId }, { loanReference: loanId }] },
      include: {
        product: true,
        account: true,
        user: { select: { id: true, email: true, username: true, profile: true } },
        repayments: {
          orderBy: { paidAt: 'desc' },
        },
        application: {
          include: {
            schedules: {
              orderBy: { installmentNumber: 'asc' },
            },
          },
        },
      },
    });

    if (!loan) throw new NotFoundException('Loan not found');
    return loan;
  }

  // ---------------------------------------------------------------------------
  // 14. STAFF & RBAC (ROLE-BASED ACCESS CONTROL)
  // ---------------------------------------------------------------------------
  async getRbacRoles() {
    const roles = await this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
        _count: {
          select: {
            users: true,
          },
        },
      },
    });

    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      userCount: r._count.users,
      permissions: r.permissions.map((p) => p.permission.slug),
      createdAt: r.createdAt,
    }));
  }

  async getRbacPermissions() {
    const permissions = await this.prisma.permission.findMany({
      orderBy: [{ groupName: 'asc' }, { slug: 'asc' }],
    });

    // Group by groupName
    const grouped: Record<string, any[]> = {};
    for (const p of permissions) {
      if (!grouped[p.groupName]) {
        grouped[p.groupName] = [];
      }
      grouped[p.groupName].push(p);
    }

    return {
      total: permissions.length,
      permissions,
      grouped,
    };
  }

  async createRbacRole(dto: CreateRoleDto, adminId: string) {
    const roleName = dto.name.toUpperCase().replace(/\s+/g, '_');
    const existing = await this.prisma.role.findUnique({ where: { name: roleName } });
    if (existing) {
      throw new ConflictException(`Role '${roleName}' already exists`);
    }

    const role = await this.prisma.$transaction(async (tx) => {
      const createdRole = await tx.role.create({
        data: {
          name: roleName,
          description: dto.description || null,
          isSystem: false,
        },
      });

      if (dto.permissions && dto.permissions.length > 0) {
        const perms = await tx.permission.findMany({
          where: { slug: { in: dto.permissions } },
        });

        if (perms.length > 0) {
          await tx.rolePermission.createMany({
            data: perms.map((p) => ({
              roleId: createdRole.id,
              permissionId: p.id,
            })),
          });
        }
      }

      return createdRole;
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'RBAC_ROLE_CREATED',
        resource: 'Role',
        resourceId: role.id,
        afterState: { name: roleName, permissions: dto.permissions },
      },
    });

    return { message: `Role '${roleName}' created successfully`, role };
  }

  async updateRbacRolePermissions(roleId: string, dto: UpdateRolePermissionsDto, adminId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');

    await this.prisma.$transaction(async (tx) => {
      // Clear existing role permissions
      await tx.rolePermission.deleteMany({ where: { roleId } });

      // Find permission IDs for slugs
      if (dto.permissions && dto.permissions.length > 0) {
        const perms = await tx.permission.findMany({
          where: { slug: { in: dto.permissions } },
        });

        if (perms.length > 0) {
          await tx.rolePermission.createMany({
            data: perms.map((p) => ({
              roleId,
              permissionId: p.id,
            })),
          });
        }
      }

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'RBAC_ROLE_PERMISSIONS_UPDATED',
          resource: 'Role',
          resourceId: roleId,
          afterState: { role: role.name, permissions: dto.permissions },
        },
      });
    });

    return { message: `Permissions updated successfully for role '${role.name}'` };
  }

  async getStaffMembers() {
    const staff = await this.prisma.user.findMany({
      where: {
        roles: {
          some: {
            role: {
              name: {
                not: 'CUSTOMER',
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        profile: true,
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return staff.map((u) => ({
      id: u.id,
      email: u.email,
      username: u.username,
      firstName: u.profile?.firstName || '',
      lastName: u.profile?.lastName || '',
      status: u.status,
      isEmailVerified: u.isEmailVerified,
      createdAt: u.createdAt,
      avatarUrl: u.profile?.avatarUrl,
      roles: u.roles.map((r) => r.role.name),
      permissions: Array.from(
        new Set(u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.slug))),
      ),
    }));
  }

  async createStaffUser(dto: CreateStaffUserDto, adminId: string) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email.toLowerCase() }, { username: dto.username.toLowerCase() }] },
    });
    if (existing) {
      throw new ConflictException('User with this email or username already exists');
    }

    const passwordHash = await CryptoUtil.hash(dto.password);
    const referralCode = `STF-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email.toLowerCase(),
          username: dto.username.toLowerCase(),
          passwordHash,
          phone: dto.phone || null,
          referralCode,
          status: UserStatus.ACTIVE,
          isEmailVerified: true,
          profile: {
            create: {
              firstName: dto.firstName,
              lastName: dto.lastName,
            },
          },
        },
      });

      // Assign roles
      for (const roleName of dto.roles) {
        let role = await tx.role.findUnique({ where: { name: roleName.toUpperCase() } });
        if (!role) {
          role = await tx.role.create({
            data: {
              name: roleName.toUpperCase(),
              description: `Custom ${roleName} role`,
              isSystem: false,
            },
          });
        }

        await tx.userRole.create({
          data: {
            userId: newUser.id,
            roleId: role.id,
          },
        });
      }

      return newUser;
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'STAFF_USER_CREATED',
        resource: 'User',
        resourceId: user.id,
        afterState: { email: user.email, username: user.username, roles: dto.roles },
      },
    });

    return { message: 'Staff user created successfully', user: { id: user.id, email: user.email, username: user.username } };
  }

  async assignStaffRoles(userId: string, dto: AssignUserRolesDto, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId } });

      for (const roleName of dto.roles) {
        let role = await tx.role.findUnique({ where: { name: roleName.toUpperCase() } });
        if (!role) {
          role = await tx.role.create({
            data: {
              name: roleName.toUpperCase(),
              description: `Custom ${roleName} role`,
              isSystem: false,
            },
          });
        }

        await tx.userRole.create({
          data: {
            userId,
            roleId: role.id,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'STAFF_ROLES_ASSIGNED',
          resource: 'UserRole',
          resourceId: userId,
          afterState: { roles: dto.roles },
        },
      });
    });

    return { message: `Roles updated successfully for user ${user.username}` };
  }

  // ---------------------------------------------------------------------------
  // 11. SUPPORT TICKETS
  // ---------------------------------------------------------------------------
  async getSupportTickets(query?: {
    status?: string;
    priority?: string;
    category?: string;
    assignedTo?: string;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query?.status) where.status = query.status as SupportTicketStatus;
    if (query?.priority) where.priority = query.priority as any;
    if (query?.category) where.category = query.category.toUpperCase();
    if (query?.assignedTo) where.assignedTo = query.assignedTo;

    if (query?.search) {
      const s = query.search.trim();
      where.OR = [
        { ticketNumber: { contains: s } },
        { subject: { contains: s } },
        { user: { email: { contains: s } } },
        { user: { username: { contains: s } } },
      ];
    }

    const sortField = query?.sortBy || 'updatedAt';
    const sortDir = query?.sortOrder === 'asc' ? 'asc' : 'desc';

    const [total, tickets] = await Promise.all([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        take: limit,
        skip,
        orderBy: { [sortField]: sortDir },
        include: {
          user: { select: { id: true, email: true, username: true, profile: true } },
          messages: {
            take: 10,
            orderBy: { createdAt: 'desc' },
            include: { sender: { select: { id: true, username: true, email: true } } },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: tickets,
      tickets,
    };
  }

  async replySupportTicket(ticketId: string, dto: ReplyTicketDto, adminId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const result = await this.prisma.$transaction(async (tx) => {
      const msg = await tx.supportMessage.create({
        data: {
          ticketId,
          senderId: adminId,
          message: dto.message,
          isStaff: true,
        },
      });

      await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: (dto.status as SupportTicketStatus) || SupportTicketStatus.IN_PROGRESS,
          updatedAt: new Date(),
        },
      });

      return msg;
    });

    return { message: 'Staff reply transmitted to customer', reply: result };
  }

  // ---------------------------------------------------------------------------
  // 12. MASTER SYSTEM SETTINGS & PARAMETERS
  // ---------------------------------------------------------------------------
  async getSystemSettings() {
    return this.prisma.systemSetting.findMany({
      orderBy: { key: 'asc' },
    });
  }

  async updateSystemSetting(adminId: string, key: string, dto: UpdateSystemSettingDto) {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (!setting) {
      return this.prisma.systemSetting.create({
        data: {
          key,
          value: dto.value,
          description: dto.description || '',
        },
      });
    }

    const updated = await this.prisma.systemSetting.update({
      where: { key },
      data: {
        value: dto.value,
        ...(dto.description && { description: dto.description }),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'SYSTEM_SETTING_UPDATED',
        resource: 'SystemSetting',
        resourceId: key,
        beforeState: { value: setting.value },
        afterState: { value: dto.value },
      },
    });

    return updated;
  }

  async batchUpdateSettings(adminId: string, dto: BatchUpdateSettingsDto) {
    const updates = Object.entries(dto.settings).map(([key, value]) =>
      this.prisma.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      }),
    );

    await Promise.all(updates);

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'SYSTEM_SETTINGS_BATCH_UPDATED',
        resource: 'SystemSetting',
        afterState: dto.settings,
      },
    });

    return { message: 'Settings updated successfully' };
  }

  async updateMasterSettings(adminId: string, dto: UpdateMasterSettingsDto) {
    return this.batchUpdateSettings(adminId, { settings: dto.settings });
  }
}
