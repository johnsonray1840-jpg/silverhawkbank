import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TransfersService } from './transfers.service';
import { StandingOrdersService } from './standing-orders.service';
import { CashlinksService } from './cashlinks.service';
import { InternalTransferDto } from './dto/internal-transfer.dto';
import { ExternalTransferDto } from './dto/external-transfer.dto';
import { InternationalTransferDto } from './dto/international-transfer.dto';
import { RequestTransferOtpDto } from './dto/request-otp.dto';
import { CreateStandingOrderDto } from './dto/standing-orders.dto';
import { ClaimCashlinkDto, CreateCashlinkDto } from './dto/cashlinks.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Transfers')
@Controller('transfers')
@UseGuards(JwtAuthGuard)
export class TransfersController {
  constructor(
    private transfersService: TransfersService,
    private standingOrdersService: StandingOrdersService,
    private cashlinksService: CashlinksService,
  ) {}

  @Post('send-otp')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request 6-digit OTP verification code for funds transfer authorization' })
  @ApiResponse({ status: 200, description: 'Authorization OTP code dispatched to user email and in-app notification' })
  async sendTransferOtp(
    @CurrentUser('id') userId: string,
    @Body() dto: RequestTransferOtpDto,
  ) {
    return this.transfersService.sendTransferOtp(userId, dto);
  }

  @Post('request-otp')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Alias for requesting transfer OTP authorization code' })
  async requestTransferOtp(
    @CurrentUser('id') userId: string,
    @Body() dto: RequestTransferOtpDto,
  ) {
    return this.transfersService.sendTransferOtp(userId, dto);
  }

  @Post('internal')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute immediate internal transfer between Silverhawk accounts' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Unique idempotency key for safe retries' })
  @ApiResponse({ status: 200, description: 'Internal transfer completed and ledger posted' })
  async transferInternal(
    @CurrentUser('id') userId: string,
    @Body() dto: InternalTransferDto,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
  ) {
    return this.transfersService.transferInternal(userId, dto, headerIdempotencyKey);
  }

  @Post('external')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate outbound wire transfer to an external bank' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiResponse({ status: 200, description: 'External transfer dispatched to clearing provider' })
  async transferExternal(
    @CurrentUser('id') userId: string,
    @Body() dto: ExternalTransferDto,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
  ) {
    return this.transfersService.transferExternal(userId, dto, headerIdempotencyKey);
  }

  @Post('wire')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate outbound wire transfer (alias to external)' })
  async transferWire(
    @CurrentUser('id') userId: string,
    @Body() dto: ExternalTransferDto,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
  ) {
    return this.transfersService.transferExternal(userId, dto, headerIdempotencyKey);
  }

  @Post('international')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate international wire transfer (SWIFT/SEPA) - immediate execution with OTP' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiResponse({ status: 200, description: 'International wire transfer completed successfully' })
  async transferInternational(
    @CurrentUser('id') userId: string,
    @Body() dto: InternationalTransferDto,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
  ) {
    return this.transfersService.transferInternational(userId, dto, headerIdempotencyKey);
  }

  // --- Phase 22: Standing Orders Endpoints ---

  @Post('standing-orders')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create automated recurring standing order payment' })
  async createStandingOrder(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateStandingOrderDto,
  ) {
    return this.standingOrdersService.createStandingOrder(userId, dto);
  }

  @Get('standing-orders')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all standing orders for authenticated user' })
  async getStandingOrders(@CurrentUser('id') userId: string) {
    return this.standingOrdersService.getStandingOrders(userId);
  }

  @Get('standing-orders/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get details of specific standing order' })
  async getStandingOrder(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.standingOrdersService.getStandingOrderById(userId, id);
  }

  @Patch('standing-orders/:id/toggle')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pause or resume an active standing order' })
  async toggleStandingOrder(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.standingOrdersService.toggleStandingOrder(userId, id);
  }

  @Delete('standing-orders/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel an active standing order' })
  async cancelStandingOrder(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.standingOrdersService.cancelStandingOrder(userId, id);
  }

  // --- Phase 25: P2P Cashlinks Endpoints ---

  @Post('cashlinks')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create shareable one-time claimable cashlink' })
  async createCashlink(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCashlinkDto,
  ) {
    return this.cashlinksService.createCashlink(userId, dto);
  }

  @Get('cashlinks/:code')
  @Public()
  @ApiOperation({ summary: 'Public preview of a cashlink by code' })
  async getCashlinkPreview(@Param('code') code: string) {
    return this.cashlinksService.getCashlinkPreview(code);
  }

  @Post('cashlinks/claim')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Claim cashlink funds into recipient bank account' })
  async claimCashlink(
    @CurrentUser('id') userId: string,
    @Body() dto: ClaimCashlinkDto,
  ) {
    return this.cashlinksService.claimCashlink(userId, dto);
  }

  @Delete('cashlinks/:code')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel active cashlink and refund creator' })
  async cancelCashlink(
    @CurrentUser('id') userId: string,
    @Param('code') code: string,
  ) {
    return this.cashlinksService.cancelCashlink(userId, code);
  }
}
