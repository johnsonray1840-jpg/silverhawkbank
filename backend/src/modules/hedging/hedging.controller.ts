import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HedgingService } from './hedging.service';
import {
  CreateForwardQuoteDto,
  BookForwardContractDto,
  SettleForwardContractDto,
  RolloverForwardContractDto,
} from './dto/hedging.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForwardContractStatus } from '../../common/utils/fx-forward.util';

@ApiTags('Treasury FX Hedging, Forward Contracts & MTM Risk')
@ApiBearerAuth()
@Controller('hedging')
export class HedgingController {
  constructor(private readonly hedgingService: HedgingService) {}

  @Post('quotes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a guaranteed CIRP forward exchange rate quote (60s validity)' })
  @ApiResponse({ status: 200, description: 'Forward quote generated with interest rate parity points' })
  async getForwardQuote(@Body() dto: CreateForwardQuoteDto) {
    return this.hedgingService.getForwardQuote(dto);
  }

  @Post('contracts/book')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Book an institutional FX Forward Contract (FEC) with collateral lock' })
  @ApiResponse({ status: 201, description: 'Forward contract booked and collateral margin reserved' })
  async bookContract(
    @CurrentUser('id') userId: string,
    @Body() dto: BookForwardContractDto,
  ) {
    return this.hedgingService.bookContract(userId, dto);
  }

  @Get('contracts')
  @ApiOperation({ summary: 'List all open and historical forward contracts with real-time MTM valuation' })
  @ApiQuery({ name: 'status', enum: ForwardContractStatus, required: false })
  @ApiResponse({ status: 200, description: 'List of forward contracts with unrealized PnL' })
  async listContracts(
    @CurrentUser('id') userId: string,
    @Query('status') status?: ForwardContractStatus,
  ) {
    return this.hedgingService.listContracts(userId, status);
  }

  @Get('contracts/:id')
  @ApiOperation({ summary: 'Get forward contract details with real-time Mark-to-Market valuation' })
  @ApiResponse({ status: 200, description: 'Contract details and collateral health' })
  async getContract(
    @CurrentUser('id') userId: string,
    @Param('id') contractId: string,
  ) {
    return this.hedgingService.getContract(userId, contractId);
  }

  @Post('contracts/:id/settle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Settle forward contract at maturity (Physical Delivery or Cash Settled Net PnL)' })
  @ApiResponse({ status: 200, description: 'Contract settled and collateral released' })
  async settleContract(
    @CurrentUser('id') userId: string,
    @Param('id') contractId: string,
    @Body() dto: SettleForwardContractDto,
  ) {
    return this.hedgingService.settleContract(userId, contractId, dto);
  }

  @Post('contracts/:id/rollover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rollover forward contract tenor to a future date with swap points' })
  @ApiResponse({ status: 200, description: 'Contract rolled over successfully' })
  async rolloverContract(
    @CurrentUser('id') userId: string,
    @Param('id') contractId: string,
    @Body() dto: RolloverForwardContractDto,
  ) {
    return this.hedgingService.rolloverContract(userId, contractId, dto);
  }
}

