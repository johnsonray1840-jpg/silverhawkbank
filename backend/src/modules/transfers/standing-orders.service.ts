import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateStandingOrderDto,
  StandingOrderFrequency,
  StandingOrderStatus,
  UpdateStandingOrderDto,
} from './dto/standing-orders.dto';
import { CryptoUtil } from '../../common/utils/crypto.util';
import Decimal from 'decimal.js';

export interface StandingOrderRecord {
  id: string;
  userId: string;
  sourceAccountId: string;
  destinationAccountNumber: string;
  destinationAccountName: string;
  destinationBankCode?: string;
  amount: string;
  currency: string;
  frequency: StandingOrderFrequency;
  status: StandingOrderStatus;
  startDate: Date;
  endDate?: Date;
  nextRunDate: Date;
  lastRunDate?: Date;
  executionCount: number;
  maxOccurrences?: number;
  narration?: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class StandingOrdersService {
  private readonly logger = new Logger(StandingOrdersService.name);
  // In-memory persistent registry (can also sync with DB / SystemSetting)
  private static ordersStore: Map<string, StandingOrderRecord> = new Map();

  constructor(private prisma: PrismaService) {}

  /**
   * Calculate next run date from a reference date based on frequency
   */
  static calculateNextRunDate(startDate: Date, frequency: StandingOrderFrequency): Date {
    const next = new Date(startDate);
    switch (frequency) {
      case StandingOrderFrequency.DAILY:
        next.setDate(next.getDate() + 1);
        break;
      case StandingOrderFrequency.WEEKLY:
        next.setDate(next.getDate() + 7);
        break;
      case StandingOrderFrequency.BIWEEKLY:
        next.setDate(next.getDate() + 14);
        break;
      case StandingOrderFrequency.MONTHLY:
        next.setMonth(next.getMonth() + 1);
        break;
      default:
        next.setDate(next.getDate() + 1);
    }
    return next;
  }

  /**
   * Create new recurring standing order
   */
  async createStandingOrder(userId: string, dto: CreateStandingOrderDto): Promise<StandingOrderRecord> {
    const amount = new Decimal(dto.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    // Verify source account belongs to user
    const sourceAccount = await this.prisma.bankAccount.findUnique({
      where: { id: dto.sourceAccountId },
    });

    if (!sourceAccount || sourceAccount.userId !== userId) {
      throw new ForbiddenException('Invalid or unowned source bank account');
    }

    const start = new Date(dto.startDate);
    const nextRun = start > new Date() ? start : StandingOrdersService.calculateNextRunDate(start, dto.frequency);

    const orderId = `STO-${CryptoUtil.generateNumericOtp(6)}`;
    const order: StandingOrderRecord = {
      id: orderId,
      userId,
      sourceAccountId: dto.sourceAccountId,
      destinationAccountNumber: dto.destinationAccountNumber,
      destinationAccountName: dto.destinationAccountName,
      destinationBankCode: dto.destinationBankCode,
      amount: amount.toFixed(4),
      currency: dto.currency,
      frequency: dto.frequency,
      status: StandingOrderStatus.ACTIVE,
      startDate: start,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      nextRunDate: nextRun,
      executionCount: 0,
      maxOccurrences: dto.maxOccurrences,
      narration: dto.narration || 'Automated Standing Order',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    StandingOrdersService.ordersStore.set(orderId, order);
    this.logger.log(`Standing order ${orderId} created for user ${userId} (${dto.frequency})`);
    return order;
  }

  /**
   * List all standing orders for user
   */
  async getStandingOrders(userId: string): Promise<StandingOrderRecord[]> {
    return Array.from(StandingOrdersService.ordersStore.values()).filter(
      (order) => order.userId === userId,
    );
  }

  /**
   * Get single standing order
   */
  async getStandingOrderById(userId: string, orderId: string): Promise<StandingOrderRecord> {
    const order = StandingOrdersService.ordersStore.get(orderId);
    if (!order || order.userId !== userId) {
      throw new NotFoundException(`Standing order ${orderId} not found`);
    }
    return order;
  }

  /**
   * Toggle pause / resume
   */
  async toggleStandingOrder(userId: string, orderId: string): Promise<StandingOrderRecord> {
    const order = await this.getStandingOrderById(userId, orderId);
    order.status =
      order.status === StandingOrderStatus.ACTIVE
        ? StandingOrderStatus.PAUSED
        : StandingOrderStatus.ACTIVE;
    order.updatedAt = new Date();
    StandingOrdersService.ordersStore.set(orderId, order);
    return order;
  }

  /**
   * Cancel standing order
   */
  async cancelStandingOrder(userId: string, orderId: string): Promise<StandingOrderRecord> {
    const order = await this.getStandingOrderById(userId, orderId);
    order.status = StandingOrderStatus.CANCELLED;
    order.updatedAt = new Date();
    StandingOrdersService.ordersStore.set(orderId, order);
    return order;
  }

  /**
   * Cron Trigger: Execute due standing orders
   */
  async processDueStandingOrders(): Promise<{ processed: number; executed: number; failed: number }> {
    const now = new Date();
    let processed = 0;
    let executed = 0;
    let failed = 0;

    for (const [orderId, order] of StandingOrdersService.ordersStore.entries()) {
      if (order.status !== StandingOrderStatus.ACTIVE) continue;
      if (order.nextRunDate > now) continue;

      // Check max occurrences
      if (order.maxOccurrences && order.executionCount >= order.maxOccurrences) {
        order.status = StandingOrderStatus.COMPLETED;
        continue;
      }

      // Check end date
      if (order.endDate && now > order.endDate) {
        order.status = StandingOrderStatus.COMPLETED;
        continue;
      }

      processed++;
      try {
        // Execute debit / credit transfer
        const sourceAcc = await this.prisma.bankAccount.findUnique({
          where: { id: order.sourceAccountId },
        });

        if (sourceAcc && new Decimal(sourceAcc.availableBalance.toString()).greaterThanOrEqualTo(new Decimal(order.amount))) {
          // Perform transfer update
          await this.prisma.bankAccount.update({
            where: { id: order.sourceAccountId },
            data: {
              currentBalance: { decrement: order.amount },
              availableBalance: { decrement: order.amount },
            },
          });

          order.executionCount++;
          order.lastRunDate = now;
          order.nextRunDate = StandingOrdersService.calculateNextRunDate(now, order.frequency);
          order.updatedAt = now;

          if (order.maxOccurrences && order.executionCount >= order.maxOccurrences) {
            order.status = StandingOrderStatus.COMPLETED;
          }

          executed++;
          this.logger.log(`Standing order ${orderId} executed successfully (Run #${order.executionCount})`);
        } else {
          this.logger.warn(`Standing order ${orderId} skipped: Insufficient balance in account ${order.sourceAccountId}`);
          failed++;
        }
      } catch (err: any) {
        this.logger.error(`Error processing standing order ${orderId}: ${err?.message}`);
        failed++;
      }
    }

    return { processed, executed, failed };
  }
}

