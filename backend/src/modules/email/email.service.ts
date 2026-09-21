import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface CreditAlertPayload {
  to: string;
  recipientName: string;
  amount: string;
  currency: string;
  senderName: string;
  accountNumber: string;
  reference: string;
  description: string;
  availableBalance: string;
}

export interface DebitAlertPayload {
  to: string;
  senderName: string;
  amount: string;
  currency: string;
  recipientName: string;
  accountNumber: string;
  reference: string;
  description: string;
  availableBalance: string;
}

export interface TransactionStatusPayload {
  to: string;
  customerName: string;
  amount: string;
  currency: string;
  status: string;
  reference: string;
  reason?: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER';
}

export interface OtpEmailPayload {
  to: string;
  recipientName: string;
  otpCode: string;
  expiresInMinutes?: number;
}

export interface TransferOtpEmailPayload {
  to: string;
  senderName: string;
  amount: string;
  currency: string;
  recipientName: string;
  accountNumber?: string;
  otpCode: string;
  expiresInMinutes?: number;
}

export interface KycEmailPayload {
  to: string;
  recipientName: string;
  status: string;
  tier?: string;
  notes?: string;
  rejectionReason?: string;
  requestedInfo?: string;
}


@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;
  private resendApiKey?: string;

  constructor(private configService: ConfigService) {
    this.resendApiKey =
      this.configService.get<string>('RESEND_API_KEY') ||
      this.configService.get<string>('RESEND_KEY') ||
      process.env.RESEND_API_KEY ||
      process.env.RESEND_KEY;

    const host = this.configService.get<string>('SMTP_HOST', 'smtp.resend.com');
    const port = Number(this.configService.get<number>('SMTP_PORT', 465));
    const user = this.configService.get<string>('SMTP_USER', 'resend');
    const pass = this.configService.get<string>('SMTP_PASS', this.resendApiKey || '');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: (user && pass) ? { user, pass } : undefined,
    });

    if (this.resendApiKey) {
      this.logger.log('🚀 Resend Email Service configured and active');
    }
  }

  private getBaseEmailTemplate(title: string, contentHtml: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <style>
          body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #1e293b; }
          .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0; }
          .header { background: linear-gradient(135deg, #0ea5e9, #0369a1); padding: 32px 20px; text-align: center; color: #ffffff; }
          .header h1 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; }
          .header p { margin: 6px 0 0; font-size: 14px; opacity: 0.95; }
          .content { padding: 32px 28px; }
          .badge-credit { display: inline-block; background: #dcfce7; color: #15803d; font-weight: 700; padding: 6px 14px; border-radius: 9999px; font-size: 13px; }
          .badge-debit { display: inline-block; background: #fee2e2; color: #b91c1c; font-weight: 700; padding: 6px 14px; border-radius: 9999px; font-size: 13px; }
          .amount-box { text-align: center; margin: 25px 0; padding: 20px; background: #f8fafc; border-radius: 12px; border: 1px dashed #cbd5e1; }
          .amount-box .amount { font-size: 32px; font-weight: 800; color: #0f172a; margin: 5px 0; }
          .otp-box { text-align: center; margin: 25px 0; padding: 24px; background: #f0f9ff; border-radius: 12px; border: 2px dashed #0ea5e9; }
          .otp-code { font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 900; letter-spacing: 8px; color: #0284c7; margin: 10px 0; }
          .details-table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }
          .details-table td { padding: 12px 8px; border-bottom: 1px solid #f1f5f9; }
          .details-table td.label { color: #64748b; font-weight: 500; width: 40%; }
          .details-table td.value { color: #0f172a; font-weight: 600; text-align: right; }
          .footer { background: #f8fafc; padding: 24px 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
          .footer a { color: #0ea5e9; text-decoration: none; }
          .btn-action { display: inline-block; background: #0ea5e9; color: #ffffff !important; padding: 12px 28px; border-radius: 10px; font-weight: 700; text-decoration: none; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Silverhawk</h1>
            <p>Swift & Secure Digital Banking</p>
          </div>
          <div class="content">
            ${contentHtml}
          </div>
          <div class="footer">
            <p>&copy; 2026 Silverhawk Bank. All rights reserved.</p>
            <p>If you did not make this request, please contact our 24/7 security center at <a href="mailto:support@silverhawkbank.com">support@silverhawkbank.com</a> immediately.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Send 6-digit Email Verification OTP on Registration
   */
  async sendVerificationOtpEmail(payload: OtpEmailPayload) {
    const expires = payload.expiresInMinutes || 15;
    const content = `
      <div style="text-align: center;">
        <span class="badge-credit" style="background: #e0f2fe; color: #0369a1;">🔐 EMAIL VERIFICATION</span>
      </div>
      <h2 style="font-size: 20px; color: #0f172a; text-align: center; margin-top: 16px;">Verify Your Email Address</h2>
      <p style="font-size: 15px; line-height: 1.6;">Hello <strong>${payload.recipientName}</strong>,</p>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        Welcome to Silverhawk Bank! To complete your registration and activate your online banking account, please enter the 6-digit verification code below:
      </p>
      
      <div class="otp-box">
        <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 700; letter-spacing: 1px;">Your 6-Digit Verification Code</div>
        <div class="otp-code">${payload.otpCode}</div>
        <div style="font-size: 12px; color: #dc2626; font-weight: 600;">Valid for ${expires} minutes</div>
      </div>

      <p style="font-size: 13px; color: #64748b; line-height: 1.6;">
        Please do not share this code with anyone. Silverhawk representatives will never ask for your verification code.
      </p>
    `;

    return this.sendMail(
      payload.to,
      `Your Silverhawk Verification Code: ${payload.otpCode}`,
      this.getBaseEmailTemplate('Verify Your Email', content),
    );
  }

  /**
   * Send 2FA Login Security OTP
   */
  async sendTwoFactorOtpEmail(payload: OtpEmailPayload) {
    const expires = payload.expiresInMinutes || 10;
    const content = `
      <div style="text-align: center;">
        <span class="badge-credit" style="background: #fef3c7; color: #b45309;">🛡️ TWO-FACTOR AUTHENTICATION</span>
      </div>
      <h2 style="font-size: 20px; color: #0f172a; text-align: center; margin-top: 16px;">Authorize Login Request</h2>
      <p style="font-size: 15px; line-height: 1.6;">Hello <strong>${payload.recipientName}</strong>,</p>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        A sign-in attempt was detected on your Silverhawk account. Use the one-time authentication code below to complete sign-in:
      </p>
      
      <div class="otp-box">
        <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 700; letter-spacing: 1px;">One-Time Security Code</div>
        <div class="otp-code">${payload.otpCode}</div>
        <div style="font-size: 12px; color: #dc2626; font-weight: 600;">Expires in ${expires} minutes</div>
      </div>

      <p style="font-size: 13px; color: #64748b; line-height: 1.6;">
        If you did not initiate this login, your credentials may be compromised. Reset your password immediately.
      </p>
    `;

    return this.sendMail(
      payload.to,
      `Silverhawk Security: ${payload.otpCode} is your 2FA login code`,
      this.getBaseEmailTemplate('2FA Login Verification', content),
    );
  }

  /**
   * Send Transfer Authorization OTP Email
   */
  async sendTransferOtpEmail(payload: TransferOtpEmailPayload) {
    const expires = payload.expiresInMinutes || 10;
    const formattedAmount = `${payload.currency} ${parseFloat(payload.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const content = `
      <div style="text-align: center;">
        <span class="badge-credit" style="background: #e0f2fe; color: #0369a1;">🔐 TRANSFER AUTHORIZATION</span>
      </div>
      <h2 style="font-size: 20px; color: #0f172a; text-align: center; margin-top: 16px;">Authorize Funds Transfer</h2>
      <p style="font-size: 15px; line-height: 1.6;">Hello <strong>${payload.senderName}</strong>,</p>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        A transfer request of <strong>${formattedAmount}</strong> to <strong>${payload.recipientName}</strong>${payload.accountNumber ? ` (Account #${payload.accountNumber})` : ''} has been initiated from your account. Use the one-time authorization code below to complete this transaction:
      </p>
      
      <div class="otp-box">
        <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 700; letter-spacing: 1px;">Transaction Authorization Code</div>
        <div class="otp-code">${payload.otpCode}</div>
        <div style="font-size: 12px; color: #dc2626; font-weight: 600;">Valid for ${expires} minutes</div>
      </div>

      <p style="font-size: 13px; color: #64748b; line-height: 1.6;">
        Never share this code with anyone. Silverhawk staff will never ask for your authorization code. If you did not initiate this transfer, freeze your account immediately.
      </p>
    `;

    return this.sendMail(
      payload.to,
      `Silverhawk Authorization: ${payload.otpCode} is your transfer code for ${formattedAmount}`,
      this.getBaseEmailTemplate('Transfer Authorization', content),
    );
  }

  /**
   * Send Password Reset Token Email
   */
  async sendPasswordResetEmail(to: string, recipientName: string, resetToken: string) {
    const content = `
      <div style="text-align: center;">
        <span class="badge-debit">🔑 PASSWORD RESET</span>
      </div>
      <h2 style="font-size: 20px; color: #0f172a; text-align: center; margin-top: 16px;">Reset Your Password</h2>
      <p style="font-size: 15px; line-height: 1.6;">Hello <strong>${recipientName}</strong>,</p>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        We received a request to reset the password for your Silverhawk account. Use the security token below on the password reset page:
      </p>
      
      <div class="amount-box" style="background: #f8fafc; word-break: break-all;">
        <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 700;">Security Reset Token</div>
        <div style="font-family: monospace; font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 8px;">${resetToken}</div>
      </div>

      <p style="font-size: 13px; color: #64748b; line-height: 1.6;">
        This token is valid for 60 minutes. If you did not request this, you can safely ignore this email.
      </p>
    `;

    return this.sendMail(
      to,
      `Silverhawk: Password Reset Request`,
      this.getBaseEmailTemplate('Password Reset', content),
    );
  }

  /**
   * Send Credit Alert Email when money is received
   */
  async sendCreditAlert(payload: CreditAlertPayload) {
    const formattedAmount = `${payload.currency} ${parseFloat(payload.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const formattedBalance = `${payload.currency} ${parseFloat(payload.availableBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const content = `
      <div style="text-align: center;">
        <span class="badge-credit">✓ CREDIT TRANSACTION</span>
      </div>
      <div class="amount-box">
        <div style="font-size: 13px; color: #64748b; text-transform: uppercase; font-weight: 600;">Amount Credited</div>
        <div class="amount" style="color: #16a34a;">+${formattedAmount}</div>
      </div>
      <p style="font-size: 15px; line-height: 1.6;">Dear <strong>${payload.recipientName}</strong>,</p>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        We wish to inform you that your Silverhawk account has been credited with the sum of <strong>${formattedAmount}</strong>.
      </p>
      <table class="details-table">
        <tr>
          <td class="label">Account Number</td>
          <td class="value">${payload.accountNumber}</td>
        </tr>
        <tr>
          <td class="label">Sender</td>
          <td class="value">${payload.senderName}</td>
        </tr>
        <tr>
          <td class="label">Description</td>
          <td class="value">${payload.description || 'Deposit / Transfer Received'}</td>
        </tr>
        <tr>
          <td class="label">Transaction Reference</td>
          <td class="value" style="font-family: monospace; font-size: 12px;">${payload.reference}</td>
        </tr>
        <tr>
          <td class="label">Date & Time</td>
          <td class="value">${new Date().toUTCString()}</td>
        </tr>
        <tr style="background-color: #f0fdf4;">
          <td class="label" style="color: #166534; font-weight: 700;">Available Balance</td>
          <td class="value" style="color: #166534; font-weight: 800;">${formattedBalance}</td>
        </tr>
      </table>
    `;

    return this.sendMail(
      payload.to,
      `Credit Alert: +${formattedAmount} received on Silverhawk`,
      this.getBaseEmailTemplate('Credit Alert', content),
    );
  }

  /**
   * Send Debit Alert Email when money is sent
   */
  async sendDebitAlert(payload: DebitAlertPayload) {
    const formattedAmount = `${payload.currency} ${parseFloat(payload.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const formattedBalance = `${payload.currency} ${parseFloat(payload.availableBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const content = `
      <div style="text-align: center;">
        <span class="badge-debit">⚠ DEBIT TRANSACTION</span>
      </div>
      <div class="amount-box">
        <div style="font-size: 13px; color: #64748b; text-transform: uppercase; font-weight: 600;">Amount Debited</div>
        <div class="amount" style="color: #dc2626;">-${formattedAmount}</div>
      </div>
      <p style="font-size: 15px; line-height: 1.6;">Dear <strong>${payload.senderName}</strong>,</p>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        We wish to inform you that a debit transaction of <strong>${formattedAmount}</strong> occurred on your account.
      </p>
      <table class="details-table">
        <tr>
          <td class="label">Account Number</td>
          <td class="value">${payload.accountNumber}</td>
        </tr>
        <tr>
          <td class="label">Recipient</td>
          <td class="value">${payload.recipientName}</td>
        </tr>
        <tr>
          <td class="label">Description</td>
          <td class="value">${payload.description || 'Transfer / Outbound Wire'}</td>
        </tr>
        <tr>
          <td class="label">Transaction Reference</td>
          <td class="value" style="font-family: monospace; font-size: 12px;">${payload.reference}</td>
        </tr>
        <tr>
          <td class="label">Date & Time</td>
          <td class="value">${new Date().toUTCString()}</td>
        </tr>
        <tr style="background-color: #fef2f2;">
          <td class="label" style="color: #991b1b; font-weight: 700;">Available Balance</td>
          <td class="value" style="color: #991b1b; font-weight: 800;">${formattedBalance}</td>
        </tr>
      </table>
    `;

    return this.sendMail(
      payload.to,
      `Debit Alert: -${formattedAmount} from Silverhawk Account`,
      this.getBaseEmailTemplate('Debit Alert', content),
    );
  }

  /**
   * Send Deposit / Withdrawal Status Notification
   */
  async sendStatusAlert(payload: TransactionStatusPayload) {
    const formattedAmount = `${payload.currency} ${parseFloat(payload.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const isSuccess = payload.status === 'SUCCESS' || payload.status === 'APPROVED' || payload.status === 'COMPLETED';

    const content = `
      <div style="text-align: center;">
        <span style="display: inline-block; background: ${isSuccess ? '#dcfce7' : '#fef3c7'}; color: ${isSuccess ? '#15803d' : '#b45309'}; font-weight: 700; padding: 6px 14px; border-radius: 9999px; font-size: 13px;">
          ${payload.type} — ${payload.status}
        </span>
      </div>
      <div class="amount-box">
        <div style="font-size: 13px; color: #64748b; text-transform: uppercase; font-weight: 600;">Transaction Amount</div>
        <div class="amount">${formattedAmount}</div>
      </div>
      <p style="font-size: 15px; line-height: 1.6;">Dear <strong>${payload.customerName}</strong>,</p>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        Your ${payload.type.toLowerCase()} request has been updated to status: <strong>${payload.status}</strong>.
        ${payload.reason ? `<br><br><strong>Note:</strong> ${payload.reason}` : ''}
      </p>
      <table class="details-table">
        <tr>
          <td class="label">Transaction Reference</td>
          <td class="value" style="font-family: monospace;">${payload.reference}</td>
        </tr>
        <tr>
          <td class="label">Date Updated</td>
          <td class="value">${new Date().toUTCString()}</td>
        </tr>
      </table>
    `;

    return this.sendMail(
      payload.to,
      `Silverhawk Update: ${payload.type} ${payload.status} (${formattedAmount})`,
      this.getBaseEmailTemplate(`${payload.type} Status`, content),
    );
  }

  /**
   * KYC Verification Status Notification Email
   */
  async sendKycStatusEmail(payload: KycEmailPayload) {
    const isApproved = payload.status === 'APPROVED';
    const isRejected = payload.status === 'REJECTED';
    const isUnderReview = payload.status === 'UNDER_REVIEW';

    let statusBadge = `<span class="badge-credit" style="background: #e0f2fe; color: #0369a1;">${payload.status}</span>`;
    let headline = 'KYC Verification Update';

    if (isApproved) {
      statusBadge = `<span class="badge-credit">APPROVED 🎉</span>`;
      headline = 'KYC Verification Approved!';
    } else if (isRejected) {
      statusBadge = `<span class="badge-debit">REJECTED</span>`;
      headline = 'KYC Verification Unsuccessful';
    } else if (isUnderReview) {
      statusBadge = `<span class="badge-credit" style="background: #fef3c7; color: #b45309;">UNDER REVIEW</span>`;
      headline = 'KYC Verification Under Review';
    }

    const content = `
      <div style="text-align: center; margin-bottom: 20px;">
        ${statusBadge}
      </div>
      <p style="font-size: 15px; color: #334155; line-height: 1.6;">
        Dear <strong>${payload.recipientName}</strong>,
      </p>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        ${isApproved
          ? `Congratulations! Your identity verification application has been approved${payload.tier ? ` at <strong>${payload.tier}</strong>` : ''}. Your account limits have been automatically upgraded.`
          : isRejected
          ? `Your identity verification application could not be approved at this time.${payload.rejectionReason ? `<br><br><strong>Reason:</strong> ${payload.rejectionReason}` : ''}`
          : `Your identity verification application is currently being reviewed by our compliance team.${payload.requestedInfo ? `<br><br><strong>Action Required:</strong> ${payload.requestedInfo}` : ''}`
        }
        ${payload.notes ? `<br><br><strong>Compliance Notes:</strong> ${payload.notes}` : ''}
      </p>
      <table class="details-table">
        <tr>
          <td class="label">Application Status</td>
          <td class="value"><strong>${payload.status}</strong></td>
        </tr>
        ${payload.tier ? `<tr><td class="label">Verified Tier</td><td class="value">${payload.tier}</td></tr>` : ''}
        <tr>
          <td class="label">Date Processed</td>
          <td class="value">${new Date().toUTCString()}</td>
        </tr>
      </table>
    `;

    return this.sendMail(
      payload.to,
      `Silverhawk Bank: ${headline}`,
      this.getBaseEmailTemplate('KYC Compliance Notice', content),
    );
  }

  /**
   * Core mail sender with direct Resend REST API support + Nodemailer SMTP fallback
   */

  private async sendMail(to: string, subject: string, html: string) {
    const from =
      this.configService.get<string>('EMAIL_FROM') ||
      this.configService.get<string>('SMTP_FROM') ||
      process.env.EMAIL_FROM ||
      process.env.SMTP_FROM ||
      'Silverhawk Bank <onboarding@resend.dev>';

    // 1. Try Resend Direct REST API if RESEND_API_KEY is available
    if (this.resendApiKey && (this.resendApiKey.startsWith('re_') || this.resendApiKey.length > 20)) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.resendApiKey}`,
          },
          body: JSON.stringify({
            from: from.includes('<') ? from : `Silverhawk Bank <${from}>`,
            to: [to],
            subject,
            html,
          }),
        });

        if (response.ok) {
          const resJson = await response.json();
          this.logger.log(`📧 [Resend API] Email delivered to [${to}] | Subject: "${subject}" | Id: ${resJson.id}`);
          return { status: 'SENT_RESEND_API', id: resJson.id, to, subject };
        } else {
          const errBody = await response.text();
          this.logger.warn(`⚠️ [Resend API Error]: ${errBody}. Falling back to SMTP...`);
        }
      } catch (apiErr: any) {
        this.logger.warn(`⚠️ [Resend API Exception]: ${apiErr.message}. Falling back to SMTP...`);
      }
    }

    // 2. Fallback to Nodemailer SMTP
    try {
      const info = await this.transporter.sendMail({
        from,
        to,
        subject,
        html,
      });
      this.logger.log(`📧 [SMTP] Email sent to [${to}] | Subject: "${subject}" | MessageId: ${info.messageId}`);
      return info;
    } catch (error: any) {
      this.logger.warn(`⚠️ [Email Fallback Simulation]: Unable to dispatch email to ${to}: ${error.message}`);
      return { status: 'SIMULATED_LOGGED', to, subject };
    }
  }
}
