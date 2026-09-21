/**
 * Silverhawk Digital Banking Platform — Master CMS & Platform Settings Engine
 * Universal Configuration Validator, Dynamic Tariff Resolver, Template Engine & Security Filter
 */

import Decimal from 'decimal.js';

export enum SettingCategory {
  GENERAL = 'GENERAL',
  BRANDING = 'BRANDING',
  CONTACT = 'CONTACT',
  CURRENCIES = 'CURRENCIES',
  FEES = 'FEES',
  LIMITS = 'LIMITS',
  MAINTENANCE = 'MAINTENANCE',
  REGISTRATION = 'REGISTRATION',
  KYC = 'KYC',
  LOANS = 'LOANS',
  NOTIFICATIONS = 'NOTIFICATIONS',
  GATEWAYS = 'GATEWAYS',
  SMTP = 'SMTP',
  SMS = 'SMS',
  SECURITY = 'SECURITY',
}

export interface SettingDefinition {
  key: string;
  category: SettingCategory;
  defaultValue: string;
  isSensitive: boolean;
  description: string;
}

export class PlatformSettingsUtil {
  public static readonly DEFINITIONS: Record<string, SettingDefinition> = {
    // 1. Bank Name & Brand
    bank_name: {
      key: 'bank_name',
      category: SettingCategory.BRANDING,
      defaultValue: 'Silverhawk Digital Federal Trust',
      isSensitive: false,
      description: 'Official registered institutional bank name',
    },
    bank_short_name: {
      key: 'bank_short_name',
      category: SettingCategory.BRANDING,
      defaultValue: 'Silverhawk',
      isSensitive: false,
      description: 'Short display name for compact mobile navigation & SMS',
    },
    tagline: {
      key: 'tagline',
      category: SettingCategory.BRANDING,
      defaultValue: 'Next-Generation Global Institutional & Private Wealth Banking',
      isSensitive: false,
      description: 'Corporate brand mission tagline',
    },
    copyright_text: {
      key: 'copyright_text',
      category: SettingCategory.BRANDING,
      defaultValue: '© 2026 Silverhawk Digital Federal Trust. Member FDIC / Federal Reserve System.',
      isSensitive: false,
      description: 'Legal copyright footer text',
    },

    // 2. Logo & 3. Favicon
    logo_url: {
      key: 'logo_url',
      category: SettingCategory.BRANDING,
      defaultValue: '/storage/app/public/photos/silverhawk_bank_logo.svg',
      isSensitive: false,
      description: 'Primary corporate SVG/PNG logo asset URL',
    },
    logo_dark_url: {
      key: 'logo_dark_url',
      category: SettingCategory.BRANDING,
      defaultValue: '/storage/app/public/photos/silverhawk_bank_logo_white.svg',
      isSensitive: false,
      description: 'Dark mode contrast logo asset URL',
    },
    favicon_url: {
      key: 'favicon_url',
      category: SettingCategory.BRANDING,
      defaultValue: '/storage/app/public/photos/silverhawk_favicon.png',
      isSensitive: false,
      description: 'Browser tab favicon icon URL',
    },

    // 4. Contact Information, 5. Support Email, 6. Phone, 7. Address
    support_email: {
      key: 'support_email',
      category: SettingCategory.CONTACT,
      defaultValue: 'support@silverhawkbank.com',
      isSensitive: false,
      description: '24/7 Tier-1 customer support desk mailbox',
    },
    compliance_email: {
      key: 'compliance_email',
      category: SettingCategory.CONTACT,
      defaultValue: 'compliance@silverhawkbank.com',
      isSensitive: false,
      description: 'AML/FinCEN compliance & regulatory mailbox',
    },
    support_phone: {
      key: 'support_phone',
      category: SettingCategory.CONTACT,
      defaultValue: '+1 (800) 892-4190',
      isSensitive: false,
      description: 'Toll-free 24/7 institutional phone hotline',
    },
    emergency_phone: {
      key: 'emergency_phone',
      category: SettingCategory.CONTACT,
      defaultValue: '+1 (800) 892-4199',
      isSensitive: false,
      description: 'Emergency lost card & fraud prevention hotline',
    },
    headquarters_address: {
      key: 'headquarters_address',
      category: SettingCategory.CONTACT,
      defaultValue: '100 Wall Street, 28th Floor, New York, NY 10005, United States',
      isSensitive: false,
      description: 'Physical global headquarters postal address',
    },
    routing_number: {
      key: 'routing_number',
      category: SettingCategory.CONTACT,
      defaultValue: '021000021',
      isSensitive: false,
      description: 'ABA Fedwire 9-digit routing transit number',
    },
    swift_code: {
      key: 'swift_code',
      category: SettingCategory.CONTACT,
      defaultValue: 'RMVLUS33NYC',
      isSensitive: false,
      description: 'SWIFT/BIC 8 or 11 character interbank clearing identifier',
    },
    business_hours: {
      key: 'business_hours',
      category: SettingCategory.CONTACT,
      defaultValue: 'Mon - Fri: 8:00 AM - 6:00 PM EST | 24/7 Live Treasury Desks',
      isSensitive: false,
      description: 'Institutional customer service operating hours',
    },

    // 8. Currencies
    default_currency: {
      key: 'default_currency',
      category: SettingCategory.CURRENCIES,
      defaultValue: 'USD',
      isSensitive: false,
      description: 'Platform base accounting currency',
    },
    supported_currencies: {
      key: 'supported_currencies',
      category: SettingCategory.CURRENCIES,
      defaultValue: 'USD,EUR,GBP,CAD,AUD,JPY,CHF,NGN',
      isSensitive: false,
      description: 'Comma-separated list of enabled multi-currency ISO codes',
    },
    exchange_rate_source: {
      key: 'exchange_rate_source',
      category: SettingCategory.CURRENCIES,
      defaultValue: 'CENTRAL_BANK_ECB_FIXING',
      isSensitive: false,
      description: 'FX exchange rate feed provider source',
    },

    // 9. Fees
    transfer_fee_internal_flat: {
      key: 'transfer_fee_internal_flat',
      category: SettingCategory.FEES,
      defaultValue: '0.0000',
      isSensitive: false,
      description: 'Flat fee charged on internal peer-to-peer transfers',
    },
    transfer_fee_internal_pct: {
      key: 'transfer_fee_internal_pct',
      category: SettingCategory.FEES,
      defaultValue: '0.00',
      isSensitive: false,
      description: 'Percentage fee charged on internal peer-to-peer transfers',
    },
    transfer_fee_external_flat: {
      key: 'transfer_fee_external_flat',
      category: SettingCategory.FEES,
      defaultValue: '15.0000',
      isSensitive: false,
      description: 'Flat wire fee charged on outbound external bank wires',
    },
    transfer_fee_external_pct: {
      key: 'transfer_fee_external_pct',
      category: SettingCategory.FEES,
      defaultValue: '0.25',
      isSensitive: false,
      description: 'Percentage fee charged on outbound external bank wires',
    },
    withdrawal_fee_pct: {
      key: 'withdrawal_fee_pct',
      category: SettingCategory.FEES,
      defaultValue: '1.00',
      isSensitive: false,
      description: 'Percentage fee charged on cash or ATM disbursements',
    },
    card_issuance_fee: {
      key: 'card_issuance_fee',
      category: SettingCategory.FEES,
      defaultValue: '50.0000',
      isSensitive: false,
      description: 'Physical metal card issuance & courier fee',
    },
    loan_processing_fee_pct: {
      key: 'loan_processing_fee_pct',
      category: SettingCategory.FEES,
      defaultValue: '1.00',
      isSensitive: false,
      description: 'Loan origination & underwriting processing fee %',
    },
    hysa_apy_rate: {
      key: 'hysa_apy_rate',
      category: SettingCategory.FEES,
      defaultValue: '7.25%',
      isSensitive: false,
      description: 'Advertised High-Yield Savings Annual Percentage Yield rate',
    },

    // 10. Limits
    daily_transfer_limit_default: {
      key: 'daily_transfer_limit_default',
      category: SettingCategory.LIMITS,
      defaultValue: '50000.0000',
      isSensitive: false,
      description: 'Default daily aggregate transfer volume ceiling per customer',
    },
    daily_withdrawal_limit_default: {
      key: 'daily_withdrawal_limit_default',
      category: SettingCategory.LIMITS,
      defaultValue: '20000.0000',
      isSensitive: false,
      description: 'Default daily cash withdrawal limit per customer',
    },
    single_transfer_limit: {
      key: 'single_transfer_limit',
      category: SettingCategory.LIMITS,
      defaultValue: '100000.0000',
      isSensitive: false,
      description: 'Maximum permitted single transaction amount without dual-authorization',
    },
    min_deposit_amount: {
      key: 'min_deposit_amount',
      category: SettingCategory.LIMITS,
      defaultValue: '10.0000',
      isSensitive: false,
      description: 'Minimum inbound deposit funding floor',
    },
    max_deposit_amount: {
      key: 'max_deposit_amount',
      category: SettingCategory.LIMITS,
      defaultValue: '1000000.0000',
      isSensitive: false,
      description: 'Maximum inbound deposit funding ceiling per single transaction',
    },

    // 11. Maintenance Mode
    maintenance_mode: {
      key: 'maintenance_mode',
      category: SettingCategory.MAINTENANCE,
      defaultValue: 'false',
      isSensitive: false,
      description: 'Global maintenance mode toggle (blocks customer logins)',
    },
    maintenance_title: {
      key: 'maintenance_title',
      category: SettingCategory.MAINTENANCE,
      defaultValue: 'Scheduled Interbank Network Maintenance',
      isSensitive: false,
      description: 'Header title displayed on customer maintenance screen',
    },
    maintenance_message: {
      key: 'maintenance_message',
      category: SettingCategory.MAINTENANCE,
      defaultValue: 'Our core banking ledger is currently undergoing scheduled Fedwire upgrades. Real-time services will resume shortly.',
      isSensitive: false,
      description: 'Detailed explanation shown to customers during maintenance',
    },
    maintenance_bypass_ips: {
      key: 'maintenance_bypass_ips',
      category: SettingCategory.MAINTENANCE,
      defaultValue: '127.0.0.1,::1',
      isSensitive: false,
      description: 'Comma-separated IP addresses permitted to bypass maintenance mode',
    },

    // 12. Registration Settings
    enable_registration: {
      key: 'enable_registration',
      category: SettingCategory.REGISTRATION,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Allow new public customer registrations',
    },
    require_email_verification: {
      key: 'require_email_verification',
      category: SettingCategory.REGISTRATION,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Enforce 6-digit email OTP verification before dashboard access',
    },
    require_phone_verification: {
      key: 'require_phone_verification',
      category: SettingCategory.REGISTRATION,
      defaultValue: 'false',
      isSensitive: false,
      description: 'Enforce SMS OTP verification during onboarding',
    },
    default_user_status: {
      key: 'default_user_status',
      category: SettingCategory.REGISTRATION,
      defaultValue: 'ACTIVE',
      isSensitive: false,
      description: 'Initial account status for newly registered customers (ACTIVE or PENDING_REVIEW)',
    },
    allow_referral_rewards: {
      key: 'allow_referral_rewards',
      category: SettingCategory.REGISTRATION,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Credit affiliate bonus upon referee verified deposit',
    },
    referral_bonus_amount: {
      key: 'referral_bonus_amount',
      category: SettingCategory.REGISTRATION,
      defaultValue: '25.0000',
      isSensitive: false,
      description: 'Flat bonus credited for successful customer referrals',
    },

    // 13. KYC Requirements
    kyc_required_for_transfers: {
      key: 'kyc_required_for_transfers',
      category: SettingCategory.KYC,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Block outbound transfers if customer KYC is unverified',
    },
    kyc_required_for_loans: {
      key: 'kyc_required_for_loans',
      category: SettingCategory.KYC,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Require approved KYC before underwriting credit facilities',
    },
    kyc_required_for_cards: {
      key: 'kyc_required_for_cards',
      category: SettingCategory.KYC,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Require approved KYC before virtual/metal card issuance',
    },
    min_kyc_tier_for_wires: {
      key: 'min_kyc_tier_for_wires',
      category: SettingCategory.KYC,
      defaultValue: 'TIER_2',
      isSensitive: false,
      description: 'Minimum required KYC level for cross-border SWIFT wires',
    },
    kyc_auto_approve_tier1: {
      key: 'kyc_auto_approve_tier1',
      category: SettingCategory.KYC,
      defaultValue: 'false',
      isSensitive: false,
      description: 'Automatically approve Tier 1 submissions matching AML criteria',
    },

    // 14. Loan Settings
    enable_loans: {
      key: 'enable_loans',
      category: SettingCategory.LOANS,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Enable customer loan application catalog in dashboard',
    },
    min_interest_rate: {
      key: 'min_interest_rate',
      category: SettingCategory.LOANS,
      defaultValue: '4.20',
      isSensitive: false,
      description: 'Minimum allowable annual loan interest rate %',
    },
    max_interest_rate: {
      key: 'max_interest_rate',
      category: SettingCategory.LOANS,
      defaultValue: '18.50',
      isSensitive: false,
      description: 'Maximum allowable annual loan interest rate %',
    },
    max_tenure_months: {
      key: 'max_tenure_months',
      category: SettingCategory.LOANS,
      defaultValue: '60',
      isSensitive: false,
      description: 'Maximum repayment duration in months',
    },
    late_payment_penalty_pct: {
      key: 'late_payment_penalty_pct',
      category: SettingCategory.LOANS,
      defaultValue: '2.50',
      isSensitive: false,
      description: 'Late repayment delinquency surcharge penalty %',
    },

    // 15. Notification Settings
    email_notifications_enabled: {
      key: 'email_notifications_enabled',
      category: SettingCategory.NOTIFICATIONS,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Dispatch transaction receipts & alerts via email',
    },
    sms_notifications_enabled: {
      key: 'sms_notifications_enabled',
      category: SettingCategory.NOTIFICATIONS,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Dispatch urgent debit/credit alerts via SMS',
    },
    push_notifications_enabled: {
      key: 'push_notifications_enabled',
      category: SettingCategory.NOTIFICATIONS,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Send real-time mobile push notifications',
    },
    notify_admin_on_registration: {
      key: 'notify_admin_on_registration',
      category: SettingCategory.NOTIFICATIONS,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Alert executive staff when new account registers',
    },
    notify_admin_on_deposit: {
      key: 'notify_admin_on_deposit',
      category: SettingCategory.NOTIFICATIONS,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Alert treasury desk when large deposit is initiated',
    },
    notify_admin_on_kyc: {
      key: 'notify_admin_on_kyc',
      category: SettingCategory.NOTIFICATIONS,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Alert compliance officer upon new identity submission',
    },

    // 16. Payment Gateway Settings & Crypto Desks
    stripe_enabled: {
      key: 'stripe_enabled',
      category: SettingCategory.GATEWAYS,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Enable Stripe Credit/Debit card acquiring',
    },
    stripe_public_key: {
      key: 'stripe_public_key',
      category: SettingCategory.GATEWAYS,
      defaultValue: '',  // Set via STRIPE_PUBLIC_KEY env var or admin settings panel
      isSensitive: false,
      description: 'Stripe publishable client key',
    },
    stripe_secret_key: {
      key: 'stripe_secret_key',
      category: SettingCategory.GATEWAYS,
      defaultValue: '',  // Set via STRIPE_SECRET_KEY env var or admin settings panel
      isSensitive: true,
      description: 'Stripe secret merchant API key',
    },
    paystack_enabled: {
      key: 'paystack_enabled',
      category: SettingCategory.GATEWAYS,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Enable Paystack gateway for African payments',
    },
    paystack_public_key: {
      key: 'paystack_public_key',
      category: SettingCategory.GATEWAYS,
      defaultValue: '',  // Set via PAYSTACK_PUBLIC_KEY env var or admin settings panel
      isSensitive: false,
      description: 'Paystack client public key',
    },
    paystack_secret_key: {
      key: 'paystack_secret_key',
      category: SettingCategory.GATEWAYS,
      defaultValue: '',  // Set via PAYSTACK_SECRET_KEY env var or admin settings panel
      isSensitive: true,
      description: 'Paystack merchant secret API key',
    },
    flutterwave_enabled: {
      key: 'flutterwave_enabled',
      category: SettingCategory.GATEWAYS,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Enable Flutterwave multi-currency checkout',
    },
    flutterwave_public_key: {
      key: 'flutterwave_public_key',
      category: SettingCategory.GATEWAYS,
      defaultValue: '',  // Set via FLUTTERWAVE_PUBLIC_KEY env var or admin settings panel
      isSensitive: false,
      description: 'Flutterwave public key',
    },
    flutterwave_secret_key: {
      key: 'flutterwave_secret_key',
      category: SettingCategory.GATEWAYS,
      defaultValue: '',  // Set via FLUTTERWAVE_SECRET_KEY env var or admin settings panel
      isSensitive: true,
      description: 'Flutterwave secret key',
    },
    crypto_btc_address: {
      key: 'crypto_btc_address',
      category: SettingCategory.GATEWAYS,
      defaultValue: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      isSensitive: false,
      description: 'Institutional Bitcoin Treasury Custody Address',
    },
    crypto_usdt_trc20: {
      key: 'crypto_usdt_trc20',
      category: SettingCategory.GATEWAYS,
      defaultValue: 'TYDzsYUEpvnYmQk4zGP9sWWcTEd36dAtW7',
      isSensitive: false,
      description: 'Institutional USDT TRC-20 Clearing Address',
    },
    crypto_eth_address: {
      key: 'crypto_eth_address',
      category: SettingCategory.GATEWAYS,
      defaultValue: '0x71C8705a2B8e6267150C3667cE177A144eB29',
      isSensitive: false,
      description: 'Institutional Ethereum / ERC-20 Vault Address',
    },

    // 17. SMTP Settings
    smtp_host: {
      key: 'smtp_host',
      category: SettingCategory.SMTP,
      defaultValue: 'smtp.mailgun.org',
      isSensitive: false,
      description: 'Outbound SMTP mail server hostname',
    },
    smtp_port: {
      key: 'smtp_port',
      category: SettingCategory.SMTP,
      defaultValue: '587',
      isSensitive: false,
      description: 'SMTP port (587 TLS or 465 SSL)',
    },
    smtp_username: {
      key: 'smtp_username',
      category: SettingCategory.SMTP,
      defaultValue: 'postmaster@mail.silverhawkbank.com',
      isSensitive: false,
      description: 'SMTP authentication username',
    },
    smtp_password: {
      key: 'smtp_password',
      category: SettingCategory.SMTP,
      defaultValue: 'RmvMailgunPass2026!Sec',
      isSensitive: true,
      description: 'SMTP authentication password',
    },
    smtp_from_name: {
      key: 'smtp_from_name',
      category: SettingCategory.SMTP,
      defaultValue: 'Silverhawk Digital Federal Trust',
      isSensitive: false,
      description: 'Display sender name on outbound transactional emails',
    },
    smtp_from_email: {
      key: 'smtp_from_email',
      category: SettingCategory.SMTP,
      defaultValue: 'no-reply@silverhawkbank.com',
      isSensitive: false,
      description: 'Sender email address on outbound transactional emails',
    },
    smtp_secure: {
      key: 'smtp_secure',
      category: SettingCategory.SMTP,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Enforce STARTTLS encryption on SMTP connection',
    },

    // 18. SMS Settings
    sms_provider: {
      key: 'sms_provider',
      category: SettingCategory.SMS,
      defaultValue: 'TWILIO',
      isSensitive: false,
      description: 'SMS Gateway Provider (TWILIO, AFRICAS_TALKING, or TERMII)',
    },
    sms_api_key: {
      key: 'sms_api_key',
      category: SettingCategory.SMS,
      defaultValue: 'sms_live_api_key_rmvl_990182',
      isSensitive: true,
      description: 'SMS Gateway API Authorization Key',
    },
    sms_sender_id: {
      key: 'sms_sender_id',
      category: SettingCategory.SMS,
      defaultValue: 'SILVERHAWK',
      isSensitive: false,
      description: 'Alphanumeric Sender ID displayed on customer phones',
    },
    twilio_account_sid: {
      key: 'twilio_account_sid',
      category: SettingCategory.SMS,
      defaultValue: '',  // Set via TWILIO_ACCOUNT_SID env var or admin settings panel
      isSensitive: false,
      description: 'Twilio Account SID',
    },
    twilio_auth_token: {
      key: 'twilio_auth_token',
      category: SettingCategory.SMS,
      defaultValue: 'auth_tok_twilio_rmvl_secret_2026',
      isSensitive: true,
      description: 'Twilio Auth Token',
    },
    twilio_from_number: {
      key: 'twilio_from_number',
      category: SettingCategory.SMS,
      defaultValue: '+18008924190',
      isSensitive: false,
      description: 'Twilio sender phone number or shortcode',
    },

    // 19. Security Settings
    enforce_2fa_for_admins: {
      key: 'enforce_2fa_for_admins',
      category: SettingCategory.SECURITY,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Enforce hardware passkey or TOTP 2FA for all administrative logins',
    },
    enforce_2fa_for_high_value_transfers: {
      key: 'enforce_2fa_for_high_value_transfers',
      category: SettingCategory.SECURITY,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Require step-up 2FA on transfers exceeding $10,000',
    },
    session_timeout_minutes: {
      key: 'session_timeout_minutes',
      category: SettingCategory.SECURITY,
      defaultValue: '30',
      isSensitive: false,
      description: 'Inactivity session timeout period in minutes',
    },
    max_login_attempts: {
      key: 'max_login_attempts',
      category: SettingCategory.SECURITY,
      defaultValue: '5',
      isSensitive: false,
      description: 'Maximum consecutive failed login attempts before temporary account lockout',
    },
    lockout_duration_minutes: {
      key: 'lockout_duration_minutes',
      category: SettingCategory.SECURITY,
      defaultValue: '15',
      isSensitive: false,
      description: 'Account security lockout cooldown period in minutes',
    },
    password_min_length: {
      key: 'password_min_length',
      category: SettingCategory.SECURITY,
      defaultValue: '8',
      isSensitive: false,
      description: 'Minimum required password character length',
    },
    password_require_symbols: {
      key: 'password_require_symbols',
      category: SettingCategory.SECURITY,
      defaultValue: 'true',
      isSensitive: false,
      description: 'Require special symbols and numbers in passwords',
    },
  };

