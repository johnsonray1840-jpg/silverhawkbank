import { Module } from '@nestjs/common';
import { OpenBankingService } from './open-banking.service';
import { OpenBankingController } from './open-banking.controller';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [LedgerModule],
  controllers: [OpenBankingController],
  providers: [OpenBankingService],
  exports: [OpenBankingService],
})
export class OpenBankingModule {}

