import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeysService } from '../../modules/auth/api-keys.service';
import { ApiKeyScope } from '../../modules/auth/dto/api-keys.dto';

export const REQUIRE_API_SCOPE_KEY = 'require_api_scope';

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private apiKeysService: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    // Extract API key from X-API-Key or Authorization: Bearer rem_...
    let apiKey = request.headers['x-api-key'] as string;
    const authHeader = request.headers['authorization'] as string;

    if (!apiKey && authHeader && authHeader.startsWith('Bearer rem_')) {
      apiKey = authHeader.substring(7);
    }

    if (!apiKey) {
      throw new UnauthorizedException('Missing X-API-Key or Bearer API token header');
    }

    const requiredScope = this.reflector.getAllAndOverride<ApiKeyScope>(
      REQUIRE_API_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );

    const validatedKey = await this.apiKeysService.validateApiKey(apiKey, requiredScope);
    
    // Attach API key identity to request
    request.apiKey = validatedKey;
    request.user = { id: validatedKey.userId, isApiKey: true };

    return true;
  }
}

