import * as crypto from 'crypto';

export interface WebhookRetrySchedule {
  attempt: number;
  maxAttempts: number;
  shouldRetry: boolean;
  isDeadLetter: boolean;
  nextRetryDelaySeconds?: number;
  status: 'RETRY_SCHEDULED' | 'DEAD_LETTER_QUEUE' | 'DELIVERY_SUCCESS';
}

export interface DeadLetterRecord {
  dlqId: string;
  subscriptionId: string;
  topic: string;
  endpointUrl: string;
  payload: any;
  totalAttempts: number;
  lastStatusCode: number;
  lastErrorMessage: string;
  queuedAt: string;
  canReplay: boolean;
}

export class WebhookGatewayUtil {
  public static readonly BACKOFF_INTERVALS_SECONDS = [10, 60, 300, 1800, 7200]; // 10s, 1m, 5m, 30m, 2h
  public static readonly MAX_RETRY_ATTEMPTS = 5;

  /**
   * Calculates exponential backoff retry window or flags for DLQ
   */
  public static evaluateRetryPolicy(
    currentAttempt: number,
    httpStatusCode?: number,
    maxAttempts: number = this.MAX_RETRY_ATTEMPTS,
  ): WebhookRetrySchedule {
    // HTTP 2xx or 3xx treated as success
    if (httpStatusCode && httpStatusCode >= 200 && httpStatusCode < 400) {
      return {
        attempt: currentAttempt,
        maxAttempts,
        shouldRetry: false,
        isDeadLetter: false,
        status: 'DELIVERY_SUCCESS',
      };
    }

    if (currentAttempt >= maxAttempts) {
      return {
        attempt: currentAttempt,
        maxAttempts,
        shouldRetry: false,
        isDeadLetter: true,
        status: 'DEAD_LETTER_QUEUE',
      };
    }

    const delayIndex = Math.min(currentAttempt - 1, this.BACKOFF_INTERVALS_SECONDS.length - 1);
    const delaySeconds = this.BACKOFF_INTERVALS_SECONDS[Math.max(0, delayIndex)];

    return {
      attempt: currentAttempt,
      maxAttempts,
      shouldRetry: true,
      isDeadLetter: false,
      nextRetryDelaySeconds: delaySeconds,
      status: 'RETRY_SCHEDULED',
    };
  }

  /**
   * Generates a Dead-Letter Queue (DLQ) item when retries are exhausted
   */
  public static createDeadLetterItem(
    subscriptionId: string,
    topic: string,
    endpointUrl: string,
    payload: any,
    attempts: number,
    statusCode: number,
    errorMessage: string,
  ): DeadLetterRecord {
    const dlqId = `DLQ-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    return {
      dlqId,
      subscriptionId,
      topic,
      endpointUrl,
      payload,
      totalAttempts: attempts,
      lastStatusCode: statusCode,
      lastErrorMessage: errorMessage,
      queuedAt: new Date().toISOString(),
      canReplay: true,
    };
  }

  /**
   * Multi-Provider Inbound Signature Verifiers
   */

  // 1. Stripe-compatible HMAC-SHA256 (t=timestamp,v1=signature)
  public static verifyStripeHmac(
    rawBody: string,
    signatureHeader: string,
    secret: string,
    toleranceSeconds: number = 300,
  ): boolean {
    try {
      const parts = signatureHeader.split(',');
      const timestampPart = parts.find((p) => p.startsWith('t='));
      const sigPart = parts.find((p) => p.startsWith('v1='));

      if (!timestampPart || !sigPart) return false;

      const timestamp = parseInt(timestampPart.split('=')[1], 10);
      const signature = sigPart.split('=')[1];

      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > toleranceSeconds) {
        return false; // Anti-replay
      }

      const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${rawBody}`, 'utf8')
        .digest('hex');

      return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSig, 'hex'));
    } catch {
      return false;
    }
  }

  // 2. Paystack-compatible HMAC-SHA512
  public static verifyPaystackHmac(
    rawBody: string,
    signatureHeader: string,
    secret: string,
  ): boolean {
    try {
      if (!signatureHeader || !secret) return false;
      const expectedHmac = crypto
        .createHmac('sha512', secret)
        .update(rawBody, 'utf8')
        .digest('hex');

      return crypto.timingSafeEqual(Buffer.from(signatureHeader, 'hex'), Buffer.from(expectedHmac, 'hex'));
    } catch {
      return false;
    }
  }

  // 3. Flutterwave-compatible Secret Hash Header Verification
  public static verifyFlutterwaveSecretHash(
    signatureHeader: string,
    expectedSecretHash: string,
  ): boolean {
    if (!signatureHeader || !expectedSecretHash) return false;
    return signatureHeader === expectedSecretHash;
  }
}

