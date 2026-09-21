import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateWebhookSubscriptionDto,
  WebhookEventTopic,
  WebhookSubscriptionStatus,
} from './dto/webhook-subscription.dto';
import * as crypto from 'crypto';

export interface WebhookSubscriptionRecord {
  id: string;
  userId: string;
  url: string;
  secret: string;
  description?: string;
  topics: WebhookEventTopic[];
  status: WebhookSubscriptionStatus;
  failureCount: number;
  lastDispatchedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDeliveryLog {
  id: string;
  subscriptionId: string;
  userId: string;
  topic: WebhookEventTopic;
  payload: any;
  statusCode?: number;
  responseBody?: string;
  attempts: number;
  status: 'DELIVERED' | 'FAILED' | 'PENDING';
  nextRetryAt?: Date;
  createdAt: Date;
}

@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);
  private static subscriptionsStore: Map<string, WebhookSubscriptionRecord> = new Map();
  private static deliveryLogsStore: Map<string, WebhookDeliveryLog> = new Map();

  /**
   * Compute HMAC-SHA256 Signature Header for outbound payload
   */
  static generateSignature(payload: any, secret: string, timestamp: number = Math.floor(Date.now() / 1000)): string {
    const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const signaturePayload = `${timestamp}.${payloadString}`;
    const hmac = crypto.createHmac('sha256', secret).update(signaturePayload).digest('hex');
    return `t=${timestamp},v1=${hmac}`;
  }

  /**
   * Verify an incoming signature against secret with timestamp drift protection
   */
  static verifySignature(
    payloadString: string,
    signatureHeader: string,
    secret: string,
    toleranceSeconds: number = 300,
  ): boolean {
    try {
      const parts = signatureHeader.split(',');
      const timestampPart = parts.find((p) => p.startsWith('t='));
      const signaturePart = parts.find((p) => p.startsWith('v1='));

      if (!timestampPart || !signaturePart) return false;

      const timestamp = parseInt(timestampPart.split('=')[1], 10);
      const signature = signaturePart.split('=')[1];

      const currentTime = Math.floor(Date.now() / 1000);
      if (Math.abs(currentTime - timestamp) > toleranceSeconds) {
        return false; // Replay attack protection
      }

      const expectedHmac = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${payloadString}`)
        .digest('hex');

      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedHmac));
    } catch {
      return false;
    }
  }

  /**
   * Register a new developer webhook subscription
   */
  async createSubscription(
    userId: string,
    dto: CreateWebhookSubscriptionDto,
  ): Promise<WebhookSubscriptionRecord> {
    const subId = `WHS-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

    const subscription: WebhookSubscriptionRecord = {
      id: subId,
      userId,
      url: dto.url,
      secret,
      description: dto.description || 'Developer Webhook Endpoint',
      topics: dto.topics,
      status: WebhookSubscriptionStatus.ACTIVE,
      failureCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    WebhookDispatcherService.subscriptionsStore.set(subId, subscription);
    this.logger.log(`Webhook subscription ${subId} registered for user ${userId} -> ${dto.url}`);
    return subscription;
  }

  /**
   * List all subscriptions for a user
   */
  async getSubscriptions(userId: string): Promise<WebhookSubscriptionRecord[]> {
    return Array.from(WebhookDispatcherService.subscriptionsStore.values()).filter(
      (sub) => sub.userId === userId,
    );
  }

  /**
   * Delete subscription
   */
  async deleteSubscription(userId: string, subscriptionId: string): Promise<{ message: string }> {
    const sub = WebhookDispatcherService.subscriptionsStore.get(subscriptionId);
    if (!sub || sub.userId !== userId) {
      throw new NotFoundException(`Webhook subscription ${subscriptionId} not found`);
    }

    WebhookDispatcherService.subscriptionsStore.delete(subscriptionId);
    this.logger.log(`Webhook subscription ${subscriptionId} deleted`);
    return { message: `Webhook subscription ${subscriptionId} deleted successfully` };
  }

  /**
   * Dispatch an event to all matching subscribers
   */
  async dispatchEvent(topic: WebhookEventTopic, payload: any, userId?: string) {
    const subscribers = Array.from(WebhookDispatcherService.subscriptionsStore.values()).filter(
      (sub) =>
        sub.status === WebhookSubscriptionStatus.ACTIVE &&
        sub.topics.includes(topic) &&
        (!userId || sub.userId === userId),
    );

    for (const sub of subscribers) {
      const logId = `WHL-${crypto.randomBytes(8).toString('hex')}`;
      const log: WebhookDeliveryLog = {
        id: logId,
        subscriptionId: sub.id,
        userId: sub.userId,
        topic,
        payload,
        attempts: 1,
        status: 'DELIVERED', // Simulated instant dispatch
        statusCode: 200,
        responseBody: '{"received": true}',
        createdAt: new Date(),
      };

      WebhookDispatcherService.deliveryLogsStore.set(logId, log);
      sub.lastDispatchedAt = new Date();
      WebhookDispatcherService.subscriptionsStore.set(sub.id, sub);

      this.logger.log(`Dispatched webhook ${topic} to ${sub.url} [Delivery: ${logId}]`);
    }
  }

  /**
   * Get delivery logs for user
   */
  async getDeliveryLogs(userId: string): Promise<WebhookDeliveryLog[]> {
    return Array.from(WebhookDispatcherService.deliveryLogsStore.values())
      .filter((log) => log.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Replay a failed or past webhook event
   */
  async replayEvent(userId: string, eventId: string): Promise<WebhookDeliveryLog> {
    const log = WebhookDispatcherService.deliveryLogsStore.get(eventId);
    if (!log || log.userId !== userId) {
      throw new NotFoundException(`Webhook event log ${eventId} not found`);
    }

    log.attempts++;
    log.status = 'DELIVERED';
    log.statusCode = 200;
    log.responseBody = '{"replayed": true, "received": true}';
    WebhookDispatcherService.deliveryLogsStore.set(eventId, log);

    this.logger.log(`Replayed webhook event ${eventId} successfully`);
    return log;
  }
}

