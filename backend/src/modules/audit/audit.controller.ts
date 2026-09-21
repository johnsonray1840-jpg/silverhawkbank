import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { ExportAuditLogsDto, QueryAuditLogsDto } from './dto/audit.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Audit Logs & Compliance Trail')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Query and multi-filter immutable system audit logs' })
  @ApiResponse({ status: 200, description: 'Paginated audit logs list' })
  async queryAuditLogs(@Query() query: QueryAuditLogsDto) {
    return this.auditService.queryAuditLogs(query);
  }

  @Get('verify-integrity')
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Verify cryptographic Merkle hash chain integrity of audit logs' })
  @ApiResponse({ status: 200, description: 'Cryptographic verification report' })
  async verifyChainIntegrity() {
    return this.auditService.verifyChainIntegrity();
  }

  @Get('export')
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Export audit trail records in CSV or PDF format' })
  @ApiResponse({ status: 200, description: 'Exported audit document' })
  async exportAuditLogs(@Query() query: ExportAuditLogsDto) {
    return this.auditService.exportAuditLogs(query);
  }

  @Get('logs/:id')
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Inspect single audit log entry with full state diff' })
  @ApiResponse({ status: 200, description: 'Detailed audit log record' })
  async getAuditLogById(@Param('id') id: string) {
    return this.auditService.getAuditLogById(id);
  }
}

