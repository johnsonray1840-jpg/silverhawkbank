import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SmsPayload {
  to: string;
  message: string;
  senderId?: string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private twilioSid?: string;
  private twilioToken?: string;
  private twilioFromNumber?: string;

  constructor(private configService: ConfigService) {
    this.twilioSid = this.configService.get<string>('TWILIO_ACCOUNT_SID') || process.env.TWILIO_ACCOUNT_SID;
    this.twilioToken = this.configService.get<string>('TWILIO_AUTH_TOKEN') || process.env.TWILIO_AUTH_TOKEN;
    this.twilioFromNumber = this.configService.get<string>('TWILIO_PHONE_NUMBER') || process.env.TWILIO_PHONE_NUMBER || '+18005550199';

    if (this.twilioSid && this.twilioToken) {
      this.logger.log('📱 Twilio SMS Gateway configured and active');
    } else {
      this.logger.log('📱 SMS Gateway in simulated test mode');
    }
  }

  /**
   * Format phone number to E.164 standard
   */
  private formatPhoneNumber(phone: string): string {
    const cleaned = phone.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) {
      return cleaned;
    }
    // Default to +1 if 10-digit US number without country code
    if (cleaned.length === 10) {
      return `+1${cleaned}`;
    }
    return `+${cleaned}`;
  }

  /**
   * Send transactional SMS
   */
  async sendSms(payload: SmsPayload): Promise<{ success: boolean; messageId?: string; status: string }> {
    const normalizedPhone = this.formatPhoneNumber(payload.to);

    // If Twilio credentials available, call Twilio REST API
    if (this.twilioSid && this.twilioToken && !this.twilioSid.includes('placeholder')) {
      try {
        const authHeader = 'Basic ' + Buffer.from(`${this.twilioSid}:${this.twilioToken}`).toString('base64');
        const params = new URLSearchParams();
        params.append('To', normalizedPhone);
        params.append('From', this.twilioFromNumber!);
        params.append('Body', payload.message);

        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${this.twilioSid}/Messages.json`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: authHeader,
            },
            body: params.toString(),
          },
        );

        if (response.ok) {
          const resJson: any = await response.json();
          this.logger.log(`📱 [Twilio SMS] Delivered to [${normalizedPhone}] | MessageSid: ${resJson.sid}`);
          return { success: true, messageId: resJson.sid, status: 'DELIVERED_TWILIO' };
        } else {
          const errText = await response.text();
          this.logger.warn(`⚠️ [Twilio SMS Error]: ${errText}. Falling back to simulation mode...`);
        }
      } catch (err: any) {
        this.logger.warn(`⚠️ [Twilio SMS Exception]: ${err.message}. Falling back to simulation mode...`);
      }
    }

    // Simulation / Sandbox Logger
    this.logger.log(`📱 [SMS DISPATCH] To: ${normalizedPhone} | Content: "${payload.message}"`);
    return {
      success: true,
      messageId: `sim_sms_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      status: 'DELIVERED_SIMULATED',
    };
  }

  /**
   * Send Security / Login Alert SMS
   */
  async sendSecurityAlertSms(phone: string, eventName: string, ipAddress?: string) {
    const text = `Silverhawk Alert: ${eventName} detected on your account at ${new Date().toLocaleTimeString()} UTC${ipAddress ? ` from IP ${ipAddress}` : ''}. If this wasn't you, lock your account immediately.`;
    return this.sendSms({ to: phone, message: text });
  }

  /**
   * Send Debit Alert SMS
   */
  async sendDebitAlertSms(phone: string, amount: string, currency: string, recipient: string, availableBalance: string) {
    const text = `Silverhawk Debit: ${currency} ${amount} sent to ${recipient}. Avail Bal: ${currency} ${availableBalance}. Ref: ${Date.now().toString().slice(-6)}`;
    return this.sendSms({ to: phone, message: text });
  }

  /**
   * Send Credit Alert SMS
   */
  async sendCreditAlertSms(phone: string, amount: string, currency: string, sender: string, availableBalance: string) {
    const text = `Silverhawk Credit: ${currency} ${amount} received from ${sender}. Avail Bal: ${currency} ${availableBalance}.`;
    return this.sendSms({ to: phone, message: text });
  }

  /**
   * Send Loan Update SMS
   */
  async sendLoanAlertSms(phone: string, status: string, amount: string, currency: string) {
    const text = `Silverhawk Loans: Your loan application of ${currency} ${amount} has been ${status}. Check your dashboard for details.`;
    return this.sendSms({ to: phone, message: text });
  }

  /**
   * Send KYC Status SMS
   */
  async sendKycAlertSms(phone: string, status: string) {
    const text = `Silverhawk Compliance: Your KYC identity verification has been updated to ${status}.`;
    return this.sendSms({ to: phone, message: text });
  }
}

