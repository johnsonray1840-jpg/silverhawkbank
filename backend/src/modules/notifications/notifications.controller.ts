import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { EmailService } from '../email/email.service';

class BroadcastNotificationDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  linkUrl?: string;
}

@Controller('notifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Preview simulated transactional email template
   */
  @Get('email-templates/preview')
  async previewEmailTemplate(
    @CurrentUser('id') userId: string,
    @Query('type') type: string = 'CONFIRMATION',
    @Query('amount') amount: string = '5000.00',
    @Query('currency') currency: string = 'USD',
    @Query('fee') fee: string = '15.00',
    @Query('recipient') recipient: string = 'Apex Global Clearing LLC',
    @Query('bank') bank: string = 'JPMorgan Chase Bank, N.A.',
    @Query('account') account: string = 'US89CHAS1234567890',
    @Query('reference') reference: string = 'TRF-DEMO-882201',
    @Query('reason') reason?: string,
  ) {
    const rendered = this.emailService.getRenderedTransferEmail(type.toUpperCase(), {
      senderName: 'Account Holder',
      recipientName: recipient,
      counterpartyName: recipient,
      counterpartyBank: bank,
      counterpartyAccount: account,
      amount,
      fee,
      currency,
      netAmount: (parseFloat(amount) - parseFloat(fee)).toFixed(2),
      reference,
      reason: reason || (type.toUpperCase() === 'REQUIRES_REVIEW' ? 'Flagged for source of funds and OFAC screening' : undefined),
      timestamp: new Date().toISOString(),
    });

    return {
      type: type.toUpperCase(),
      subject: rendered.subject,
      html: rendered.html,
    };
  }

  /**
   * Get unread notification badge count
   */
  @Get('unread-count')
  async getUnreadCount(@CurrentUser('id') userId: string) {
    return this.notificationsService.getUnreadCount(userId);
  }

  /**
   * Get user notifications
   */
  @Get()
  async getUserNotifications(
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('type') type?: string,
  ) {
    return this.notificationsService.getUserNotifications(userId, {
      limit,
      offset,
      unreadOnly: unreadOnly === 'true',
      type,
    });
  }


  /**
   * Mark all notifications as read
   */
  @Patch('read-all')
  async markAllAsRead(@CurrentUser('id') userId: string) {
    return this.notificationsService.markAllAsRead(userId);
  }

  /**
   * Mark single notification as read
   */
  @Patch(':id/read')
  async markAsRead(
    @CurrentUser('id') userId: string,
    @Param('id') notificationId: string,
  ) {
    return this.notificationsService.markAsRead(userId, notificationId);
  }

  /**
   * Delete single notification
   */
  @Delete(':id')
  async deleteNotification(
    @CurrentUser('id') userId: string,
    @Param('id') notificationId: string,
  ) {
    return this.notificationsService.deleteNotification(userId, notificationId);
  }

  /**
   * Admin broadcast notification
   */
  @Post('admin/broadcast')
  @RequirePermissions('notifications.broadcast')
  async broadcastNotification(@Body() dto: BroadcastNotificationDto) {
    return this.notificationsService.broadcastNotification(
      dto.title,
      dto.message,
      dto.type,
      dto.linkUrl,
    );
  }
}
