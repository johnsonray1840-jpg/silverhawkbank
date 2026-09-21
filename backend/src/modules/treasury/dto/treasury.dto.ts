import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Max,
} from 'class-validator';
import { TreasuryRole } from '../../../common/utils/treasury-multisig.util';

export class CreateSharedVaultDto {
  @ApiProperty({ example: 'Acme Corp Operating Treasury', description: 'Name of the shared collaborative treasury vault' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Primary payroll and vendor disbursement multi-sig vault', description: 'Description/purpose of the vault' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 'USD', description: '3-letter ISO-4217 currency code' })
  @IsString()
  @IsNotEmpty()
  currencyCode: string;

  @ApiProperty({ example: 2, description: 'M-of-N: Required number of approver signatures before executing transfers', default: 2 })
  @IsNumber()
  @Min(1)
  @Max(10)
  requiredApprovals: number;

  @ApiPropertyOptional({ example: 500, description: 'Threshold amount below which transfers execute instantly without approval', default: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  instantSpendLimit?: number;
}

export class AddVaultMemberDto {
  @ApiProperty({ example: 'usr_c0a8012300000000', description: 'ID of the user to invite/add to the vault' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ enum: TreasuryRole, example: TreasuryRole.APPROVER, description: 'Assigned governance role in this vault' })
  @IsEnum(TreasuryRole)
  role: TreasuryRole;
}

export class InitiateTreasuryTransferDto {
  @ApiProperty({ example: '1098765432', description: 'Destination bank account number' })
  @IsString()
  @IsNotEmpty()
  destinationAccountNumber: string;

  @ApiPropertyOptional({ example: 'SILVERHAWK', description: 'Destination bank sorting code' })
  @IsString()
  @IsOptional()
  destinationBankCode?: string;

  @ApiProperty({ example: 4500.0, description: 'Amount to transfer' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ example: 'Q3 Vendor Cloud Infrastructure Invoice Payment', description: 'Transfer memo/purpose' })
  @IsString()
  @IsNotEmpty()
  memo: string;
}

export class ApproveTransferDto {
  @ApiPropertyOptional({ example: 'Verified invoice with procurement team and approved.', description: 'Signer review notes or justification' })
  @IsString()
  @IsOptional()
  comment?: string;
}

export class RejectTransferDto {
  @ApiProperty({ example: 'Duplicate invoice detected or incorrect beneficiary account.', description: 'Reason for rejecting transfer' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class ConfigureSweepRuleDto {
  @ApiProperty({ example: 5000.0, description: 'Minimum target balance buffer (replenish if below)' })
  @IsNumber()
  @Min(0)
  targetMinBalance: number;

  @ApiProperty({ example: 25000.0, description: 'Maximum target balance ceiling (sweep surplus if above)' })
  @IsNumber()
  @Min(0)
  targetMaxBalance: number;

  @ApiProperty({ example: 'acc_sav_001928374', description: 'Destination reserve vault/savings account ID for excess sweeps' })
  @IsString()
  @IsNotEmpty()
  destinationAccountId: string;
}

