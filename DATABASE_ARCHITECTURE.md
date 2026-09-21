# Silverhawk Banking Platform — Database Architecture (MySQL 8.0+)

## 1. Core Principles & MySQL Specification

- **Database Engine**: **MySQL 8.0+** (InnoDB Storage Engine)
- **Character Set / Collation**: `utf8mb4` / `utf8mb4_unicode_ci`
- **Monetary Precision**: All financial columns use MySQL `DECIMAL(18, 4)` to eliminate floating-point calculation errors.
- **Concurrency & Integrity**: Strict ACID transactions with row-level locking (`SELECT ... FOR UPDATE`), optimistic concurrency where appropriate, and foreign key constraints with indexed lookup paths.
- **Ledger Model**: Double-entry bookkeeping. Authoritative account balances are derived from ledger journal entries and verified against cached snapshot balances.

---

## 2. Double-Entry Accounting Architecture

Every monetary operation generates a balanced `JournalTransaction` with at least two matching `LedgerEntry` records where:

$$\sum \text{Debit} = \sum \text{Credit}$$

### Chart of Accounts Structure
1. **Assets (1000–1999)**:
   - `1010`: Cash & Bank Settlement (Provider clearing accounts: Paystack, Flutterwave, Stripe)
   - `1020`: Vault / Central Bank Reserve
   - `1050`: Loans Receivable (Principal disbursed to borrowers)
2. **Liabilities (2000–2999)**:
   - `2010`: Customer Checking Deposits
   - `2020`: Customer Savings Deposits
   - `2030`: Fixed Term Deposit Liabilities
   - `2040`: Target Savings Escrow
3. **Equity (3000–3999)**:
   - `3010`: Retained Earnings
   - `3020`: Shareholder Capital
4. **Revenue (4000–4999)**:
   - `4010`: Wire & Transfer Fee Income
   - `4020`: Loan Interest Income
   - `4030`: Loan Late Penalty Income
   - `4040`: Card Issuance & Maintenance Fees
   - `4050`: FX Spread Income
5. **Expenses (5000–5999)**:
   - `5010`: Payment Gateway Processing Fees
   - `5020`: Customer Savings Interest Expense
   - `5030`: Referral Commission Expense

---

## 3. Entity Relationship & MySQL Schema Design

```
+------------------+         +--------------------+         +-------------------+
|      users       | 1 --- * |    user_roles      | * --- 1 |       roles       |
+------------------+         +--------------------+         +-------------------+
        | 1
        |
        + --- 1 --- profiles
        + --- 1 --- kyc_profiles --- * kyc_documents
        + --- 1 --- * bank_accounts --- 1 --- ledger_accounts
        |                    | 1
        |                    + --- * cards
        |                    + --- * loans
        |                    + --- * savings_accounts
        |
        + --- 1 --- * transactions (Business Event)
                            | 1
                            + --- 1 journal_transactions
                                         | 1
                                         + --- * ledger_entries (Debit / Credit)
```

---

## 4. Normalized MySQL Table Definitions

### 4.1 Users & Access Control
- `users`: `id` (VARCHAR(36) PK/UUID), `email` (VARCHAR(191) UNIQUE), `username` (VARCHAR(191) UNIQUE), `phone` (VARCHAR(50) UNIQUE), `password_hash` (VARCHAR(255) Argon2id), `pin_hash` (VARCHAR(255)), `status` (ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'FROZEN', 'CLOSED')), `is_email_verified` (BOOLEAN), `two_factor_enabled` (BOOLEAN), `two_factor_secret` (VARCHAR(255)), `created_at` (DATETIME(3)), `updated_at` (DATETIME(3)).
- `roles`: `id`, `name` (VARCHAR(100) UNIQUE), `description`, `is_system` (BOOLEAN).
- `permissions`: `id`, `slug` (VARCHAR(100) UNIQUE), `group_name`, `description`.
- `role_permissions`: `role_id`, `permission_id` (Composite PK).
- `user_roles`: `user_id`, `role_id` (Composite PK).
- `sessions`: `id`, `user_id`, `token_hash`, `ip_address`, `user_agent`, `expires_at`, `is_revoked`.
- `login_attempts`: `id`, `identifier`, `ip_address`, `successful` (BOOLEAN), `attempted_at`.

### 4.2 Profiles & KYC
- `profiles`: `id`, `user_id` (UNIQUE FK), `first_name` (VARCHAR(100)), `last_name` (VARCHAR(100)), `middle_name` (VARCHAR(100)), `avatar_url`, `date_of_birth` (DATE), `nationality` (VARCHAR(100)), `address_line1`, `address_line2`, `city`, `state`, `postal_code`, `country`.
- `kyc_profiles`: `id`, `user_id` (UNIQUE FK), `tier` (TINYINT DEFAULT 1), `status` (ENUM('NOT_STARTED', 'PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED')), `reviewer_id` (FK), `review_notes` (TEXT), `submitted_at`, `reviewed_at`.
- `kyc_documents`: `id`, `kyc_profile_id` (FK), `document_type` (ENUM('PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE', 'UTILITY_BILL', 'SELFIE')), `file_path` (VARCHAR(255)), `file_size`, `mime_type`, `status`, `created_at`.

