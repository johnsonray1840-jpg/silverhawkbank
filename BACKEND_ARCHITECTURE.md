# Silverhawk Banking Platform — Backend Architecture (NestJS + TypeScript + Prisma + MySQL)

## 1. System Architecture Overview

The Silverhawk backend is designed as a modular, high-throughput, enterprise-grade RESTful API service built on **NestJS**, **TypeScript**, **Prisma ORM**, and **MySQL 8.0+**.

```
[ Frontend Client (Tailwind / Alpine.js UI) ]
                     |  HTTPS / REST / JSON
                     v
+-------------------------------------------------------------+
|                NestJS API Gateway Layer                     |
|  - Rate Limiter (Throttler)   - Helmet / CORS Security      |
|  - JWT Auth Guard             - RBAC Permission Guard       |
|  - Validation Pipe (DTOs)     - Standard Response Interceptor|
|  - Global Exception Filter    - Audit Logging Interceptor   |
+-------------------------------------------------------------+
                     |
+-------------------------------------------------------------+
|                    Core Business Modules                    |
|  - AuthModule                 - AccountsModule              |
|  - LedgerModule (Double-Entry)- TransfersModule             |
|  - DepositsModule             - WithdrawalsModule           |
|  - LoansModule                - SavingsModule               |
|  - CardsModule                - KYCModule                   |
|  - SupportModule              - AdminModule                 |
|  - NotificationsModule        - SettingsModule              |
+-------------------------------------------------------------+
       |                           |                     |
       v                           v                     v
+---------------+        +-------------------+    +----------------------+
|  MySQL 8.0+   |        |   Redis / BullMQ  |    | External Providers   |
| (InnoDB / ACID|        | - Email Queue     |    | - Payments (Paystack,|
| Double-Entry  |        | - SMS Queue       |    |   Flutterwave, Stripe|
| Ledger Engine)|        | - Loan Scheduler  |    | - SMTP Email         |
+---------------+        | - Fraud Checks    |    | - SMS Gateway        |
                         +-------------------+    +----------------------+
```

---

## 2. Directory & Modular Structure

```
backend/
├── src/
│   ├── main.ts                          # Bootstrap & global pipes/interceptors
│   ├── app.module.ts                    # Root module aggregating sub-modules
│   ├── common/                          # Shared utilities, decorators, guards
│   │   ├── decorators/                  # @CurrentUser(), @RequirePermissions()
│   │   ├── filters/                     # AllExceptionsFilter, HttpErrorFilter
│   │   ├── guards/                      # JwtAuthGuard, RolesGuard, PermissionsGuard
│   │   ├── interceptors/                # ResponseEnvelopeInterceptor, AuditLogInterceptor
│   │   ├── pipes/                       # StrictValidationPipe
│   │   └── utils/                       # DecimalMath, ReferenceGenerator, CryptoUtils
│   ├── config/                          # Typed configuration validation (Joi/Zod)
│   ├── database/                        # PrismaService, PrismaModule with MySQL config
│   ├── modules/
│   │   ├── auth/                        # Registration, Login, Argon2id, 2FA, Sessions
│   │   ├── users/                       # User entity, Profile management
│   │   ├── kyc/                         # KYC tier evaluation, Document review
│   │   ├── accounts/                    # Bank account lifecycle, Balance aggregates
│   │   ├── ledger/                      # General ledger, Journal postings, Double-entry
│   │   ├── transfers/                   # Internal & external transfer engine
│   │   ├── deposits/                    # Bank wire, Card, and Gateway deposit processors
│   │   ├── withdrawals/                 # Outbound payout request & review workflow
│   │   ├── beneficiaries/               # Beneficiary address book & cooling periods
│   │   ├── loans/                       # Loan underwriting, Schedules, Amortization
│   │   ├── savings/                     # Target savings & Fixed-term deposit maturities
│   │   ├── cards/                       # Virtual card tokenization & limit enforcement
│   │   ├── notifications/               # In-app, Email (SMTP), and SMS dispatchers
│   │   ├── support/                     # Support ticket threading & staff assignment
│   │   ├── admin/                       # Administrative statistics, Customer control
│   │   ├── audit/                       # Immutable security event log store
│   │   ├── settings/                    # Dynamic CMS & Banking configuration
│   │   └── webhooks/                    # Provider webhook receivers & signature checkers
│   └── providers/                       # Third-party service abstractions
│       ├── payment/                     # Paystack, Flutterwave, Stripe adapters
│       ├── email/                       # NodeMailer SMTP adapter
│       ├── sms/                         # SMS provider adapter
│       └── storage/                     # S3 / Local secured storage
├── prisma/
│   ├── schema.prisma                    # Complete MySQL Prisma Schema
│   ├── migrations/                      # Sequential MySQL migrations
│   └── seed.ts                          # Production & Demo initial seed data
├── docker-compose.yml                   # Local MySQL 8.0 + Redis 7.0 stack
├── Dockerfile                           # Multi-stage production container
└── package.json
```

