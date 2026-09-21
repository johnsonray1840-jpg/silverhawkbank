import {
  PrismaClient,
  UserStatus,
  AccountType,
  AccountStatus,
  LedgerAccountType,
  LedgerEntryType,
  TransactionType,
  TransactionStatus,
  KycTier,
  KycStatus,
  LoanInterestType,
  LoanStatus,
  SavingsType,
  SavingsStatus,
  CardType,
  CardBrand,
  CardStatus,
  AutoDebitFrequency,
} from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('================================================================');
  console.log('🌱 Starting Silverhawk Banking Platform Database Seeding');
  console.log('⚠️  DEVELOPMENT & DEMO SEED ONLY - NEVER USE IN PRODUCTION');
  console.log('================================================================\n');

  // ----------------------------------------------------------------------------
  // 1. SYSTEM CURRENCIES & EXCHANGE RATES
  // ----------------------------------------------------------------------------
  console.log('📌 1/9 Seeding Currencies and Exchange Rates...');
  const currenciesData = [
    { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2, isBase: true, isActive: true },
    { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, isBase: false, isActive: true },
    { code: 'GBP', name: 'British Pound', symbol: '£', decimals: 2, isBase: false, isActive: true },
    { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', decimals: 2, isBase: false, isActive: true },
    { code: 'AUD', name: 'Australian Dollar', symbol: 'AU$', decimals: 2, isBase: false, isActive: true },
    { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0, isBase: false, isActive: true },
    { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', decimals: 2, isBase: false, isActive: true },
    { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', decimals: 2, isBase: false, isActive: true },
  ];

  for (const curr of currenciesData) {
    await prisma.currency.upsert({
      where: { code: curr.code },
      update: curr,
      create: curr,
    });
  }

  // Seed Exchange Rates (relative to USD base)
  const exchangeRates = [
    { baseCurrency: 'USD', quoteCurrency: 'EUR', rate: 0.920000 },
    { baseCurrency: 'USD', quoteCurrency: 'GBP', rate: 0.785000 },
    { baseCurrency: 'USD', quoteCurrency: 'CAD', rate: 1.365000 },
    { baseCurrency: 'USD', quoteCurrency: 'AUD', rate: 1.512000 },
    { baseCurrency: 'USD', quoteCurrency: 'JPY', rate: 155.450000 },
    { baseCurrency: 'USD', quoteCurrency: 'CHF', rate: 0.908000 },
    { baseCurrency: 'USD', quoteCurrency: 'NGN', rate: 1480.000000 },
  ];

  for (const rate of exchangeRates) {
    await prisma.exchangeRate.upsert({
      where: {
        baseCurrency_quoteCurrency: {
          baseCurrency: rate.baseCurrency,
          quoteCurrency: rate.quoteCurrency,
        },
      },
      update: { rate: rate.rate, source: 'CENTRAL_BANK' },
      create: { ...rate, source: 'CENTRAL_BANK' },
    });
  }

  // ----------------------------------------------------------------------------
  // 2. CHART OF ACCOUNTS (DOUBLE-ENTRY GENERAL LEDGER)
  // ----------------------------------------------------------------------------
  console.log('📌 2/9 Seeding Chart of Accounts (General Ledger)...');
  const chartOfAccounts = [
    // Assets (1000s)
    { accountCode: '1010', name: 'Cash & Vault Reserve', type: LedgerAccountType.ASSET, currencyCode: 'USD', isSystem: true },
    { accountCode: '1020', name: 'Paystack Settlement Clearing', type: LedgerAccountType.ASSET, currencyCode: 'USD', isSystem: true },
    { accountCode: '1030', name: 'Flutterwave Settlement Clearing', type: LedgerAccountType.ASSET, currencyCode: 'USD', isSystem: true },
    { accountCode: '1040', name: 'Stripe Settlement Clearing', type: LedgerAccountType.ASSET, currencyCode: 'USD', isSystem: true },
    { accountCode: '1050', name: 'Loans Principal Receivable', type: LedgerAccountType.ASSET, currencyCode: 'USD', isSystem: true },

    // Liabilities (2000s)
    { accountCode: '2010', name: 'Customer Checking Deposits Liability', type: LedgerAccountType.LIABILITY, currencyCode: 'USD', isSystem: true },
    { accountCode: '2020', name: 'Customer Savings Deposits Liability', type: LedgerAccountType.LIABILITY, currencyCode: 'USD', isSystem: true },
    { accountCode: '2030', name: 'Fixed Term Deposits Liability', type: LedgerAccountType.LIABILITY, currencyCode: 'USD', isSystem: true },
    { accountCode: '2040', name: 'Target Savings Escrow Liability', type: LedgerAccountType.LIABILITY, currencyCode: 'USD', isSystem: true },

    // Equity (3000s)
    { accountCode: '3010', name: 'Shareholder Capital', type: LedgerAccountType.EQUITY, currencyCode: 'USD', isSystem: true },
    { accountCode: '3020', name: 'Retained Earnings', type: LedgerAccountType.EQUITY, currencyCode: 'USD', isSystem: true },

    // Revenue (4000s)
    { accountCode: '4010', name: 'Transfer & Wire Fee Income', type: LedgerAccountType.REVENUE, currencyCode: 'USD', isSystem: true },
    { accountCode: '4020', name: 'Loan Interest Income', type: LedgerAccountType.REVENUE, currencyCode: 'USD', isSystem: true },
    { accountCode: '4030', name: 'Loan Late Penalty Income', type: LedgerAccountType.REVENUE, currencyCode: 'USD', isSystem: true },
    { accountCode: '4040', name: 'Card Issuance & Maintenance Income', type: LedgerAccountType.REVENUE, currencyCode: 'USD', isSystem: true },
    { accountCode: '4050', name: 'Foreign Exchange Spread Income', type: LedgerAccountType.REVENUE, currencyCode: 'USD', isSystem: true },

    // Expenses (5000s)
    { accountCode: '5010', name: 'Payment Gateway Processing Expenses', type: LedgerAccountType.EXPENSE, currencyCode: 'USD', isSystem: true },
    { accountCode: '5020', name: 'Customer Savings Interest Expense', type: LedgerAccountType.EXPENSE, currencyCode: 'USD', isSystem: true },
    { accountCode: '5030', name: 'Referral Commission Expense', type: LedgerAccountType.EXPENSE, currencyCode: 'USD', isSystem: true },
  ];

  for (const coa of chartOfAccounts) {
    await prisma.ledgerAccount.upsert({
      where: { accountCode: coa.accountCode },
      update: coa,
      create: coa,
    });
  }

  // ----------------------------------------------------------------------------
  // 3. ROLES & GRANULAR PERMISSIONS MATRIX
  // ----------------------------------------------------------------------------
  console.log('📌 3/9 Seeding Roles and Granular Permissions...');
  const roles = [
    { name: 'SUPER_ADMIN', description: 'Full system administrative access', isSystem: true },
    { name: 'ADMIN', description: 'General administrative operations', isSystem: true },
    { name: 'FINANCE_MANAGER', description: 'Manages ledger, manual adjustments, fee rules, and treasury', isSystem: true },
    { name: 'KYC_OFFICER', description: 'Reviews and approves KYC compliance documents', isSystem: true },
    { name: 'LOAN_OFFICER', description: 'Underwrites, approves, and monitors loan applications', isSystem: true },
    { name: 'SUPPORT_AGENT', description: 'Handles customer support tickets and live inquiries', isSystem: true },
    { name: 'AUDITOR', description: 'Read-only compliance and audit log inspector', isSystem: true },
    { name: 'CUSTOMER', description: 'Standard consumer banking portal user', isSystem: true },
  ];

  const createdRoles: Record<string, any> = {};
  for (const r of roles) {
    createdRoles[r.name] = await prisma.role.upsert({
      where: { name: r.name },
      update: r,
      create: r,
    });
  }

  const permissionsList = [
    // Users
    { slug: 'users.read', groupName: 'Users', description: 'View user profiles' },
    { slug: 'users.create', groupName: 'Users', description: 'Create user accounts' },
    { slug: 'users.update', groupName: 'Users', description: 'Edit user profile information' },
    { slug: 'users.freeze', groupName: 'Users', description: 'Freeze or unfreeze user accounts' },
    // Accounts
    { slug: 'accounts.read', groupName: 'Accounts', description: 'View bank account balances' },
    { slug: 'accounts.update', groupName: 'Accounts', description: 'Modify account limits and status' },
    // KYC
    { slug: 'kyc.read', groupName: 'KYC', description: 'View customer KYC submissions' },
    { slug: 'kyc.approve', groupName: 'KYC', description: 'Approve or reject KYC documents' },
    // Ledger & Transactions
    { slug: 'ledger.read', groupName: 'Ledger', description: 'Inspect general ledger and journal entries' },
    { slug: 'transactions.read', groupName: 'Transactions', description: 'View all transaction streams' },
    { slug: 'transactions.reverse', groupName: 'Transactions', description: 'Execute compensating transaction reversals' },
    { slug: 'transactions.adjust', groupName: 'Transactions', description: 'Execute manual credit/debit adjustments' },
    // Deposits & Withdrawals
    { slug: 'deposits.approve', groupName: 'Deposits', description: 'Approve manual or wire deposits' },
    { slug: 'withdrawals.approve', groupName: 'Withdrawals', description: 'Approve customer outbound payouts' },
    // Loans
    { slug: 'loans.read', groupName: 'Loans', description: 'View loan applications' },
    { slug: 'loans.approve', groupName: 'Loans', description: 'Approve or reject loan applications' },
    { slug: 'loans.disburse', groupName: 'Loans', description: 'Disburse approved loans' },
    // Cards
    { slug: 'cards.manage', groupName: 'Cards', description: 'Manage card status and provider tokens' },
    // Support
    { slug: 'support.manage', groupName: 'Support', description: 'Reply to and assign support tickets' },
    // System Settings & Audit
    { slug: 'settings.update', groupName: 'Settings', description: 'Update bank settings and fee rules' },
    { slug: 'audit.read', groupName: 'Audit', description: 'Inspect security audit logs' },
  ];

  for (const perm of permissionsList) {
    const p = await prisma.permission.upsert({
      where: { slug: perm.slug },
      update: perm,
      create: perm,
    });

    // Assign all permissions to SUPER_ADMIN
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: createdRoles['SUPER_ADMIN'].id,
          permissionId: p.id,
        },
      },
      update: {},
      create: {
        roleId: createdRoles['SUPER_ADMIN'].id,
        permissionId: p.id,
      },
    });

    // Assign general permissions to ADMIN
    if (!perm.slug.startsWith('transactions.adjust') && !perm.slug.startsWith('settings.update')) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: createdRoles['ADMIN'].id,
            permissionId: p.id,
          },
        },
        update: {},
        create: {
          roleId: createdRoles['ADMIN'].id,
          permissionId: p.id,
        },
      });
    }

    // Role-specific assignments
    if (perm.groupName === 'KYC') {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: createdRoles['KYC_OFFICER'].id, permissionId: p.id } },
        update: {},
        create: { roleId: createdRoles['KYC_OFFICER'].id, permissionId: p.id },
      });
    }

    if (perm.groupName === 'Loans') {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: createdRoles['LOAN_OFFICER'].id, permissionId: p.id } },
        update: {},
        create: { roleId: createdRoles['LOAN_OFFICER'].id, permissionId: p.id },
      });
    }

    if (perm.groupName === 'Support') {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: createdRoles['SUPPORT_AGENT'].id, permissionId: p.id } },
        update: {},
        create: { roleId: createdRoles['SUPPORT_AGENT'].id, permissionId: p.id },
      });
    }

    if (perm.groupName === 'Audit' || perm.groupName === 'Ledger') {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: createdRoles['AUDITOR'].id, permissionId: p.id } },
        update: {},
        create: { roleId: createdRoles['AUDITOR'].id, permissionId: p.id },
      });
    }
  }

  // ----------------------------------------------------------------------------
  // 4. LOAN PRODUCTS & CREDIT PLANS
  // ----------------------------------------------------------------------------
  console.log('📌 4/9 Seeding Loan Products...');
  const loanProducts = [
    {
      name: 'Personal Flexi Loan',
      description: 'Quick personal loans with flexible monthly repayments for verified customers.',
      minAmount: 1000.0000,
      maxAmount: 50000.0000,
      interestRate: 5.50,
      interestType: LoanInterestType.REDUCING_BALANCE,
      minTenureMonths: 3,
      maxTenureMonths: 36,
      processingFeePercentage: 1.00,
      latePenaltyPercentage: 2.00,
      isActive: true,
    },
    {
      name: 'SME Business Growth Loan',
      description: 'Working capital and asset financing for small and medium enterprises.',
      minAmount: 5000.0000,
      maxAmount: 250000.0000,
      interestRate: 7.00,
      interestType: LoanInterestType.REDUCING_BALANCE,
      minTenureMonths: 6,
      maxTenureMonths: 60,
      processingFeePercentage: 1.50,
      latePenaltyPercentage: 2.50,
      isActive: true,
    },
    {
      name: 'Mortgage & Home Financing',
      description: 'Competitive low-interest home purchasing and real estate development loans.',
      minAmount: 50000.0000,
      maxAmount: 1000000.0000,
      interestRate: 4.20,
      interestType: LoanInterestType.REDUCING_BALANCE,
      minTenureMonths: 12,
      maxTenureMonths: 240,
      processingFeePercentage: 0.75,
      latePenaltyPercentage: 1.50,
      isActive: true,
    },
    {
      name: 'Executive Salary Advance',
      description: 'Instant liquidity against expected monthly corporate payroll disbursements.',
      minAmount: 500.0000,
      maxAmount: 15000.0000,
      interestRate: 3.50,
      interestType: LoanInterestType.FLAT,
      minTenureMonths: 1,
      maxTenureMonths: 6,
      processingFeePercentage: 0.50,
      latePenaltyPercentage: 1.50,
      isActive: true,
    },
  ];

  for (const prod of loanProducts) {
    const existing = await prisma.loanProduct.findFirst({ where: { name: prod.name } });
    if (!existing) {
      await prisma.loanProduct.create({ data: prod });
    }
  }

  // ----------------------------------------------------------------------------
  // 5. SAVINGS & FIXED DEPOSIT PRODUCTS
  // ----------------------------------------------------------------------------
  console.log('📌 5/9 Seeding Savings and Fixed Deposit Products...');
  const savingsProducts = [
    {
      name: 'Target Savings Goal Plan',
      type: SavingsType.TARGET,
      description: 'Automated recurring savings plan tailored for specific goals with competitive interest yield.',
      minAmount: 50.0000,
      interestRate: 6.00,
      lockPeriodDays: 30,
      earlyBreakFee: 1.00,
      isActive: true,
    },
    {
      name: 'High-Yield Fixed Term Deposit (30 Days)',
      type: SavingsType.FIXED_DEPOSIT,
      description: 'Short-term capital preservation vault yielding 7.50% annualized return.',
      minAmount: 500.0000,
      interestRate: 7.50,
      lockPeriodDays: 30,
      earlyBreakFee: 2.00,
      isActive: true,
    },
    {
      name: 'High-Yield Fixed Term Deposit (90 Days)',
      type: SavingsType.FIXED_DEPOSIT,
      description: 'Quarterly institutional-grade fixed deposit vault yielding 9.00% annualized return.',
      minAmount: 1000.0000,
      interestRate: 9.00,
      lockPeriodDays: 90,
      earlyBreakFee: 2.50,
      isActive: true,
    },
    {
      name: 'High-Yield Fixed Term Deposit (365 Days)',
      type: SavingsType.FIXED_DEPOSIT,
      description: 'Annual wealth compounding deposit vault yielding 12.00% annualized return.',
      minAmount: 5000.0000,
      interestRate: 12.00,
      lockPeriodDays: 365,
      earlyBreakFee: 3.50,
      isActive: true,
    },
    {
      name: 'Flexible High-Yield Wealth Vault',
      type: SavingsType.REGULAR,
      description: 'Liquid high-yield savings account compounding interest daily with zero withdrawal penalties.',
      minAmount: 10.0000,
      interestRate: 5.25,
      lockPeriodDays: 0,
      earlyBreakFee: 0.00,
      isActive: true,
    },
  ];

  for (const sp of savingsProducts) {
    const existing = await prisma.savingsProduct.findFirst({ where: { name: sp.name } });
    if (!existing) {
      await prisma.savingsProduct.create({ data: sp });
    }
  }

  // ----------------------------------------------------------------------------
  // 6. SYSTEM SETTINGS (15 OPERATIONAL CATEGORIES)
  // ----------------------------------------------------------------------------
  console.log('📌 6/9 Seeding Bank System Settings...');
  const settings = [
    { key: 'bank_name', value: 'Silverhawk', groupName: 'GENERAL', description: 'Official institution name' },
    { key: 'bank_tagline', value: 'Swift and Secure Money Transfer Worldwide', groupName: 'GENERAL', description: 'Brand slogan' },
    { key: 'support_email', value: 'support@silverhawkbank.com', groupName: 'CONTACT', description: 'Customer support desk email' },
    { key: 'support_phone', value: '1-800-BANKING', groupName: 'CONTACT', description: '24/7 Support hotline' },
    { key: 'bank_address', value: '100 Financial Plaza, Suite 400, New York, NY 10005', groupName: 'CONTACT', description: 'Global headquarters physical address' },
    { key: 'business_hours', value: 'Mon - Fri: 8:00 AM - 6:00 PM EST', groupName: 'CONTACT', description: 'Standard operating hours' },
    { key: 'default_currency', value: 'USD', groupName: 'FINANCIAL', description: 'Base operating currency' },
    { key: 'transfer_fee_internal_flat', value: '0.0000', groupName: 'FEES', description: 'Internal account transfer fee' },
    { key: 'transfer_fee_external_pct', value: '0.50', groupName: 'FEES', description: 'Outbound external wire fee percentage' },
    { key: 'withdrawal_fee_pct', value: '1.00', groupName: 'FEES', description: 'Cash withdrawal fee percentage' },
    { key: 'daily_transfer_limit_default', value: '25000.0000', groupName: 'LIMITS', description: 'Default daily customer transfer limit' },
    { key: 'daily_withdrawal_limit_default', value: '10000.0000', groupName: 'LIMITS', description: 'Default daily customer withdrawal limit' },
    { key: 'kyc_required_for_transfers', value: 'true', groupName: 'COMPLIANCE', description: 'Enforce approved KYC before high-value transfers' },
    { key: 'late_penalty_percentage_default', value: '2.00', groupName: 'LOANS', description: 'Default late repayment penalty percentage' },
    { key: 'maintenance_mode', value: 'false', groupName: 'SYSTEM', description: 'Global system maintenance toggle' },
  ];

  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: s,
      create: s,
    });
  }

  // ----------------------------------------------------------------------------
  // 7. ADMINISTRATIVE & STAFF SEED ACCOUNTS
  // ----------------------------------------------------------------------------
  console.log('📌 7/9 Seeding Administrative and Staff Accounts...');
  const defaultPasswordHash = await argon2.hash('SilverhawkAdmin2026!', {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
  });

  const defaultPinHash = await argon2.hash('1234', {
    type: argon2.argon2id,
  });

  const staffUsers = [
    {
      email: 'admin@silverhawkbank.com',
      username: 'admin',
      firstName: 'Admin',
      lastName: 'Officer',
      role: 'ADMIN',
    },
    {
      email: 'superadmin@silverhawkbank.com',
      username: 'superadmin',
      firstName: 'Chief',
      lastName: 'Administrator',
      role: 'SUPER_ADMIN',
    },
    {
      email: 'finance@silverhawkbank.com',
      username: 'financemanager',
      firstName: 'Elena',
      lastName: 'Rostova',
      role: 'FINANCE_MANAGER',
    },
    {
      email: 'kyc@silverhawkbank.com',
      username: 'kycofficer',
      firstName: 'Marcus',
      lastName: 'Vance',
      role: 'KYC_OFFICER',
    },
    {
      email: 'loans@silverhawkbank.com',
      username: 'loanofficer',
      firstName: 'David',
      lastName: 'Sterling',
      role: 'LOAN_OFFICER',
    },
    {
      email: 'support@silverhawkbank.com',
      username: 'supportagent',
      firstName: 'Sarah',
      lastName: 'Connor',
      role: 'SUPPORT_AGENT',
    },
    {
      email: 'auditor@silverhawkbank.com',
      username: 'auditor',
      firstName: 'Auditor',
      lastName: 'General',
      role: 'AUDITOR',
    },
  ];

  for (const staff of staffUsers) {
    const user = await prisma.user.upsert({
      where: { email: staff.email },
      update: {
        username: staff.username,
        passwordHash: defaultPasswordHash,
        pinHash: defaultPinHash,
        status: UserStatus.ACTIVE,
        isEmailVerified: true,
      },
      create: {
        email: staff.email,
        username: staff.username,
        passwordHash: defaultPasswordHash,
        pinHash: defaultPinHash,
        status: UserStatus.ACTIVE,
        isEmailVerified: true,
        referralCode: `REF-${staff.username.toUpperCase()}`,
        profile: {
          create: {
            firstName: staff.firstName,
            lastName: staff.lastName,
            country: 'United States',
          },
        },
      },
    });

    // Attach role
    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: user.id,
          roleId: createdRoles[staff.role].id,
        },
      },
      update: {},
      create: {
        userId: user.id,
        roleId: createdRoles[staff.role].id,
      },
    });
  }

  // ----------------------------------------------------------------------------
  // 8. DEMO CUSTOMER ACCOUNTS WITH BALANCED GENERAL LEDGER ENTRIES
  // ----------------------------------------------------------------------------
  console.log('📌 8/9 Seeding Demo Customers & Double-Entry Ledger Balances...');
  const customerPasswordHash = await argon2.hash('CustomerPass123!', {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
  });

  // Demo Customer 1: Henry Robert (Private Wealth & Institutional Client)
  const henryCustomer = await prisma.user.upsert({
    where: { email: 'henry.robert@silverhawkbank.com' },
    update: {
      username: 'henryrobert',
      passwordHash: customerPasswordHash,
      pinHash: defaultPinHash,
      status: UserStatus.ACTIVE,
      isEmailVerified: true,
    },
    create: {
      email: 'henry.robert@silverhawkbank.com',
      username: 'henryrobert',
      phone: '+15554928102',
      passwordHash: customerPasswordHash,
      pinHash: defaultPinHash,
      status: UserStatus.ACTIVE,
      isEmailVerified: true,
      referralCode: 'REF-HENRYROBERT',
      profile: {
        create: {
          firstName: 'Henry',
          lastName: 'Robert',
          country: 'United States',
          city: 'New York',
          state: 'New York',
          postalCode: '10005',
          addressLine1: '742 Evergreen Terrace, Suite 500',
        },
      },
      kycProfile: {
        create: {
          tier: KycTier.TIER_3,
          status: KycStatus.APPROVED,
          reviewNotes: 'Verified Private Wealth Institutional Executive KYC Tier 3.',
          submittedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
          reviewedAt: new Date(Date.now() - 89 * 24 * 60 * 60 * 1000),
        },
      },
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: henryCustomer.id,
        roleId: createdRoles['CUSTOMER'].id,
      },
    },
    update: {},
    create: {
      userId: henryCustomer.id,
      roleId: createdRoles['CUSTOMER'].id,
    },
  });

  // Henry Robert Checking Account ($148,520.50)
  const henryCheckingAccNumber = '4091823901';
  let henryAccount = await prisma.bankAccount.findUnique({
    where: { accountNumber: henryCheckingAccNumber },
  });

  if (!henryAccount) {
    henryAccount = await prisma.bankAccount.create({
      data: {
        userId: henryCustomer.id,
        accountNumber: henryCheckingAccNumber,
        accountName: 'Henry Robert - Primary Wealth Checking',
        type: AccountType.CHECKING,
        currencyCode: 'USD',
        status: AccountStatus.ACTIVE,
        currentBalance: 148520.5000,
        availableBalance: 148520.5000,
        ledgerBalance: 148520.5000,
        dailyTransferLimit: 100000.0000,
        dailyWithdrawalLimit: 50000.0000,
      },
    });

    const henryLedgerAccount = await prisma.ledgerAccount.upsert({
      where: { accountCode: `2010-${henryCheckingAccNumber}` },
      update: {},
      create: {
        accountCode: `2010-${henryCheckingAccNumber}`,
        name: `Liability - ${henryAccount.accountName}`,
        type: LedgerAccountType.LIABILITY,
        currencyCode: 'USD',
        bankAccountId: henryAccount.id,
      },
    });

    const henryDepositRef = 'TXN-INIT-DEP-4091823901';
    const henryTxn = await prisma.transaction.create({
      data: {
        reference: henryDepositRef,
        userId: henryCustomer.id,
        destinationAccountId: henryAccount.id,
        type: TransactionType.DEPOSIT,
        amount: 148520.5000,
        netAmount: 148520.5000,
        currencyCode: 'USD',
        status: TransactionStatus.SUCCESS,
        description: 'Direct Deposit - Institutional Executive Retainer',
      },
    });

    const henryJournal = await prisma.journalTransaction.create({
      data: {
        reference: `JRN-${henryDepositRef}`,
        transactionId: henryTxn.id,
        description: 'Opening Wire Deposit - Debit Cash / Credit Customer Checking Liability',
        postedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    });

    const cashVault = await prisma.ledgerAccount.findUnique({ where: { accountCode: '1010' } });
    if (cashVault) {
      await prisma.ledgerEntry.createMany({
        data: [
          {
            journalTransactionId: henryJournal.id,
            ledgerAccountId: cashVault.id,
            entryType: LedgerEntryType.DEBIT,
            amount: 148520.5000,
            currencyCode: 'USD',
            exchangeRate: '1.000000',
          },
          {
            journalTransactionId: henryJournal.id,
            ledgerAccountId: henryLedgerAccount.id,
            entryType: LedgerEntryType.CREDIT,
            amount: 148520.5000,
            currencyCode: 'USD',
            exchangeRate: '1.000000',
          },
        ],
      });
    }
  }

  // Henry Robert High-Yield Savings Vault ($350,000.00)
  const henrySavingsAccNumber = '4091823902';
  let henrySavingsAccount = await prisma.bankAccount.findUnique({
    where: { accountNumber: henrySavingsAccNumber },
  });

  if (!henrySavingsAccount) {
    henrySavingsAccount = await prisma.bankAccount.create({
      data: {
        userId: henryCustomer.id,
        accountNumber: henrySavingsAccNumber,
        accountName: 'Henry Robert - High-Yield Savings Vault',
        type: AccountType.SAVINGS,
        currencyCode: 'USD',
        status: AccountStatus.ACTIVE,
        currentBalance: 350000.0000,
        availableBalance: 350000.0000,
        ledgerBalance: 350000.0000,
      },
    });
  }

  // Henry Robert Physical Black Metal Visa Card
  const existingHenryCard = await prisma.card.findFirst({ where: { userId: henryCustomer.id } });
  if (!existingHenryCard && henryAccount) {
    await prisma.card.create({
      data: {
        userId: henryCustomer.id,
        accountId: henryAccount.id,
        cardType: CardType.PHYSICAL,
        brand: CardBrand.VISA,
        cardHolderName: 'HENRY ROBERT',
        maskedPan: '4242••••••••4242',
        tokenReference: 'tok_visa_black_metal_live_990182',
        expiryMonth: 9,
        expiryYear: 2030,
        spendingLimitMonthly: 100000.0000,
        spendingLimitDaily: 50000.0000,
        status: CardStatus.ACTIVE,
      },
    });
  }

  // Demo Customer 2: John Smith
  const demoCustomer1 = await prisma.user.upsert({
    where: { email: 'john.smith@example.com' },
    update: {
      username: 'johnsmith',
      passwordHash: customerPasswordHash,
      pinHash: defaultPinHash,
      status: UserStatus.ACTIVE,
      isEmailVerified: true,
    },
    create: {
      email: 'john.smith@example.com',
      username: 'johnsmith',
      phone: '+14155552671',
      passwordHash: customerPasswordHash,
      pinHash: defaultPinHash,
      status: UserStatus.ACTIVE,
      isEmailVerified: true,
      referralCode: 'REF-JOHNSMITH',
      profile: {
        create: {
          firstName: 'John',
          lastName: 'Smith',
          middleName: 'David',
          country: 'United States',
          city: 'San Francisco',
          state: 'California',
          postalCode: '94105',
          addressLine1: '452 Market Street, Apt 12B',
        },
      },
      kycProfile: {
        create: {
          tier: KycTier.TIER_3,
          status: KycStatus.APPROVED,
          reviewNotes: 'Identity, passport, and address verified successfully.',
          submittedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          reviewedAt: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000),
        },
      },
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: demoCustomer1.id,
        roleId: createdRoles['CUSTOMER'].id,
      },
    },
    update: {},
    create: {
      userId: demoCustomer1.id,
      roleId: createdRoles['CUSTOMER'].id,
    },
  });

  // John Smith Primary Checking Account ($120,000.00)
  const checkingAccNumber = '1002384912';
  let johnAccount = await prisma.bankAccount.findUnique({
    where: { accountNumber: checkingAccNumber },
  });

  if (!johnAccount) {
    johnAccount = await prisma.bankAccount.create({
      data: {
        userId: demoCustomer1.id,
        accountNumber: checkingAccNumber,
        accountName: 'John Smith - Primary Checking',
        type: AccountType.CHECKING,
        currencyCode: 'USD',
        status: AccountStatus.ACTIVE,
        currentBalance: 120000.0000,
        availableBalance: 120000.0000,
        ledgerBalance: 120000.0000,
        dailyTransferLimit: 25000.0000,
        dailyWithdrawalLimit: 10000.0000,
      },
    });

    const customerLedgerAccount = await prisma.ledgerAccount.upsert({
      where: { accountCode: `2010-${checkingAccNumber}` },
      update: {},
      create: {
        accountCode: `2010-${checkingAccNumber}`,
        name: `Liability - ${johnAccount.accountName}`,
        type: LedgerAccountType.LIABILITY,
        currencyCode: 'USD',
        bankAccountId: johnAccount.id,
      },
    });

    const initialDepositRef = 'TXN-INIT-DEP-1002384912';
    const initTxn = await prisma.transaction.create({
      data: {
        reference: initialDepositRef,
        userId: demoCustomer1.id,
        destinationAccountId: johnAccount.id,
        type: TransactionType.DEPOSIT,
        amount: 120000.0000,
        netAmount: 120000.0000,
        currencyCode: 'USD',
        status: TransactionStatus.SUCCESS,
        description: 'Initial Opening Bank Wire Deposit',
      },
    });

    const journalTx = await prisma.journalTransaction.create({
      data: {
        reference: `JRN-${initialDepositRef}`,
        transactionId: initTxn.id,
        description: 'Opening Wire Deposit - Debit Cash / Credit Customer Checking Liability',
        postedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      },
    });

    const cashVault = await prisma.ledgerAccount.findUnique({ where: { accountCode: '1010' } });
    if (cashVault) {
      await prisma.ledgerEntry.createMany({
        data: [
          {
            journalTransactionId: journalTx.id,
            ledgerAccountId: cashVault.id,
            entryType: LedgerEntryType.DEBIT,
            amount: 120000.0000,
            currencyCode: 'USD',
            exchangeRate: '1.000000',
          },
          {
            journalTransactionId: journalTx.id,
            ledgerAccountId: customerLedgerAccount.id,
            entryType: LedgerEntryType.CREDIT,
            amount: 120000.0000,
            currencyCode: 'USD',
            exchangeRate: '1.000000',
          },
        ],
      });
    }
  }

  // Virtual Card for John Smith
  const existingCard = await prisma.card.findFirst({ where: { userId: demoCustomer1.id } });
  if (!existingCard && johnAccount) {
    await prisma.card.create({
      data: {
        userId: demoCustomer1.id,
        accountId: johnAccount.id,
        cardType: CardType.VIRTUAL,
        brand: CardBrand.VISA,
        cardHolderName: 'JOHN SMITH',
        maskedPan: '4242••••••••4242',
        tokenReference: 'tok_visa_virtual_live_0182746',
        expiryMonth: 12,
        expiryYear: 2028,
        spendingLimitMonthly: 15000.0000,
        spendingLimitDaily: 2500.0000,
        status: CardStatus.ACTIVE,
      },
    });
  }

  // Target Savings for John Smith
  const existingSavings = await prisma.savingsAccount.findFirst({ where: { userId: demoCustomer1.id } });
  if (!existingSavings && johnAccount) {
    await prisma.savingsAccount.create({
      data: {
        userId: demoCustomer1.id,
        accountId: johnAccount.id,
        type: SavingsType.TARGET,
        title: 'New Home Down Payment',
        targetAmount: 50000.0000,
        currentAmount: 35000.0000,
        interestRate: 6.00,
        autoDebitFrequency: AutoDebitFrequency.MONTHLY,
        autoDebitAmount: 1500.0000,
        startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        maturityDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        status: SavingsStatus.ACTIVE,
      },
    });
  }

  // Beneficiaries for John Smith
  const beneficiaries = [
    { name: 'Alice Walker', accountNumber: '1004829104', bankName: 'Silverhawk', isInternal: true, currencyCode: 'USD' },
    { name: 'Robert Downey', accountNumber: '9823746152', bankName: 'Barclays Bank UK', isInternal: false, swiftBic: 'BARCGB22', currencyCode: 'GBP' },
  ];

  for (const b of beneficiaries) {
    const existing = await prisma.beneficiary.findFirst({
      where: { userId: demoCustomer1.id, accountNumber: b.accountNumber },
    });
    if (!existing) {
      await prisma.beneficiary.create({
        data: {
          userId: demoCustomer1.id,
          ...b,
        },
      });
    }
  }

  // ----------------------------------------------------------------------------
  // 9. SAMPLE HISTORICAL TRANSACTIONS
  // ----------------------------------------------------------------------------
  console.log('📌 9/9 Seeding Sample Balanced Historical Transactions...');
  if (johnAccount) {
    const sampleTxs = [
      {
        reference: 'TXN-SMPL-001',
        type: TransactionType.TRANSFER_INTERNAL,
        amount: 2500.0000,
        fee: 0.0000,
        description: 'Internal Wire to Alice Walker',
        status: TransactionStatus.SUCCESS,
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
      {
        reference: 'TXN-SMPL-002',
        type: TransactionType.CARD_PURCHASE,
        amount: 340.5000,
        fee: 0.0000,
        description: 'Apple Store Online Purchase',
        status: TransactionStatus.SUCCESS,
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
      {
        reference: 'TXN-SMPL-003',
        type: TransactionType.DEPOSIT,
        amount: 8500.0000,
        fee: 0.0000,
        description: 'Client Consulting Invoice Settlement',
        status: TransactionStatus.SUCCESS,
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    ];

    for (const txData of sampleTxs) {
      const existing = await prisma.transaction.findUnique({ where: { reference: txData.reference } });
      if (!existing) {
        await prisma.transaction.create({
          data: {
            ...txData,
            userId: demoCustomer1.id,
            sourceAccountId: txData.type === TransactionType.DEPOSIT ? null : johnAccount.id,
            destinationAccountId: txData.type === TransactionType.DEPOSIT ? johnAccount.id : null,
            netAmount: txData.amount,
            currencyCode: 'USD',
          },
        });
      }
    }
  }

  console.log('\n================================================================');
  console.log('✅ Silverhawk Database Seeding Completed Successfully!');
  console.log('================================================================');
  console.log('🔑 DEVELOPMENT CREDENTIALS SUMMARY:');
  console.log('----------------------------------------------------------------');
  console.log('👑 Super Admin:  superadmin@silverhawkbank.com  |  SilverhawkAdmin2026!');
  console.log('🛡️  Admin:        admin@silverhawkbank.com       |  SilverhawkAdmin2026!');
  console.log('💰 Finance:      finance@silverhawkbank.com     |  SilverhawkAdmin2026!');
  console.log('🔍 KYC Officer:  kyc@silverhawkbank.com         |  SilverhawkAdmin2026!');
  console.log('📑 Loan Officer: loans@silverhawkbank.com       |  SilverhawkAdmin2026!');
  console.log('🎧 Support:      support@silverhawkbank.com     |  SilverhawkAdmin2026!');
  console.log('📋 Auditor:      auditor@silverhawkbank.com     |  SilverhawkAdmin2026!');
  console.log('🏦 Wealth Demo:  henry.robert@silverhawkbank.com|  CustomerPass123!');
  console.log('👤 Standard Demo:john.smith@example.com         |  CustomerPass123!');
  console.log('----------------------------------------------------------------');
  console.log('🔒 Default Transaction PIN: 1234');
  console.log('⚠️  DEVELOPMENT NOTICE: Use these credentials only in local/staging.');
  console.log('================================================================\n');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed with error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
