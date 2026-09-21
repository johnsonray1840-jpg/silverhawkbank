import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export enum ApiKeyScope {
  ACCOUNTS_READ = 'accounts:read',
  ACCOUNTS_WRITE = 'accounts:write',
  TRANSFERS_READ = 'transfers:read',
  TRANSFERS_WRITE = 'transfers:write',
  TRANSACTIONS_READ = 'transactions:read',
  CARDS_READ = 'cards:read',
  CARDS_WRITE = 'cards:write',
  WEBHOOKS_MANAGE = 'webhooks:manage',
}

export enum ApiKeyEnvironment {
  TEST = 'TEST',
  LIVE = 'LIVE',
}

export class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsEnum(ApiKeyEnvironment)
  @IsOptional()
  environment?: ApiKeyEnvironment;

  @IsArray()
  @IsEnum(ApiKeyScope, { each: true })
  @IsNotEmpty()
  scopes: ApiKeyScope[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  ipWhitelist?: string[];
}

