import { Module } from '@nestjs/common';
import { CardsService } from './cards.service';
import { CardsController } from './cards.controller';
import { LedgerModule } from '../ledger/ledger.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [LedgerModule, EmailModule],
  controllers: [CardsController],
  providers: [CardsService],
  exports: [CardsService],
})
export class CardsModule {}
