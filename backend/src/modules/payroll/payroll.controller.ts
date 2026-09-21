import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PayrollService } from './payroll.service';
import {
  CreatePayrollBatchDto,
  AddPayrollEmployeesDto,
} from './dto/payroll.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Corporate Bulk Payroll & Tax Withholding')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Post('batches')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create and validate a corporate bulk payroll batch run' })
  @ApiResponse({ status: 201, description: 'Payroll batch validated and ready for execution' })
  async createBatch(
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePayrollBatchDto,
  ) {
    return this.payrollService.createBatch(userId, dto);
  }

  @Get('batches')
  @ApiOperation({ summary: 'List all historical corporate payroll runs for authenticated employer' })
  @ApiResponse({ status: 200, description: 'List of payroll batches' })
  async listBatches(@CurrentUser('id') userId: string) {
    return this.payrollService.listBatches(userId);
  }

  @Get('batches/:id')
  @ApiOperation({ summary: 'Get detailed payroll batch summary and individual employee pay slips' })
  @ApiResponse({ status: 200, description: 'Batch details with gross-to-net withholdings' })
  async getBatch(
    @CurrentUser('id') userId: string,
    @Param('id') batchId: string,
  ) {
    return this.payrollService.getBatch(userId, batchId);
  }

  @Post('batches/:id/employees')
  @ApiOperation({ summary: 'Append additional employee pay items to a draft/validated batch' })
  @ApiResponse({ status: 200, description: 'Employee records added to batch' })
  async addEmployees(
    @CurrentUser('id') userId: string,
    @Param('id') batchId: string,
    @Body() dto: AddPayrollEmployeesDto,
  ) {
    return this.payrollService.addEmployees(userId, batchId, dto);
  }

  @Post('batches/:id/execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Atomically execute payroll disbursement across all employees via double-entry ledger' })
  @ApiResponse({ status: 200, description: 'Batch payroll disbursed successfully' })
  async executeBatch(
    @CurrentUser('id') userId: string,
    @Param('id') batchId: string,
  ) {
    return this.payrollService.executeBatch(userId, batchId);
  }

  @Get('batches/:id/export/iso20022')
  @Header('Content-Type', 'application/xml')
  @Header('Content-Disposition', 'attachment; filename="pain.001.001.09.xml"')
  @ApiOperation({ summary: 'Download SEPA ISO 20022 (pain.001.001.09) XML payment clearing file' })
  @ApiResponse({ status: 200, description: 'Standardized ISO 20022 XML payload' })
  async exportIso20022Xml(
    @CurrentUser('id') userId: string,
    @Param('id') batchId: string,
  ) {
    return this.payrollService.exportIso20022Xml(userId, batchId);
  }

  @Get('batches/:id/export/nacha')
  @Header('Content-Type', 'text/plain')
  @Header('Content-Disposition', 'attachment; filename="nacha_ach_batch.txt"')
  @ApiOperation({ summary: 'Download US NACHA ACH 94-character fixed-width batch file' })
  @ApiResponse({ status: 200, description: 'NACHA PPD ACH batch string' })
  async exportNachaFile(
    @CurrentUser('id') userId: string,
    @Param('id') batchId: string,
  ) {
    return this.payrollService.exportNachaFile(userId, batchId);
  }
}

