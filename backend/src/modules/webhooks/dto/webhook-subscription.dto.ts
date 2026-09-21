import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export enum WebhookEventTopic {
  TRANSACTION_CREATED = 'transaction.created',
  TRANSACTION_SUCCESS = 'transaction.success',
  TRANSACTION_FAILED = 'transaction.failed',
  TRANSFER_SENT = 'transfer.sent',
  TRANSFER_RECEIVED = 'transfer.received',
  DEPOSIT_COMPLETED = 'deposit.completed',
  LOAN_DISBURSED = 'loan.disbursed',
  CARD_TRANSACTION = 'card.transaction',
  KYC_UPDATED = 'kyc.updated',
}

export enum WebhookSubscriptionStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  DISABLED = 'DISABLED',
}

export class CreateWebhookSubscriptionDto {
  @IsUrl({ require_tld: false, require_protocol: true })
  @IsNotEmpty()
  url: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsEnum(WebhookEventTopic, { each: true })
  @IsNotEmpty()
  topics: WebhookEventTopic[];
}

export class ReplayWebhookDto {
  @IsString()
  @IsNotEmpty()
  eventId: string;
}

