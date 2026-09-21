# Silverhawk Banking Platform — Frontend API Requirements

## 1. Global Standard Response Format

All REST API endpoints adhere strictly to the standardized envelope structure:

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {},
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

Error responses:
```json
{
  "success": false,
  "errorCode": "INSUFFICIENT_FUNDS",
  "message": "The account balance is insufficient for this transaction.",
  "errors": []
}
```

---

## 2. Authentication & Session Management

### `POST /api/v1/auth/register`
- **Description**: Registers a new customer account based on the 4-step wizard.
- **Request Body**:
  ```json
  {
    "firstName": "John",
    "lastName": "Smith",
    "middleName": "David",
    "username": "johnsmith123",
    "email": "john@example.com",
    "phone": "+12345678901",
    "country": "United States of America",
    "currency": "USD",
    "accountType": "Checking Account",
    "pin": "1234",
    "password": "SecurePassword123!",
    "passwordConfirmation": "SecurePassword123!",
    "termsAccepted": true
  }
  ```
- **Response**: `201 Created` with user details, generated account number, and access/refresh token pair.

### `POST /api/v1/auth/login`
- **Description**: Authenticates a user or administrator.
- **Request Body**:
  ```json
  {
    "email": "john@example.com",
    "password": "SecurePassword123!",
    "rememberMe": true
  }
  ```
- **Response**: `200 OK` with user profile, roles, permissions, JWT access token, and HTTP-only refresh cookie.

### `POST /api/v1/auth/refresh-token`
- **Description**: Rotates the access token using the valid refresh token.

### `POST /api/v1/auth/forgot-password`
- **Description**: Initiates a password reset email containing a time-limited signed token.
- **Request Body**: `{ "email": "john@example.com" }`

### `POST /api/v1/auth/reset-password`
- **Description**: Resets password using token.
- **Request Body**: `{ "token": "...", "password": "...", "passwordConfirmation": "..." }`

### `POST /api/v1/auth/verify-code`
- **Description**: Verifies 2FA / bot / security PIN.
- **Request Body**: `{ "code": "580448" }`

---

## 3. Accounts & Ledger Balance Endpoints

### `GET /api/v1/accounts/summary`
- **Auth**: Customer Bearer Token
- **Response**:
  ```json
  {
    "totalBalance": "124500.0000",
    "availableBalance": "120000.0000",
    "pendingBalance": "4500.0000",
    "savingsBalance": "35000.0000",
    "loanBalance": "12000.0000",
    "currency": "USD",
    "accounts": [
      {
        "id": "acc_01...",
        "accountNumber": "1002384912",
        "accountName": "John Smith - Primary Checking",
        "type": "CHECKING",
        "currency": "USD",
        "balance": "120000.0000",
        "ledgerBalance": "124500.0000",
        "status": "ACTIVE"
      }
    ]
  }
  ```

### `GET /api/v1/accounts/:id/statement`
- **Query Params**: `startDate`, `endDate`, `type`, `page`, `limit`
- **Response**: Paginated transactions and opening/closing balances calculated from the double-entry ledger.

---

## 4. Transfers & Beneficiaries

### `POST /api/v1/transfers/internal`
- **Description**: Transfers funds between Silverhawk accounts (immediate atomic settlement).
- **Request Body**:
  ```json
  {
    "sourceAccountId": "acc_01...",
    "destinationAccountNumber": "1002384999",
    "amount": "1500.00",
    "currency": "USD",
    "description": "Monthly rent split",
    "pin": "1234",
    "idempotencyKey": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
  }
  ```

### `POST /api/v1/transfers/external`
- **Description**: Dispatches outbound transfer to external bank via payment provider abstraction.
- **Request Body**:
  ```json
  {
    "sourceAccountId": "acc_01...",
    "bankCode": "044",
    "bankName": "Barclays Bank",
    "accountNumber": "9876543210",
    "accountName": "Jane Doe",
    "routingNumber": "123456789",
    "swiftBic": "BARCGB22",
    "amount": "2500.00",
    "currency": "GBP",
    "pin": "1234",
    "idempotencyKey": "e89fa416-202b-49f1-aec6-e151459d9b3b"
  }
  ```

### `GET /api/v1/beneficiaries` & `POST /api/v1/beneficiaries`
- **Description**: List, save, and manage frequent recipients.

---

## 5. Deposits & Withdrawals

### `POST /api/v1/deposits/initiate`
- **Request Body**: `{ "accountId": "acc_01...", "amount": "5000.00", "currency": "USD", "method": "BANK_TRANSFER" }`
- **Response**: Unique deposit reference and bank account instructions / payment gateway checkout link.

### `POST /api/v1/withdrawals/request`
- **Request Body**: `{ "accountId": "acc_01...", "amount": "1000.00", "destinationBankId": "...", "pin": "1234" }`
- **Response**: Created withdrawal request with status `UNDER_REVIEW` or `PROCESSING`.

---

## 6. Cards Hub

### `GET /api/v1/cards`
- **Response**: List of virtual/physical cards, masked card numbers, status, balance, daily spending limit.

### `POST /api/v1/cards/:id/freeze`
- **Description**: Instantly freezes/unfreezes a card.

### `POST /api/v1/cards/:id/reveal`
- **Description**: Validates PIN/password and securely returns tokenized PAN, CVV, and expiry date.

---

## 7. Loans & Credit

### `GET /api/v1/loans/products`
- **Response**: Available loan products, minimum/maximum amounts, interest rates, tenure options.

### `POST /api/v1/loans/apply`
- **Request Body**: `{ "productId": "loan_prod_01", "amount": "25000.00", "tenureMonths": 12, "purpose": "Business expansion" }`

### `GET /api/v1/loans/active` & `POST /api/v1/loans/:id/repay`
- **Description**: View loan balance, next installment date, amortization schedule, and submit repayment.

---

## 8. Savings & Fixed Deposits

### `GET /api/v1/savings` & `POST /api/v1/savings/create`
- **Types**: `REGULAR_SAVINGS`, `TARGET_SAVINGS`, `FIXED_DEPOSIT`
- **Fields**: Target amount, target date, auto-debit frequency, lockup tenure, interest rate.

---

## 9. KYC & Compliance

### `POST /api/v1/kyc/submit`
- **Form Data**: Government ID, Proof of Address, Selfie image, Date of birth, Nationality, Residential address.
- **Response**: `200 OK` with status `PENDING` review.

---

## 10. Admin & Staff API Endpoints

- `GET /api/v1/admin/dashboard/stats`: Aggregated live metrics (Deposits, Withdrawals, Active Users, System Assets/Liabilities).
- `GET /api/v1/admin/users`: Paginated customer search, filters, status toggles.
- `POST /api/v1/admin/users/:id/freeze`: Account lock/freeze.
- `POST /api/v1/admin/transactions/adjust`: Controlled manual credit/debit with mandatory audit reason and ledger entry.
- `POST /api/v1/admin/transactions/:id/reverse`: Immutable compensating reversal transaction.
- `POST /api/v1/admin/deposits/:id/approve` & `POST /api/v1/admin/deposits/:id/reject`: Deposit desk workflow.
- `POST /api/v1/admin/withdrawals/:id/approve` & `POST /api/v1/admin/withdrawals/:id/reject`: Outbound payout desk.
- `POST /api/v1/admin/kyc/:id/review`: KYC compliance approval/rejection with review notes.
- `GET /api/v1/admin/ledger/journal`: Full double-entry ledger stream.
- `GET /api/v1/admin/settings` & `PUT /api/v1/admin/settings`: Dynamic system configuration.

