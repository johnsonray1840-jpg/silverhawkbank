import Decimal from 'decimal.js';

export enum PayrollBatchStatus {
  DRAFT = 'DRAFT',
  VALIDATED = 'VALIDATED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  PARTIAL_FAILURE = 'PARTIAL_FAILURE',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum PayItemType {
  SALARY = 'SALARY',
  BONUS = 'BONUS',
  COMMISSION = 'COMMISSION',
  OVERTIME = 'OVERTIME',
  EXPENSE_REIMBURSEMENT = 'EXPENSE_REIMBURSEMENT',
}

export interface EmployeePayItem {
  id: string;
  employeeName: string;
  employeeEmail?: string;
  accountNumber: string;
  bankCode?: string;
  routingNumber?: string;
  payType: PayItemType;
  grossAmount: string;
  taxDeduction: string;
  pensionDeduction: string;
  insuranceDeduction: string;
  totalDeductions: string;
  netAmount: string;
  status: 'PENDING' | 'PROCESSED' | 'FAILED';
  failureReason?: string;
  transactionReference?: string;
}

export interface PayrollBatchSummary {
  totalEmployees: number;
  grossTotal: string;
  totalTaxWithheld: string;
  totalPensionWithheld: string;
  totalInsuranceWithheld: string;
  totalDeductions: string;
  netDisbursementTotal: string;
  currency: string;
}

export class PayrollBatchUtil {
  /**
   * Calculate precise Gross-to-Net deductions for an individual pay line
   */
  static calculateItemDeductions(
    grossAmount: Decimal | string | number,
    taxRatePercent: number = 15,
    pensionRatePercent: number = 8,
    fixedInsuranceDeduction: number = 50,
  ): {
    gross: Decimal;
    tax: Decimal;
    pension: Decimal;
    insurance: Decimal;
    totalDeductions: Decimal;
    net: Decimal;
  } {
    const gross = new Decimal(grossAmount.toString());
    const tax = gross.times(taxRatePercent).dividedBy(100);
    const pension = gross.times(pensionRatePercent).dividedBy(100);
    const insurance = new Decimal(fixedInsuranceDeduction.toString());

    const totalDeductions = tax.plus(pension).plus(insurance);
    const net = gross.minus(totalDeductions);

    if (net.isNegative()) {
      throw new Error(`Total deductions (${totalDeductions.toFixed(2)}) exceed gross amount (${gross.toFixed(2)})`);
    }

    return { gross, tax, pension, insurance, totalDeductions, net };
  }

  /**
   * Validate aggregate batch mathematical parity: Total Gross == Total Net + Total Deductions
   */
  static validateBatchParity(
    grossTotal: Decimal | string | number,
    totalDeductions: Decimal | string | number,
    netTotal: Decimal | string | number,
  ): boolean {
    const gross = new Decimal(grossTotal.toString());
    const deductions = new Decimal(totalDeductions.toString());
    const net = new Decimal(netTotal.toString());

    const sum = net.plus(deductions);
    return gross.minus(sum).abs().lessThan(0.0001);
  }

