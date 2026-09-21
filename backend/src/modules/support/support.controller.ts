import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SupportService } from './support.service';
import {
  AddMessageDto,
  AssignTicketDto,
  CreateTicketDto,
  QueryTicketsDto,
  ReopenTicketDto,
  UpdateTicketPriorityDto,
  UpdateTicketStatusDto,
} from './dto/support.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@ApiTags('Customer Support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  /**
   * Create new support ticket
   */
  @Post('tickets')
  @ApiOperation({ summary: 'Create a new customer support ticket' })
  @ApiResponse({ status: 201, description: 'Ticket created successfully' })
  async createTicket(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTicketDto,
  ) {
    return this.supportService.createTicket(userId, dto);
  }

  /**
   * List customer's tickets
   */
  @Get('tickets')
  @ApiOperation({ summary: 'List customer own support tickets' })
  async getUserTickets(@CurrentUser('id') userId: string) {
    return this.supportService.getUserTickets(userId);
  }

  /**
   * Get single ticket details
   */
  @Get('tickets/:id')
  @ApiOperation({ summary: 'Get support ticket details with message thread' })
  async getTicketById(
    @CurrentUser('id') userId: string,
    @Param('id') ticketId: string,
  ) {
    return this.supportService.getTicketById(userId, ticketId, false);
  }

  /**
   * Get ticket history & audit timeline
   */
  @Get('tickets/:id/history')
  @ApiOperation({ summary: 'Get support ticket timeline and audit history' })
  async getTicketHistory(
    @CurrentUser('id') userId: string,
    @Param('id') ticketId: string,
  ) {
    return this.supportService.getTicketHistory(userId, ticketId, false);
  }

  /**
   * Post message / reply to ticket (Customer)
   */
  @Post('tickets/:id/messages')
  @ApiOperation({ summary: 'Post customer reply to support ticket' })
  async addCustomerMessage(
    @CurrentUser('id') userId: string,
    @Param('id') ticketId: string,
    @Body() dto: AddMessageDto,
  ) {
    return this.supportService.addMessage(userId, ticketId, dto, false);
  }

  /**
   * Close ticket (Customer or Staff)
   */
  @Patch('tickets/:id/close')
  @ApiOperation({ summary: 'Close support ticket' })
  async closeTicket(
    @CurrentUser('id') userId: string,
    @Param('id') ticketId: string,
  ) {
    return this.supportService.closeTicket(userId, ticketId, false);
  }

  /**
   * Reopen closed ticket (Customer or Staff)
   */
  @Post('tickets/:id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reopen a closed or resolved support ticket' })
  async reopenTicket(
    @CurrentUser('id') userId: string,
    @Param('id') ticketId: string,
    @Body() dto: ReopenTicketDto,
  ) {
    return this.supportService.reopenTicket(userId, ticketId, dto, false);
  }

  // --------------------------------------------------------------------------
  // ADMINISTRATIVE DESK ENDPOINTS
  // --------------------------------------------------------------------------

  /**
   * Admin: List and filter all tickets across platform
   */
  @Get('admin/tickets')
  @RequirePermissions('support.read')
  @ApiOperation({ summary: 'Admin list and multi-filter platform support tickets' })
  async adminListTickets(@Query() query: QueryTicketsDto) {
    return this.supportService.adminListTickets(query);
  }

  /**
   * Admin: View ticket details
   */
  @Get('admin/tickets/:id')
  @RequirePermissions('support.read')
  @ApiOperation({ summary: 'Admin inspect support ticket details' })
  async adminGetTicket(
    @CurrentUser('id') adminId: string,
    @Param('id') ticketId: string,
  ) {
    return this.supportService.getTicketById(adminId, ticketId, true);
  }

  /**
   * Admin: View ticket audit history
   */
  @Get('admin/tickets/:id/history')
  @RequirePermissions('support.read')
  @ApiOperation({ summary: 'Admin view ticket audit log and history timeline' })
  async adminGetTicketHistory(
    @CurrentUser('id') adminId: string,
    @Param('id') ticketId: string,
  ) {
    return this.supportService.getTicketHistory(adminId, ticketId, true);
  }

  /**
   * Admin: Post message / staff reply
   */
  @Post('admin/tickets/:id/messages')
  @RequirePermissions('support.reply')
  @ApiOperation({ summary: 'Admin post staff reply to ticket' })
  async adminAddMessage(
    @CurrentUser('id') adminId: string,
    @Param('id') ticketId: string,
    @Body() dto: AddMessageDto,
  ) {
    return this.supportService.addMessage(adminId, ticketId, dto, true);
  }

  /**
   * Admin: Assign ticket to staff officer
   */
  @Patch('admin/tickets/:id/assign')
  @RequirePermissions('support.manage')
  @ApiOperation({ summary: 'Admin assign ticket to staff member' })
  async adminAssignTicket(
    @CurrentUser('id') adminId: string,
    @Param('id') ticketId: string,
    @Body() dto: AssignTicketDto,
  ) {
    return this.supportService.adminAssignTicket(adminId, ticketId, dto);
  }

  /**
   * Admin: Update ticket status
   */
  @Patch('admin/tickets/:id/status')
  @RequirePermissions('support.manage')
  @ApiOperation({ summary: 'Admin update ticket status' })
  async adminUpdateStatus(
    @CurrentUser('id') adminId: string,
    @Param('id') ticketId: string,
    @Body() dto: UpdateTicketStatusDto,
  ) {
    return this.supportService.adminUpdateStatus(adminId, ticketId, dto);
  }

  /**
   * Admin: Update ticket priority
   */
  @Patch('admin/tickets/:id/priority')
  @RequirePermissions('support.manage')
  @ApiOperation({ summary: 'Admin update ticket priority level' })
  async adminUpdatePriority(
    @CurrentUser('id') adminId: string,
    @Param('id') ticketId: string,
    @Body() dto: UpdateTicketPriorityDto,
  ) {
    return this.supportService.adminUpdatePriority(adminId, ticketId, dto);
  }
}
