import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { CreateWebhookSubscriptionDto, ReplayWebhookDto } from './dto/webhook-subscription.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Developer Webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhookService: WebhookDispatcherService) {}

  @Post('subscriptions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new developer webhook URL endpoint' })
  @ApiResponse({ status: 201, description: 'Webhook subscription created with signing secret' })
  async createSubscription(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateWebhookSubscriptionDto,
  ) {
    return this.webhookService.createSubscription(userId, dto);
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'List all registered developer webhook subscriptions' })
  async getSubscriptions(@CurrentUser('id') userId: string) {
    return this.webhookService.getSubscriptions(userId);
  }

  @Delete('subscriptions/:id')
  @ApiOperation({ summary: 'Delete a registered webhook subscription' })
  async deleteSubscription(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.webhookService.deleteSubscription(userId, id);
  }

  @Get('logs')
  @ApiOperation({ summary: 'List webhook delivery logs and payloads' })
  async getDeliveryLogs(@CurrentUser('id') userId: string) {
    return this.webhookService.getDeliveryLogs(userId);
  }

  @Post('replay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually replay a past webhook event' })
  async replayEvent(
    @CurrentUser('id') userId: string,
    @Body() dto: ReplayWebhookDto,
  ) {
    return this.webhookService.replayEvent(userId, dto.eventId);
  }
}