  /**
   * Filter sensitive credentials from public settings payload
   */
  public static filterPublicSettings(
    allSettings: Record<string, any>,
  ): Record<string, any> {
    const publicSettings: Record<string, any> = {};

    for (const [key, def] of Object.entries(this.DEFINITIONS)) {
      if (!def.isSensitive) {
        publicSettings[key] =
          allSettings[key] !== undefined ? allSettings[key] : def.defaultValue;
      }
    }

    // Include dynamic feature flags if present
    for (const [k, v] of Object.entries(allSettings)) {
      if (k.startsWith('feature_') || k.startsWith('header_')) {
        publicSettings[k] = v;
      }
    }

    return publicSettings;
  }

  /**
   * Group flat settings list into category-organized dictionary for Admin UI
   */
  public static groupSettings(
    allSettings: Record<string, any>,
  ): Record<SettingCategory, Array<{ key: string; value: any; description: string; isSensitive: boolean }>> {
    const grouped: Record<string, any[]> = {};

    for (const cat of Object.values(SettingCategory)) {
      grouped[cat] = [];
    }

    for (const [key, def] of Object.entries(this.DEFINITIONS)) {
      const val = allSettings[key] !== undefined ? allSettings[key] : def.defaultValue;
      if (!grouped[def.category]) grouped[def.category] = [];
      grouped[def.category].push({
        key,
        value: val,
        description: def.description,
        isSensitive: def.isSensitive,
      });
    }

    return grouped as any;
  }

