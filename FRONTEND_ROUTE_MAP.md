# Silverhawk Banking Platform — Frontend Route Map

## 1. Overview
This document maps all existing frontend pages, views, UI layouts, navigation structures, forms, and interactive components in the Silverhawk banking platform. The existing UI/UX and styling are the authoritative source of truth.

---

## 2. Public & Marketing Routes

| Route / File | Title | Layout / Structure | Key Interactive Elements & Forms |
| :--- | :--- | :--- | :--- |
| [`index.html`](file:///Users/mac/Desktop/silverhawkbank.com/index.html) | Home - Silverhawk | Landing page, Hero section, Feature grids, Currency transfer calculator preview, Testimonials, Dark/Light Mode toggle, Smartsupp Live Chat, Footer. | Dark mode switcher, Navigation links, "Open Account" CTA, "Sign In" CTA. |
| [`about.html`](file:///Users/mac/Desktop/silverhawkbank.com/about.html) | About Us - Silverhawk | Company background, Mission, Core values, Executive team, Security assurances, Translation dropdown. | Navigation, Dark mode switcher, Language selector (MyMemory / LibreTranslate API), CTA buttons. |
| [`contact.html`](file:///Users/mac/Desktop/silverhawkbank.com/contact.html) | Contact Us - Silverhawk | Support channels, Office details, 24/7 hotline info, Contact form. | **Contact Form**: `name`, `email`, `subject`, `message` &rarr; Submits to `/api/v1/support/contact`. |
| [`chart.html`](file:///Users/mac/Desktop/silverhawkbank.com/chart.html) | Personal Banking - Silverhawk | Personal savings, Checking accounts, Term deposits, Interest calculators. | Product comparisons, "Apply Now" triggers, Dark mode switcher. |
| [`alerts.html`](file:///Users/mac/Desktop/silverhawkbank.com/alerts.html) | Business Banking - Silverhawk | Corporate banking, Merchant accounts, Payroll services, International wire info. | Feature breakdown, Business account inquiry triggers. |
| [`send-money.html`](file:///Users/mac/Desktop/silverhawkbank.com/send-money.html) | Loans & Credit - Silverhawk | Loan product breakdown (Personal, Business, Mortgage), Interest rates, Repayment calculator preview. | Loan eligibility guide, "Apply for Loan" CTA. |
| [`grants.html`](file:///Users/mac/Desktop/silverhawkbank.com/grants.html) | Grants & Financial Aid - Silverhawk | Grant programs, Educational/SME financial aid information, Eligibility checklists. | Financial aid application triggers, FAQ accordion. |
| [`apps.html`](file:///Users/mac/Desktop/silverhawkbank.com/apps.html) | Apps - Silverhawk | iOS and Android mobile banking app showcase, QR code download links, Feature previews. | App store links, Mobile feature cards. |
| [`privacy.html`](file:///Users/mac/Desktop/silverhawkbank.com/privacy.html) | Privacy Policy - Silverhawk | GDPR, Data protection disclosures, Cookie policies. | Legal text accordion, Language selector. |
| [`terms-of-service.html`](file:///Users/mac/Desktop/silverhawkbank.com/terms-of-service.html) | Terms of Service - Silverhawk | Legal user terms, Financial agreement, Liability disclosures. | Legal sections, Language selector. |

---

## 3. Authentication & Security Routes

| Route / File | Purpose | Form Fields & Payload | Target API Endpoint |
| :--- | :--- | :--- | :--- |
| [`login.html`](file:///Users/mac/Desktop/silverhawkbank.com/login.html) | User & Admin Sign In | `email` (or `username`), `password`, `remember_me` | `POST /api/v1/auth/login` |
| [`register.html`](file:///Users/mac/Desktop/silverhawkbank.com/register.html) | 4-Step Registration Wizard | **Step 1 (Personal)**: `name`, `lastname`, `middlename`, `username`<br>**Step 2 (Contact)**: `email`, `phone`, `country`<br>**Step 3 (Account)**: `curr` (Currency), `accounttype`, `pin` (4-digit PIN)<br>**Step 4 (Security)**: `password`, `password_confirmation`, `terms` | `POST /api/v1/auth/register` |
| [`forgot-password.html`](file:///Users/mac/Desktop/silverhawkbank.com/forgot-password.html) | Password Reset Request | `email` | `POST /api/v1/auth/forgot-password` |
| [`verify.html`](file:///Users/mac/Desktop/silverhawkbank.com/verify.html) | Security & Bot Verification / 2FA | `code` (Auto-generated security/2FA OTP code verification) | `POST /api/v1/auth/verify-code` |

---

## 4. Customer Banking Portal Views (Dashboard)

The customer portal mounts inside [`dashboard/`](file:///Users/mac/Desktop/silverhawkbank.com/dashboard) and adheres to the existing Tailwind/Alpine.js theme tokens:

| Portal View | Route | Features & Components | Backend Data Dependencies |
| :--- | :--- | :--- | :--- |
| **Overview Dashboard** | `/dashboard` | Total balance, Available balance, Ledger balance, Recent transactions, Quick actions (Transfer, Deposit, Withdraw, Pay), Monthly cash flow chart. | `/api/v1/accounts/summary`, `/api/v1/transactions/recent`, `/api/v1/reports/monthly-cashflow` |
| **Cards Hub** | [`dashboard/index.html`](file:///Users/mac/Desktop/silverhawkbank.com/dashboard/index.html) | Virtual/Physical card list, Card freeze/unfreeze, Spending limits, Sensitive details toggle (masked PAN/CVV), Card transactions. | `/api/v1/cards`, `/api/v1/cards/:id/freeze`, `/api/v1/cards/:id/limits` |
| **Transfers Hub** | `/dashboard/transfers` | Internal transfer, Cross-account transfer, External bank transfer, Beneficiary selector, 2FA/PIN confirmation modal. | `/api/v1/transfers/internal`, `/api/v1/transfers/external`, `/api/v1/beneficiaries` |
| **Deposits** | `/dashboard/deposits` | Deposit methods (Bank wire, Card gateway, Crypto/Manual), Reference generator, Proof-of-payment upload. | `/api/v1/deposits/methods`, `/api/v1/deposits/initiate`, `/api/v1/deposits/history` |
| **Withdrawals** | `/dashboard/withdrawals` | Bank withdrawal form, Balance validation, Daily limits indicator, OTP confirmation. | `/api/v1/withdrawals/request`, `/api/v1/withdrawals/limits` |
| **Savings & Fixed Deposits** | `/dashboard/savings` | Regular savings, Target goal tracker, Fixed deposit lockup creator, Maturity calculator. | `/api/v1/savings/plans`, `/api/v1/savings/target`, `/api/v1/savings/fixed-deposit` |
| **Loans & Credit** | `/dashboard/loans` | Active loans, Repayment schedule, Loan application wizard, Amortization calculator. | `/api/v1/loans/products`, `/api/v1/loans/apply`, `/api/v1/loans/repay` |
| **Statements & Activity** | `/dashboard/statements` | Filterable transaction table (Date, Type, Status, Currency), PDF export, CSV export. | `/api/v1/transactions`, `/api/v1/statements/export-pdf`, `/api/v1/statements/export-csv` |
| **KYC & Identity** | `/dashboard/kyc` | Tier verification, Document uploader (Passport, ID, Utility Bill, Selfie), Verification status banner. | `/api/v1/kyc/status`, `/api/v1/kyc/submit` |
| **Profile & Security** | `/dashboard/settings` | Profile details, Password change, Transaction PIN reset, 2FA setup, Notification preferences. | `/api/v1/users/profile`, `/api/v1/auth/2fa/enable`, `/api/v1/notifications/preferences` |
| **Support & Tickets** | `/dashboard/support` | Ticket submission, Conversation thread, File attachments. | `/api/v1/support/tickets`, `/api/v1/support/tickets/:id/messages` |

---

## 5. Admin & Staff Portal Views

| Admin View | Route | Description & Management Controls |
| :--- | :--- | :--- |
| **Admin Overview** | `/admin` | System assets/liabilities, Active users count, Pending KYC counter, Pending deposits/withdrawals, Recent fraud alerts. |
| **Customer Management** | `/admin/users` | User list, Profile inspector, KYC verification review, Account freeze/unfreeze, Password reset dispatch, Activity audit log. |
| **Ledger & Accounts** | `/admin/ledger` | Real-time double-entry ledger inspector, Journal transactions, General ledger accounts, Balance sheet view. |
| **Transaction Desk** | `/admin/transactions` | Global transaction stream, Manual credit/debit adjustment desk, Transaction reversal engine with immutable compensating entries. |
| **Deposit Approvals** | `/admin/deposits` | Review pending wire/manual deposits, Match bank references, Approve/Reject credits. |
| **Withdrawal Approvals** | `/admin/withdrawals` | Multi-step approval for outbound payouts, Risk check indicators, Provider dispatch. |
| **Loan Management** | `/admin/loans` | Loan application underwriting, Approval/Disbursement workflow, Repayment tracking, Penalty waivers. |
| **KYC Compliance Desk** | `/admin/kyc` | Document review canvas, High-resolution zoom, Approve/Reject with reason notes, Tier assignment. |
| **Card Administration** | `/admin/cards` | Virtual card issuance overview, Provider pool balance, Card lock/unlock overrides. |
| **Support Desk** | `/admin/support` | Ticket assignment, Agent replies, Internal staff notes, Ticket resolution. |
| **Staff & RBAC** | `/admin/staff` | Staff accounts, Role assignments (`SUPER_ADMIN`, `FINANCE_MANAGER`, `KYC_OFFICER`, `LOAN_OFFICER`, etc.), Granular permission matrix. |
| **System Settings** | `/admin/settings` | Core bank config (Name, Currencies, Exchange rates, Fee rules, Transfer limits, Payment gateways, SMTP, SMS, Risk parameters). |

