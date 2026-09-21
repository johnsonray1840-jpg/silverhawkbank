import { Module } from '@nestjs/common';
import { CronService } from './cron.service';
import { TransfersModule } from '../transfers/transfers.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TransfersModule, NotificationsModule],
  providers: [CronService],
  exports: [CronService],
})
export class CronModule {}