---

## 3. Financial Integrity & Concurrency Control

### 3.1 Strict MySQL Atomic Transactions
To prevent race conditions, double-spending, or negative balances, all balance-altering operations execute inside a dedicated Prisma interactive transaction with row locking:

```typescript
await this.prisma.$transaction(async (tx) => {
  // 1. Lock source account row in MySQL
  const [sourceAccount] = await tx.$queryRaw<BankAccount[]>`
    SELECT * FROM bank_accounts 
    WHERE id = ${sourceAccountId} 
    FOR UPDATE
  `;

  if (new Decimal(sourceAccount.availableBalance).lessThan(totalDeduction)) {
    throw new BadRequestException('INSUFFICIENT_FUNDS');
  }

  // 2. Debit source balance
  await tx.bankAccount.update({
    where: { id: sourceAccountId },
    data: {
      currentBalance: { decrement: totalDeduction },
      availableBalance: { decrement: totalDeduction },
    },
  });

  // 3. Post double-entry journal & ledger entries atomically
  await this.ledgerService.postJournalEntry(tx, {
    reference: transactionRef,
    debitAccountId: sourceLedgerAccountId,
    creditAccountId: destinationLedgerAccountId,
    amount: transferAmount,
    currency,
  });
});
```

### 3.2 Idempotency Enforcement
Every non-idempotent financial request (`POST /transfers`, `POST /withdrawals`, `POST /deposits`) requires an `Idempotency-Key` HTTP header. If the key exists:
- If `PROCESSING`: Returns `409 Conflict`.
- If `SUCCESS`: Returns cached original response immediately without re-executing ledger operations.

---

## 4. Payment Provider Abstraction Layer

Payment gateways implement a clean provider contract:

```typescript
export interface IPaymentProvider {
  readonly name: string;
  resolveAccount(accountNumber: string, bankCode: string): Promise<AccountResolutionResult>;
  initiateTransfer(payload: OutboundTransferDto): Promise<ProviderTransferResult>;
  verifyWebhook(signature: string, payload: any): boolean;
  parseWebhookEvent(payload: any): WebhookEventDto;
}
```

Concrete adapters include:
- `PaystackProvider`
- `FlutterwaveProvider`
- `StripeProvider`
- `ManualWireProvider`

---

## 5. Security & Authentication Design

1. **Password Hashing**: **Argon2id** (`argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 })`).
2. **Transaction PIN**: Argon2id hashed separate 4-digit PIN for high-risk operations.
3. **Session & Token Management**:
   - Access Token: Short-lived (15 minutes) JWT passed via Authorization Bearer header.
   - Refresh Token: Long-lived (7 days) rotating token stored hashed in MySQL `sessions` table.
4. **Role-Based Access Control (RBAC)**: Fine-grained permissions evaluated via NestJS `@RequirePermissions('users.update', 'loans.approve')` guard.
5. **Rate Limiting**: Redis-backed sliding window rate limiter on auth and transaction endpoints.

---

## 6. Background Queue & Scheduled Tasks (BullMQ + Redis)

| Queue / Cron | Frequency | Purpose |
| :--- | :--- | :--- |
| `email-queue` | On-demand | Dispatches templated transactional emails (Welcome, OTP, Transaction alert). |
| `sms-queue` | On-demand | Dispatches SMS security codes and critical debit alerts. |
| `loan-accrual-cron` | Daily @ 00:00 UTC | Calculates daily interest on active reducing-balance loans. |
| `savings-contribution-cron` | Daily @ 01:00 UTC | Processes automated recurring debit contributions for target savings. |
| `fixed-deposit-maturity-cron` | Daily @ 02:00 UTC | Checks maturing fixed deposits, credits principal + interest, closes plan. |
| `session-cleanup-cron` | Hourly | Purges expired un-refreshed sessions and stale OTP codes. |

