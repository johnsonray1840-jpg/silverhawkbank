import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  FeeCategory,
  FeeEngineUtil,
} from '../../common/utils/fee-engine.util';
import {
  CalculateFeeQuoteDto,
  ConfigureFeeRuleDto,
} from './dto/fees.dto';

@Injectable()
export class FeesService {
  private readonly logger = new Logger(FeesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculate transparent fee breakdown server-side
   */
  async calculateFeeQuote(dto: CalculateFeeQuoteDto) {
    try {
      const validatedCategory = FeeEngineUtil.validateFeeCategory(dto.category);
      const currency = (dto.currencyCode || 'USD').toUpperCase();

      const result = FeeEngineUtil.calculateFee(
        validatedCategory,
        dto.amount,
        currency,
      );

      return {
        success: true,
        currency,
        ...result,
      };
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  /**
   * Retrieve full catalog of bank tariffs and fee schedules
   */
  async getFeeTariffCatalog() {
    const catalog = Object.values(FeeCategory).map((cat) => {
      const rule = FeeEngineUtil.DEFAULT_RULES[cat];
      return {
        category: cat,
        name: cat.replace(/_/g, ' '),
        flatFee: rule.flat,
        percentageFee: rule.pct + '%',
        minFee: rule.min,
        maxFee: rule.max || null,
        description: `Standard ${cat.toLowerCase().replace(/_/g, ' ')} tariff`,
      };
    });

    return {
      institution: 'Silverhawk Commercial & Private Bank',
      feeTransparencyStandard: 'ISO 20022 / Consumer Financial Protection Aligned',
      count: catalog.length,
      tariffs: catalog,
    };
  }

  /**
   * Admin: Configure or override commercial fee rule
   */
  async configureFeeRule(dto: ConfigureFeeRuleDto, adminId: string) {
    const validatedCategory = FeeEngineUtil.validateFeeCategory(dto.category);
    this.logger.log(`Admin ${adminId} updated fee rule for ${validatedCategory} in ${dto.currencyCode}`);

    // Create Audit Log
    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'UPDATE_FEE_STRUCTURE',
        resource: 'FeeStructure',
        resourceId: validatedCategory,
        afterState: {
          category: validatedCategory,
          currency: dto.currencyCode,
          flatFee: dto.flatFee,
          percentageFee: dto.percentageFee,
          minFee: dto.minFee || null,
          maxFee: dto.maxFee || null,
        },
      },
    });

    return {
      message: `Fee schedule for ${validatedCategory} updated successfully`,
      rule: {
        category: validatedCategory,
        currencyCode: dto.currencyCode,
        flatFee: dto.flatFee,
        percentageFee: dto.percentageFee,
        minFee: dto.minFee || '0.0000',
        maxFee: dto.maxFee || null,
      },
    };
  }
}

