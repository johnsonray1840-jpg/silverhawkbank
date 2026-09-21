import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FeesService } from './fees.service';
import { CalculateFeeQuoteDto, ConfigureFeeRuleDto } from './dto/fees.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@ApiTags('Fees & Tariffs')
@Controller('fees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FeesController {
  constructor(private readonly feesService: FeesService) {}

  @Post('calculate')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calculate transparent fee quotation server-side' })
  @ApiResponse({ status: 200, description: 'Calculated fee breakdown' })
  async calculateFee(@Body() dto: CalculateFeeQuoteDto) {
    return this.feesService.calculateFeeQuote(dto);
  }

  @Get('tariffs')
  @Public()
  @ApiOperation({ summary: 'List all standard bank fee schedules & tariffs' })
  async getFeeTariffs() {
    return this.feesService.getFeeTariffCatalog();
  }

  @Post('admin/configure')
  @ApiBearerAuth()
  @RequirePermissions('settings.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Configure banking fee structure' })
  async configureFeeRule(
    @Body() dto: ConfigureFeeRuleDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.feesService.configureFeeRule(dto, adminId);
  }
}