### 4.3 Banking Accounts & Currencies
- `currencies`: `code` (VARCHAR(3) PK, e.g., 'USD', 'EUR', 'GBP'), `name`, `symbol`, `decimals` (INT DEFAULT 2), `is_active` (BOOLEAN), `is_base` (BOOLEAN).
- `exchange_rates`: `id`, `base_currency`, `quote_currency`, `rate` (DECIMAL(18, 6)), `source`, `updated_at`.
- `bank_accounts`: `id` (VARCHAR(36) PK), `user_id` (FK), `account_number` (VARCHAR(20) UNIQUE), `account_name` (VARCHAR(150)), `type` (ENUM('CHECKING', 'SAVINGS', 'BUSINESS', 'INVESTMENT', 'FIXED_DEPOSIT')), `currency` (VARCHAR(3) FK), `status` (ENUM('ACTIVE', 'PENDING', 'FROZEN', 'SUSPENDED', 'DORMANT', 'CLOSED')), `current_balance` (DECIMAL(18, 4) DEFAULT 0.0000), `available_balance` (DECIMAL(18, 4) DEFAULT 0.0000), `ledger_balance` (DECIMAL(18, 4) DEFAULT 0.0000), `daily_transfer_limit` (DECIMAL(18, 4)), `daily_withdrawal_limit` (DECIMAL(18, 4)), `created_at`, `updated_at`.