  /**
   * Generate SEPA ISO 20022 Customer Credit Transfer Initiation (pain.001.001.09) XML
   */
  static generateIso20022Pain001(
    messageId: string,
    initiatingParty: string,
    debtorAccount: string,
    debtorBic: string,
    currency: string,
    items: EmployeePayItem[],
  ): string {
    const creationDate = new Date().toISOString();
    const numberOfTransactions = items.length;
    const controlSum = items
      .reduce((sum, item) => sum.plus(new Decimal(item.netAmount)), new Decimal(0))
      .toFixed(2);

    let recordsXml = '';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      recordsXml += `
      <CdtTrfTxInf>
        <PmtId>
          <EndToEndId>${item.id}</EndToEndId>
        </PmtId>
        <Amt>
          <InstdAmt Ccy="${currency}">${parseFloat(item.netAmount).toFixed(2)}</InstdAmt>
        </Amt>
        <CdtrAgt>
          <FinInstnId>
            <BICFI>${item.routingNumber || 'REMIVUS33XXX'}</BICFI>
          </FinInstnId>
        </CdtrAgt>
        <Cdtr>
          <Nm>${item.employeeName.replace(/&/g, '&amp;')}</Nm>
        </Cdtr>
        <CdtrAcct>
          <Id>
            <Othr>
              <Id>${item.accountNumber}</Id>
            </Othr>
          </Id>
        </CdtrAcct>
        <RmtInf>
          <Ustrd>Payroll Disbursement ${item.payType} - ${item.employeeName}</Ustrd>
        </RmtInf>
      </CdtTrfTxInf>`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${messageId}</MsgId>
      <CreDtTm>${creationDate}</CreDtTm>
      <NbOfTxs>${numberOfTransactions}</NbOfTxs>
      <CtrlSum>${controlSum}</CtrlSum>
      <InitgPty>
        <Nm>${initiatingParty.replace(/&/g, '&amp;')}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>PMT-${messageId}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>${numberOfTransactions}</NbOfTxs>
      <CtrlSum>${controlSum}</CtrlSum>
      <Dbtr>
        <Nm>${initiatingParty.replace(/&/g, '&amp;')}</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <Othr>
            <Id>${debtorAccount}</Id>
          </Othr>
        </Id>
      </DbtrAcct>
      <DbtrAgt>
        <FinInstnId>
          <BICFI>${debtorBic}</BICFI>
        </FinInstnId>
      </DbtrAgt>
      ${recordsXml}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`.trim();
  }

  /**
   * Generate US NACHA ACH 94-Character Fixed-Width Batch File
   */
  static generateNachaAch(
    companyName: string,
    companyId: string,
    originRouting: string,
    destinationRouting: string,
    items: EmployeePayItem[],
  ): string {
    const padR = (str: string, len: number) => str.padEnd(len, ' ').substring(0, len);
    const padL = (str: string, len: number, char = '0') => str.padStart(len, char).substring(0, len);

    const now = new Date();
    const fileDate = `${now.getFullYear().toString().slice(-2)}${padL((now.getMonth() + 1).toString(), 2)}${padL(now.getDate().toString(), 2)}`;
    const fileTime = `${padL(now.getHours().toString(), 2)}${padL(now.getMinutes().toString(), 2)}`;

    // 1. File Header Record (Type 1) - 94 chars
    const fileHeader = padR(`101 ${padL(destinationRouting, 9)}${padL(originRouting, 10)}${fileDate}${fileTime}A094101${padR('SILVERHAWK CLEARING', 23)}${padR(companyName, 23)}00000001`, 94);

    // 2. Batch Header Record (Type 5 - PPD Payroll) - 94 chars
    const batchHeader = padR(`5200${padR(companyName, 16)}${padR('PAYROLL', 20)}${padR(companyId, 10)}PPD${padR('PAYROLL', 10)}${fileDate}${fileDate}   1${padL(originRouting.substring(0, 8), 8)}0000001`, 94);

    // 3. Entry Detail Records (Type 6) - 94 chars each
    const entryRecords: string[] = [];
    let totalDebitCents = 0;
    let totalCreditCents = 0;
    let entryHashSum = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const cents = Math.round(parseFloat(item.netAmount) * 100);
      totalCreditCents += cents;

      const routing8 = (item.routingNumber || '02100002').substring(0, 8);
      const checkDigit = (item.routingNumber || '021000021').slice(-1);
      entryHashSum += parseInt(routing8, 10) || 0;

      const traceNumber = `${padL(originRouting.substring(0, 8), 8)}${padL((i + 1).toString(), 7)}`;

      // Transaction Code 22 = Automated Deposit (Checking Credit)
      const record = padR(`622${padL(routing8, 8)}${checkDigit}${padR(item.accountNumber, 17)}${padL(cents.toString(), 10)}${padR(item.id, 15)}${padR(item.employeeName, 22)}  0${traceNumber}`, 94);
      entryRecords.push(record);
    }

    // 4. Batch Control Record (Type 8) - 94 chars
    const entryHash = padL(entryHashSum.toString().slice(-10), 10);
    const batchControl = padR(`8200${padL(items.length.toString(), 6)}${entryHash}${padL(totalDebitCents.toString(), 12)}${padL(totalCreditCents.toString(), 12)}${padR(companyId, 10)}${padR('', 25)}${padL(originRouting.substring(0, 8), 8)}0000001`, 94);

    // 5. File Control Record (Type 9) - 94 chars
    const totalLines = 2 + items.length + 2;
    const blockCount = Math.ceil(totalLines / 10);
    const fileControl = padR(`9000001${padL(blockCount.toString(), 6)}${padL(items.length.toString(), 8)}${entryHash}${padL(totalDebitCents.toString(), 12)}${padL(totalCreditCents.toString(), 12)}${padR('', 39)}`, 94);

    return [fileHeader, batchHeader, ...entryRecords, batchControl, fileControl].join('\n');
  }
}
