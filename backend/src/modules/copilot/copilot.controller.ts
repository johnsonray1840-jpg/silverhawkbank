import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CopilotService } from './copilot.service';
import { CopilotQueryDto } from './dto/copilot.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('AI Financial Copilot & Wealth Intelligence')
@ApiBearerAuth()
@Controller('copilot')
export class CopilotController {
  constructor(private readonly copilotService: CopilotService) {}

  @Post('query')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Conversational natural-language query to AI financial copilot' })
  @ApiResponse({ status: 200, description: 'Copilot query response with financial context and action recommendations' })
  async query(
    @CurrentUser('id') userId: string,
    @Body() dto: CopilotQueryDto,
  ) {
    return this.copilotService.queryCopilot(userId, dto);
  }

  @Get('insights')
  @ApiOperation({ summary: 'Retrieve personalized spending insights, category breakdown, and financial health score' })
  @ApiResponse({ status: 200, description: 'User financial health score, net worth, and category spending breakdown' })
  async getInsights(@CurrentUser('id') userId: string) {
    return this.copilotService.getInsights(userId);
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'Detect recurring monthly subscriptions, utility bills, and average costs' })
  @ApiResponse({ status: 200, description: 'List of detected recurring subscriptions with upcoming bill estimations' })
  async getSubscriptions(@CurrentUser('id') userId: string) {
    return this.copilotService.getSubscriptions(userId);
  }

  @Get('cashflow-forecast')
  @ApiOperation({ summary: 'Generate 30/60/90-day predictive cash-flow forecast and runway runway analysis' })
  @ApiResponse({ status: 200, description: 'Multi-horizon cash-flow projections and runway risk rating' })
  async getCashflowForecast(@CurrentUser('id') userId: string) {
    return this.copilotService.getCashflowForecast(userId);
  }
}

