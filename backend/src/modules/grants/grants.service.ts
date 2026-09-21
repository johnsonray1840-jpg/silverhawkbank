import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EmailService } from '../email/email.service';
import { ApplyGrantDto, ReviewGrantDto, DisburseGrantDto } from './dto/apply-grant.dto';
import { GrantStatus, TransactionType, TransactionStatus, LedgerEntryType } from '@prisma/client';
import { CryptoUtil } from '../../common/utils/crypto.util';
import Decimal from 'decimal.js';

export interface GrantProgram {
  id: string;
  name: string;
  category: string;
  minAmount: number;
  maxAmount: number;
  description: string;
  benefits: string[];
  eligibleTypes: string[];
  icon: string;
  badgeColor: string;
}

@Injectable()
export class GrantsService {
  private readonly logger = new Logger(GrantsService.name);

  private readonly programs: GrantProgram[] = [
    {
      id: 'small-business',
      name: 'Small Business Startup & Expansion Grant',
      category: 'Commercial Enterprise',
      minAmount: 5000,
      maxAmount: 50000,
      description: 'Seed funding and working capital for early-stage and expanding small enterprises with strong job-creation potential.',
      benefits: [
        'Non-dilutive grant capital ($5k - $50k)',
        'Zero collateral requirement',
        'Direct disbursement to primary checking account',
        'Complimentary enterprise advisory & mentoring',
      ],
      eligibleTypes: ['LLC', 'Corporation', 'Sole Proprietorship', 'Partnership'],
      icon: 'fa-store',
      badgeColor: 'blue',
    },
    {
      id: 'community-dev',
      name: 'Enterprise & Community Development Grant',
      category: 'Community Impact',
      minAmount: 10000,
      maxAmount: 100000,
      description: 'Capital deployment for businesses and non-profits executing high-impact civic, infrastructure, or community projects.',
      benefits: [
        'Up to $100,000 non-repayable grant',
        'Tailored milestone funding schedule',
        'ESG impact certification and recognition',
        'Quarterly growth check-ins',
      ],
      eligibleTypes: ['Non-Profit', 'NGO', 'LLC', 'Corporation'],
      icon: 'fa-users',
      badgeColor: 'amber',
    },
    {
      id: 'cleantech-innov',
      name: 'Clean Tech, Green Energy & Innovation Grant',
      category: 'Innovation & Tech',
      minAmount: 20000,
      maxAmount: 150000,
      description: 'Direct financing for green sustainability, renewable technology, and advanced digital transformation projects.',
      benefits: [
        'Substantial funding up to $150,000',
        'Fast-track technical compliance review',
        'Tax incentive and sustainability report guidance',
        'Zero repayment obligation',
      ],
      eligibleTypes: ['Tech Startup', 'LLC', 'Corporation'],
      icon: 'fa-bolt',
      badgeColor: 'emerald',
    },
    {
      id: 'global-trade',
      name: 'Global Commerce & Export Expansion Grant',
      category: 'International Trade',
      minAmount: 15000,
      maxAmount: 75000,
      description: 'Trade assistance and supply-chain logistics subsidy for enterprises expanding cross-border commerce operations.',
      benefits: [
        'Up to $75,000 in trade expansion capital',
        'Multi-currency treasury support',
        'FX hedging and cross-border settlement guidance',
        'Priority banking relationship manager',
      ],
      eligibleTypes: ['Export / Import LLC', 'Corporation', 'Partnership'],
      icon: 'fa-globe',
      badgeColor: 'indigo',
    },
    {
      id: 'education-tech',
      name: 'Education & Workforce Upskilling Grant',
      category: 'Human Capital',
      minAmount: 5000,
      maxAmount: 25000,
      description: 'Institutional sponsorship for professional development, technical certifications, and workplace capacity building.',
      benefits: [
        'Direct sponsorship up to $25,000',
        'Accredited institutional partner network',
        'Immediate disbursement upon verification',
      ],
      eligibleTypes: ['Individual', 'Educational Org', 'Small Business'],
      icon: 'fa-graduation-cap',
      badgeColor: 'purple',
    },
    {
      id: 'emergency-relief',
      name: 'Commercial Hardship & Emergency Relief Aid',
      category: 'Emergency Assistance',
      minAmount: 1000,
      maxAmount: 15000,
      description: 'Rapid-response liquidity grant for qualified accounts navigating unexpected operational or macroeconomic disruptions.',
      benefits: [
        'Rapid 24-48h expedited review & payout',
        'Up to $15,000 immediate working relief',
        'Zero interest and zero fees',
      ],
      eligibleTypes: ['All Registered Accounts'],
      icon: 'fa-heart',
      badgeColor: 'rose',
    },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Get all active grant programs
   */
  getPrograms(): GrantProgram[] {
    return this.programs;
  }

  /**
   * Submit a new grant application
   */
  async applyForGrant(userId: string, dto: ApplyGrantDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    // Verify PIN if required and user has a PIN configured
    if (user.pinHash) {
      if (!dto.pin) {
        throw new BadRequestException('Account transaction PIN is required to authorize application');
      }
      const isPinValid = await CryptoUtil.verify(user.pinHash, dto.pin);
      if (!isPinValid) {
        throw new BadRequestException('Invalid transaction PIN. Please try again.');
      }
    }

    // Validate program
    const program = this.programs.find((p) => p.id === dto.programId);
    if (!program) {
      throw new BadRequestException(`Grant program '${dto.programId}' not recognized`);
    }

    // Validate account
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: dto.accountId, userId: user.id },
    });

    if (!account) {
      throw new BadRequestException('Selected bank account is invalid or does not belong to your profile');
    }

    if (account.status !== 'ACTIVE' || account.isFrozen) {
      throw new BadRequestException('Selected bank account is not active or is temporarily frozen');
    }

    const requestedAmountDecimal = new Decimal(dto.requestedAmount);
    if (requestedAmountDecimal.lessThan(program.minAmount)) {
      throw new BadRequestException(`Requested amount cannot be less than ${account.currencyCode} ${program.minAmount.toLocaleString()}`);
    }
    if (requestedAmountDecimal.greaterThan(program.maxAmount)) {
      throw new BadRequestException(`Requested amount cannot exceed ${account.currencyCode} ${program.maxAmount.toLocaleString()} for this program`);
    }

    const applicationRef = `GRNT-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Date.now().toString().slice(-4)}`;

    const application = await this.prisma.grantApplication.create({
      data: {
        applicationRef,
        userId: user.id,
        accountId: account.id,
        programId: program.id,
        programName: program.name,
        businessName: dto.businessName.trim(),
        businessType: dto.businessType.trim(),
        registrationNum: dto.registrationNum.trim(),
        taxId: dto.taxId ? dto.taxId.trim() : undefined,
        annualTurnover: dto.annualTurnover ? new Decimal(dto.annualTurnover).toFixed(4) : undefined,
        employeeCount: dto.employeeCount || undefined,
        requestedAmount: requestedAmountDecimal.toFixed(4),
        currencyCode: account.currencyCode,
        proposalTitle: dto.proposalTitle.trim(),
        proposalDetails: dto.proposalDetails.trim(),
        milestones: dto.milestones || undefined,
        status: GrantStatus.UNDER_REVIEW,
      },
      include: {
        account: {
          select: {
            id: true,
            accountNumber: true,
            accountName: true,
            currencyCode: true,
          },
        },
      },
    });

    // Create system notification
    await this.prisma.notification.create({
      data: {
        userId: user.id,
        title: 'Grant Application Received',
        message: `Your grant proposal for "${program.name}" (Ref: ${applicationRef}) of ${account.currencyCode} ${requestedAmountDecimal.toLocaleString()} has been submitted for underwriting review.`,
        type: 'SYSTEM',
      },
    });

    this.logger.log(`Grant application submitted: ${applicationRef} by user ${user.id} for ${requestedAmountDecimal.toFixed(2)} ${account.currencyCode}`);

    return {
      success: true,
      message: 'Grant application submitted successfully and is currently under underwriting review.',
      application,
    };
  }

  /**
   * Get all grant applications submitted by user
   */
  async getUserApplications(userId: string) {
    const applications = await this.prisma.grantApplication.findMany({
      where: { userId },
      include: {
        account: {
          select: {
            id: true,
            accountNumber: true,
            accountName: true,
            currencyCode: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return applications;
  }

  /**
   * Get single application by ID
   */
  async getApplicationById(userId: string, id: string) {
    const application = await this.prisma.grantApplication.findFirst({
      where: { id, userId },
      include: {
        account: {
          select: {
            id: true,
            accountNumber: true,
            accountName: true,
            currencyCode: true,
          },
        },
      },
    });

    if (!application) {
      throw new NotFoundException('Grant application not found');
    }

    return application;
  }

  /**
   * Admin: List all applications
   */
  async adminListApplications(query: { status?: GrantStatus; programId?: string }) {
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.programId) where.programId = query.programId;

    return this.prisma.grantApplication.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            profile: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        account: {
          select: {
            id: true,
            accountNumber: true,
            accountName: true,
            currencyCode: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Admin: Review and Approve/Reject Grant Application
   */
  async adminReviewApplication(adminId: string, id: string, dto: ReviewGrantDto) {
    const application = await this.prisma.grantApplication.findUnique({
      where: { id },
      include: { user: { include: { profile: true } }, account: true },
    });

    if (!application) {
      throw new NotFoundException('Grant application not found');
    }

    const approvedAmount = dto.approvedAmount
      ? new Decimal(dto.approvedAmount).toFixed(4)
      : application.requestedAmount.toString();

    const updated = await this.prisma.grantApplication.update({
      where: { id },
      data: {
        status: dto.status,
        approvedAmount: dto.status === GrantStatus.APPROVED ? approvedAmount : undefined,
        reviewNotes: dto.reviewNotes,
      },
      include: { account: true },
    });

    // Notify applicant
    const statusText = dto.status === GrantStatus.APPROVED ? 'APPROVED' : dto.status === GrantStatus.REJECTED ? 'DECLINED' : 'UPDATED';
    await this.prisma.notification.create({
      data: {
        userId: application.userId,
        title: `Grant Application ${statusText}`,
        message: `Your application for "${application.programName}" (Ref: ${application.applicationRef}) is now ${statusText}.${dto.reviewNotes ? ` Note: ${dto.reviewNotes}` : ''}`,
        type: 'SYSTEM',
      },
    });

    return {
      success: true,
      message: `Grant application updated to ${dto.status}`,
      application: updated,
    };
  }

  /**
   * Disburse Grant funds atomically to the user's primary bank account
   */
  async disburseGrant(userId: string, id: string, dto?: DisburseGrantDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const application = await this.prisma.grantApplication.findFirst({
      where: { id, userId },
      include: { account: true },
    });

    if (!application) {
      throw new NotFoundException('Grant application not found');
    }

    if (application.status === GrantStatus.DISBURSED) {
      throw new BadRequestException('This grant has already been disbursed');
    }

    if (application.status === GrantStatus.REJECTED) {
      throw new BadRequestException('Cannot disburse funds for a declined grant application');
    }

    // Verify PIN if provided or if user has PIN
    if (user.pinHash && dto?.pin) {
      const isPinValid = await CryptoUtil.verify(user.pinHash, dto.pin);
      if (!isPinValid) {
        throw new BadRequestException('Invalid security PIN');
      }
    }

    // Resolve disbursement account
    const targetAccountId = dto?.accountId || application.accountId;
    let bankAccount = targetAccountId
      ? await this.prisma.bankAccount.findFirst({
          where: { id: targetAccountId, userId },
        })
      : null;

    if (!bankAccount) {
      // Fallback to first active account
      bankAccount = await this.prisma.bankAccount.findFirst({
        where: { userId, status: 'ACTIVE' },
      });
    }

    if (!bankAccount || bankAccount.status !== 'ACTIVE' || bankAccount.isFrozen) {
      throw new BadRequestException('No eligible, active bank account found for disbursement credit');
    }

    const awardAmount = application.approvedAmount
      ? new Decimal(application.approvedAmount.toString())
      : new Decimal(application.requestedAmount.toString());

    const txRef = CryptoUtil.generateTransactionReference('GRNT-DSB');

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Credit recipient bank account
      const updatedAccount = await tx.bankAccount.update({
        where: { id: bankAccount.id },
        data: {
          currentBalance: { increment: awardAmount.toFixed(4) },
          availableBalance: { increment: awardAmount.toFixed(4) },
          ledgerBalance: { increment: awardAmount.toFixed(4) },
        },
      });

      // 2. Create Transaction Record
      const transaction = await tx.transaction.create({
        data: {
          reference: txRef,
          userId: user.id,
          destinationAccountId: bankAccount.id,
          type: TransactionType.DEPOSIT,
          amount: awardAmount.toFixed(4),
          fee: '0.0000',
          netAmount: awardAmount.toFixed(4),
          currencyCode: bankAccount.currencyCode,
          status: TransactionStatus.SUCCESS,
          description: `Grant Disbursement: ${application.programName} (${application.applicationRef})`,
          metadata: {
            grantId: application.id,
            applicationRef: application.applicationRef,
            programName: application.programName,
            businessName: application.businessName,
            disbursedAmount: awardAmount.toFixed(4),
            currencyCode: bankAccount.currencyCode,
          },
        },
      });

      // 3. Update Grant Application status to DISBURSED
      const updatedGrant = await tx.grantApplication.update({
        where: { id: application.id },
        data: {
          status: GrantStatus.DISBURSED,
          approvedAmount: awardAmount.toFixed(4),
          disbursedAt: new Date(),
          transactionId: transaction.id,
          accountId: bankAccount.id,
        },
      });

      // 4. Double-entry General Ledger record:
      // Debit: 5040 (Grants & Subsidies Program Outflow)
      // Credit: 2010-<acc> (Customer Current Liability)
      const currentAccLedgerCode = `2010-${bankAccount.accountNumber}`;
      const journalEntries = [
        {
          accountCode: '5040', // Grant Program Subsidies Expense / Equity
          entryType: LedgerEntryType.DEBIT,
          amount: awardAmount.toFixed(4),
          currencyCode: bankAccount.currencyCode,
        },
        {
          accountCode: currentAccLedgerCode,
          entryType: LedgerEntryType.CREDIT,
          amount: awardAmount.toFixed(4),
          currencyCode: bankAccount.currencyCode,
        },
      ];

      return {
        grant: updatedGrant,
        transaction,
        account: updatedAccount,
      };
    });

    // Send credit alert email to applicant
    const recipientName = user.profile
      ? `${user.profile.firstName} ${user.profile.lastName}`
      : user.username;

    try {
      await this.emailService.sendCreditAlert({
        to: user.email,
        recipientName,
        accountNumber: bankAccount.accountNumber,
        amount: awardAmount.toFixed(2),
        currency: bankAccount.currencyCode,
        senderName: `Silverhawk Institutional Aid — ${application.programName}`,
        description: `Disbursement of approved grant funding (Ref: ${application.applicationRef})`,
        reference: txRef,
        availableBalance: result.account.availableBalance.toString(),
      });
    } catch (err) {
      this.logger.warn(`Failed to dispatch grant email to ${user.email}: ${err.message}`);
    }

    // In-app notification
    await this.prisma.notification.create({
      data: {
        userId: user.id,
        title: '🎉 Grant Funds Disbursed!',
        message: `Your grant of ${bankAccount.currencyCode} ${awardAmount.toLocaleString()} (${application.programName}) has been disbursed and credited to account #${bankAccount.accountNumber}.`,
        type: 'SYSTEM',
      },
    });

    this.logger.log(`Grant ${application.applicationRef} disbursed ${awardAmount.toFixed(2)} ${bankAccount.currencyCode} to user ${user.id}`);

    return {
      success: true,
      message: `Grant funds of ${bankAccount.currencyCode} ${awardAmount.toLocaleString()} have been successfully credited to account #${bankAccount.accountNumber}`,
      transaction: result.transaction,
      grant: result.grant,
      accountBalance: result.account.availableBalance,
    };
  }
}

