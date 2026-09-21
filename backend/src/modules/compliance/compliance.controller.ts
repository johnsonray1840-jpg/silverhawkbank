import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ComplianceService } from './compliance.service';
import {
  AlertStatus,
  CreateSarDto,
  ResolveAlertDto,
  ScreenEntityDto,
} from './dto/compliance.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@ApiTags('AML & Regulatory Compliance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Post('screen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Screen individual or entity against OFAC, UN, EU, UK HMT & PEP watchlists' })
  async screenEntity(@Body() dto: ScreenEntityDto) {
    return this.complianceService.screenEntity(dto);
  }

  @Get('alerts')
  @RequirePermissions('admin.read')
  @ApiOperation({ summary: 'Compliance Officer: List flagged AML and Sanctions alerts' })
  async getAlerts(@Query('status') status?: AlertStatus) {
    return this.complianceService.getAlerts(status);
  }

  @Get('alerts/:id')
  @RequirePermissions('admin.read')
  @ApiOperation({ summary: 'Compliance Officer: Get alert details and matching watchlist entries' })
  async getAlertById(@Param('id') id: string) {
    return this.complianceService.getAlertById(id);
  }

  @Patch('alerts/:id/resolve')
  @RequirePermissions('admin.update')
  @ApiOperation({ summary: 'Compliance Officer: Resolve alert as False Positive or escalate' })
  async resolveAlert(
    @CurrentUser('id') officerUserId: string,
    @Param('id') id: string,
    @Body() dto: ResolveAlertDto,
  ) {
    return this.complianceService.resolveAlert(officerUserId, id, dto);
  }

  @Post('sar')
  @RequirePermissions('admin.update')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Compliance Officer: File official Suspicious Activity Report (SAR)' })
  @ApiResponse({ status: 201, description: 'SAR record generated with FinCEN BSA export payload' })
  async fileSar(
    @CurrentUser('id') officerUserId: string,
    @Body() dto: CreateSarDto,
  ) {
    return this.complianceService.fileSar(officerUserId, dto);
  }

  @Get('sar')
  @RequirePermissions('admin.read')
  @ApiOperation({ summary: 'Compliance Officer: List all filed SAR compliance reports' })
  async getSars() {
    return this.complianceService.getSars();
  }
}

