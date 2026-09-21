import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PayItemType } from '../../../common/utils/payroll-batch.util';

export class EmployeePayItemDto {
  @ApiProperty({ example: 'Alice Morgan', description: 'Full employee or contractor name' })
  @IsString()
  @IsNotEmpty()
  employeeName: string;

  @ApiPropertyOptional({ example: 'alice.morgan@enterprise.com', description: 'Employee notification email' })
  @IsString()
  @IsOptional()
  employeeEmail?: string;

  @ApiProperty({ example: '1092837461', description: 'Employee destination bank account number' })
  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @ApiPropertyOptional({ example: 'REMIVUS33XXX', description: 'Destination Bank SWIFT/BIC Code' })
  @IsString()
  @IsOptional()
  bankCode?: string;

  @ApiPropertyOptional({ example: '021000021', description: 'Destination ABA Routing Number' })
  @IsString()
  @IsOptional()
  routingNumber?: string;

  @ApiProperty({ enum: PayItemType, example: PayItemType.SALARY, description: 'Pay item category' })
  @IsEnum(PayItemType)
  payType: PayItemType;

  @ApiProperty({ example: 8500.0, description: 'Gross pay amount before statutory withholdings' })
  @IsNumber()
  @Min(0.01)
  grossAmount: number;

  @ApiPropertyOptional({ example: 15, description: 'Percentage rate for income tax withholding', default: 15 })
  @IsNumber()
  @IsOptional()
  taxRatePercent?: number;

  @ApiPropertyOptional({ example: 8, description: 'Percentage rate for pension/401(k) deduction', default: 8 })
  @IsNumber()
  @IsOptional()
  pensionRatePercent?: number;

  @ApiPropertyOptional({ example: 50, description: 'Fixed health insurance benefit deduction', default: 50 })
  @IsNumber()
  @IsOptional()
  healthInsuranceDeduction?: number;
}

export class CreatePayrollBatchDto {
  @ApiProperty({ example: 'September 2026 Global Engineering & Operations Payroll', description: 'Title or description of the payroll run' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'USD', description: '3-letter ISO-4217 currency code' })
  @IsString()
  @IsNotEmpty()
  currencyCode: string;

  @ApiProperty({
    type: [EmployeePayItemDto],
    description: 'List of employee pay records',
    example: [
      {
        employeeName: 'Alice Morgan',
        accountNumber: '1092837461',
        payType: 'SALARY',
        grossAmount: 8500.0,
      },
      {
        employeeName: 'David Zhang',
        accountNumber: '1092837462',
        payType: 'SALARY',
        grossAmount: 9200.0,
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmployeePayItemDto)
  employees: EmployeePayItemDto[];
}

export class AddPayrollEmployeesDto {
  @ApiProperty({
    type: [EmployeePayItemDto],
    description: 'List of additional employee pay records to append to batch',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmployeePayItemDto)
  employees: EmployeePayItemDto[];
}

