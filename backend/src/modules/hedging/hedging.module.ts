import { Module } from '@nestjs/common';
import { HedgingService } from './hedging.service';
import { HedgingController } from './hedging.controller';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HedgingController],
  providers: [HedgingService],
  exports: [HedgingService],
})
export class HedgingModule {}

