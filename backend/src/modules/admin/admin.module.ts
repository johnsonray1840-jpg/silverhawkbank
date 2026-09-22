import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { MakerCheckerService } from './maker-checker.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [AdminController],
  providers: [AdminService, MakerCheckerService],
  exports: [AdminService, MakerCheckerService],
})
export class AdminModule {}