### 4.4 Double-Entry General Ledger
- `ledger_accounts`: `id` (VARCHAR(36) PK), `account_code` (VARCHAR(20) UNIQUE), `name` (VARCHAR(150)), `type` (ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')), `currency` (VARCHAR(3)), `bank_account_id` (FK Nullable), `created_at`.
- `journal_transactions`: `id` (VARCHAR(36) PK), `reference` (VARCHAR(100) UNIQUE), `transaction_id` (VARCHAR(36) FK Nullable), `description` (VARCHAR(255)), `posted_at` (DATETIME(3)), `created_by` (VARCHAR(36)).
- `ledger_entries`: `id` (VARCHAR(36) PK), `journal_transaction_id` (FK), `ledger_account_id` (FK), `entry_type` (ENUM('DEBIT', 'CREDIT')), `amount` (DECIMAL(18, 4)), `currency` (VARCHAR(3)), `exchange_rate` (DECIMAL(18, 6) DEFAULT 1.000000), `created_at`.

### 4.5 Transactions, Transfers, Deposits, Withdrawals
- `transactions`: `id` (VARCHAR(36) PK), `reference` (VARCHAR(100) UNIQUE), `idempotency_key` (VARCHAR(100) UNIQUE Nullable), `user_id` (FK), `source_account_id` (FK Nullable), `destination_account_id` (FK Nullable), `type` (ENUM('TRANSFER_INTERNAL', 'TRANSFER_EXTERNAL', 'DEPOSIT', 'WITHDRAWAL', 'LOAN_DISBURSEMENT', 'LOAN_REPAYMENT', 'SAVINGS_DEPOSIT', 'SAVINGS_WITHDRAWAL', 'CARD_PURCHASE', 'FEE', 'TAX', 'ADJUSTMENT_CREDIT', 'ADJUSTMENT_DEBIT', 'REVERSAL')), `amount` (DECIMAL(18, 4)), `fee` (DECIMAL(18, 4) DEFAULT 0.0000), `tax` (DECIMAL(18, 4) DEFAULT 0.0000), `net_amount` (DECIMAL(18, 4)), `currency` (VARCHAR(3)), `status` (ENUM('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REVERSED')), `description` (VARCHAR(255)), `metadata` (JSON), `created_at`, `updated_at`.
- `transfers`: `id`, `transaction_id` (UNIQUE FK), `sender_account_id` (FK), `recipient_account_id` (FK Nullable), `recipient_name` (VARCHAR(150)), `bank_name` (VARCHAR(100)), `routing_number` (VARCHAR(50)), `swift_bic` (VARCHAR(20)), `provider` (VARCHAR(50)), `provider_reference` (VARCHAR(100)), `status`.
- `beneficiaries`: `id`, `user_id` (FK), `name`, `account_number`, `bank_name`, `bank_code`, `routing_number`, `swift_bic`, `currency`, `is_active` (BOOLEAN), `created_at`.
- `deposits`: `id`, `transaction_id` (UNIQUE FK), `account_id` (FK), `method` (ENUM('BANK_TRANSFER', 'CARD', 'GATEWAY', 'MANUAL', 'ADMIN_CREDIT')), `payment_reference`, `proof_document_url`, `status`, `approved_by` (FK Nullable).
- `withdrawals`: `id`, `transaction_id` (UNIQUE FK), `account_id` (FK), `amount`, `destination_details` (JSON), `status`, `approved_by` (FK Nullable), `rejection_reason`.

### 4.6 Loans & Credit
- `loan_products`: `id`, `name`, `min_amount` (DECIMAL(18, 4)), `max_amount` (DECIMAL(18, 4)), `interest_rate` (DECIMAL(5, 2)), `interest_type` (ENUM('FLAT', 'REDUCING_BALANCE')), `min_tenure_months`, `max_tenure_months`, `processing_fee_percentage`, `late_penalty_percentage`, `is_active`.
- `loan_applications`: `id`, `user_id` (FK), `product_id` (FK), `account_id` (FK for disbursement), `principal_amount` (DECIMAL(18, 4)), `tenure_months` (INT), `interest_amount` (DECIMAL(18, 4)), `total_repayable` (DECIMAL(18, 4)), `outstanding_balance` (DECIMAL(18, 4)), `purpose` (TEXT), `status` (ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DISBURSED', 'ACTIVE', 'COMPLETED', 'DEFAULTED', 'CANCELLED')), `reviewed_by` (FK Nullable), `created_at`.
- `loan_schedules`: `id`, `loan_id` (FK), `installment_number` (INT), `due_date` (DATE), `principal_due` (DECIMAL(18, 4)), `interest_due` (DECIMAL(18, 4)), `fee_due` (DECIMAL(18, 4)), `total_due` (DECIMAL(18, 4)), `amount_paid` (DECIMAL(18, 4) DEFAULT 0.0000), `status` (ENUM('PENDING', 'PAID', 'PARTIAL', 'OVERDUE')), `paid_at`.

### 4.7 Savings & Fixed Deposits
- `savings_accounts`: `id`, `user_id` (FK), `account_id` (FK), `type` (ENUM('REGULAR', 'TARGET', 'FIXED_DEPOSIT')), `title` (VARCHAR(150)), `target_amount` (DECIMAL(18, 4)), `current_amount` (DECIMAL(18, 4) DEFAULT 0.0000), `interest_rate` (DECIMAL(5, 2)), `start_date` (DATE), `maturity_date` (DATE Nullable), `auto_debit_frequency` (ENUM('NONE', 'DAILY', 'WEEKLY', 'MONTHLY')), `auto_debit_amount` (DECIMAL(18, 4)), `status` (ENUM('ACTIVE', 'MATURED', 'BROKEN', 'CLOSED')).

### 4.8 Cards
- `cards`: `id`, `user_id` (FK), `account_id` (FK), `card_type` (ENUM('VIRTUAL', 'PHYSICAL')), `brand` (ENUM('VISA', 'MASTERCARD')), `masked_pan` (VARCHAR(20)), `token_reference` (VARCHAR(255)), `expiry_month` (INT), `expiry_year` (INT), `spending_limit_monthly` (DECIMAL(18, 4)), `is_frozen` (BOOLEAN DEFAULT false), `status` (ENUM('ACTIVE', 'INACTIVE', 'BLOCKED', 'EXPIRED')).

### 4.9 Audit Logs & System Settings
- `audit_logs`: `id`, `actor_id` (VARCHAR(36) Nullable), `actor_role` (VARCHAR(50)), `action` (VARCHAR(100)), `resource` (VARCHAR(100)), `resource_id` (VARCHAR(100)), `ip_address` (VARCHAR(45)), `user_agent` (TEXT), `before_state` (JSON Nullable), `after_state` (JSON Nullable), `created_at` (DATETIME(3)).
- `system_settings`: `key` (VARCHAR(100) PK), `value` (LONGTEXT), `group_name` (VARCHAR(50)), `is_encrypted` (BOOLEAN DEFAULT false), `updated_at`.

---

## 5. MySQL Indexing Strategy

```sql
-- High-frequency lookups and constraints
CREATE UNIQUE INDEX uq_users_email ON users(email);
CREATE UNIQUE INDEX uq_users_username ON users(username);
CREATE UNIQUE INDEX uq_bank_accounts_number ON bank_accounts(account_number);
CREATE UNIQUE INDEX uq_transactions_ref ON transactions(reference);
CREATE UNIQUE INDEX uq_transactions_idempotency ON transactions(idempotency_key);
CREATE UNIQUE INDEX uq_journal_ref ON journal_transactions(reference);

-- Composite & Performance Indexes
CREATE INDEX idx_transactions_user_status ON transactions(user_id, status, created_at DESC);
CREATE INDEX idx_transactions_source_acc ON transactions(source_account_id, created_at DESC);
CREATE INDEX idx_transactions_dest_acc ON transactions(destination_account_id, created_at DESC);
CREATE INDEX idx_ledger_entries_account ON ledger_entries(ledger_account_id, created_at DESC);
CREATE INDEX idx_ledger_entries_journal ON ledger_entries(journal_transaction_id);
CREATE INDEX idx_loans_user_status ON loan_applications(user_id, status);
CREATE INDEX idx_kyc_status ON kyc_profiles(status);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource, resource_id, created_at DESC);
```

