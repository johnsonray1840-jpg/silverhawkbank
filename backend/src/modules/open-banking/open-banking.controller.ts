import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OpenBankingService } from './open-banking.service';
import {
  AuthorizeConsentDto,
  CreateConsentDto,
  CreatePaymentSetupDto,
  ExecutePaymentDto,
} from './dto/open-banking.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Open Banking / PSD2 APIs (v3.1)')
@Controller('open-banking/v3.1')
export class OpenBankingController {
  constructor(private readonly openBankingService: OpenBankingService) {}

  // -------------------------------------------------------------
  // 1. Consent Management
  // -------------------------------------------------------------

  @Post('consents')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'TPP: Create Open Banking access consent request' })
  @ApiResponse({ status: 201, description: 'Consent request created in AwaitingAuthorization state' })
  async createConsent(@Body() dto: CreateConsentDto) {
    return this.openBankingService.createConsent(dto);
  }

  @Post('consents/:id/authorize')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer: Explicitly review, select accounts, and authorize consent' })
  async authorizeConsent(
    @CurrentUser('id') userId: string,
    @Param('id') consentId: string,
    @Body() dto: AuthorizeConsentDto,
  ) {
    return this.openBankingService.authorizeConsent(userId, consentId, dto);
  }

  @Delete('consents/:id')
  @Public()
  @ApiOperation({ summary: 'TPP or Customer: Revoke active consent' })
  async revokeConsent(@Param('id') consentId: string) {
    return this.openBankingService.revokeConsent(consentId);
  }

  // -------------------------------------------------------------
  // 2. Account Information Services (AIS)
  // -------------------------------------------------------------

  @Get('ais/accounts')
  @Public()
  @ApiOperation({ summary: 'AIS: Retrieve authorized accounts list' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer ob_tok_...' })
  async getAisAccounts(@Headers('authorization') authHeader: string) {
    return this.openBankingService.getAisAccounts(authHeader || '');
  }

  @Get('ais/accounts/:id/balances')
  @Public()
  @ApiOperation({ summary: 'AIS: Retrieve real-time ledger balances for authorized account' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer ob_tok_...' })
  async getAisBalances(
    @Headers('authorization') authHeader: string,
    @Param('id') accountId: string,
  ) {
    return this.openBankingService.getAisBalances(authHeader || '', accountId);
  }

  @Get('ais/accounts/:id/transactions')
  @Public()
  @ApiOperation({ summary: 'AIS: Retrieve booked transactions for authorized account' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer ob_tok_...' })
  async getAisTransactions(
    @Headers('authorization') authHeader: string,
    @Param('id') accountId: string,
  ) {
    return this.openBankingService.getAisTransactions(authHeader || '', accountId);
  }

  // -------------------------------------------------------------
  // 3. Payment Initiation Services (PIS)
  // -------------------------------------------------------------

  @Post('pis/payment-setups')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'PIS: Create single immediate payment setup session' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer ob_tok_...' })
  async createPaymentSetup(
    @Headers('authorization') authHeader: string,
    @Body() dto: CreatePaymentSetupDto,
  ) {
    return this.openBankingService.createPaymentSetup(authHeader || '', dto);
  }

  @Post('pis/payments')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer: Authorize and execute Open Banking payment' })
  @ApiResponse({ status: 200, description: 'Payment executed and ledger posted' })
  async executePayment(
    @CurrentUser('id') userId: string,
    @Body() dto: ExecutePaymentDto,
  ) {
    return this.openBankingService.executePayment(userId, dto);
  }
}

