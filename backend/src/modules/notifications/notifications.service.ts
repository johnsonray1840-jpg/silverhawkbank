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
}
