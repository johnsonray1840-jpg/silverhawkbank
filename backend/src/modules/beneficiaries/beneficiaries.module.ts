import { Module, forwardRef } from '@nestjs/common';
import { BeneficiariesService } from './beneficiaries.service';
import { BeneficiariesController } from './beneficiaries.controller';
import { TransfersModule } from '../transfers/transfers.module';

@Module({
  imports: [forwardRef(() => TransfersModule)],
  controllers: [BeneficiariesController],
  providers: [BeneficiariesService],
  exports: [BeneficiariesService],
})
export class BeneficiariesModule {}
