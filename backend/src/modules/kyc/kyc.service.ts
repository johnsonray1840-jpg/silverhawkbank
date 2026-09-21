import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { KycDocumentType, KycStatus, KycTier, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { ReviewKycDto } from './dto/review-kyc.dto';
import { QueryKycDto } from './dto/query-kyc.dto';
import { FileSecurityUtil } from '../../common/utils/file-security.util';
import { EmailService } from '../email/email.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  /**
   * Get authenticated customer's KYC verification status & document list
   */
  async getKycStatus(userId: string) {
    const kyc = await this.prisma.kycProfile.findUnique({
      where: { userId },
      include: {
        documents: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!kyc) {
      return {
        status: KycStatus.NOT_STARTED,
        tier: KycTier.TIER_1,
        reviewNotes: null,
        rejectionReason: null,
        requestedInfo: null,
        documents: [],
      };
    }

    return kyc;
  }

  /**
   * Validate uploaded document binary with magic numbers, file signature, size, and store securely
   */
  async uploadSecureDocument(
    userId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('No document file buffer provided for upload');
    }

    // 1. Strict Security Validation (Magic bytes, extension, MIME, executables, size bounds)
    const validation = FileSecurityUtil.validateFile(
      file.buffer,
      file.originalname,
      file.mimetype,
    );

    if (!validation.isValid) {
      this.logger.warn(`Rejected malicious or invalid file upload from user ${userId}: ${validation.error}`);
      throw new BadRequestException(validation.error);
    }

    // 2. Save into private non-public storage directory
    const storageRoot = path.join(process.cwd(), 'storage');
    const savedPath = await FileSecurityUtil.saveSecureDocument(
      storageRoot,
      userId,
      file.buffer,
      validation.sanitizedFilename!,
    );

    return {
      message: 'Document uploaded and secured successfully',
      filePath: savedPath,
      originalFilename: file.originalname,
      fileSize: validation.fileSize!,
      mimeType: validation.mimeType!,
      fileHash: validation.fileHash!,
      detectedType: validation.detectedType!,
    };
  }

  /**
   * Submit KYC identity and address documents for compliance verification
   */
  async submitKyc(userId: string, dto: SubmitKycDto) {
    if (!dto.documents || dto.documents.length === 0) {
      throw new BadRequestException('At least one identity document must be provided');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('User account not found');
    }

    const kycProfile = await this.prisma.kycProfile.upsert({
      where: { userId },
      update: {
        status: KycStatus.PENDING,
        submittedAt: new Date(),
        reviewNotes: null,
        rejectionReason: null,
        requestedInfo: null,
        tier: dto.targetTier || KycTier.TIER_2,
      },
      create: {
        userId,
        tier: dto.targetTier || KycTier.TIER_2,
        status: KycStatus.PENDING,
        submittedAt: new Date(),
      },
    });

    // Create document records in atomic transaction
    await this.prisma.$transaction(async (tx) => {
      for (const doc of dto.documents) {
        await tx.kycDocument.create({
          data: {
            kycProfileId: kycProfile.id,
            documentType: doc.documentType,
            documentNumber: doc.documentNumber || null,
            filePath: doc.filePath,
            originalFilename: doc.originalFilename || null,
            fileHash: doc.fileHash || null,
            fileSize: doc.fileSize,
            mimeType: doc.mimeType,
            expiryDate: doc.expiryDate ? new Date(doc.expiryDate) : null,
            status: KycStatus.PENDING,
          },
        });
      }

      // In-app Notification
      await tx.notification.create({
        data: {
          userId,
          title: 'KYC Documents Submitted',
          message: 'Your verification documents have been received and are currently under review by our compliance desk.',
          type: 'COMPLIANCE',
        },
      });
    });

    // Send confirmation email
    const recipientName = user.profile
      ? `${user.profile.firstName} ${user.profile.lastName}`
      : user.username;

    await this.emailService.sendKycStatusEmail({
      to: user.email,
      recipientName,
      status: 'PENDING',
      tier: dto.targetTier || 'TIER_2',
      notes: 'Your documents have been encrypted and submitted to the compliance verification desk.',
    });

    return {
      message: 'KYC documents submitted successfully. Verification is pending review.',
      kycProfileId: kycProfile.id,
      status: KycStatus.PENDING,
      tier: kycProfile.tier,
    };
  }

  /**
   * Retrieve secure document for viewing/download with strict ownership & role authorization
   */
  async getSecureDocument(
    documentId: string,
    requestingUser: { id: string; role?: string; permissions?: string[] },
  ) {
    const document = await this.prisma.kycDocument.findUnique({
      where: { id: documentId },
      include: {
        kycProfile: {
          include: { user: true },
        },
      },
    });

    if (!document) {
      throw new NotFoundException('KYC document not found');
    }

    const isOwner = document.kycProfile.userId === requestingUser.id;
    const isAdmin =
      requestingUser.role === 'ADMIN' ||
      requestingUser.role === 'SUPER_ADMIN' ||
      (requestingUser.permissions && requestingUser.permissions.includes('kyc.read'));

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('Access denied: You are not authorized to access this KYC document');
    }

    // Verify file exists on disk
    if (!fs.existsSync(document.filePath)) {
      throw new NotFoundException('The document binary could not be found on secure disk storage');
    }

    return {
      filePath: document.filePath,
      originalFilename: document.originalFilename || `kyc_doc_${document.id}${path.extname(document.filePath)}`,
      mimeType: document.mimeType,
      fileSize: document.fileSize,
      documentType: document.documentType,
    };
  }

  /**
   * Compliance Desk: Paginated list of KYC applications for review
   */
  async getKycApplications(queryDto: QueryKycDto) {
    const { page = 1, limit = 20, status, tier } = queryDto;
    const skip = (page - 1) * limit;

    const where: Prisma.KycProfileWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (tier) {
      where.tier = tier;
    }

    const [applications, total] = await Promise.all([
      this.prisma.kycProfile.findMany({
        where,
        skip,
        take: limit,
        orderBy: { submittedAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              phone: true,
              profile: true,
            },
          },
          documents: true,
        },
      }),
      this.prisma.kycProfile.count({ where }),
    ]);

    return {
      data: applications,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Compliance Desk: Approve, Reject, or Request Info for a KYC application
   */
  async reviewKyc(kycProfileId: string, dto: ReviewKycDto, reviewerId: string) {
    const kycProfile = await this.prisma.kycProfile.findUnique({
      where: { id: kycProfileId },
      include: {
        user: {
          include: { profile: true },
        },
        documents: true,
      },
    });

    if (!kycProfile) {
      throw new NotFoundException('KYC profile application not found');
    }

    const previousStatus = kycProfile.status;
    const assignedTier = dto.assignedTier || (dto.status === KycStatus.APPROVED ? KycTier.TIER_2 : kycProfile.tier);

    await this.prisma.$transaction(async (tx) => {
      // 1. Update KYC Profile
      await tx.kycProfile.update({
        where: { id: kycProfileId },
        data: {
          status: dto.status,
          tier: assignedTier,
          reviewerId,
          reviewNotes: dto.reviewNotes || null,
          rejectionReason: dto.rejectionReason || null,
          requestedInfo: dto.requestedInfo || null,
          reviewedAt: new Date(),
        },
      });

      // 2. Update all associated documents
      await tx.kycDocument.updateMany({
        where: { kycProfileId },
        data: {
          status: dto.status,
          rejectionReason: dto.rejectionReason || null,
        },
      });

      // 3. If approved, upgrade daily transaction limits on customer bank accounts
      if (dto.status === KycStatus.APPROVED) {
        let transferLimit = 25000.0000;
        let withdrawalLimit = 10000.0000;

        if (assignedTier === KycTier.TIER_2) {
          transferLimit = 50000.0000;
          withdrawalLimit = 20000.0000;
        } else if (assignedTier === KycTier.TIER_3) {
          transferLimit = 250000.0000;
          withdrawalLimit = 100000.0000;
        }

        await tx.bankAccount.updateMany({
          where: { userId: kycProfile.userId },
          data: {
            dailyTransferLimit: transferLimit,
            dailyWithdrawalLimit: withdrawalLimit,
          },
        });
      }

      // 4. Create Immutable Audit Log
      await tx.auditLog.create({
        data: {
          actorId: reviewerId,
          actorRole: 'COMPLIANCE_OFFICER',
          action: `KYC_REVIEW_${dto.status}`,
          resource: 'KycProfile',
          resourceId: kycProfileId,
          beforeState: { status: previousStatus, tier: kycProfile.tier },
          afterState: {
            status: dto.status,
            tier: assignedTier,
            notes: dto.reviewNotes || null,
            rejectionReason: dto.rejectionReason || null,
            requestedInfo: dto.requestedInfo || null,
          },
        },
      });

      // 5. In-App Notification
      const isApproved = dto.status === KycStatus.APPROVED;
      const isRejected = dto.status === KycStatus.REJECTED;

      let notifTitle = 'KYC Verification Update';
      let notifMsg = `Your KYC status has been updated to ${dto.status}.`;

      if (isApproved) {
        notifTitle = 'KYC Verification Approved 🎉';
        notifMsg = `Congratulations! Your account has been verified at ${assignedTier}. Your daily transfer and withdrawal limits have been upgraded.`;
      } else if (isRejected) {
        notifTitle = 'KYC Verification Unsuccessful';
        notifMsg = `Your KYC application could not be approved. Reason: ${dto.rejectionReason || 'Please resubmit valid documentation.'}`;
      } else if (dto.requestedInfo) {
        notifTitle = 'Additional KYC Information Requested ⚠️';
        notifMsg = `Our compliance desk requires additional details: ${dto.requestedInfo}`;
      }

      await tx.notification.create({
        data: {
          userId: kycProfile.userId,
          title: notifTitle,
          message: notifMsg,
          type: 'COMPLIANCE',
        },
      });
    });

    // 6. Send Email Notification
    const user = kycProfile.user;
    const recipientName = user.profile
      ? `${user.profile.firstName} ${user.profile.lastName}`
      : user.username;

    await this.emailService.sendKycStatusEmail({
      to: user.email,
      recipientName,
      status: dto.status,
      tier: assignedTier,
      notes: dto.reviewNotes,
      rejectionReason: dto.rejectionReason,
      requestedInfo: dto.requestedInfo,
    });

    return {
      message: `KYC application successfully reviewed (${dto.status})`,
      kycProfileId,
      status: dto.status,
      tier: assignedTier,
    };
  }
}
