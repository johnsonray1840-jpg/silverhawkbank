/**
 * Silverhawk Digital Banking — Master CMS & Platform Settings Engine (Client Core)
 * Dynamically binds and synchronizes all 19 platform configuration areas across all pages:
 * Bank Name, Logo, Favicon, Contact Info, Support Email, Phone, Address, Currencies,
 * Fees, Limits, Maintenance Mode, Registration, KYC, Loans, Notifications, Gateways,
 * SMTP, SMS, and Security Policies.
 *
 * ZERO HARDCODED VALUES: All elements marked with [data-cms="..."] or standard utility classes
 * are dynamically populated from live backend settings or local cache.
 */

(function(window, document) {
  'use strict';

  const API_ENDPOINT = (function() {
    if (typeof window !== 'undefined') {
      if (window.SILVERHAWK_API_URL) return `${window.SILVERHAWK_API_URL}/settings/public`;
      if (window.location && window.location.origin) return `${window.location.origin}/api/v1/settings/public`;
    }
    return '/api/v1/settings/public';
  })();

  const DEFAULT_SETTINGS = {
    // 1. Bank Name & Brand
    bank_name: 'Silverhawk Digital Federal Trust',
    bank_short_name: 'Silverhawk',
    tagline: 'Next-Generation Global Institutional & Private Wealth Banking',
    copyright_text: '© 2026 Silverhawk Digital Federal Trust. Member FDIC / Federal Reserve System.',

    // 2. Logo & 3. Favicon
    logo_url: '/storage/app/public/photos/silverhawk_bank_logo.svg',
    logo_dark_url: '/storage/app/public/photos/silverhawk_bank_logo_white.svg',
    favicon_url: '/storage/app/public/photos/silverhawk_favicon.png',

    // 4. Contact Information, 5. Support Email, 6. Phone, 7. Address
    support_email: 'support@silverhawkbank.com',
    compliance_email: 'compliance@silverhawkbank.com',
    support_phone: '+1 (800) 892-4190',
    emergency_phone: '+1 (800) 892-4199',
    headquarters_address: '100 Wall Street, 28th Floor, New York, NY 10005, United States',
    routing_number: '021000021',
    swift_code: 'RMVLUS33NYC',
    business_hours: 'Mon - Fri: 8:00 AM - 6:00 PM EST | 24/7 Live Treasury Desks',

    // 8. Currencies
    default_currency: 'USD',
    supported_currencies: 'USD,EUR,GBP,CAD,AUD,JPY,CHF,NGN',
    exchange_rate_source: 'CENTRAL_BANK_ECB_FIXING',

    // 9. Fees
    transfer_fee_internal_flat: '$0.00',
    transfer_fee_internal_pct: '0.00%',
    transfer_fee_external_flat: '$15.00',
    transfer_fee_external_pct: '0.25%',
    wire_fee_domestic: '$0.00',
    wire_fee_international: '$15.00',
    withdrawal_fee_pct: '1.00%',
    card_issuance_fee: '$50.00',
    loan_processing_fee_pct: '1.00%',
    hysa_apy_rate: '7.25%',

    // 10. Limits
    daily_transfer_limit_default: '$50,000.00',
    daily_withdrawal_limit_default: '$20,000.00',
    single_transfer_limit: '$100,000.00',
    min_deposit_amount: '$10.00',
    max_deposit_amount: '$1,000,000.00',

    // 11. Maintenance Mode
    maintenance_mode: false,
    maintenance_title: 'Scheduled Interbank Network Maintenance',
    maintenance_message: 'Our core banking ledger is currently undergoing scheduled Fedwire upgrades. Real-time services will resume shortly.',
    header_announcement_enabled: true,
    header_announcement_text: 'Federal Reserve Wire Network Operating at 100% SLA Capacity',

    // 12. Registration Settings
    enable_registration: true,
    require_email_verification: true,
    require_phone_verification: false,
    allow_referral_rewards: true,
    referral_bonus_amount: '$25.00',

    // 13. KYC Requirements
    kyc_required_for_transfers: true,
    kyc_required_for_loans: true,
    kyc_required_for_cards: true,
    min_kyc_tier_for_wires: 'TIER_2',

    // 14. Loan Settings
    enable_loans: true,
    min_interest_rate: '4.20%',
    max_interest_rate: '18.50%',
    max_tenure_months: '60 Months',

    // 15. Notification Settings
    email_notifications_enabled: true,
    sms_notifications_enabled: true,
    push_notifications_enabled: true,

    // 16. Payment Gateway Settings & Crypto Desks
    stripe_enabled: true,
    paystack_enabled: true,
    flutterwave_enabled: true,
    crypto_btc_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    crypto_usdt_trc20: 'TYDzsYUEpvnYmQk4zGP9sWWcTEd36dAtW7',
    crypto_eth_address: '0x71C8705a2B8e6267150C3667cE177A144eB29',

    // 17. SMTP Settings
    smtp_from_name: 'Silverhawk Digital Federal Trust',
    smtp_from_email: 'no-reply@silverhawkbank.com',

    // 18. SMS Settings
    sms_sender_id: 'SILVERHAWK',

    // 19. Security Settings
    enforce_2fa_for_admins: true,
    session_timeout_minutes: '30',
    max_login_attempts: '5',

    // Feature Toggles (Tweak 90% of Bank Capabilities)
    feature_instant_transfers: true,
    feature_card_issuance: true,
    feature_hysa_vaults: true,
    feature_trade_finance: true,
    feature_crypto_deposits: true,
    feature_grants: true,
    feature_pos_merchants: true,
    feature_ai_copilot: true,
  };

  const SilverhawkSiteConfig = {
    /**
     * Get cached or default settings synchronously
     */
    getSettings() {
      try {
        const stored = localStorage.getItem(SETTINGS_KEY);
        if (!stored) return { ...DEFAULT_SETTINGS };
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      } catch (e) {
        return { ...DEFAULT_SETTINGS };
      }
    },

    /**
     * Get single setting value by key
     */
    get(key, fallback = null) {
      const cfg = this.getSettings();
      return cfg[key] !== undefined ? cfg[key] : fallback;
    },

    /**
     * Save settings locally and notify DOM
     */
    saveSettings(newSettings) {
      const merged = { ...this.getSettings(), ...newSettings };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
      this.applyToDOM();
      window.dispatchEvent(new CustomEvent('silverhawk-settings-updated', { detail: merged }));
      return merged;
    },

    /**
     * Fetch latest public settings from live backend
     */
    async fetchRemote() {
      try {
        const res = await fetch(API_ENDPOINT);
        if (res.ok) {
          const data = await res.json();
          const remoteSettings = data.settings || (data.data && data.data.settings) || data;
          if (remoteSettings && typeof remoteSettings === 'object') {
            this.saveSettings(remoteSettings);
            return remoteSettings;
          }
        }
      } catch (e) {
        // Fallback silently to cached/default settings
      }
      return this.getSettings();
    },

    /**
     * Universal DOM dynamic binding: Updates titles, logos, text, hrefs, and styles
     */
    applyToDOM() {
      const cfg = this.getSettings();

      // 1. Update Document Title
      if (document.title && cfg.bank_name) {
        if (!document.title.includes(cfg.bank_name) && !document.title.includes(cfg.bank_short_name)) {
          const parts = document.title.split('—');
          const pageName = parts[0].trim();
          document.title = `${pageName} — ${cfg.bank_name}`;
        }
      }

      // 2. Favicon & Shortcuts
      const favicon = document.querySelector("link[rel*='icon']");
      if (favicon && cfg.favicon_url) {
        favicon.href = cfg.favicon_url;
      }

      // 3. Bank Name & Brand Tokens
      document.querySelectorAll('[data-cms="bank_name"], .bank-name, [data-bank-name]').forEach((el) => {
        el.textContent = cfg.bank_name;
      });
      document.querySelectorAll('[data-cms="bank_short_name"], .bank-short-name, [data-bank-short-name]').forEach((el) => {
        el.textContent = cfg.bank_short_name;
      });
      document.querySelectorAll('[data-cms="tagline"], .bank-tagline, [data-bank-tagline]').forEach((el) => {
        el.textContent = cfg.tagline;
      });
      document.querySelectorAll('[data-cms="copyright"], .bank-copyright, [data-bank-copyright]').forEach((el) => {
        el.textContent = cfg.copyright_text;
      });

      // 4. Logo Assets
      document.querySelectorAll('[data-cms="logo"], .bank-logo, [data-bank-logo]').forEach((el) => {
        if (el.tagName === 'IMG') {
          el.src = cfg.logo_url;
          el.alt = cfg.bank_name;
        }
      });
      document.querySelectorAll('[data-cms="logo_dark"], .bank-logo-dark').forEach((el) => {
        if (el.tagName === 'IMG') {
          el.src = cfg.logo_dark_url || cfg.logo_url;
          el.alt = cfg.bank_name;
        }
      });

      // 5. Contact Information (Email, Phone, Address, Routing, SWIFT)
      document.querySelectorAll('[data-cms="support_email"], .support-email, [data-support-email]').forEach((el) => {
        el.textContent = cfg.support_email;
        if (el.tagName === 'A') el.href = `mailto:${cfg.support_email}`;
      });
      document.querySelectorAll('[data-cms="compliance_email"]').forEach((el) => {
        el.textContent = cfg.compliance_email || cfg.support_email;
        if (el.tagName === 'A') el.href = `mailto:${cfg.compliance_email || cfg.support_email}`;
      });
      document.querySelectorAll('a[href^="mailto:"]').forEach((el) => {
        if (el.href.includes('silverhawkbank.com') || el.href.includes('support@')) {
          el.href = `mailto:${cfg.support_email}`;
        }
      });

      document.querySelectorAll('[data-cms="support_phone"], .support-phone, [data-support-phone]').forEach((el) => {
        el.textContent = cfg.support_phone;
        if (el.tagName === 'A') el.href = `tel:${cfg.support_phone.replace(/[^\d+]/g, '')}`;
      });
      document.querySelectorAll('[data-cms="emergency_phone"]').forEach((el) => {
        el.textContent = cfg.emergency_phone || cfg.support_phone;
        if (el.tagName === 'A') el.href = `tel:${(cfg.emergency_phone || cfg.support_phone).replace(/[^\d+]/g, '')}`;
      });

      document.querySelectorAll('[data-cms="headquarters_address"], .bank-address, [data-bank-address]').forEach((el) => {
        el.textContent = cfg.headquarters_address;
      });
      document.querySelectorAll('[data-cms="routing_number"], .bank-routing').forEach((el) => {
        el.textContent = cfg.routing_number;
      });
      document.querySelectorAll('[data-cms="swift_code"], .bank-swift').forEach((el) => {
        el.textContent = cfg.swift_code;
      });
      document.querySelectorAll('[data-cms="business_hours"]').forEach((el) => {
        el.textContent = cfg.business_hours;
      });

      // 6. Fees, Rates & Limits
      document.querySelectorAll('[data-cms="hysa_rate"], .hysa-rate').forEach((el) => {
        el.textContent = cfg.hysa_apy_rate;
      });
      document.querySelectorAll('[data-cms="wire_fee_domestic"]').forEach((el) => {
        el.textContent = cfg.wire_fee_domestic || cfg.transfer_fee_internal_flat;
      });
      document.querySelectorAll('[data-cms="wire_fee_international"]').forEach((el) => {
        el.textContent = cfg.wire_fee_international || cfg.transfer_fee_external_flat;
      });
      document.querySelectorAll('[data-cms="card_fee"]').forEach((el) => {
        el.textContent = cfg.card_issuance_fee;
      });
      document.querySelectorAll('[data-cms="daily_transfer_limit"]').forEach((el) => {
        el.textContent = cfg.daily_transfer_limit_default;
      });

      // 7. Crypto Treasury Addresses
      document.querySelectorAll('[data-cms="crypto_btc"]').forEach((el) => {
        el.textContent = cfg.crypto_btc_address;
      });
      document.querySelectorAll('[data-cms="crypto_usdt"]').forEach((el) => {
        el.textContent = cfg.crypto_usdt_trc20;
      });
      document.querySelectorAll('[data-cms="crypto_eth"]').forEach((el) => {
        el.textContent = cfg.crypto_eth_address;
      });

      // 8. Maintenance Mode Gate
      this.checkMaintenanceGate(cfg);
    },

    /**
     * Display elegant full-screen maintenance overlay when maintenance_mode is active
     */
    checkMaintenanceGate(cfg) {
      const isMaintenance = cfg.maintenance_mode === true || cfg.maintenance_mode === 'true';
      const path = window.location.pathname.toLowerCase();
      const isAdminRoute = path.includes('/admin') || path.includes('admin.html');

      const existingOverlay = document.getElementById('silverhawk-maintenance-overlay');

      if (isMaintenance && !isAdminRoute) {
        if (!existingOverlay) {
          const overlay = document.createElement('div');
          overlay.id = 'silverhawk-maintenance-overlay';
          overlay.className = 'fixed inset-0 z-[999999] bg-[#070b14] flex items-center justify-center p-6 text-center text-slate-100 backdrop-blur-3xl';
          overlay.innerHTML = `
            <div class="max-w-lg w-full bg-[#0c162f] border border-amber-500/30 rounded-3xl p-8 sm:p-10 shadow-2xl space-y-6">
              <div class="w-16 h-16 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-2xl animate-pulse">
                <i class="fas fa-tools"></i>
              </div>
              <div class="space-y-2">
                <h1 class="text-2xl font-black text-white tracking-tight">${cfg.maintenance_title || 'Interbank System Maintenance'}</h1>
                <p class="text-sm text-slate-300 leading-relaxed">${cfg.maintenance_message || 'Our core banking network is currently undergoing scheduled infrastructure upgrades. Services will resume shortly.'}</p>
              </div>
              <div class="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 text-xs text-slate-400 space-y-1">
                <div>Support Desk: <a href="mailto:${cfg.support_email}" class="text-sky-400 font-bold hover:underline">${cfg.support_email}</a></div>
                <div>Emergency Hotline: <span class="text-slate-200 font-bold">${cfg.support_phone}</span></div>
              </div>
              <a href="/admin" class="inline-block text-[11px] font-bold text-slate-500 hover:text-slate-300 transition-colors">
                <i class="fas fa-shield-alt mr-1"></i> Staff Administration Portal
              </a>
            </div>
          `;
          document.body.appendChild(overlay);
        }
      } else if (existingOverlay) {
        existingOverlay.remove();
      }
    },

    /**
     * Initialize on DOM Ready
     */
    init() {
      // 1. Initial DOM bind with cached/defaults
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.applyToDOM());
      } else {
        this.applyToDOM();
      }

      // 2. Asynchronously fetch live backend updates
      this.fetchRemote().then(() => this.applyToDOM());
    },
  };

  // Run initialization
  SilverhawkSiteConfig.init();

  // Export to window
  window.SilverhawkSiteConfig = SilverhawkSiteConfig;

})(window, document);
