import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/api-keys.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Developer API Keys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('auth/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate a new developer API key with custom permission scopes' })
  @ApiResponse({ status: 201, description: 'API Key generated. Secret is displayed once.' })
  async createApiKey(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeysService.createApiKey(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all API keys for authenticated user' })
  async getApiKeys(@CurrentUser('id') userId: string) {
    return this.apiKeysService.getApiKeys(userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an API key' })
  async revokeApiKey(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.apiKeysService.revokeApiKey(userId, id);
  }
}

