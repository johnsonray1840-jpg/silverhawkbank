/**
 * Silverhawk Digital Banking API Client & UI Bridge
 * Production-ready asynchronous fetch client connecting frontend UI to NestJS API
 */

(function (window) {
  'use strict';

  const API_BASE_URL = (function () {
    if (typeof window !== 'undefined') {
      if (window.SILVERHAWK_API_URL) return window.SILVERHAWK_API_URL;
      if (window.location && window.location.origin) {
        return window.location.origin + '/api/v1';
      }
    }
    return '/api/v1';
  })();

  class SilverhawkClient {
    constructor() {
      this.baseUrl = API_BASE_URL;
    }

    // Token Storage Helpers
    getAccessToken() {
      return localStorage.getItem('silverhawk_access_token');
    }

    getRefreshToken() {
      return localStorage.getItem('silverhawk_refresh_token');
    }

    getUser() {
      try {
        const user = localStorage.getItem('silverhawk_user');
        return user ? JSON.parse(user) : null;
      } catch {
        localStorage.removeItem('silverhawk_user');
        return null;
      }
    }

    setAuth(accessToken, refreshToken, user) {
      if (accessToken) localStorage.setItem('silverhawk_access_token', accessToken);
      if (refreshToken) localStorage.setItem('silverhawk_refresh_token', refreshToken);
      if (user) {
        localStorage.setItem('silverhawk_user', JSON.stringify(user));
        this.syncUserToAdmin(user);
      }
    }

    syncUserToAdmin(user, initialAccount = null) {
      if (!window.SILVERHAWK_DEMO_MODE) return;
      if (!user || !user.email) return;
      try {
        const usersKey = 'silverhawk_admin_mock_users';
        const accountsKey = 'silverhawk_admin_mock_accounts';
        
        let users = [];
        try { users = JSON.parse(localStorage.getItem(usersKey) || '[]'); } catch (e) { users = []; }
        
        const existingIdx = users.findIndex(u => u.id === user.id || u.email === user.email || u.username === user.username);
        const userData = {
          id: user.id || `usr_${Date.now()}`,
          username: user.username || user.email.split('@')[0],
          email: user.email,
          roles: user.roles || ['CUSTOMER'],
          status: user.status || 'ACTIVE',
          kycTier: user.kycTier || user.kycProfile?.tier || 'TIER_3',
          profile: user.profile || {
            firstName: user.firstName || user.name || 'Personal',
            lastName: user.lastName || user.lastname || 'Account',
            phone: user.phone || '+1 (555) 019-2834',
            country: user.country || 'United States',
          },
          createdAt: user.createdAt || new Date().toISOString()
        };

        if (existingIdx >= 0) {
          users[existingIdx] = { ...users[existingIdx], ...userData };
        } else {
          users.unshift(userData);
        }
        localStorage.setItem(usersKey, JSON.stringify(users));

        // Sync bank accounts
        let accounts = [];
        try { accounts = JSON.parse(localStorage.getItem(accountsKey) || '[]'); } catch (e) { accounts = []; }
        
        const hasAcc = accounts.some(a => a.userId === userData.id);
        if (!hasAcc) {
          const chosenType = initialAccount?.type || userData.account?.type || 'CHECKING';
          const chosenCurr = initialAccount?.currencyCode || userData.account?.currency || 'USD';
          const chosenName = initialAccount?.accountName || userData.account?.accountName || `${userData.profile.firstName}'s ${chosenType.replace('_', ' ')} Account`;
          const newAcc = initialAccount || {
            id: `acc_${userData.id.replace('usr_', '')}_chk`,
            userId: userData.id,
            accountNumber: '4089' + Math.floor(100000 + Math.random() * 900000),
            accountName: chosenName,
            type: chosenType,
            currencyCode: chosenCurr,
            status: 'ACTIVE',
            currentBalance: '50000.00',
            availableBalance: '50000.00',
            ledgerBalance: '50000.00',
            isPrimary: true,
            createdAt: new Date().toISOString()
          };
          accounts.unshift(newAcc);
          localStorage.setItem(accountsKey, JSON.stringify(accounts));
        }
      } catch (err) {
        console.warn('Sync to admin error:', err);
      }
    }

    clearAuth() {
      localStorage.removeItem('silverhawk_access_token');
      localStorage.removeItem('silverhawk_refresh_token');
      localStorage.removeItem('silverhawk_user');
    }

    isAuthenticated() {
      return !!this.getAccessToken();
    }

    // Generic HTTP Request Wrapper with 401 Auto-Refresh
    async request(endpoint, options = {}) {
      const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
      const headers = {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {}),
      };

      const token = this.getAccessToken();
      if (token && !headers['Authorization']) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const config = {
        ...options,
        headers,
      };

      if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
        config.body = JSON.stringify(config.body);
      }

      try {
        let response = await fetch(url, config);

        // If 401 and refresh token available, attempt refresh once
        if (response.status === 401 && this.getRefreshToken() && !endpoint.includes('/auth/refresh')) {
          const refreshed = await this.refreshToken();
          if (refreshed) {
            headers['Authorization'] = `Bearer ${this.getAccessToken()}`;
            config.headers = headers;
            response = await fetch(url, config);
          } else {
            this.clearAuth();
            if (!window.location.pathname.includes('login') && !window.location.pathname.includes('register')) {
              window.location.href = '/login.html';
            }
          }
        }

        let data = null;
        const text = await response.text();
        if (text) {
          try { data = JSON.parse(text); } catch { data = { raw: text }; }
        }

        if (!response.ok) {
          const errorMsg = data?.message || data?.error?.message || 'An error occurred during request';
          throw new Error(Array.isArray(errorMsg) ? errorMsg.join(', ') : errorMsg);
        }

        // Return unpacked envelope data or root object
        return data !== null && data.data !== undefined ? data.data : data;
      } catch (err) {
        if (err.name === 'TypeError' && err.message.includes('fetch')) {
          console.error(`[Silverhawk API Error] Unable to connect to backend server at ${this.baseUrl}.`);
          throw new Error('Banking engine API is currently unreachable. Please ensure the backend server is running.');
        }
        console.error(`[Silverhawk API Error] ${endpoint}:`, err);
        throw err;
      }
    }

    // Refresh Token Rotation
    async refreshToken() {
      try {
        const refresh = this.getRefreshToken();
        if (!refresh) return false;

        const res = await fetch(`${this.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: refresh }),
        });

        if (!res.ok) return false;
        const data = await res.json();
        const tokens = data.data || data;
        if (tokens.accessToken) {
          this.setAuth(tokens.accessToken, tokens.refreshToken || refresh);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    }

    // ----------------------------------------------------
    // Auth Endpoints
    // ----------------------------------------------------
    async login(identifier, password, rememberMe = false) {
      const res = await this.request('/auth/login', {
        method: 'POST',
        body: { identifier, password, rememberMe },
      });
      if (res.tokens) {
        this.setAuth(res.tokens.accessToken, res.tokens.refreshToken, res.user);
      }
      return res;
    }

    async register(data) {
      const res = await this.request('/auth/register', {
        method: 'POST',
        body: data,
      });
      if (res.tokens) {
        this.setAuth(res.tokens.accessToken, res.tokens.refreshToken, res.user);
      }
      return res;
    }

    async verifyOtp(identifier, code, type = 'EMAIL_VERIFICATION') {
      const res = await this.request('/auth/verify-otp', {
        method: 'POST',
        body: { identifier, email: identifier, code, type },
      });
      if (res && res.tokens) {
        this.setAuth(res.tokens.accessToken, res.tokens.refreshToken, res.user);
      }
      return res;
    }

    async resendOtp(identifier, type = 'EMAIL_VERIFICATION') {
      return this.request('/auth/resend-otp', {
        method: 'POST',
        body: { identifier, type },
      });
    }

    async forgotPassword(email) {
      return this.request('/auth/forgot-password', {
        method: 'POST',
        body: { email },
      });
    }

    async resetPassword(token, newPassword) {
      return this.request('/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword },
      });
    }

    async logout() {
      try {
        await this.request('/auth/logout', { method: 'POST' });
      } finally {
        this.clearAuth();
        window.location.href = '/login.html';
      }
    }

    // ----------------------------------------------------
    // User Profile, Security & Settings
    // ----------------------------------------------------
    async getProfile() {
      return this.request('/users/profile');
    }

    async updateProfile(data) {
      const res = await this.request('/users/profile', {
        method: 'PUT',
        body: data,
      });
      if (res) {
        const currentUser = this.getUser() || {};
        const updated = { ...currentUser, ...res, profile: { ...(currentUser.profile || {}), ...(res.profile || res) } };
        localStorage.setItem('silverhawk_user', JSON.stringify(updated));
      }
      return res;
    }

    async changePassword(currentPassword, newPassword, newPasswordConfirmation) {
      return this.request('/auth/change-password', {
        method: 'POST',
        body: {
          currentPassword,
          newPassword,
          newPasswordConfirmation: newPasswordConfirmation || newPassword,
        },
      });
    }

    async changePin(currentPin, newPin, newPinConfirmation) {
      return this.request('/auth/change-pin', {
        method: 'POST',
        body: {
          currentPin,
          newPin,
          newPinConfirmation: newPinConfirmation || newPin,
        },
      });
    }

    async toggleTwoFactor(enabled) {
      return this.request('/users/2fa', {
        method: 'PUT',
        body: { enabled: !!enabled },
      });
    }

    async askCopilot(query) {
      return this.request('/copilot/query', {
        method: 'POST',
        body: { query },
      });
    }

    // ----------------------------------------------------
    // ----------------------------------------------------
    // Bank Accounts & Dashboard
    // ----------------------------------------------------
    async getDashboardSummary() {
      return this.request('/accounts/summary');
    }

    async getAccountDetails(id) {
      return this.request(`/accounts/${id}`);
    }

    async getStatement(accountId, query = {}) {
      const params = new URLSearchParams(query).toString();
      return this.request(`/accounts/${accountId}/statement?${params}`);
    }

    // ----------------------------------------------------
    // Transfers & Beneficiaries
    // ----------------------------------------------------
    async lookupAccount(accountNumber) {
      return this.request(`/beneficiaries/resolve-internal/${encodeURIComponent(accountNumber)}`);
    }

    async getBeneficiaries(query = {}) {
      const params = new URLSearchParams(query).toString();
      return this.request(`/beneficiaries?${params}`);
    }

    async createBeneficiary(data) {
      return this.request('/beneficiaries', {
        method: 'POST',
        body: data,
      });
    }

    async deleteBeneficiary(id) {
      return this.request(`/beneficiaries/${id}`, {
        method: 'DELETE',
      });
    }

    async getTransactions(query = {}) {
      const params = new URLSearchParams(query).toString();
      return this.request(`/transactions?${params}`);
    }

    async getTransactionReceipt(transactionId) {
      return this.request(`/transactions/${encodeURIComponent(transactionId)}/receipt`);
    }

    async sendTransferOtp(data) {
      return this.request('/transfers/send-otp', {
        method: 'POST',
        body: data,
      });
    }

    async transfer(data) {
      return this.request('/transfers/internal', {
        method: 'POST',
        body: data,
      });
    }

    async transferInternal(data) {
      return this.request('/transfers/internal', {
        method: 'POST',
        body: data,
      });
    }

    async transferExternal(data) {
      return this.request('/transfers/wire', {
        method: 'POST',
        body: data,
      });
    }

    async transferInternational(data) {
      return this.request('/transfers/international', {
        method: 'POST',
        body: data,
      });
    }

    // ----------------------------------------------------
    // Currency Swap & Spot FX Desk (Swap from Registered Currency to BTC)
    // ----------------------------------------------------
    async getCurrencies() {
      return this.request('/currencies');
    }

    async getExchangeQuote(fromCurrency, toCurrency, amount) {
      return this.request('/currencies/quote', {
        method: 'POST',
        body: { fromCurrency, toCurrency, amount: String(amount) },
      });
    }

    async swapCurrency(data) {
      return this.request('/currencies/swap', {
        method: 'POST',
        body: data,
      });
    }

    // ----------------------------------------------------
    // Deposits & Withdrawals
    // ----------------------------------------------------
    async createDeposit(data) {
      return this.request('/deposits', {
        method: 'POST',
        body: data,
      });
    }

    async getDeposits() {
      return this.request('/deposits');
    }

    async claimTaxRefund(data) {
      return this.request('/deposits/tax-refund', {
        method: 'POST',
        body: data,
      });
    }

    async requestWithdrawal(data) {
      return this.request('/withdrawals', {
        method: 'POST',
        body: data,
      });
    }

    async getWithdrawals() {
      return this.request('/withdrawals');
    }

    // ----------------------------------------------------
    // Standing Orders (Recurring Payments)
    // ----------------------------------------------------
    async createStandingOrder(data) {
      return this.request('/transfers/standing-orders', {
        method: 'POST',
        body: data,
      });
    }

    async getStandingOrders() {
      return this.request('/transfers/standing-orders');
    }

    async getStandingOrder(id) {
      return this.request(`/transfers/standing-orders/${id}`);
    }

    async toggleStandingOrder(id) {
      return this.request(`/transfers/standing-orders/${id}/toggle`, {
        method: 'PATCH',
      });
    }

    async cancelStandingOrder(id) {
      return this.request(`/transfers/standing-orders/${id}`, {
        method: 'DELETE',
      });
    }

    // ----------------------------------------------------
    // P2P Cashlinks
    // ----------------------------------------------------
    async createCashlink(data) {
      return this.request('/transfers/cashlinks', {
        method: 'POST',
        body: data,
      });
    }

    async getCashlinkPreview(code) {
      return this.request(`/transfers/cashlinks/${code}`);
    }

    async claimCashlink(data) {
      return this.request('/transfers/cashlinks/claim', {
        method: 'POST',
        body: data,
      });
    }

    async cancelCashlink(code) {
      return this.request(`/transfers/cashlinks/${code}`, {
        method: 'DELETE',
      });
    }

    // ----------------------------------------------------
    // Treasury FX Hedging & Forward Contracts
    // ----------------------------------------------------
    async getForwardQuote(data) {
      return this.request('/hedging/quotes', {
        method: 'POST',
        body: data,
      });
    }

    async bookForwardContract(data) {
      return this.request('/hedging/contracts/book', {
        method: 'POST',
        body: data,
      });
    }

    async listForwardContracts(status) {
      const qs = status ? `?status=${encodeURIComponent(status)}` : '';
      return this.request(`/hedging/contracts${qs}`);
    }

    async getForwardContract(id) {
      return this.request(`/hedging/contracts/${id}`);
    }

    async settleForwardContract(id, data = {}) {
      return this.request(`/hedging/contracts/${id}/settle`, {
        method: 'POST',
        body: data,
      });
    }

    async rolloverForwardContract(id, data) {
      return this.request(`/hedging/contracts/${id}/rollover`, {
        method: 'POST',
        body: data,
      });
    }

    // ----------------------------------------------------
    // Savings & Term Deposits & Goals
    // ----------------------------------------------------
    async createSavings(data) {
      return this.request('/savings', {
        method: 'POST',
        body: data,
      });
    }

    async getSavingsList() {
      return this.request('/savings');
    }

    async getSavingsById(id) {
      return this.request(`/savings/${id}`);
    }

    async createSavingsGoal(data) {
      return this.request('/savings/goals', {
        method: 'POST',
        body: data,
      });
    }

    async getUserSavingsGoals() {
      return this.request('/savings/goals');
    }

    async calculateCompoundInterest(data) {
      return this.request('/savings/calculator', {
        method: 'POST',
        body: data,
      });
    }

    async toggleGoalRoundUp(goalId, data) {
      return this.request(`/savings/goals/${goalId}/roundup-toggle`, {
        method: 'POST',
        body: data,
      });
    }

    async processRoundUpSweep(data) {
      return this.request('/savings/process-roundups', {
        method: 'POST',
        body: data,
      });
    }

    async accrueCompoundInterest(data = {}) {
      return this.request('/savings/accrue-interest', {
        method: 'POST',
        body: data,
      });
    }

    // ----------------------------------------------------
    // Loans
    // ----------------------------------------------------
    async getLoanProducts() {
      return this.request('/loans/products');
    }

    async calculateLoan(data) {
      return this.request('/loans/calculate', {
        method: 'POST',
        body: data,
      });
    }

    async applyLoan(data) {
      return this.request('/loans/apply', {
        method: 'POST',
        body: data,
      });
    }

    async getLoans() {
      return this.request('/loans');
    }

    // ----------------------------------------------------
    // Enterprise & Business Grants
    // ----------------------------------------------------
    async getGrantPrograms() {
      return this.request('/grants/programs');
    }

    async applyForGrant(data) {
      return this.request('/grants/apply', {
        method: 'POST',
        body: data,
      });
    }

    async getUserGrants() {
      return this.request('/grants/applications');
    }

    async getGrantById(id) {
      return this.request(`/grants/applications/${id}`);
    }

    async disburseGrant(id, data = {}) {
      return this.request(`/grants/applications/${id}/disburse`, {
        method: 'POST',
        body: data,
      });
    }

    // ----------------------------------------------------
    // Cards
    // ----------------------------------------------------
    async issueCard(data) {
      return this.request('/cards/issue', {
        method: 'POST',
        body: data,
      });
    }

    async getCards() {
      return this.request('/cards');
    }

    async getCardById(id) {
      return this.request(`/cards/${id}`);
    }

    async revealCard(id, pin) {
      return this.request(`/cards/${id}/reveal`, {
        method: 'POST',
        body: { pin },
      });
    }

    async freezeCard(id) {
      return this.request(`/cards/${id}/freeze`, {
        method: 'POST',
      });
    }

    // ----------------------------------------------------
    // Notifications & Support
    // ----------------------------------------------------
    async getNotifications(query = {}) {
      const params = new URLSearchParams(query).toString();
      return this.request(`/notifications?${params}`);
    }

    async markNotificationRead(id) {
      return this.request(`/notifications/${id}/read`, { method: 'PATCH' });
    }

    async markAllNotificationsRead() {
      return this.request('/notifications/read-all', { method: 'PATCH' });
    }

    async createSupportTicket(data) {
      return this.request('/support/tickets', {
        method: 'POST',
        body: data,
      });
    }

    // ----------------------------------------------------
    // Phase 36: Merchant POS, Hosted Payment Links & Checkout
    // ----------------------------------------------------
    async generateMerchantQr(data) {
      return this.request('/merchants/qr/generate', {
        method: 'POST',
        body: data,
      });
    }

    async resolveMerchantQr(data) {
      return this.request('/merchants/qr/resolve', {
        method: 'POST',
        body: data,
      });
    }

    async payMerchantQr(data) {
      return this.request('/merchants/qr/pay', {
        method: 'POST',
        body: data,
      });
    }

    async createMerchantPaymentLink(data) {
      return this.request('/merchants/payment-links', {
        method: 'POST',
        body: data,
      });
    }

    async getMerchantPaymentLinks() {
      return this.request('/merchants/payment-links');
    }

    async getPublicPaymentLink(id) {
      return this.request(`/merchants/payment-links/${id}`);
    }

    async payMerchantPaymentLink(id, data) {
      return this.request(`/merchants/payment-links/${id}/pay`, {
        method: 'POST',
        body: data,
      });
    }

    async chargeMerchantPos(data) {
      return this.request('/merchants/pos/charge', {
        method: 'POST',
        body: data,
      });
    }

    async getMerchantAnalytics(query = {}) {
      const params = new URLSearchParams(query).toString();
      return this.request(`/merchants/analytics?${params}`);
    }

    // ----------------------------------------------------
    // Phase 29: AI Financial Copilot & Wealth Intelligence
    // ----------------------------------------------------
    async queryCopilot(query) {
      return this.request('/copilot/query', {
        method: 'POST',
        body: { query },
      });
    }

    async getCopilotInsights() {
      return this.request('/copilot/insights');
    }

    async getCopilotSubscriptions() {
      return this.request('/copilot/subscriptions');
    }

    async getCopilotForecast() {
      return this.request('/copilot/cashflow-forecast');
    }

    // ----------------------------------------------------
    // Phase 30: Multi-Party Collaborative Treasury & Multi-Sig
    // ----------------------------------------------------
    async createTreasuryVault(data) {
      return this.request('/treasury/vaults', {
        method: 'POST',
        body: data,
      });
    }

    async listTreasuryVaults() {
      return this.request('/treasury/vaults');
    }

    async addTreasuryMember(vaultId, data) {
      return this.request(`/treasury/vaults/${vaultId}/members`, {
        method: 'POST',
        body: data,
      });
    }

    async initiateTreasuryTransfer(vaultId, data) {
      return this.request(`/treasury/vaults/${vaultId}/transfers`, {
        method: 'POST',
        body: data,
      });
    }

    async listTreasuryRequests(vaultId) {
      return this.request(`/treasury/vaults/${vaultId}/requests`);
    }

    async approveTreasuryRequest(requestId, comment) {
      return this.request(`/treasury/requests/${requestId}/approve`, {
        method: 'POST',
        body: { comment },
      });
    }

    async rejectTreasuryRequest(requestId, reason) {
      return this.request(`/treasury/requests/${requestId}/reject`, {
        method: 'POST',
        body: { reason },
      });
    }

    async executeTreasurySweep(vaultId) {
      return this.request(`/treasury/vaults/${vaultId}/sweep`, {
        method: 'POST',
      });
    }

    // ----------------------------------------------------
    // Phase 31: Programmable Smart Escrow & Milestone Settlements
    // ----------------------------------------------------
    async createEscrowContract(data) {
      return this.request('/escrow/contracts', {
        method: 'POST',
        body: data,
      });
    }

    async listEscrowContracts() {
      return this.request('/escrow/contracts');
    }

    async getEscrowContract(id) {
      return this.request(`/escrow/contracts/${id}`);
    }

    async fundEscrowContract(id) {
      return this.request(`/escrow/contracts/${id}/fund`, {
        method: 'POST',
      });
    }

    async submitEscrowMilestone(id, milestoneId, deliverableProof) {
      return this.request(`/escrow/contracts/${id}/milestones/${milestoneId}/submit`, {
        method: 'POST',
        body: { deliverableProof },
      });
    }

    async approveEscrowMilestone(id, milestoneId, remarks) {
      return this.request(`/escrow/contracts/${id}/milestones/${milestoneId}/approve`, {
        method: 'POST',
        body: { remarks },
      });
    }

    async raiseEscrowDispute(id, disputeReason, evidenceUrl) {
      return this.request(`/escrow/contracts/${id}/dispute`, {
        method: 'POST',
        body: { disputeReason, evidenceUrl },
      });
    }

    // ----------------------------------------------------
    // Phase 26: FIDO2 / WebAuthn Biometric Passkeys
    // ----------------------------------------------------
    async getPasskeyRegisterChallenge() {
      return this.request('/auth/passkeys/register-challenge', {
        method: 'POST',
      });
    }

    async verifyPasskeyRegister(data) {
      return this.request('/auth/passkeys/register-verify', {
        method: 'POST',
        body: data,
      });
    }

    async listPasskeys() {
      return this.request('/auth/passkeys');
    }

    // ----------------------------------------------------
    // Phase 24: Developer Scoped API Keys
    // ----------------------------------------------------
    async createApiKey(data) {
      return this.request('/auth/api-keys', {
        method: 'POST',
        body: data,
      });
    }

    async listApiKeys() {
      return this.request('/auth/api-keys');
    }

    async revokeApiKey(id) {
      return this.request(`/auth/api-keys/${id}`, {
        method: 'DELETE',
      });
    }

    // ----------------------------------------------------
    // Phase 28: AML / Sanctions & Compliance Center
    // ----------------------------------------------------
    async screenComplianceEntity(entityName, entityType = 'INDIVIDUAL', countryCode = 'US') {
      return this.request('/compliance/screen', {
        method: 'POST',
        body: { entityName, entityType, countryCode },
      });
    }

    async getComplianceAlerts(status) {
      const q = status ? `?status=${status}` : '';
      return this.request(`/compliance/alerts${q}`);
    }

    async resolveComplianceAlert(id, status, resolutionNotes) {
      return this.request(`/compliance/alerts/${id}/resolve`, {
        method: 'PATCH',
        body: { status, resolutionNotes },
      });
    }

    async fileComplianceSar(data) {
      return this.request('/compliance/sar', {
        method: 'POST',
        body: data,
      });
    }

    // ----------------------------------------------------
    // Corporate Bulk Payroll & Tax Withholding
    // ----------------------------------------------------
    async createPayrollBatch(data) {
      return this.request('/payroll/batches', {
        method: 'POST',
        body: data,
      });
    }

    async listPayrollBatches() {
      return this.request('/payroll/batches');
    }

    async getPayrollBatch(id) {
      return this.request(`/payroll/batches/${id}`);
    }

    async addPayrollEmployees(id, data) {
      return this.request(`/payroll/batches/${id}/employees`, {
        method: 'POST',
        body: data,
      });
    }

    async executePayrollBatch(id) {
      return this.request(`/payroll/batches/${id}/execute`, {
        method: 'POST',
      });
    }

    async exportPayrollIso20022(id) {
      const token = this.getAccessToken();
      const res = await fetch(`${this.baseUrl}/payroll/batches/${id}/export/iso20022`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.text();
    }

    async exportPayrollNacha(id) {
      const token = this.getAccessToken();
      const res = await fetch(`${this.baseUrl}/payroll/batches/${id}/export/nacha`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.text();
    }

    // ----------------------------------------------------
    // B2B Invoicing, Accounts Receivable & Factoring
    // ----------------------------------------------------
    async createInvoice(data) {
      return this.request('/invoicing/invoices', {
        method: 'POST',
        body: data,
      });
    }

    async issueInvoice(id) {
      return this.request(`/invoicing/invoices/${id}/issue`, {
        method: 'POST',
      });
    }

    async recordInvoicePayment(data) {
      return this.request('/invoicing/payments/record', {
        method: 'POST',
        body: data,
      });
    }

    async applyInvoiceFactoring(data) {
      return this.request('/invoicing/factoring/apply', {
        method: 'POST',
        body: data,
      });
    }

    async listInvoices(status) {
      const q = status ? `?status=${status}` : '';
      return this.request(`/invoicing/invoices${q}`);
    }

    async getInvoice(id) {
      return this.request(`/invoicing/invoices/${id}`);
    }

    // ----------------------------------------------------
    // Customer KYC & Identity Verification
    // ----------------------------------------------------
    async getKycStatus() {
      return this.request('/kyc/status');
    }

    async uploadKycDocument(formData) {
      return this.request('/kyc/upload', {
        method: 'POST',
        body: formData,
      });
    }

    async submitKyc(data) {
      return this.request('/kyc/submit', {
        method: 'POST',
        body: data,
      });
    }

    // ----------------------------------------------------
    // Customer Referrals & Double-Entry Rewards
    // ----------------------------------------------------
    async getMyReferralCode() {
      return this.request('/referrals/my-code');
    }

    async getReferralStats() {
      return this.request('/referrals/stats');
    }

    async getReferredUsers(query = {}) {
      const q = new URLSearchParams(query).toString();
      return this.request(`/referrals/referred-users?${q}`);
    }

    async getReferralHistory(query = {}) {
      const q = new URLSearchParams(query).toString();
      return this.request(`/referrals/history?${q}`);
    }

    // ----------------------------------------------------
    // Open Banking & PSD2 Gateway (v3.1)
    // ----------------------------------------------------
    async createOpenBankingConsent(data) {
      return this.request('/open-banking/v3.1/consents', {
        method: 'POST',
        body: data,
      });
    }

    async authorizeOpenBankingConsent(id, data) {
      return this.request(`/open-banking/v3.1/consents/${id}/authorize`, {
        method: 'POST',
        body: data,
      });
    }

    async revokeOpenBankingConsent(id) {
      return this.request(`/open-banking/v3.1/consents/${id}`, {
        method: 'DELETE',
      });
    }

    async getAisAccounts(obAuthToken) {
      return this.request('/open-banking/v3.1/ais/accounts', {
        headers: { Authorization: `Bearer ${obAuthToken}` },
      });
    }

    async getAisBalances(obAuthToken, accountId) {
      return this.request(`/open-banking/v3.1/ais/accounts/${accountId}/balances`, {
        headers: { Authorization: `Bearer ${obAuthToken}` },
      });
    }

    // ----------------------------------------------------
    // Payment Gateway Sessions (Stripe, Paystack, Flutterwave)
    // ----------------------------------------------------
    async getPaymentProviders() {
      return this.request('/payments/providers');
    }

    async initializeGatewayPayment(data) {
      return this.request('/payments/initialize', {
        method: 'POST',
        body: data,
      });
    }

    async verifyGatewayPayment(data) {
      return this.request('/payments/verify', {
        method: 'POST',
        body: data,
      });
    }

    // ----------------------------------------------------
    // Phase 17 & 31: Admin Operations & Escrow Arbitration
    // ----------------------------------------------------
    async getAdminAnalytics() {
      return this.request('/admin/analytics/dashboard');
    }

    async getAdminAuditLogs(query = {}) {
      const params = new URLSearchParams(query).toString();
      return this.request(`/admin/analytics/audit-logs?${params}`);
    }

    async resolveEscrowDispute(contractId, data) {
      return this.request(`/escrow/contracts/${contractId}/resolve`, {
        method: 'POST',
        body: data,
      });
    }
  }

  // Toast / Alert Helper
  function showToast(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `fixed bottom-5 right-5 z-50 px-5 py-3.5 rounded-2xl shadow-2xl text-sm font-semibold transition-all duration-300 transform translate-y-0 opacity-100 flex items-center space-x-3 backdrop-blur-md ${
      type === 'error'
        ? 'bg-red-600/95 text-white border border-red-500'
        : type === 'success'
        ? 'bg-emerald-600/95 text-white border border-emerald-500'
        : 'bg-sky-600/95 text-white border border-sky-500'
    }`;

    const icon = type === 'error' ? 'fa-exclamation-triangle' : type === 'success' ? 'fa-check-circle' : 'fa-info-circle';
    alertDiv.innerHTML = `<i class="fas ${icon} text-base"></i> <span>${message}</span>`;
    document.body.appendChild(alertDiv);

    setTimeout(() => {
      alertDiv.style.opacity = '0';
      alertDiv.style.transform = 'translateY(20px)';
      setTimeout(() => alertDiv.remove(), 400);
    }, 4500);
  }

  window.SilverhawkAPI = new SilverhawkClient();
  window.SilverhawkToast = showToast;

  // Initialize UI Hooks
  function initApp() {
    // 0. Safety Preloader Dismissal
    const preloader = document.querySelector('.page-loading');
    if (preloader) {
      setTimeout(() => {
        preloader.classList.remove('active');
        setTimeout(() => preloader.remove(), 400);
      }, 500);
    }

    // 1. Hook up Login Form
    const loginForm = document.querySelector('form#login-form, form[action*="login"], form[id*="login"]');
    if (loginForm) {
      loginForm.onsubmit = async function (e) {
        e.preventDefault();
        const emailInput = loginForm.querySelector('input[name="email"], input[name="username"], input[type="text"]');
        const passwordInput = loginForm.querySelector('input[name="password"], input[type="password"]');
        const rememberInput = loginForm.querySelector('input[name="remember_me"]');
        const submitBtn = loginForm.querySelector('button[type="submit"]');

        if (!emailInput || !passwordInput) return;

        const originalBtnText = submitBtn ? submitBtn.innerHTML : 'Sign In';
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Signing in...';
        }

        try {
          const res = await window.SilverhawkAPI.login(
            emailInput.value.trim(),
            passwordInput.value,
            rememberInput ? rememberInput.checked : false
          );

          if (res.requires2fa) {
            window.SilverhawkToast('2FA security code required. Redirecting to verification...', 'info');
            sessionStorage.setItem('pending_verification_email', res.email || emailInput.value.trim());
            setTimeout(() => {
              window.location.href = `verify.html?email=${encodeURIComponent(res.email || emailInput.value.trim())}&type=LOGIN_2FA`;
            }, 800);
            return;
          }

          if (res.requiresVerification) {
            window.SilverhawkToast('Please verify your email address. Redirecting to verification...', 'info');
            sessionStorage.setItem('pending_verification_email', res.email || emailInput.value.trim());
            setTimeout(() => {
              window.location.href = `verify.html?email=${encodeURIComponent(res.email || emailInput.value.trim())}&type=EMAIL_VERIFICATION`;
            }, 800);
            return;
          }

          window.SilverhawkToast('Login successful! Welcome back.', 'success');
          const userRoles = res.user?.roles || [];
          const isStaffAdmin = userRoles.includes('ADMIN') || userRoles.includes('SUPER_ADMIN') || userRoles.includes('FINANCE_MANAGER') || userRoles.includes('KYC_OFFICER');
          setTimeout(() => {
            window.location.href = isStaffAdmin ? 'admin.html' : 'dashboard.html';
          }, 800);
        } catch (err) {
          window.SilverhawkToast(err.message || 'Login failed. Please check credentials.', 'error');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
          }
        }
      };
    }

    // 2. Hook up Register Form
    window.handleRegisterSubmit = async function (e) {
      if (e && e.preventDefault) e.preventDefault();
      const formEl = document.getElementById('registration-form') || document.querySelector('form[action*="register"]');
      if (!formEl) return;

      const submitBtn = formEl.querySelector('button[type="submit"], #submit-btn');
      const originalBtnText = submitBtn ? submitBtn.innerHTML : 'Create Account';

      const firstName = formEl.querySelector('input[name="name"]')?.value?.trim();
      const lastName = formEl.querySelector('input[name="lastname"]')?.value?.trim();
      const middleName = formEl.querySelector('input[name="middlename"]')?.value?.trim() || undefined;
      const username = formEl.querySelector('input[name="username"]')?.value?.trim();
      const email = formEl.querySelector('input[name="email"]')?.value?.trim();
      const phone = formEl.querySelector('input[name="phone"]')?.value?.trim() || undefined;
      const country = formEl.querySelector('select[name="country"], input[name="country"]')?.value || 'United States of America';
      const currencyCode = (formEl.querySelector('select[name="curr"], input[name="curr"]')?.value || 'USD').toUpperCase();
      
      // Normalize account type
      let rawAccountType = formEl.querySelector('select[name="accounttype"], input[name="accounttype"]')?.value || 'CHECKING';
      let accountType = 'CHECKING';
      const atLow = rawAccountType.toLowerCase();
      if (atLow.includes('cur')) {
        accountType = 'CURRENT';
      } else if (atLow.includes('sav')) {
        accountType = 'SAVINGS';
      } else if (atLow.includes('bus')) {
        accountType = 'BUSINESS';
      } else if (atLow.includes('invest')) {
        accountType = 'INVESTMENT';
      } else if (atLow.includes('fix')) {
        accountType = 'FIXED_DEPOSIT';
      } else {
        accountType = 'CHECKING';
      }

      const pin = (formEl.querySelector('input[name="pin"]')?.value || '1234').trim();
      const password = formEl.querySelector('input[name="password"]')?.value;
      const passwordConfirmation = formEl.querySelector('input[name="password_confirmation"]')?.value;
      const termsAccepted = formEl.querySelector('input[name="terms"]')?.checked ?? true;

      if (!firstName || !lastName || !username || !email || !password) {
        window.SilverhawkToast('Please fill in all required fields.', 'error');
        return;
      }

      if (password && passwordConfirmation && password !== passwordConfirmation) {
        window.SilverhawkToast('Passwords do not match!', 'error');
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Creating account...';
      }

      try {
        const payload = {
          firstName,
          lastName,
          middleName,
          username,
          email,
          phone,
          password,
          passwordConfirmation: passwordConfirmation || password,
          pin,
          currency: currencyCode,
          accountType,
          country,
          termsAccepted,
        };

        const res = await window.SilverhawkAPI.register(payload);
        sessionStorage.setItem('pending_verification_email', email);
        window.SilverhawkToast('Account created! A 6-digit code has been dispatched to your email.', 'success');
        setTimeout(() => {
          window.location.href = `verify.html?email=${encodeURIComponent(email)}&type=EMAIL_VERIFICATION`;
        }, 1000);
      } catch (err) {
        // Offline registration fallback — DEMO MODE ONLY
        if (window.SILVERHAWK_DEMO_MODE && err.message && (err.message.includes('unreachable') || err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))) {
          console.warn('[Silverhawk DEMO] Backend unreachable. Activating demo local banking session for:', email);
          const mockUser = {
            id: 'usr_' + Date.now(),
            username,
            email,
            roles: ['CUSTOMER'],
            status: 'ACTIVE',
            kycTier: 'TIER_3',
            profile: {
              firstName,
              lastName,
              phone: phone || '+1 (555) 019-2834',
              country: country || 'United States',
            },
            createdAt: new Date().toISOString()
          };
          const mockAccount = {
            id: 'acc_' + Date.now() + '_main',
            userId: mockUser.id,
            accountNumber: '4089' + Math.floor(100000 + Math.random() * 900000),
            accountName: `${firstName}'s ${rawAccountType || accountType} Account`,
            type: accountType,
            currencyCode: currencyCode,
            status: 'ACTIVE',
            currentBalance: '10000.00',
            availableBalance: '10000.00',
            ledgerBalance: '10000.00',
            isPrimary: true,
            createdAt: new Date().toISOString()
          };

          window.SilverhawkAPI.setAuth('mock_access_token_' + Date.now(), 'mock_refresh_token_' + Date.now(), mockUser);
          window.SilverhawkAPI.syncUserToAdmin(mockUser, mockAccount);
          sessionStorage.setItem('pending_verification_email', email);

          window.SilverhawkToast('Account created! A 6-digit verification code has been dispatched to your email.', 'success');
          setTimeout(() => {
            window.location.href = `verify.html?email=${encodeURIComponent(email)}&type=EMAIL_VERIFICATION`;
          }, 1000);
          return;
        }

        window.SilverhawkToast(err.message || 'Registration failed.', 'error');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnText;
        }
      }
    };

    const regForm = document.getElementById('registration-form') || document.querySelector('form[action*="register"]');
    if (regForm) {
      regForm.onsubmit = window.handleRegisterSubmit;
      const regSubmitBtn = regForm.querySelector('#submit-btn, button[type="submit"]');
      if (regSubmitBtn) {
        regSubmitBtn.onclick = function(e) {
          window.handleRegisterSubmit(e);
        };
      }
    }

    // 2b. Hook up Forgot Password Form
    const forgotForm = document.querySelector('form[action*="forgot-password"], form#forgot-password-form');
    if (forgotForm) {
      forgotForm.onsubmit = async function (e) {
        e.preventDefault();
        const emailInput = forgotForm.querySelector('input[name="email"], input[type="email"]');
        const submitBtn = forgotForm.querySelector('button[type="submit"]');
        if (!emailInput || !emailInput.value.trim()) {
          window.SilverhawkToast('Please enter your email address.', 'error');
          return;
        }
        const origText = submitBtn ? submitBtn.innerHTML : 'Send Password Reset Link';
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Sending Instructions...';
        }
        try {
          await window.SilverhawkAPI.forgotPassword(emailInput.value.trim());
          window.SilverhawkToast('Password reset link has been dispatched to your email!', 'success');
        } catch (err) {
          window.SilverhawkToast(err.message || 'Failed to dispatch reset link. Check your email address.', 'error');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = origText;
          }
        }
      };
    }

    // 2c. Hook up Contact Form
    const contactForm = document.querySelector('form[action*="contact"], form#contact-form');
    if (contactForm) {
      contactForm.onsubmit = async function (e) {
        e.preventDefault();
        const nameInput = contactForm.querySelector('input[name="name"]');
        const emailInput = contactForm.querySelector('input[name="email"]');
        const subjectInput = contactForm.querySelector('input[name="subject"]');
        const messageInput = contactForm.querySelector('textarea[name="message"]');
        const submitBtn = contactForm.querySelector('button[type="submit"]');

        const origBtnText = submitBtn ? submitBtn.innerHTML : 'Send Message';
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Dispatching Message...';
        }

        try {
          if (window.SilverhawkAPI.isAuthenticated()) {
            await window.SilverhawkAPI.createSupportTicket({
              subject: subjectInput?.value || 'Contact Inquery',
              message: `From: ${nameInput?.value || 'Visitor'} (${emailInput?.value || 'N/A'})\n\n${messageInput?.value || ''}`,
              category: 'GENERAL',
              priority: 'MEDIUM'
            });
          }
          window.SilverhawkToast('Thank you! Your message has been received by our private banking desk.', 'success');
          contactForm.reset();
        } catch (err) {
          window.SilverhawkToast('Message submitted successfully to support concierge.', 'success');
          contactForm.reset();
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = origBtnText;
          }
        }
      };
    }

    // 3. Live Dashboard Updates for Logged-In User
    const rawPath = (window.location.pathname || '').toLowerCase();
    const isDashboardPage = rawPath === '/dashboard' ||
                            rawPath === '/dashboard/' ||
                            rawPath.endsWith('/dashboard.html') ||
                            rawPath.endsWith('/dashboard/index.html');
    const isAuthPage = rawPath.includes('login') || rawPath.includes('register') || rawPath.includes('verify') || rawPath.includes('forgot-password');

    if (isDashboardPage && !isAuthPage) {
      if (!window.SilverhawkAPI.isAuthenticated()) {
        console.warn('[Silverhawk] Unauthenticated user attempting to access dashboard. Redirecting to /login.html.');
        window.location.href = '/login.html';
        return;
      }
    }

    if (window.SilverhawkAPI.isAuthenticated()) {
      const user = window.SilverhawkAPI.getUser();
      console.log(`[Silverhawk] Authenticated session active for: ${user?.email || user?.username || 'User'}`);

      // Populate User Full Name and Greeting
      if (user) {
        const fullName = user.profile ? `${user.profile.firstName || ''} ${user.profile.lastName || ''}`.trim() : user.username;
        const initials = user.profile ? `${(user.profile.firstName || 'U')[0]}${(user.profile.lastName || '')[0] || ''}`.toUpperCase() : 'U';

        const nameEls = document.querySelectorAll('#user-display-name, #user-greeting-name, .user-name');
        nameEls.forEach((el) => {
          el.textContent = fullName || user.username || 'Valued Customer';
        });

        const avatarEls = document.querySelectorAll('#user-avatar-initials');
        avatarEls.forEach((el) => {
          el.textContent = initials || 'RC';
        });
      }

      // Populate Dynamic Time-of-Day Greeting
      const now = new Date();
      const currentHour = now.getHours();
      let greetingText = 'Good Afternoon 👋';
      if (currentHour < 12) {
        greetingText = 'Good Morning 👋';
      } else if (currentHour >= 18) {
        greetingText = 'Good Evening 👋';
      }
      const greetingEls = document.querySelectorAll('#user-time-greeting, .time-greeting');
      greetingEls.forEach((el) => {
        el.textContent = greetingText;
      });

      // Populate Live Timestamp
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const formattedTimestamp = `Last updated: ${monthNames[now.getMonth()]} ${now.getDate()}, ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const timeEls = document.querySelectorAll('#last-updated-timestamp, .live-timestamp');
      timeEls.forEach((el) => {
        el.textContent = formattedTimestamp;
      });

      // Load live balance & account stats
      window.SilverhawkAPI.getDashboardSummary()
        .then((summary) => {
          if (!summary) return;

          // Currency symbols mapping covering all currencies supported in registration
          const currencySymbols = {
            AED: "د.إ", AFN: "Af", ALL: "Lek", ANG: "ƒ", AOA: "Kz", ARS: "$", AUD: "AU$", AWG: "ƒ", AZN: "ман",
            BAM: "KM", BBD: "$", BDT: "৳", BGN: "лв", BHD: ".د.ب", BIF: "FBu", BMD: "$", BND: "$", BOB: "$b",
            BRL: "R$", BTC: "₿", BSD: "$", BTN: "Nu.", BWP: "P", BYR: "p.", BZD: "BZ$", CAD: "CA$", CDF: "FC",
            CHF: "CHF ", CLP: "$", CNY: "¥", COP: "$", CRC: "₡", CUP: "⃌", CVE: "$", CZK: "Kč", DJF: "Fdj",
            DKK: "kr", DOP: "RD$", DZD: "دج", EGP: "£", ETB: "Br", EUR: "€", ETH: "ETH", FJD: "$", FKP: "£",
            GBP: "£", GEL: "ლ", GHS: "¢", GIP: "£", GMD: "D", GNF: "FG", GTQ: "Q", GYD: "$", HKD: "HK$",
            HNL: "L", HRK: "kn", HTG: "G", HUF: "Ft", IDR: "Rp", ILS: "₪", INR: "₹", IQD: "ع.د", IRR: "﷼",
            ISK: "kr", JEP: "£", JMD: "J$", JOD: "JD", JPY: "¥", KES: "KSh", KGS: "лв", KHR: "៛", KMF: "CF",
            KPW: "₩", KRW: "₩", KWD: "د.ك", KYD: "$", KZT: "лв", LAK: "₭", LBP: "£", LKR: "₨", LRD: "$",
            LSL: "L", LTL: "Lt", LVL: "Ls", LYD: "ل.د", MAD: "د.م.", MDL: "L", MGA: "Ar", MKD: "ден", MMK: "K",
            MNT: "₮", MOP: "MOP$", MRO: "UM", MUR: "₨", MVR: ".ރ", MWK: "MK", MXN: "$", MYR: "RM", MZN: "MT",
            NAD: "$", NGN: "₦", NIO: "C$", NOK: "kr", NPR: "₨", NZD: "NZ$", OMR: "﷼", PAB: "B/.", PEN: "S/.",
            PGK: "K", PHP: "₱", PKR: "₨", PLN: "zł", PYG: "Gs", QAR: "﷼", RON: "lei", RSD: "Дин.", RUB: "руб",
            RWF: "ر.س", SAR: "﷼", SBD: "$", SCR: "₨", SDG: "£", SEK: "kr", SGD: "SG$", SHP: "£", SLL: "Le",
            SOS: "S", SRD: "$", STD: "Db", SVC: "$", SYP: "£", SZL: "L", THB: "฿", TJS: "TJS", TMT: "m",
            TND: "د.ت", TOP: "T$", TRY: "₤", TTD: "$", TWD: "NT$", UAH: "₴", UGX: "USh", USD: "$", UYU: "$U",
            UZS: "лв", VEF: "Bs", VND: "₫", VUV: "VT", WST: "WS$", XAF: "FCFA", XCD: "$", XPF: "F", YER: "﷼",
            ZAR: "R", ZMK: "ZK", ZWL: "Z$"
          };

          window.getSilverhawkCurrencySymbol = function(code) {
            if (!code) return '$';
            const c = String(code).toUpperCase().trim();
            return currencySymbols[c] || `${c} `;
          };

          const standardUsdRates = {
            USD: 1.000000,
            EUR: 0.920000,
            GBP: 0.785000,
            CAD: 1.365000,
            AUD: 1.512000,
            JPY: 155.450000,
            CHF: 0.908000,
            NGN: 1480.000000,
          };

          const primaryAccount = summary.accounts?.find(a => a.currencyCode !== 'BTC') || summary.accounts?.[0];
          const userCurrency = (primaryAccount?.currencyCode || 'USD').toUpperCase();
          const userCurrencySymbol = window.getSilverhawkCurrencySymbol(userCurrency);

          // Base USD BTC price and live rate in user's currency
          const baseBtcUsdPrice = 77634.00;
          const currencyRateToUsd = standardUsdRates[userCurrency] || 1.00;
          const btcRateInUserCurrency = baseBtcUsdPrice * currencyRateToUsd;

          // Update Balance text elements with user's currency symbol
          const availRaw = summary.totals?.availableBalance || summary.totals?.totalBalance || (primaryAccount ? primaryAccount.currentBalance : '0');
          const formattedAvail = `${userCurrencySymbol}${parseFloat(availRaw || '0').toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

          const balanceEls = document.querySelectorAll('.user-balance, [data-user-balance], #total-balance-display, #hero-balance-display, #checking-balance-display');
          balanceEls.forEach((el) => {
            el.textContent = formattedAvail;
          });

          const availEls = document.querySelectorAll('#available-balance-display, #swap-available-balance');
          availEls.forEach((el) => {
            el.textContent = formattedAvail;
          });

          // Update user currency badges
          const currBadgeEls = document.querySelectorAll('.user-currency-code, [data-currency-code], #user-currency-badge, #swap-from-currency-code');
          currBadgeEls.forEach((el) => {
            el.textContent = userCurrency;
          });

          // Update Account Type Labels (Hero Card and Switcher Sub-tab)
          function formatAccountTypeName(type) {
            if (!type) return 'Checking Account';
            const t = String(type).toUpperCase();
            if (t === 'CURRENT' || t === 'CURRENT_ACCOUNT') return 'Current Account';
            if (t === 'BUSINESS' || t === 'BUSINESS_ACCOUNT') return 'Business Account';
            if (t === 'SAVINGS' || t === 'SAVINGS_ACCOUNT') return 'Savings Account';
            if (t === 'INVESTMENT' || t === 'INVESTMENT_ACCOUNT') return 'Investment Account';
            if (t === 'FIXED_DEPOSIT' || t === 'FIXED_DEPOSIT_ACCOUNT') return 'Fixed Deposit Account';
            if (t === 'CHECKING' || t === 'CHECKING_ACCOUNT') return 'Checking Account';
            return type.replace(/_/g, ' ');
          }

          const rawAccType = primaryAccount?.type || summary.accountType || 'CHECKING';
          const accTypeFormatted = formatAccountTypeName(rawAccType);

          const heroTypeEl = document.getElementById('hero-account-type-label');
          if (heroTypeEl) heroTypeEl.textContent = accTypeFormatted.toUpperCase();

          const subtabTypeEl = document.getElementById('subtab-account-type-label');
          if (subtabTypeEl) subtabTypeEl.textContent = accTypeFormatted;

          const depositTypeEl = document.getElementById('deposit-account-type');
          if (depositTypeEl) depositTypeEl.textContent = accTypeFormatted;

          // Update Bitcoin Wallet elements in user's currency
          const cryptoAccount = summary.accounts?.find(a => (a.currencyCode === 'BTC' || a.type === 'CRYPTO'));
          const btcBalance = cryptoAccount ? parseFloat(cryptoAccount.currentBalance || '0') : 0;
          const btcFormatted = `${btcBalance.toFixed(6)} BTC`;
          const fiatEquivalent = `${userCurrencySymbol}${(btcBalance * btcRateInUserCurrency).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

          const btcBalEls = document.querySelectorAll('#crypto-btc-balance');
          btcBalEls.forEach(el => el.textContent = btcFormatted);

          const fiatEqEls = document.querySelectorAll('#crypto-fiat-equivalent');
          fiatEqEls.forEach(el => el.textContent = `≈ ${fiatEquivalent}`);

          const btcRateEls = document.querySelectorAll('#crypto-btc-rate');
          btcRateEls.forEach(el => el.textContent = `1 BTC = ${userCurrencySymbol}${btcRateInUserCurrency.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);

          // ----------------------------------------------------
          // Currency Swap Helper Utilities
          // ----------------------------------------------------
          let swapDirection = 'FIAT_TO_CRYPTO'; // FIAT_TO_CRYPTO or CRYPTO_TO_FIAT

          window.initSwapModal = function() {
            const availEl = document.getElementById('swap-available-balance');
            const fromCodeEl = document.getElementById('swap-from-currency-code');
            const toCodeEl = document.getElementById('swap-to-currency-code');
            const rateCaptionEl = document.getElementById('swap-live-rate-caption');
            const amountInput = document.getElementById('swap-amount-input');
            const estOutputEl = document.getElementById('swap-estimated-output');

            if (availEl) availEl.textContent = swapDirection === 'FIAT_TO_CRYPTO' ? formattedAvail : `${btcBalance.toFixed(6)} BTC`;
            if (fromCodeEl) fromCodeEl.textContent = swapDirection === 'FIAT_TO_CRYPTO' ? userCurrency : 'BTC';
            if (toCodeEl) toCodeEl.textContent = swapDirection === 'FIAT_TO_CRYPTO' ? 'BTC' : userCurrency;
            if (rateCaptionEl) rateCaptionEl.textContent = `Rate: 1 BTC = ${userCurrencySymbol}${btcRateInUserCurrency.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
            if (amountInput) {
              amountInput.value = '';
              amountInput.placeholder = '0.00';
            }
            if (estOutputEl) {
              estOutputEl.textContent = swapDirection === 'FIAT_TO_CRYPTO' ? '0.000000 BTC' : `${userCurrencySymbol}0.00`;
            }
          };

          window.toggleSwapDirection = function() {
            swapDirection = swapDirection === 'FIAT_TO_CRYPTO' ? 'CRYPTO_TO_FIAT' : 'FIAT_TO_CRYPTO';
            window.initSwapModal();
            window.calcSwapEstimate();
          };

          window.setSwapPercent = function(percent) {
            const amountInput = document.getElementById('swap-amount-input');
            if (!amountInput) return;
            const maxVal = swapDirection === 'FIAT_TO_CRYPTO' ? parseFloat(availRaw || '0') : btcBalance;
            const targetVal = maxVal * percent;
            amountInput.value = swapDirection === 'FIAT_TO_CRYPTO' ? targetVal.toFixed(2) : targetVal.toFixed(6);
            window.calcSwapEstimate();
          };

          window.calcSwapEstimate = function() {
            const amountInput = document.getElementById('swap-amount-input');
            const estOutputEl = document.getElementById('swap-estimated-output');
            if (!amountInput || !estOutputEl) return;

            const val = parseFloat(amountInput.value || '0');
            if (isNaN(val) || val <= 0) {
              estOutputEl.textContent = swapDirection === 'FIAT_TO_CRYPTO' ? '0.000000 BTC' : `${userCurrencySymbol}0.00`;
              return;
            }

            if (swapDirection === 'FIAT_TO_CRYPTO') {
              const btcOut = val / btcRateInUserCurrency;
              estOutputEl.textContent = `${btcOut.toFixed(6)} BTC`;
            } else {
              const fiatOut = val * btcRateInUserCurrency;
              estOutputEl.textContent = `${userCurrencySymbol}${fiatOut.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
          };

          const amountInput = document.getElementById('swap-amount-input');
          if (amountInput) {
            amountInput.oninput = window.calcSwapEstimate;
          }

          // Hook up Currency Swap Form Submission
          const swapForm = document.getElementById('currency-swap-form');
          if (swapForm) {
            swapForm.onsubmit = async function(e) {
              e.preventDefault();
              const amtVal = document.getElementById('swap-amount-input')?.value;
              const pinVal = document.getElementById('swap-pin-input')?.value;
              const submitBtn = document.getElementById('swap-submit-btn');

              if (!amtVal || parseFloat(amtVal) <= 0) {
                window.SilverhawkToast('Please enter a valid swap amount.', 'error');
                return;
              }
              if (!pinVal || pinVal.length < 4) {
                window.SilverhawkToast('Please enter your 4-digit security PIN.', 'error');
                return;
              }

              const fromCurr = swapDirection === 'FIAT_TO_CRYPTO' ? userCurrency : 'BTC';
              const toCurr = swapDirection === 'FIAT_TO_CRYPTO' ? 'BTC' : userCurrency;

              const originalBtnHtml = submitBtn ? submitBtn.innerHTML : 'Confirm Swap';
              if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Swapping &amp; Settling...';
              }

              try {
                const res = await window.SilverhawkAPI.swapCurrency({
                  fromCurrency: fromCurr,
                  toCurrency: toCurr,
                  amount: amtVal,
                  pin: pinVal,
                });

                window.SilverhawkToast('Currency swap completed successfully!', 'success');

                // Populate Receipt Modal
                const receiptFromAmt = document.getElementById('swap-receipt-from-amt');
                const receiptToAmt = document.getElementById('swap-receipt-to-amt');
                const receiptRate = document.getElementById('swap-receipt-rate');
                const receiptRef = document.getElementById('swap-receipt-ref');

                if (receiptFromAmt) receiptFromAmt.textContent = `${parseFloat(res.debitedAmount).toFixed(fromCurr === 'BTC' ? 6 : 2)} ${fromCurr}`;
                if (receiptToAmt) receiptToAmt.textContent = `${parseFloat(res.creditedAmount).toFixed(toCurr === 'BTC' ? 6 : 2)} ${toCurr}`;
                if (receiptRate) receiptRate.textContent = `1 BTC = ${userCurrencySymbol}${btcRateInUserCurrency.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
                if (receiptRef) receiptRef.textContent = res.reference || 'SWAP-SUCCESS';

                // Close swap modal and open success modal via Alpine
                const swapAlpineData = window.getAlpineData ? window.getAlpineData() : null;
                if (swapAlpineData) {
                  swapAlpineData.showSwapModal = false;
                  swapAlpineData.showSwapSuccessModal = true;
                }

                // Re-hydrate dashboard balances
                setTimeout(() => {
                  initApp();
                }, 500);

              } catch (err) {
                window.SilverhawkToast(err.message || 'Swap failed. Please check balance and PIN.', 'error');
              } finally {
                if (submitBtn) {
                  submitBtn.disabled = false;
                  submitBtn.innerHTML = originalBtnHtml;
                }
              }
            };
          }
          // ----------------------------------------------------
          // Enterprise & Business Grants Modal Utilities
          // ----------------------------------------------------
          let grantProgramsCache = [];

          window.initGrantModal = async function() {
            try {
              if (!grantProgramsCache.length) {
                grantProgramsCache = await window.SilverhawkAPI.getGrantPrograms();
              }

              // Populate Program Selector in Form
              const progSelect = document.getElementById('grant-program-select');
              if (progSelect && progSelect.options.length <= 1) {
                grantProgramsCache.forEach(p => {
                  const opt = document.createElement('option');
                  opt.value = p.id;
                  opt.textContent = `${p.name} (Up to ${userCurrencySymbol}${p.maxAmount.toLocaleString()})`;
                  progSelect.appendChild(opt);
                });
              }

              // Populate Account Selector in Form
              const accSelect = document.getElementById('grant-account-select');
              if (accSelect && primaryAccount) {
                accSelect.innerHTML = `<option value="${primaryAccount.id}">${primaryAccount.accountName || 'Primary Account'} (${primaryAccount.accountNumber}) — ${formattedAvail}</option>`;
              }

              // Render Programs Grid in Catalog
              const gridEl = document.getElementById('grant-programs-grid');
              if (gridEl && grantProgramsCache.length) {
                gridEl.innerHTML = grantProgramsCache.map(p => `
                  <div class="p-5 rounded-2xl bg-white dark:bg-slate-800/90 border border-slate-200/70 dark:border-slate-700 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-4">
                    <div class="space-y-3">
                      <div class="flex items-center justify-between">
                        <div class="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-950/80 text-purple-600 dark:text-purple-400 flex items-center justify-center text-lg">
                          <i class="fas ${p.icon || 'fa-award'}"></i>
                        </div>
                        <span class="px-2.5 py-1 rounded-full text-[10px] font-black tracking-wide uppercase bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 border border-purple-200/60 dark:border-purple-800/60">
                          Up to ${userCurrencySymbol}${p.maxAmount.toLocaleString()}
                        </span>
                      </div>
                      <div>
                        <h4 class="text-sm font-black text-slate-900 dark:text-white">${p.name}</h4>
                        <div class="text-[11px] font-semibold text-purple-600 dark:text-purple-400 mt-0.5">${p.category}</div>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">${p.description}</p>
                      </div>
                      <ul class="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 pt-1">
                        ${p.benefits.slice(0, 3).map(b => `<li class="flex items-start space-x-1.5"><i class="fas fa-check-circle text-emerald-500 text-[11px] mt-0.5 shrink-0"></i><span>${b}</span></li>`).join('')}
                      </ul>
                    </div>
                    <button type="button" onclick="window.selectGrantProgram('${p.id}')" class="w-full py-2.5 px-4 bg-purple-600 hover:bg-purple-500 active:scale-98 text-white font-bold text-xs rounded-xl shadow-md shadow-purple-600/20 transition-all flex items-center justify-center space-x-2">
                      <span>Apply for Program</span>
                      <i class="fas fa-arrow-right text-[10px]"></i>
                    </button>
                  </div>
                `).join('');
              }

              // Load Application History
              await window.loadUserGrants();

            } catch (err) {
              console.warn('Failed to initialize grant modal:', err);
            }
          };

          window.selectGrantProgram = function(progId) {
            const grantAlpineData = window.getAlpineData ? window.getAlpineData() : null;
            if (grantAlpineData) grantAlpineData.grantTab = 'apply';
            const progSelect = document.getElementById('grant-program-select');
            if (progSelect) {
              progSelect.value = progId;
              progSelect.dispatchEvent(new Event('change'));
            }
          };

          window.loadUserGrants = async function() {
            const listEl = document.getElementById('grant-tracker-list');
            if (!listEl) return;

            try {
              const applications = await window.SilverhawkAPI.getUserGrants();
              if (!applications || !applications.length) {
                listEl.innerHTML = `
                  <div class="p-8 text-center bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                    <div class="w-12 h-12 rounded-full bg-purple-50 dark:bg-purple-950/60 text-purple-500 mx-auto flex items-center justify-center text-xl mb-3">
                      <i class="fas fa-file-signature"></i>
                    </div>
                    <div class="text-sm font-bold text-slate-800 dark:text-slate-200">No Applications Submitted Yet</div>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">Explore available grant programs and submit your commercial proposal to receive non-dilutive funding.</p>
                  </div>
                `;
                return;
              }

              listEl.innerHTML = applications.map(app => {
                let badgeHtml = '';
                let actionHtml = '';

                if (app.status === 'APPROVED') {
                  badgeHtml = `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">APPROVED &bull; READY TO CLAIM</span>`;
                  actionHtml = `
                    <div class="pt-3 border-t border-slate-100 dark:border-slate-700 flex justify-end">
                      <button type="button" onclick="window.disburseGrantFunds('${app.id}')" class="py-2 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-xl shadow-lg shadow-emerald-600/20 transition-all flex items-center space-x-2">
                        <i class="fas fa-hand-holding-usd"></i>
                        <span>Claim &amp; Disburse ${userCurrencySymbol}${parseFloat(app.approvedAmount || app.requestedAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </button>
                    </div>
                  `;
                } else if (app.status === 'DISBURSED') {
                  badgeHtml = `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-sky-100 dark:bg-sky-950 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800"><i class="fas fa-check-circle mr-1"></i>DISBURSED</span>`;
                  actionHtml = `
                    <div class="text-[11px] text-slate-400 dark:text-slate-500 flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700/50">
                      <span>Credited to #${app.account?.accountNumber || 'Primary Account'}</span>
                      <span class="font-mono text-emerald-500 font-bold">${new Date(app.disbursedAt || app.updatedAt).toLocaleDateString()}</span>
                    </div>
                  `;
                } else if (app.status === 'REJECTED') {
                  badgeHtml = `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800">DECLINED</span>`;
                } else {
                  badgeHtml = `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800"><i class="fas fa-spinner fa-spin mr-1"></i>UNDER REVIEW</span>`;
                  actionHtml = `
                    <div class="pt-2 border-t border-slate-100 dark:border-slate-700 flex justify-end">
                      <button type="button" onclick="window.disburseGrantFunds('${app.id}')" class="py-1.5 px-3 bg-purple-50 dark:bg-purple-950/60 hover:bg-purple-100 dark:hover:bg-purple-900/60 text-purple-600 dark:text-purple-300 font-bold text-[11px] rounded-lg border border-purple-200 dark:border-purple-800 transition-all flex items-center space-x-1.5" title="Expedite and authorize immediate funding credit">
                        <i class="fas fa-bolt text-amber-500"></i>
                        <span>Expedite Disbursement</span>
                      </button>
                    </div>
                  `;
                }

                return `
                  <div class="p-4 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 shadow-sm space-y-3">
                    <div class="flex items-start justify-between">
                      <div>
                        <div class="text-[11px] font-mono font-bold text-slate-400 dark:text-slate-500">${app.applicationRef}</div>
                        <h4 class="text-sm font-black text-slate-900 dark:text-white mt-0.5">${app.programName}</h4>
                        <div class="text-xs text-slate-500 dark:text-slate-400">${app.businessName} &bull; ${app.businessType}</div>
                      </div>
                      <div>${badgeHtml}</div>
                    </div>

                    <div class="grid grid-cols-2 gap-2 text-xs bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-xl">
                      <div>
                        <span class="text-slate-400">Requested:</span>
                        <div class="font-mono font-black text-slate-900 dark:text-white text-sm">${userCurrencySymbol}${parseFloat(app.requestedAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                      </div>
                      <div>
                        <span class="text-slate-400">Submitted:</span>
                        <div class="font-medium text-slate-700 dark:text-slate-300 text-xs">${new Date(app.createdAt).toLocaleDateString()}</div>
                      </div>
                    </div>

                    <div class="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                      <span class="font-semibold text-slate-800 dark:text-slate-200">Proposal:</span> ${app.proposalTitle} — ${app.proposalDetails}
                    </div>

                    ${actionHtml}
                  </div>
                `;
              }).join('');

            } catch (err) {
              console.warn('Failed to load user grants:', err);
            }
          };

          window.disburseGrantFunds = async function(grantId) {
            let pinVal = prompt('Enter your 4-digit security PIN to authorize grant disbursement:');
            if (pinVal === null) return;
            if (!pinVal || pinVal.length < 4) {
              window.SilverhawkToast('Security PIN is required.', 'error');
              return;
            }

            try {
              window.SilverhawkToast('Processing grant disbursement...', 'info');
              const res = await window.SilverhawkAPI.disburseGrant(grantId, { pin: pinVal });
              window.SilverhawkToast(res.message || 'Grant funds credited successfully!', 'success');

              // Populate Grant Receipt Modal
              const receiptProg = document.getElementById('grant-receipt-program');
              const receiptAmt = document.getElementById('grant-receipt-amount');
              const receiptAcc = document.getElementById('grant-receipt-account');
              const receiptRef = document.getElementById('grant-receipt-ref');

              if (receiptProg) receiptProg.textContent = res.grant?.programName || 'Commercial Grant Program';
              if (receiptAmt) receiptAmt.textContent = `${userCurrencySymbol}${parseFloat(res.grant?.approvedAmount || res.grant?.requestedAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
              if (receiptAcc) receiptAcc.textContent = primaryAccount ? `#${primaryAccount.accountNumber}` : 'Primary Account';
              if (receiptRef) receiptRef.textContent = res.transaction?.reference || res.grant?.applicationRef || 'GRNT-DSB-SUCCESS';

              const grantSuccessAlpineData = window.getAlpineData ? window.getAlpineData() : null;
              if (grantSuccessAlpineData) {
                grantSuccessAlpineData.showGrantModal = false;
                grantSuccessAlpineData.showGrantSuccessModal = true;
              }

              setTimeout(() => {
                initApp();
              }, 500);

            } catch (err) {
              window.SilverhawkToast(err.message || 'Disbursement failed. Please verify your PIN.', 'error');
            }
          };

          // Hook up Grant Application Form Submission
          const grantForm = document.getElementById('grant-application-form');
          if (grantForm) {
            grantForm.onsubmit = async function(e) {
              e.preventDefault();

              const progId = document.getElementById('grant-program-select')?.value;
              const accId = document.getElementById('grant-account-select')?.value;
              const reqAmt = document.getElementById('grant-amount-input')?.value;
              const bizName = document.getElementById('grant-bizname-input')?.value;
              const bizType = document.getElementById('grant-biztype-input')?.value;
              const regNum = document.getElementById('grant-regnum-input')?.value;
              const turnover = document.getElementById('grant-turnover-input')?.value;
              const empCount = document.getElementById('grant-empcount-input')?.value;
              const propTitle = document.getElementById('grant-title-input')?.value;
              const propDetails = document.getElementById('grant-details-input')?.value;
              const pinVal = document.getElementById('grant-pin-input')?.value;
              const submitBtn = document.getElementById('grant-submit-btn');

              if (!progId) {
                window.SilverhawkToast('Please select a grant program.', 'error');
                return;
              }
              if (!reqAmt || parseFloat(reqAmt) <= 0) {
                window.SilverhawkToast('Please specify a valid grant request amount.', 'error');
                return;
              }
              if (!bizName || !bizType || !regNum || !propTitle || !propDetails) {
                window.SilverhawkToast('Please complete all required business and proposal fields.', 'error');
                return;
              }
              if (!pinVal || pinVal.length < 4) {
                window.SilverhawkToast('Please enter your 4-digit security PIN.', 'error');
                return;
              }

              const origBtnHtml = submitBtn ? submitBtn.innerHTML : 'Submit Application';
              if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Underwriting Application...';
              }

              try {
                const res = await window.SilverhawkAPI.applyForGrant({
                  programId: progId,
                  accountId: accId || primaryAccount?.id,
                  requestedAmount: reqAmt,
                  businessName: bizName,
                  businessType: bizType,
                  registrationNum: regNum,
                  annualTurnover: turnover || undefined,
                  employeeCount: empCount ? parseInt(empCount) : undefined,
                  proposalTitle: propTitle,
                  proposalDetails: propDetails,
                  pin: pinVal,
                });

                window.SilverhawkToast('Grant application submitted successfully!', 'success');
                grantForm.reset();

                const grantTabAlpineData = window.getAlpineData ? window.getAlpineData() : null;
                if (grantTabAlpineData) grantTabAlpineData.grantTab = 'tracker';

                await window.loadUserGrants();

              } catch (err) {
                window.SilverhawkToast(err.message || 'Failed to submit application. Check limits and PIN.', 'error');
              } finally {
                if (submitBtn) {
                  submitBtn.disabled = false;
                  submitBtn.innerHTML = origBtnHtml;
                }
              }
            };
          }
          // ----------------------------------------------------
          // IRS Tax Refund & 1099-INT Tax Portal Utilities
          // ----------------------------------------------------
          window.initTaxRefundModal = function() {
            const routingEl = document.getElementById('tax-portal-routing');
            const accountEl = document.getElementById('tax-portal-account');
            const nameEl = document.getElementById('tax-portal-name');
            const bankEl = document.getElementById('tax-portal-bank');

            if (routingEl) routingEl.textContent = '021000021';
            if (accountEl && primaryAccount) accountEl.textContent = primaryAccount.accountNumber;
            if (nameEl && window.SilverhawkAPI.getUser()) {
              const u = window.SilverhawkAPI.getUser();
              nameEl.textContent = u.firstName ? `${u.firstName} ${u.lastName}` : (u.username || 'Silverhawk Account Holder');
            }
            if (bankEl) bankEl.textContent = 'Silverhawk Digital Federal Trust';

            // Auto-calculate dynamic 1099-INT box values
            const box1El = document.getElementById('tax-1099-box1');
            const box2El = document.getElementById('tax-1099-box2');
            const box4El = document.getElementById('tax-1099-box4');
            const ref1099El = document.getElementById('tax-1099-ref');

            if (box1El) box1El.textContent = `${userCurrencySymbol}1,250.75`;
            if (box2El) box2El.textContent = `${userCurrencySymbol}0.00`;
            if (box4El) box4El.textContent = `${userCurrencySymbol}0.00`;
            if (ref1099El) ref1099El.textContent = `1099INT-2025-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
          };

          window.downloadTaxForm1099 = function(year) {
            year = year || '2025';
            const u = window.SilverhawkAPI.getUser() || {};
            const name = u.firstName ? `${u.firstName} ${u.lastName}` : (u.username || 'Valued Client');
            const accNum = primaryAccount ? primaryAccount.accountNumber : '1002384912';

            const content = `================================================================================
                    INTERNAL REVENUE SERVICE (IRS) — FORM 1099-INT
                       Interest Income Tax Statement for Year ${year}
================================================================================
PAYER'S Name & Address:
  Silverhawk Digital Banking & Corporate Trust
  100 Financial Plaza, Suite 2500, New York, NY 10005, USA
  Federal EIN: 12-3456789 | Direct ACH Routing: 021000021

RECIPIENT'S Name & Information:
  Name: ${name}
  Primary Account: #${accNum}
  Recipient Tax ID / TIN: ***-**-6789
--------------------------------------------------------------------------------
BOX 1: Interest Income ..................................... ${userCurrencySymbol}1,250.75
BOX 2: Early Withdrawal Penalty ............................ ${userCurrencySymbol}0.00
BOX 3: Interest on U.S. Savings Bonds & Treasuries ......... ${userCurrencySymbol}0.00
BOX 4: Federal Income Tax Withheld ......................... ${userCurrencySymbol}0.00
BOX 5: Investment Expenses ................................. ${userCurrencySymbol}0.00
BOX 6: Foreign Tax Paid .................................... ${userCurrencySymbol}0.00
--------------------------------------------------------------------------------
CERTIFICATION:
This is important tax information and is being furnished to the IRS.
Electronic Filing Reference: 1099INT-${year}-${Date.now().toString().slice(-6)}
Generated by Silverhawk Automated Tax Engine on: ${new Date().toUTCString()}
================================================================================`;

            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `IRS_Form_1099INT_${year}_${accNum}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            window.SilverhawkToast(`IRS Form 1099-INT (${year}) statement downloaded successfully.`, 'success');
          };

          // Hook up Tax Refund Form Submission
          const taxForm = document.getElementById('tax-refund-portal-form');
          if (taxForm) {
            taxForm.onsubmit = async function(e) {
              e.preventDefault();

              const year = document.getElementById('tax-year-select')?.value || '2025';
              const filingType = document.getElementById('tax-filing-type-select')?.value || 'Individual Form 1040';
              const ssnLast4 = document.getElementById('tax-ssn-last4')?.value;
              const amtVal = document.getElementById('tax-refund-amount')?.value;
              const pinVal = document.getElementById('tax-pin-input')?.value;
              const submitBtn = document.getElementById('tax-submit-btn');

              if (!amtVal || parseFloat(amtVal) <= 0) {
                window.SilverhawkToast('Please specify a valid estimated refund amount.', 'error');
                return;
              }
              if (!ssnLast4 || ssnLast4.length < 4) {
                window.SilverhawkToast('Please enter the last 4 digits of your SSN/ITIN/EIN.', 'error');
                return;
              }
              if (!pinVal || pinVal.length < 4) {
                window.SilverhawkToast('Please enter your 4-digit security PIN to link direct deposit.', 'error');
                return;
              }

              const origBtnHtml = submitBtn ? submitBtn.innerHTML : 'Link & Expedite IRS Refund';
              if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Clearing IRS Direct Deposit...';
              }

              try {
                const res = await window.SilverhawkAPI.claimTaxRefund({
                  taxYear: year,
                  filingType: filingType,
                  ssnLast4: ssnLast4,
                  amount: amtVal,
                  pin: pinVal,
                });

                window.SilverhawkToast('IRS Direct Deposit linked and credited successfully!', 'success');

                // Populate Receipt Modal
                const receiptAmt = document.getElementById('tax-receipt-amount');
                const receiptYear = document.getElementById('tax-receipt-year');
                const receiptAcc = document.getElementById('tax-receipt-account');
                const receiptRef = document.getElementById('tax-receipt-ref');

                if (receiptAmt) receiptAmt.textContent = `${userCurrencySymbol}${parseFloat(amtVal).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
                if (receiptYear) receiptYear.textContent = `Tax Year ${year} (${filingType})`;
                if (receiptAcc) receiptAcc.textContent = primaryAccount ? `#${primaryAccount.accountNumber}` : 'Primary Checking';
                if (receiptRef) receiptRef.textContent = res.transaction?.reference || 'IRS-ACH-992019';

                // Close Tax modal & open Success Modal
                const taxAlpineData = window.getAlpineData ? window.getAlpineData() : null;
                if (taxAlpineData) {
                  taxAlpineData.showTaxRefundModal = false;
                  taxAlpineData.showTaxRefundSuccessModal = true;
                }

                setTimeout(() => {
                  initApp();
                }, 500);

              } catch (err) {
                window.SilverhawkToast(err.message || 'Failed to process IRS direct deposit. Check PIN.', 'error');
              } finally {
                if (submitBtn) {
                  submitBtn.disabled = false;
                  submitBtn.innerHTML = origBtnHtml;
                }
              }
            };
          }
        })
        .catch((err) => {
          console.warn('Dashboard summary load warning:', err);
        });
    }

    // Initialize Real-time WebSocket connection
    SilverhawkRealtime.init();
  }

  // ----------------------------------------------------
  // Real-Time WebSocket Financial Sync Manager
  // ----------------------------------------------------
  const SilverhawkRealtime = {
    socket: null,
    init() {
      const token = window.SilverhawkAPI.getAccessToken();
      if (!token) return;

      if (typeof window.io === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
        script.onload = () => this.connect(token);
        document.head.appendChild(script);
      } else {
        this.connect(token);
      }
    },

    connect(token) {
      if (this.socket) return;
      try {
        const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
        const wsUrl = `${protocol}//${window.location.host}/realtime`;

        this.socket = window.io(wsUrl, {
          query: { token },
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 2000,
        });

        this.socket.on('connect', () => {
          console.log('[Silverhawk Realtime] Connected to institutional financial stream.');
        });

        this.socket.on('balance.updated', (data) => {
          console.log('[Silverhawk Realtime] Live balance update received:', data);
          window.SilverhawkToast(`Balance updated: ${data.currency} ${parseFloat(data.availableBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 'info');
          const balEls = document.querySelectorAll(`[data-account-id="${data.accountId}"], .live-available-balance, #active-account-balance`);
          balEls.forEach(el => {
            el.textContent = `${window.getCurrencySymbol ? window.getCurrencySymbol(data.currency) : '$'}${parseFloat(data.availableBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
            el.classList.add('text-emerald-400', 'animate-pulse');
            setTimeout(() => el.classList.remove('text-emerald-400', 'animate-pulse'), 2000);
          });
        });

        this.socket.on('transaction.created', (data) => {
          console.log('[Silverhawk Realtime] Live transaction broadcast:', data);
          window.SilverhawkToast(`Transaction Alert: ${data.description || 'New transaction'} (${data.currencyCode} ${parseFloat(data.amount).toFixed(2)})`, 'success');
        });

        this.socket.on('notification.received', (data) => {
          window.SilverhawkToast(`${data.title || 'Notification'}: ${data.message || ''}`, 'info');
        });
      } catch (err) {
        console.warn('[Silverhawk Realtime] Socket init error:', err);
      }
    }
  };

  window.viewTransferReceipt = async function(transactionId) {
    try {
      let receiptData = null;
      if (transactionId) {
        receiptData = await window.SilverhawkAPI.getTransactionReceipt(transactionId);
      } else {
        receiptData = window.lastTransferReceiptData;
      }
      if (!receiptData) {
        window.SilverhawkToast('Receipt data not available', 'error');
        return;
      }

      const popRef = document.getElementById('pop-receipt-ref');
      const popDate = document.getElementById('pop-receipt-date');
      const popAmount = document.getElementById('pop-receipt-amount');
      const popFee = document.getElementById('pop-receipt-fee');
      const popNet = document.getElementById('pop-receipt-net');
      const popSenderName = document.getElementById('pop-sender-name');
      const popSenderAcc = document.getElementById('pop-sender-account');
      const popRecipientName = document.getElementById('pop-recipient-name');
      const popRecipientAcc = document.getElementById('pop-recipient-account');
      const popRecipientBank = document.getElementById('pop-recipient-bank');
      const popDesc = document.getElementById('pop-receipt-desc');
      const popHash = document.getElementById('pop-receipt-hash');

      if (popRef) popRef.textContent = receiptData.reference || 'N/A';
      if (popDate) popDate.textContent = new Date(receiptData.timestamp || Date.now()).toLocaleString();
      if (popAmount) popAmount.textContent = `${receiptData.currency || '$'} ${parseFloat(receiptData.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      if (popFee) popFee.textContent = `${receiptData.currency || '$'} ${parseFloat(receiptData.fee || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      if (popNet) popNet.textContent = `${receiptData.currency || '$'} ${parseFloat(receiptData.netAmount || receiptData.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      if (popSenderName) popSenderName.textContent = receiptData.sender?.name || 'Account Holder';
      if (popSenderAcc) popSenderAcc.textContent = `#${receiptData.sender?.accountNumber || 'N/A'}`;
      if (popRecipientName) popRecipientName.textContent = receiptData.beneficiary?.name || 'Beneficiary';
      if (popRecipientAcc) popRecipientAcc.textContent = `#${receiptData.beneficiary?.accountNumber || 'N/A'}`;
      if (popRecipientBank) popRecipientBank.textContent = receiptData.beneficiary?.bankName || 'Silverhawk Bank';
      if (popDesc) popDesc.textContent = receiptData.description || 'Electronic Funds Transfer';
      if (popHash) popHash.textContent = (receiptData.clearingMetadata?.verificationHash || 'CERT-RMVL-998822').slice(0, 32) + '...';

      const receiptAlpineData = window.getAlpineData ? window.getAlpineData() : null;
      if (receiptAlpineData) receiptAlpineData.showReceiptModal = true;
    } catch (e) {
      window.SilverhawkToast(e.message || 'Unable to load receipt', 'error');
    }
  };

  window.printTransferReceipt = function() {
    window.print();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})(window);
