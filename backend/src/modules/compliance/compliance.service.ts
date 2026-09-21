import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { SanctionsScreenerUtil, ScreeningResult } from '../../common/utils/sanctions-screener.util';
import {
  AlertSeverity,
  AlertStatus,
  AlertType,
  CreateSarDto,
  ResolveAlertDto,
  ScreenEntityDto,
} from './dto/compliance.dto';
import Decimal from 'decimal.js';
import * as crypto from 'crypto';

export interface ComplianceAlertRecord {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  subjectName: string;
  subjectAccountId?: string;
  transactionReference?: string;
  amount?: string;
  currency?: string;
  details: string;
  matchScore?: number;
  resolutionNotes?: string;
  resolvedBy?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SuspiciousActivityReportRecord {
  id: string;
  sarReference: string;
  alertId: string;
  suspectName: string;
  suspectAccountId: string;
  amountInvolved: string;
  currency: string;
  narrative: string;
  suspiciousActivityCodes: string[];
  finCenPayload: any;
  filedBy: string;
  filedAt: Date;
}

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);
  private static alertsStore: Map<string, ComplianceAlertRecord> = new Map();
  private static sarsStore: Map<string, SuspiciousActivityReportRecord> = new Map();

  constructor(private prisma: PrismaService) {
    this.seedInitialComplianceAlerts();
  }

  private seedInitialComplianceAlerts() {
    if (ComplianceService.alertsStore.size === 0) {
      const alertId = 'ALT-889102';
      ComplianceService.alertsStore.set(alertId, {
        id: alertId,
        type: AlertType.CTR_THRESHOLD,
        severity: AlertSeverity.MEDIUM,
        status: AlertStatus.OPEN,
        subjectName: 'Apex International Holdings',
        amount: '25000.0000',
        currency: 'USD',
        details: 'Large incoming wire exceeding statutory $10,000 threshold for automatic CTR filing',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  /**
   * Screen name against global watchlists
   */
  async screenEntity(dto: ScreenEntityDto): Promise<ScreeningResult> {
    const result = SanctionsScreenerUtil.screenName(dto.name, dto.threshold || 0.85);

    if (result.isHit) {
      const alertId = `ALT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const alert: ComplianceAlertRecord = {
        id: alertId,
        type: AlertType.SANCTIONS_HIT,
        severity: result.maxScore >= 0.95 ? AlertSeverity.CRITICAL : AlertSeverity.HIGH,
        status: AlertStatus.OPEN,
        subjectName: dto.name,
        details: `Fuzzy watchlist match against ${result.matches[0].listSource} (${result.matches[0].matchedName}) with ${(result.maxScore * 100).toFixed(1)}% confidence score`,
        matchScore: result.maxScore,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      ComplianceService.alertsStore.set(alertId, alert);
      this.logger.warn(`Sanctions hit detected for "${dto.name}" [Alert ID: ${alertId}]`);
    }

    return result;
  }

  /**
   * List all compliance alerts
   */
  async getAlerts(status?: AlertStatus): Promise<ComplianceAlertRecord[]> {
    return Array.from(ComplianceService.alertsStore.values())
      .filter((a) => !status || a.status === status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get single alert
   */
  async getAlertById(alertId: string): Promise<ComplianceAlertRecord> {
    const alert = ComplianceService.alertsStore.get(alertId);
    if (!alert) throw new NotFoundException(`Compliance alert ${alertId} not found`);
    return alert;
  }

  /**
   * Resolve compliance alert
   */
  async resolveAlert(officerUserId: string, alertId: string, dto: ResolveAlertDto): Promise<ComplianceAlertRecord> {
    const alert = await this.getAlertById(alertId);

    alert.status = dto.status;
    alert.resolutionNotes = dto.resolutionNotes;
    alert.resolvedBy = officerUserId;
    alert.resolvedAt = new Date();
    alert.updatedAt = new Date();

    ComplianceService.alertsStore.set(alertId, alert);
    this.logger.log(`Compliance alert ${alertId} resolved to ${dto.status} by officer ${officerUserId}`);

    return alert;
  }

  /**
   * File formal Suspicious Activity Report (SAR) dossier
   */
  async fileSar(officerUserId: string, dto: CreateSarDto): Promise<SuspiciousActivityReportRecord> {
    const alert = await this.getAlertById(dto.alertId);

    const sarId = `SAR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const sarRef = `FINCEN-BSA-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // FinCEN BSA XML/JSON compliant payload
    const finCenPayload = {
      FilingInstitution: {
        Name: 'Silverhawk Digital Bank Inc.',
        EIN: 'XX-XXXXXXX',
        PrimaryFederalRegulator: 'OCC / FinCEN',
      },
      SuspiciousActivity: {
        ReportDate: new Date().toISOString(),
        TotalAmount: dto.amountInvolved,
        Currency: dto.currency,
        ActivityCodes: dto.suspiciousActivityCodes || ['201', '302'], // Fraud / Structuring
        NarrativeSummary: dto.narrative,
      },
      SuspectSubject: {
        Name: dto.suspectName,
        AccountNumber: dto.suspectAccountId,
      },
    };

    const sarRecord: SuspiciousActivityReportRecord = {
      id: sarId,
      sarReference: sarRef,
      alertId: dto.alertId,
      suspectName: dto.suspectName,
      suspectAccountId: dto.suspectAccountId,
      amountInvolved: dto.amountInvolved,
      currency: dto.currency,
      narrative: dto.narrative,
      suspiciousActivityCodes: dto.suspiciousActivityCodes || ['STRUCTURING', 'SANCTIONS_EVASION'],
      finCenPayload,
      filedBy: officerUserId,
      filedAt: new Date(),
    };

    ComplianceService.sarsStore.set(sarId, sarRecord);

    // Update alert status
    alert.status = AlertStatus.ESCALATED_TO_SAR;
    alert.resolutionNotes = `Escalated to regulatory SAR filing (${sarRef})`;
    alert.updatedAt = new Date();
    ComplianceService.alertsStore.set(alert.id, alert);

    this.logger.log(`SAR ${sarRef} filed for suspect "${dto.suspectName}" by officer ${officerUserId}`);

    return sarRecord;
  }

  /**
   * List SAR filings
   */
  async getSars(): Promise<SuspiciousActivityReportRecord[]> {
    return Array.from(ComplianceService.sarsStore.values()).sort(
      (a, b) => b.filedAt.getTime() - a.filedAt.getTime(),
    );
  }
}

