import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { KycModule } from './modules/kyc/kyc.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { BeneficiariesModule } from './modules/beneficiaries/beneficiaries.module';
import { TransfersModule } from './modules/transfers/transfers.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { EmailModule } from './modules/email/email.module';
import { DepositsModule } from './modules/deposits/deposits.module';
import { WithdrawalsModule } from './modules/withdrawals/withdrawals.module';
import { SavingsModule } from './modules/savings/savings.module';
import { LoansModule } from './modules/loans/loans.module';
import { CardsModule } from './modules/cards/cards.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SupportModule } from './modules/support/support.module';
import { AdminModule } from './modules/admin/admin.module';
import { CurrenciesModule } from './modules/currencies/currencies.module';
import { CronModule } from './modules/cron/cron.module';
import { HealthModule } from './modules/health/health.module';
import { EventsModule } from './modules/events/events.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { MerchantsModule } from './modules/merchants/merchants.module';
import { OpenBankingModule } from './modules/open-banking/open-banking.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { CopilotModule } from './modules/copilot/copilot.module';
import { TreasuryModule } from './modules/treasury/treasury.module';
import { EscrowModule } from './modules/escrow/escrow.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { InvoicingModule } from './modules/invoicing/invoicing.module';
import { HedgingModule } from './modules/hedging/hedging.module';
import { GrantsModule } from './modules/grants/grants.module';
import { SettingsModule } from './modules/settings/settings.module';
import { FeesModule } from './modules/fees/fees.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { AuditModule } from './modules/audit/audit.module';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { MiddlewareConsumer, NestModule } from '@nestjs/common';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 120,
      },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    KycModule,
    LedgerModule,
    AccountsModule,
    BeneficiariesModule,
    TransfersModule,
    TransactionsModule,
    EmailModule,
    DepositsModule,
    WithdrawalsModule,
    SavingsModule,
    LoansModule,
    CardsModule,
    NotificationsModule,
    SupportModule,
    AdminModule,
    CurrenciesModule,
    CronModule,
    HealthModule,
    EventsModule,
    WebhooksModule,
    MerchantsModule,
    OpenBankingModule,
    ComplianceModule,
    CopilotModule,
    TreasuryModule,
    EscrowModule,
    PayrollModule,
    InvoicingModule,
    HedgingModule,
    GrantsModule,
    SettingsModule,
    FeesModule,
    PaymentsModule,
    ReferralsModule,
    AuditModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseEnvelopeInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}

