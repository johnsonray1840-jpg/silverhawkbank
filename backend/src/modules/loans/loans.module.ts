import { Module } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { LedgerModule } from '../ledger/ledger.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [LedgerModule, EmailModule],
  controllers: [LoansController],
  providers: [LoansService],
  exports: [LoansService],
})
export class LoansModule {}
