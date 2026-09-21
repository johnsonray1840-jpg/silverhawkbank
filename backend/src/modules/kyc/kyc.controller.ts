import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { KycService } from './kyc.service';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { ReviewKycDto } from './dto/review-kyc.dto';
import { QueryKycDto } from './dto/query-kyc.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import * as fs from 'fs';

@ApiTags('KYC & Compliance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class KycController {
  constructor(private kycService: KycService) {}

  // ----------------------------------------------------------------------------
  // CUSTOMER KYC ENDPOINTS
  // ----------------------------------------------------------------------------

  @Get('kyc/status')
  @ApiOperation({ summary: 'Get current customer KYC verification status & documents' })
  async getKycStatus(@CurrentUser('id') userId: string) {
    return this.kycService.getKycStatus(userId);
  }

  @Post('kyc/upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOperation({ summary: 'Upload KYC identity document (validated by magic bytes, size, and non-public storage)' })
  async uploadKycDocument(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ) {
    return this.kycService.uploadSecureDocument(userId, file);
  }


  @Post('kyc/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit KYC identity and address documents for verification' })
  @ApiResponse({ status: 200, description: 'Documents submitted successfully for compliance review' })
  async submitKyc(
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitKycDto,
  ) {
    return this.kycService.submitKyc(userId, dto);
  }

  @Get('kyc/documents/:id/preview')
  @ApiOperation({ summary: 'Secure inline preview of a KYC document (owner or compliance officer only)' })
  async previewKycDocument(
    @Param('id') documentId: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const doc = await this.kycService.getSecureDocument(documentId, user);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${doc.originalFilename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const fileStream = fs.createReadStream(doc.filePath);
    fileStream.pipe(res);
  }

  @Get('kyc/documents/:id/download')
  @ApiOperation({ summary: 'Secure download of a KYC document (owner or compliance officer only)' })
  async downloadKycDocument(
    @Param('id') documentId: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const doc = await this.kycService.getSecureDocument(documentId, user);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${doc.originalFilename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const fileStream = fs.createReadStream(doc.filePath);
    fileStream.pipe(res);
  }

  // ----------------------------------------------------------------------------
  // COMPLIANCE & ADMIN REVIEW DESK
  // ----------------------------------------------------------------------------

  @Get('admin/kyc')
  @RequirePermissions('kyc.read')
  @ApiOperation({ summary: 'Compliance Desk: Get paginated list of KYC applications for review' })
  async getKycApplications(@Query() queryDto: QueryKycDto) {
    return this.kycService.getKycApplications(queryDto);
  }

  @Put('admin/kyc/:id/review')
  @RequirePermissions('kyc.approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Compliance Desk: Approve, reject, or request information on a KYC application' })
  async reviewKyc(
    @Param('id') kycProfileId: string,
    @Body() dto: ReviewKycDto,
    @CurrentUser('id') reviewerId: string,
  ) {
    return this.kycService.reviewKyc(kycProfileId, dto, reviewerId);
  }
}
