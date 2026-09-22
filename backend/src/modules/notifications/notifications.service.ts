import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EmailService } from '../email/email.service';
import { SmsService } from './sms.service';

export interface MultiChannelNotificationPayload {
  userId: string;
  title: string;
  message: string;
  type: string; // SECURITY, TRANSACTION, LOAN, COMPLIANCE, CARD, SAVINGS, SYSTEM
  linkUrl?: string;
  emailSubject?: string;
  emailHtml?: string;
  smsMessage?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
  ) {}

  /**
   * Get user notifications with pagination and unread counts
   */
  async getUserNotifications(
    userId: string,
    query?: { limit?: number; offset?: number; unreadOnly?: boolean; type?: string },
  ) {
    const limit = query?.limit ? Number(query.limit) : 30;
    const offset = query?.offset ? Number(query.offset) : 0;

    const where: any = { userId };
    if (query?.unreadOnly) {
      where.isRead = false;
    }
    if (query?.type) {
      where.type = query.type;
    }

    const [notifications, totalCount, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      unreadCount,
      totalCount,
      notifications,
    };
  }

  /**
   * Get unread notification count badge
   */
  async getUnreadCount(userId: string) {
    const unreadCount = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { unreadCount };
  }

  /**
   * Mark single notification as read
   */
  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  /**
   * Mark all notifications as read for current user
   */
  async markAllAsRead(userId: string) {
    const res = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return {
      message: 'All notifications marked as read',
      markedCount: res.count,
    };
  }

  /**
   * Multi-Channel Notification Dispatcher: In-App + Email + SMS
   */
  async dispatchMultiChannelNotification(payload: MultiChannelNotificationPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      include: { profile: true },
    });

    if (!user) {
      this.logger.warn(`User ${payload.userId} not found for notification dispatch`);
      return;
    }

    // 1. In-App Notification (Database)
    const inAppNotif = await this.prisma.notification.create({
      data: {
        userId: payload.userId,
        title: payload.title,
        message: payload.message,
        type: payload.type,
        linkUrl: payload.linkUrl || null,
        isRead: false,
      },
    });

    // 2. Email Dispatch if custom subject/html provided
    if (payload.emailSubject && payload.emailHtml && user.email) {
      try {
        await this.emailService['sendMail'](user.email, payload.emailSubject, payload.emailHtml);
      } catch (err: any) {
        this.logger.warn(`Email dispatch failed for user ${payload.userId}: ${err.message}`);
      }
    }

    // 3. SMS Dispatch if phone number available
    const phoneNumber = user.phone;
    if (phoneNumber && payload.smsMessage) {
      try {
        await this.smsService.sendSms({
          to: phoneNumber,
          message: payload.smsMessage,
        });
      } catch (err: any) {
        this.logger.warn(`SMS dispatch failed for user ${payload.userId}: ${err.message}`);
      }
    }

    return inAppNotif;
  }

  /**
   * Admin broadcast notification to all active users
   */
  async broadcastNotification(title: string, message: string, type: string = 'BROADCAST', linkUrl?: string) {
    const activeUsers = await this.prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });

    const notificationsData = activeUsers.map((u) => ({
      userId: u.id,
      title,
      message,
      type,
      linkUrl: linkUrl || null,
      isRead: false,
    }));

    await this.prisma.notification.createMany({
      data: notificationsData,
    });

    return {
      message: `Broadcast delivered to ${activeUsers.length} active users`,
      recipientCount: activeUsers.length,
    };
  }

  /**
   * Delete single notification
   */
  async deleteNotification(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.notification.delete({
      where: { id: notificationId },
    });

    return { message: 'Notification deleted successfully' };
  }

  /**
   * Helper to format transfer notification payload & dispatch multi-channel
   */
  private async buildTransferEmailPayload(userId: string, tx: any, reason?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    const senderName = user?.profile ? `${user.profile.firstName} ${user.profile.lastName}`.trim() : user?.username || 'Valued Client';
    const metadata = (tx.metadata as any) || {};
    const amt = parseFloat(tx.amount?.toString() || '0');
    const currency = tx.currencyCode || 'USD';
    const beneficiary = metadata.counterpartyName || metadata.recipientName || tx.destinationAccount?.accountName || 'Beneficiary';
    const bank = metadata.counterpartyBank || metadata.bankName || 'Beneficiary Institution';
    const account = metadata.counterpartyAccount || metadata.recipientAccount || tx.destinationAccount?.accountNumber || 'N/A';
    const ref = tx.reference || 'TRF-ORDER';

    return {
      to: user?.email || 'customer@silverhawkbank.com',
      senderName,
      recipientName: beneficiary,
      amount: amt.toFixed(2),
      fee: parseFloat(tx.fee?.toString() || '0').toFixed(2),
      currency,
      netAmount: parseFloat(tx.netAmount?.toString() || amt.toString()).toFixed(2),
      reference: ref,
      accountNumber: tx.sourceAccount?.accountNumber || 'Primary Account',
      counterpartyName: beneficiary,
      counterpartyBank: bank,
      counterpartyAccount: account,
      routingNumber: metadata.routingNumber || metadata.swiftBic,
      swiftBic: metadata.swiftBic,
      rail: metadata.rail || tx.type,
      purpose: metadata.purpose || tx.description,
      reason,
      status: tx.status,
      timestamp: tx.createdAt ? new Date(tx.createdAt).toISOString() : new Date().toISOString(),
    };
  }

  /**
   * 1. Dispatch Transfer Submitted
   */
  async dispatchTransferSubmitted(userId: string, tx: any) {
    const payload = await this.buildTransferEmailPayload(userId, tx);
    const amtFormatted = `${payload.currency} ${parseFloat(payload.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    const notif = await this.prisma.notification.create({
      data: {
        userId,
        title: `Wire Order Submitted — ${payload.reference}`,
        message: `Your wire transfer of ${amtFormatted} to ${payload.counterpartyName} (${payload.counterpartyBank}) has been submitted and queued for clearing.`,
        type: 'TRANSFER_SUBMITTED',
        linkUrl: `/dashboard.html#tx-${payload.reference}`,
        isRead: false,
      },
    });

    try {
      await this.emailService.sendTransferConfirmationEmail(payload);
    } catch (e: any) {
      this.logger.warn(`Email send error on transfer submitted: ${e.message}`);
    }

    return notif;
  }

  /**
   * 2. Dispatch Transfer Processing
   */
  async dispatchTransferProcessing(userId: string, tx: any) {
    const payload = await this.buildTransferEmailPayload(userId, tx);
    const amtFormatted = `${payload.currency} ${parseFloat(payload.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    const notif = await this.prisma.notification.create({
      data: {
        userId,
        title: `Transfer Clearing in Progress — ${payload.reference}`,
        message: `Clearing and automated AML screening in progress for wire transfer of ${amtFormatted} to ${payload.counterpartyName}.`,
        type: 'TRANSFER_PROCESSING',
        linkUrl: `/dashboard.html#tx-${payload.reference}`,
        isRead: false,
      },
    });

    try {
      await this.emailService.sendTransferProcessingEmail(payload);
    } catch (e: any) {
      this.logger.warn(`Email send error on transfer processing: ${e.message}`);
    }

    return notif;
  }

  /**
   * 3. Dispatch Transfer Requires Review
   */
  async dispatchTransferRequiresReview(userId: string, tx: any, reason?: string) {
    const payload = await this.buildTransferEmailPayload(userId, tx, reason);
    const amtFormatted = `${payload.currency} ${parseFloat(payload.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    const notif = await this.prisma.notification.create({
      data: {
        userId,
        title: `Action Required: Wire Under Review — ${payload.reference}`,
        message: `Your transfer of ${amtFormatted} to ${payload.counterpartyName} has been flagged for institutional compliance review${reason ? `: ${reason}` : ''}. No action required.`,
        type: 'TRANSFER_REQUIRES_REVIEW',
        linkUrl: `/dashboard.html#tx-${payload.reference}`,
        isRead: false,
      },
    });

    try {
      await this.emailService.sendTransferReviewEmail(payload);
    } catch (e: any) {
      this.logger.warn(`Email send error on transfer review: ${e.message}`);
    }

    return notif;
  }

  /**
   * 4. Dispatch Transfer Completed
   */
  async dispatchTransferCompleted(userId: string, tx: any) {
    const payload = await this.buildTransferEmailPayload(userId, tx);
    const amtFormatted = `${payload.currency} ${parseFloat(payload.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    const notif = await this.prisma.notification.create({
      data: {
        userId,
        title: `Wire Transfer Settled & Delivered — ${payload.reference}`,
        message: `Transfer of ${amtFormatted} to ${payload.counterpartyName} (${payload.counterpartyBank}) has been finalized and settled successfully.`,
        type: 'TRANSFER_COMPLETED',
        linkUrl: `/dashboard.html#tx-${payload.reference}`,
        isRead: false,
      },
    });

    try {
      await this.emailService.sendTransferCompletedEmail(payload);
    } catch (e: any) {
      this.logger.warn(`Email send error on transfer completed: ${e.message}`);
    }

    return notif;
  }

  /**
   * 5. Dispatch Transfer Failed
   */
  async dispatchTransferFailed(userId: string, tx: any, reason?: string) {
    const payload = await this.buildTransferEmailPayload(userId, tx, reason);
    const amtFormatted = `${payload.currency} ${parseFloat(payload.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    const notif = await this.prisma.notification.create({
      data: {
        userId,
        title: `Transfer Failed / Declined — ${payload.reference}`,
        message: `Wire transfer of ${amtFormatted} to ${payload.counterpartyName} could not be processed${reason ? `: ${reason}` : ''}. Deducted funds have been refunded.`,
        type: 'TRANSFER_FAILED',
        linkUrl: `/dashboard.html#tx-${payload.reference}`,
        isRead: false,
      },
    });

    try {
      await this.emailService.sendTransferFailedEmail(payload);
    } catch (e: any) {
      this.logger.warn(`Email send error on transfer failed: ${e.message}`);
    }

    return notif;
  }

  /**
   * 6. Dispatch Transfer Cancelled
   */
  async dispatchTransferCancelled(userId: string, tx: any, reason?: string) {
    const payload = await this.buildTransferEmailPayload(userId, tx, reason);
    const amtFormatted = `${payload.currency} ${parseFloat(payload.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    const notif = await this.prisma.notification.create({
      data: {
        userId,
        title: `Transfer Order Cancelled — ${payload.reference}`,
        message: `Transfer of ${amtFormatted} to ${payload.counterpartyName} has been cancelled${reason ? `: ${reason}` : ''}.`,
        type: 'TRANSFER_CANCELLED',
        linkUrl: `/dashboard.html#tx-${payload.reference}`,
        isRead: false,
      },
    });

    try {
      await this.emailService.sendTransferCancelledEmail(payload);
    } catch (e: any) {
      this.logger.warn(`Email send error on transfer cancelled: ${e.message}`);
    }

    return notif;
  }
}
