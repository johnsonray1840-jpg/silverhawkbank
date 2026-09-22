import { Module } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { StandingOrdersService } from './standing-orders.service';
import { CashlinksService } from './cashlinks.service';
import { TransfersController } from './transfers.controller';
import { LedgerModule } from '../ledger/ledger.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [LedgerModule, EmailModule, NotificationsModule],
  controllers: [TransfersController],
  providers: [TransfersService, StandingOrdersService, CashlinksService],
  exports: [TransfersService, StandingOrdersService, CashlinksService],
})
export class TransfersModule {}
