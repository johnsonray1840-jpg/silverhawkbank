import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BeneficiariesService } from './beneficiaries.service';
import { CreateBeneficiaryDto } from './dto/create-beneficiary.dto';
import { UpdateBeneficiaryDto } from './dto/update-beneficiary.dto';
import { QueryBeneficiariesDto } from './dto/query-beneficiaries.dto';
import { TransferToBeneficiaryDto } from './dto/transfer-beneficiary.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Beneficiaries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('beneficiaries')
export class BeneficiariesController {
  constructor(private beneficiariesService: BeneficiariesService) {}

  @Get('resolve-internal/:accountNumber')
  @ApiOperation({ summary: 'Resolve an internal Silverhawk account number to recipient name' })
  @ApiResponse({ status: 200, description: 'Resolved recipient account details' })
  async resolveInternalAccount(@Param('accountNumber') accountNumber: string) {
    return this.beneficiariesService.resolveInternalAccount(accountNumber);
  }

  @Post('verify')
  @ApiOperation({ summary: 'Verify recipient account number and banking details' })
  async verifyBeneficiary(@Body() dto: { accountNumber: string; bankName?: string; routingNumber?: string }) {
    return this.beneficiariesService.verifyBeneficiary(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get list of saved transfer beneficiaries for authenticated customer' })
  async getBeneficiaries(
    @CurrentUser('id') userId: string,
    @Query() queryDto: QueryBeneficiariesDto,
  ) {
    return this.beneficiariesService.getBeneficiaries(userId, queryDto);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Save a new beneficiary to customer address book' })
  async createBeneficiary(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateBeneficiaryDto,
  ) {
    return this.beneficiariesService.createBeneficiary(userId, dto);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Edit an existing saved beneficiary' })
  async updateBeneficiary(
    @CurrentUser('id') userId: string,
    @Param('id') beneficiaryId: string,
    @Body() dto: UpdateBeneficiaryDto,
  ) {
    return this.beneficiariesService.updateBeneficiary(userId, beneficiaryId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a beneficiary from customer address book' })
  async deleteBeneficiary(
    @CurrentUser('id') userId: string,
    @Param('id') beneficiaryId: string,
  ) {
    return this.beneficiariesService.deleteBeneficiary(userId, beneficiaryId);
  }

  @Post(':id/transfer')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Execute a direct transfer to a saved beneficiary' })
  async transferToBeneficiary(
    @CurrentUser('id') userId: string,
    @Param('id') beneficiaryId: string,
    @Body() dto: TransferToBeneficiaryDto,
  ) {
    return this.beneficiariesService.transferToBeneficiary(userId, beneficiaryId, dto);
  }
}
