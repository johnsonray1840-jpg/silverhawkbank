import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class UsersController {
  constructor(private usersService: UsersService) {}

  // ----------------------------------------------------------------------------
  // CUSTOMER SELF-SERVICE ENDPOINTS
  // ----------------------------------------------------------------------------

  @Get('users/profile')
  @ApiOperation({ summary: 'Get authenticated user profile and account overview' })
  async getProfile(@CurrentUser('id') userId: string) {
    return this.usersService.getProfile(userId);
  }

  @Put('users/profile')
  @ApiOperation({ summary: 'Update customer personal profile information' })
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Put('users/2fa')
  @ApiOperation({ summary: 'Enable or disable two-factor authentication' })
  async toggleTwoFactor(
    @CurrentUser('id') userId: string,
    @Body('enabled') enabled: boolean,
  ) {
    return this.usersService.toggleTwoFactor(userId, !!enabled);
  }

  // ----------------------------------------------------------------------------
  // ADMINISTRATIVE & COMPLIANCE ENDPOINTS
  // ----------------------------------------------------------------------------

  @Get('admin/users')
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'Admin: Get paginated list of all customers with filters' })
  @ApiResponse({ status: 200, description: 'Paginated customer list' })
  async getUsers(@Query() queryDto: QueryUsersDto) {
    return this.usersService.getUsers(queryDto);
  }

  @Get('admin/users/:id')
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'Admin: Get 360-degree comprehensive customer dossier' })
  async getUserDetails(@Param('id') userId: string) {
    return this.usersService.getUserDetails(userId);
  }

  @Put('admin/users/:id/status')
  @RequirePermissions('users.freeze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Freeze, suspend, or activate user account' })
  async updateUserStatus(
    @Param('id') userId: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.usersService.updateUserStatus(userId, dto, adminId);
  }
}

