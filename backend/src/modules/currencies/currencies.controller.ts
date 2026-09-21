import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrenciesService } from './currencies.service';
import {
  ExchangeQuoteDto,
  SwapCurrencyDto,
  UpdateExchangeRateDto,
} from './dto/currencies.dto';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@ApiTags('Currencies & FX')
@Controller('currencies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CurrenciesController {
  constructor(private readonly currenciesService: CurrenciesService) {}

  /**
   * List supported currencies
   */
  @Get()
  @Public()
  @ApiOperation({ summary: 'List all supported active currencies' })
  async getCurrencies() {
    return this.currenciesService.getCurrencies();
  }

  /**
   * List live exchange rates
   */
  @Get('rates')
  @Public()
  @ApiOperation({ summary: 'Get live conversion rates' })
  async getExchangeRates() {
    return this.currenciesService.getExchangeRates();
  }

  /**
   * Convert amount between two currencies
   */
  @Get('convert')
  @Public()
  @ApiOperation({ summary: 'Convert amount with spot rate' })
  async convertAmount(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('amount') amount: string,
  ) {
    return this.currenciesService.convertAmount(from, to, amount);
  }

  /**
   * Get historical exchange rate time-series
   */
  @Get('history')
  @Public()
  @ApiOperation({ summary: 'Get historical exchange rate time-series for a currency pair' })
  async getHistoricalRates(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('limit') limit?: number,
  ) {
    return this.currenciesService.getHistoricalExchangeRates(from, to, limit ? Number(limit) : 30);
  }


  /**
   * Phase 22: Get instant exchange quote with spread calculation
   */
  @Post('quote')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get real-time swap quote with institutional spread fee breakdown' })
  async getQuote(@Body() dto: ExchangeQuoteDto) {
    return this.currenciesService.getExchangeQuote(dto);
  }

  /**
   * Phase 22: Execute instant currency swap between user accounts
   */
  @Post('swap')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Instantly swap balances between two multi-currency accounts' })
  @ApiResponse({ status: 200, description: 'Currency swap completed and ledger posted' })
  async swapCurrency(
    @CurrentUser('id') userId: string,
    @Body() dto: SwapCurrencyDto,
  ) {
    return this.currenciesService.swapCurrency(userId, dto);
  }

  /**
   * Admin: Update exchange rate
   */
  @Post('admin/rates')
  @ApiBearerAuth()
  @RequirePermissions('settings.update')
  @ApiOperation({ summary: 'Admin: Override live FX rate' })
  async updateExchangeRate(@Body() dto: UpdateExchangeRateDto) {
    return this.currenciesService.updateExchangeRate(dto);
  }
}
