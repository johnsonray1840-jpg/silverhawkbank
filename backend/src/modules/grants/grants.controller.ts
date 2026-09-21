import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GrantsService } from './grants.service';
import { ApplyGrantDto, ReviewGrantDto, DisburseGrantDto } from './dto/apply-grant.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { GrantStatus } from '@prisma/client';

@Controller('grants')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class GrantsController {
  constructor(private readonly grantsService: GrantsService) {}

  /**
   * Get list of active grant programs
   */
  @Get('programs')
  @Public()
  async getGrantPrograms() {
    return this.grantsService.getPrograms();
  }

  /**
   * Submit a new grant application
   */
  @Post('apply')
  async applyForGrant(
    @CurrentUser('id') userId: string,
    @Body() dto: ApplyGrantDto,
  ) {
    return this.grantsService.applyForGrant(userId, dto);
  }

  /**
   * List customer's grant applications
   */
  @Get('applications')
  async getUserApplications(@CurrentUser('id') userId: string) {
    return this.grantsService.getUserApplications(userId);
  }

  /**
   * Get details of a single grant application
   */
  @Get('applications/:id')
  async getApplicationById(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.grantsService.getApplicationById(userId, id);
  }

  /**
   * Disburse approved grant funds to customer bank account
   */
  @Post('applications/:id/disburse')
  async disburseGrant(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: DisburseGrantDto,
  ) {
    return this.grantsService.disburseGrant(userId, id, dto);
  }

  /**
   * Admin: List all grant applications across the bank
   */
  @Get('admin/all')
  @RequirePermissions('compliance.audit')
  async adminListApplications(
    @Query('status') status?: GrantStatus,
    @Query('programId') programId?: string,
  ) {
    return this.grantsService.adminListApplications({ status, programId });
  }

  /**
   * Admin: Review grant application (Approve / Reject)
   */
  @Post('admin/:id/review')
  @RequirePermissions('compliance.audit')
  async adminReviewApplication(
    @CurrentUser('id') adminId: string,
    @Param('id') id: string,
    @Body() dto: ReviewGrantDto,
  ) {
    return this.grantsService.adminReviewApplication(adminId, id, dto);
  }
}

