import { Module } from '@nestjs/common';
import { SavingsService } from './savings.service';
import { SavingsController } from './savings.controller';
import { LedgerModule } from '../ledger/ledger.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [LedgerModule, EmailModule],
  controllers: [SavingsController],
  providers: [SavingsService],
  exports: [SavingsService],
})
export class SavingsModule {}
