import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EmailService } from '../email/email.service';
import {
  AddMessageDto,
  AssignTicketDto,
  CreateTicketDto,
  QueryTicketsDto,
  ReopenTicketDto,
  UpdateTicketPriorityDto,
  UpdateTicketStatusDto,
} from './dto/support.dto';
import { SupportTicketPriority, SupportTicketStatus } from '@prisma/client';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Create a new support ticket with initial message
   */
  async createTicket(userId: string, dto: CreateTicketDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const ticketNumber = `TCK-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.create({
        data: {
          ticketNumber,
          userId,
          subject: dto.subject,
          category: dto.category ? dto.category.toUpperCase() : 'GENERAL',
          priority: dto.priority || SupportTicketPriority.MEDIUM,
          status: SupportTicketStatus.OPEN,
        },
      });

      await tx.supportMessage.create({
        data: {
          ticketId: ticket.id,
          senderId: userId,
          message: dto.message,
          attachment: dto.attachment || null,
          isStaff: false,
        },
      });

      await tx.notification.create({
        data: {
          userId,
          title: 'Support Ticket Created',
          message: `Your ticket #${ticketNumber} "${dto.subject}" has been received. Our support team will respond shortly.`,
          type: 'SUPPORT',
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'SUPPORT_TICKET_CREATED',
          resource: 'SupportTicket',
          resourceId: ticket.id,
          afterState: { ticketNumber, subject: dto.subject, priority: ticket.priority },
        },
      });

      return ticket;
    });

    return {
      message: 'Support ticket submitted successfully',
      ticket: result,
    };
  }

  /**
   * List customer's tickets
   */
  async getUserTickets(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      include: {
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Get single ticket details with full message thread and staff details
   */
  async getTicketById(userId: string, ticketId: string, isStaff: boolean = false) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            profile: true,
          },
        },
        messages: {
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                profile: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    if (!isStaff && ticket.userId !== userId) {
      throw new ForbiddenException('Access denied to this support ticket');
    }

    return ticket;
  }

  /**
   * Add message / reply to ticket (Customer or Staff)
   */
  async addMessage(userId: string, ticketId: string, dto: AddMessageDto, isStaff: boolean = false) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { user: { include: { profile: true } } },
    });

    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    if (!isStaff && ticket.userId !== userId) {
      throw new ForbiddenException('Access denied to this support ticket');
    }

    if (ticket.status === SupportTicketStatus.CLOSED) {
      throw new BadRequestException('Cannot reply to a closed ticket. Please reopen the ticket first.');
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const msg = await tx.supportMessage.create({
        data: {
          ticketId,
          senderId: userId,
          message: dto.message,
          attachment: dto.attachment || null,
          isStaff,
        },
      });

      // Update ticket status & timestamp
      const nextStatus = isStaff ? SupportTicketStatus.PENDING : SupportTicketStatus.IN_PROGRESS;
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: nextStatus,
          updatedAt: new Date(),
        },
      });

      // If staff reply, notify user
      if (isStaff) {
        await tx.notification.create({
          data: {
            userId: ticket.userId,
            title: 'Support Reply Received',
            message: `New response from staff on ticket #${ticket.ticketNumber}: "${ticket.subject}".`,
            type: 'SUPPORT',
          },
        });
      }

      return msg;
    });

    return {
      message: 'Reply posted successfully',
      supportMessage: message,
    };
  }

  /**
   * Close ticket
   */
  async closeTicket(userId: string, ticketId: string, isStaff: boolean = false) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });

    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    if (!isStaff && ticket.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.supportTicket.update({
        where: { id: ticketId },
        data: { status: SupportTicketStatus.CLOSED },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'SUPPORT_TICKET_CLOSED',
          resource: 'SupportTicket',
          resourceId: ticketId,
          beforeState: { status: ticket.status },
          afterState: { status: SupportTicketStatus.CLOSED },
        },
      });

      return res;
    });

    return {
      message: 'Support ticket closed successfully',
      ticket: updated,
    };
  }

  /**
   * Reopen closed or resolved ticket
   */
  async reopenTicket(userId: string, ticketId: string, dto?: ReopenTicketDto, isStaff: boolean = false) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { user: true },
    });

    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    if (!isStaff && ticket.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    if (ticket.status !== SupportTicketStatus.CLOSED && ticket.status !== SupportTicketStatus.RESOLVED) {
      throw new BadRequestException(`Ticket is currently ${ticket.status}, only CLOSED or RESOLVED tickets can be reopened`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: SupportTicketStatus.OPEN,
          updatedAt: new Date(),
        },
      });

      if (dto?.reason) {
        await tx.supportMessage.create({
          data: {
            ticketId,
            senderId: userId,
            message: `[Ticket Reopened] Reason: ${dto.reason}`,
            isStaff,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'SUPPORT_TICKET_REOPENED',
          resource: 'SupportTicket',
          resourceId: ticketId,
          beforeState: { status: ticket.status },
          afterState: { status: SupportTicketStatus.OPEN, reason: dto?.reason },
        },
      });

      // Notify user
      await tx.notification.create({
        data: {
          userId: ticket.userId,
          title: 'Ticket Reopened',
          message: `Ticket #${ticket.ticketNumber} has been reopened for further investigation.`,
          type: 'SUPPORT',
        },
      });

      return res;
    });

    return {
      message: 'Support ticket reopened successfully',
      ticket: updated,
    };
  }

  /**
   * Get ticket history & audit timeline
   */
  async getTicketHistory(userId: string, ticketId: string, isStaff: boolean = false) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        messages: {
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                profile: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    if (!isStaff && ticket.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const auditLogs = await this.prisma.auditLog.findMany({
      where: {
        resource: 'SupportTicket',
        resourceId: ticketId,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            profile: true,
          },
        },
      },
    });

    return {
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      assignedTo: ticket.assignedTo,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      messageCount: ticket.messages.length,
      auditTimeline: auditLogs,
    };
  }

  /**
   * Admin: List and multi-filter tickets across platform
   */
  async adminListTickets(query?: QueryTicketsDto) {
    const where: any = {};
    if (query?.status) where.status = query.status;
    if (query?.priority) where.priority = query.priority;
    if (query?.category) where.category = query.category.toUpperCase();
    if (query?.assignedTo) where.assignedTo = query.assignedTo;

    if (query?.search) {
      where.OR = [
        { ticketNumber: { contains: query.search, mode: 'insensitive' } },
        { subject: { contains: query.search, mode: 'insensitive' } },
        { user: { email: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Number(query?.limit) || 20);
    const skip = (page - 1) * limit;

    const [total, tickets] = await Promise.all([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              profile: true,
            },
          },
          messages: {
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      tickets,
    };
  }

  /**
   * Admin: Assign ticket to staff officer
   */
  async adminAssignTicket(adminId: string, ticketId: string, dto: AssignTicketDto) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const staff = await this.prisma.user.findUnique({
      where: { id: dto.staffId },
      include: { profile: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.supportTicket.update({
        where: { id: ticketId },
        data: { assignedTo: dto.staffId },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'SUPPORT_TICKET_ASSIGNED',
          resource: 'SupportTicket',
          resourceId: ticketId,
          beforeState: { assignedTo: ticket.assignedTo },
          afterState: { assignedTo: dto.staffId, staffName: staff.username },
        },
      });

      // Notify assigned staff
      await tx.notification.create({
        data: {
          userId: dto.staffId,
          title: 'Ticket Assigned to You',
          message: `You have been assigned to Support Ticket #${ticket.ticketNumber}: "${ticket.subject}".`,
          type: 'SUPPORT',
        },
      });

      return res;
    });

    return {
      message: 'Ticket assigned successfully',
      ticket: updated,
    };
  }

  /**
   * Admin: Update ticket status
   */
  async adminUpdateStatus(adminId: string, ticketId: string, dto: UpdateTicketStatusDto) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.supportTicket.update({
        where: { id: ticketId },
        data: { status: dto.status },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'SUPPORT_TICKET_STATUS_UPDATED',
          resource: 'SupportTicket',
          resourceId: ticketId,
          beforeState: { status: ticket.status },
          afterState: { status: dto.status, note: dto.note },
        },
      });

      return res;
    });

    return {
      message: `Ticket status updated to ${dto.status}`,
      ticket: updated,
    };
  }

  /**
   * Admin: Update ticket priority
   */
  async adminUpdatePriority(adminId: string, ticketId: string, dto: UpdateTicketPriorityDto) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.supportTicket.update({
        where: { id: ticketId },
        data: { priority: dto.priority },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'SUPPORT_TICKET_PRIORITY_UPDATED',
          resource: 'SupportTicket',
          resourceId: ticketId,
          beforeState: { priority: ticket.priority },
          afterState: { priority: dto.priority },
        },
      });

      return res;
    });

    return {
      message: `Ticket priority changed to ${dto.priority}`,
      ticket: updated,
    };
  }
}
