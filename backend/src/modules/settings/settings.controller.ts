import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { TestSmsDto, TestSmtpDto, UpdateSettingsBatchDto } from './dto/settings.dto';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('CMS & Platform Settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Get public platform settings and branding for dynamic frontend rendering' })
  @ApiResponse({ status: 200, description: 'Public platform configuration parameters' })
  async getPublicSettings() {
    return this.settingsService.getPublicSettings();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('settings.read')
  @Get('admin')
  @ApiOperation({ summary: 'Get all platform settings with category grouping and sensitive values for Admin Console' })
  @ApiResponse({ status: 200, description: 'All platform configuration parameters' })
  async getAdminSettings() {
    return this.settingsService.getAdminSettings();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('settings.update')
  @Put('admin/batch')
  @ApiOperation({ summary: 'Batch update platform settings across all CMS categories' })
  @ApiResponse({ status: 200, description: 'Settings successfully updated and audit logged' })
  async updateBatch(
    @CurrentUser('id') adminId: string,
    @Body() dto: UpdateSettingsBatchDto,
  ) {
    return this.settingsService.updateBatch(adminId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('settings.update')
  @Post('admin/test-smtp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transmit test email to verify SMTP mail server configuration' })
  @ApiResponse({ status: 200, description: 'SMTP verification results' })
  async testSmtp(
    @CurrentUser('id') adminId: string,
    @Body() dto: TestSmtpDto,
  ) {
    return this.settingsService.testSmtp(dto, adminId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('settings.update')
  @Post('admin/test-sms')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transmit test SMS to verify SMS gateway integration' })
  @ApiResponse({ status: 200, description: 'SMS verification results' })
  async testSms(
    @CurrentUser('id') adminId: string,
    @Body() dto: TestSmsDto,
  ) {
    return this.settingsService.testSms(dto, adminId);
  }
}