  /**
   * Calculate dynamic transfer fee based on live CMS settings
   */
  public static calculateTransferFee(
    amount: number | string | Decimal,
    isInternal: boolean,
    settings: Record<string, any>,
  ): { flatFee: Decimal; pctFee: Decimal; totalFee: Decimal; netAmount: Decimal } {
    const decAmount = new Decimal(amount.toString());

    const flatKey = isInternal ? 'transfer_fee_internal_flat' : 'transfer_fee_external_flat';
    const pctKey = isInternal ? 'transfer_fee_internal_pct' : 'transfer_fee_external_pct';

    const flatVal = settings[flatKey] !== undefined ? settings[flatKey] : this.DEFINITIONS[flatKey]?.defaultValue || '0';
    const pctVal = settings[pctKey] !== undefined ? settings[pctKey] : this.DEFINITIONS[pctKey]?.defaultValue || '0';

    const flatFee = new Decimal(flatVal.toString());
    const pctFee = decAmount.times(new Decimal(pctVal.toString())).dividedBy(100);
    const totalFee = flatFee.plus(pctFee);
    const netAmount = Decimal.max(new Decimal(0), decAmount.minus(totalFee));

    return {
      flatFee,
      pctFee,
      totalFee,
      netAmount,
    };
  }

  /**
   * Validate transaction against dynamic CMS limits
   */
  public static validateTransferLimits(
    amount: number | string | Decimal,
    dailySpent: number | string | Decimal,
    settings: Record<string, any>,
  ): { isValid: boolean; reason?: string } {
    const decAmount = new Decimal(amount.toString());
    const decDailySpent = new Decimal(dailySpent.toString());

    const singleLimit = new Decimal(
      settings['single_transfer_limit'] || this.DEFINITIONS['single_transfer_limit'].defaultValue,
    );
    const dailyLimit = new Decimal(
      settings['daily_transfer_limit_default'] || this.DEFINITIONS['daily_transfer_limit_default'].defaultValue,
    );

    if (decAmount.greaterThan(singleLimit)) {
      return {
        isValid: false,
        reason: `Transaction amount exceeds single transfer ceiling of $${singleLimit.toFixed(2)}`,
      };
    }

    if (decDailySpent.plus(decAmount).greaterThan(dailyLimit)) {
      return {
        isValid: false,
        reason: `Transaction would exceed daily transfer limit of $${dailyLimit.toFixed(2)} (Spent today: $${decDailySpent.toFixed(2)})`,
      };
    }

    return { isValid: true };
  }

  /**
   * Check if maintenance mode is active for client IP
   */
  public static isMaintenanceActive(
    clientIp: string | undefined,
    settings: Record<string, any>,
  ): boolean {
    const isMaintenance =
      settings['maintenance_mode'] === 'true' ||
      settings['maintenance_mode'] === true;

    if (!isMaintenance) return false;

    if (!clientIp) return true;

    const bypassIps = (
      settings['maintenance_bypass_ips'] ||
      this.DEFINITIONS['maintenance_bypass_ips'].defaultValue
    )
      .split(',')
      .map((ip: string) => ip.trim());

    return !bypassIps.includes(clientIp);
  }

  /**
   * Replace template variables with dynamic platform settings
   */
  public static replaceTemplateTokens(
    template: string,
    settings: Record<string, any>,
  ): string {
    if (!template) return '';

    let rendered = template;
    for (const [key, def] of Object.entries(this.DEFINITIONS)) {
      const val = settings[key] !== undefined ? settings[key] : def.defaultValue;
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      rendered = rendered.replace(regex, val.toString());
    }

    return rendered;
  }
}

