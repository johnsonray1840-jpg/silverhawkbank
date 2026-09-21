import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ApiKeyEnvironment, ApiKeyScope, CreateApiKeyDto } from './dto/api-keys.dto';
import * as crypto from 'crypto';

export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  hashedKey: string;
  environment: ApiKeyEnvironment;
  scopes: ApiKeyScope[];
  ipWhitelist?: string[];
  lastUsedAt?: Date;
  isRevoked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);
  private static keysStore: Map<string, ApiKeyRecord> = new Map();

  constructor(private prisma: PrismaService) {}

  /**
   * Generate raw cryptographic API key
   */
  static generateRawKey(env: ApiKeyEnvironment = ApiKeyEnvironment.LIVE): { rawKey: string; prefix: string; hash: string } {
    const envPrefix = env === ApiKeyEnvironment.LIVE ? 'rem_live_' : 'rem_test_';
    const randomEntropy = crypto.randomBytes(24).toString('hex');
    const rawKey = `${envPrefix}${randomEntropy}`;
    const prefix = `${envPrefix}${randomEntropy.slice(0, 6)}...${randomEntropy.slice(-4)}`;
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    return { rawKey, prefix, hash };
  }

  /**
   * Provision new API key for user
   */
  async createApiKey(userId: string, dto: CreateApiKeyDto): Promise<{ apiKey: ApiKeyRecord; secretKey: string }> {
    const env = dto.environment || ApiKeyEnvironment.LIVE;
    const { rawKey, prefix, hash } = ApiKeysService.generateRawKey(env);

    const keyId = `KEY-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const apiKeyRecord: ApiKeyRecord = {
      id: keyId,
      userId,
      name: dto.name,
      prefix,
      hashedKey: hash,
      environment: env,
      scopes: dto.scopes,
      ipWhitelist: dto.ipWhitelist,
      isRevoked: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    ApiKeysService.keysStore.set(keyId, apiKeyRecord);
    this.logger.log(`API Key ${keyId} provisioned for user ${userId} with scopes: ${dto.scopes.join(', ')}`);

    return {
      apiKey: apiKeyRecord,
      secretKey: rawKey,
    };
  }

  /**
   * List API keys for user (secret keys are never shown, only prefixes)
   */
  async getApiKeys(userId: string): Promise<Omit<ApiKeyRecord, 'hashedKey'>[]> {
    return Array.from(ApiKeysService.keysStore.values())
      .filter((k) => k.userId === userId)
      .map(({ hashedKey, ...rest }) => rest);
  }

  /**
   * Revoke an API key
   */
  async revokeApiKey(userId: string, keyId: string): Promise<Omit<ApiKeyRecord, 'hashedKey'>> {
    const key = ApiKeysService.keysStore.get(keyId);
    if (!key || key.userId !== userId) {
      throw new NotFoundException(`API key ${keyId} not found`);
    }

    key.isRevoked = true;
    key.updatedAt = new Date();
    ApiKeysService.keysStore.set(keyId, key);
    this.logger.log(`API Key ${keyId} revoked by user ${userId}`);

    const { hashedKey, ...safeRecord } = key;
    return safeRecord;
  }

  /**
   * Validate API key and check scopes for machine-to-machine requests
   */
  async validateApiKey(rawKey: string, requiredScope?: ApiKeyScope): Promise<ApiKeyRecord> {
    if (!rawKey || (!rawKey.startsWith('rem_live_') && !rawKey.startsWith('rem_test_'))) {
      throw new ForbiddenException('Invalid API Key format');
    }

    const computedHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const matchedKey = Array.from(ApiKeysService.keysStore.values()).find(
      (k) => k.hashedKey === computedHash,
    );

    if (!matchedKey) {
      throw new ForbiddenException('API Key does not exist or has invalid signature');
    }

    if (matchedKey.isRevoked) {
      throw new ForbiddenException('API Key has been revoked');
    }

    if (requiredScope && !matchedKey.scopes.includes(requiredScope)) {
      throw new ForbiddenException(`API Key lacks required permission scope: ${requiredScope}`);
    }

    // Update last used timestamp
    matchedKey.lastUsedAt = new Date();
    ApiKeysService.keysStore.set(matchedKey.id, matchedKey);

    return matchedKey;
  }
}

