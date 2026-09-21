import Decimal from 'decimal.js';
import * as crypto from 'crypto';

export interface StatementTransactionItem {
  id: string;
  reference: string;
  date: Date | string;
  valueDate?: Date | string;
  description: string;
  amount: number | string;
  type: 'CREDIT' | 'DEBIT';
  currency: string;
  runningBalance?: number | string;
}

export interface StatementPeriodSummary {
  accountNumber: string;
  accountName: string;
  currency: string;
  fromPeriod: Date | string;
  toPeriod: Date | string;
  openingBalance: number | string;
  closingBalance: number | string;
  totalCredits: number | string;
  totalDebits: number | string;
  transactionsCount: number;
  verificationHash: string;
}

export interface GenerateStatementOptions {
  bankName?: string;
  bankAddress?: string;
  accountHolder: string;
  accountNumber: string;
  accountType: string;
  currency: string;
  startDate?: Date | string;
  endDate?: Date | string;
  openingBalance: string | number;
  closingBalance: string | number;
  totalDebits: string | number;
  totalCredits: string | number;
  transactions: StatementTransactionItem[];
}

export interface Tax1099IntSummary {
  taxYear: number;
  recipientName: string;
  recipientTaxIdMasked: string; // e.g. ***-**-6789
  payerName: string;
  payerTin: string;
  box1InterestIncome: string;
  box2EarlyWithdrawalPenalty: string;
  box4FederalTaxWithheld: string;
  totalEligibleSavingsAccounts: number;
  statementReference: string;
}

export class StatementGeneratorUtil {
  /**
   * Generates a standard formatted binary PDF bank statement
   */
  public static generatePdfStatement(options: GenerateStatementOptions): Buffer {
    const esc = (s: string | undefined | null) => (s || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const fromStr = options.startDate ? new Date(options.startDate).toISOString().slice(0, 10) : 'Account Inception';
    const toStr = options.endDate ? new Date(options.endDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const genDate = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

    const rawDataToSign = `${options.accountNumber}|${fromStr}|${toStr}|${options.openingBalance}|${options.closingBalance}|${options.transactions.length}`;
    const verificationHash = crypto.createHash('sha256').update(rawDataToSign).digest('hex').toUpperCase();

    const streamCommands: string[] = [];

    // Header Navy Bar
    streamCommands.push('q');
    streamCommands.push('0.06 0.09 0.16 rg');
    streamCommands.push('0 750 595.28 92 re f');
    streamCommands.push('Q');

    // Header Text
    streamCommands.push('BT');
    streamCommands.push('1 1 1 rg');
    streamCommands.push('/F2 18 Tf');
    streamCommands.push('40 795 Td');
    streamCommands.push(`(${esc(options.bankName || 'SILVERHAWK DIGITAL FEDERAL BANK')}) Tj`);
    streamCommands.push('ET');

    streamCommands.push('BT');
    streamCommands.push('0.8 0.85 0.95 rg');
    streamCommands.push('/F1 10 Tf');
    streamCommands.push('40 775 Td');
    streamCommands.push(`(OFFICIAL COMMERCIAL ACCOUNT STATEMENT | ${esc(options.currency)} PORTFOLIO) Tj`);
    streamCommands.push('ET');

    streamCommands.push('BT');
    streamCommands.push('0.7 0.75 0.85 rg');
    streamCommands.push('/F1 8 Tf');
    streamCommands.push('40 760 Td');
    streamCommands.push(`(Generated: ${esc(genDate)} | Verification: SHA-256) Tj`);
    streamCommands.push('ET');

    // Summary Box
    streamCommands.push('q');
    streamCommands.push('0.95 0.96 0.98 rg');
    streamCommands.push('40 640 515.28 95 re f');
    streamCommands.push('0.85 0.88 0.92 RG 1 w');
    streamCommands.push('40 640 515.28 95 re S');
    streamCommands.push('Q');

    streamCommands.push('BT');
    streamCommands.push('0.1 0.15 0.25 rg');
    streamCommands.push('/F2 10 Tf');
    streamCommands.push('55 715 Td');
    streamCommands.push(`(Account Holder: ${esc(options.accountHolder)}) Tj`);
    streamCommands.push('0 -15 Td');
    streamCommands.push('/F1 9 Tf');
    streamCommands.push(`(Account Number: ${esc(options.accountNumber)}   |   Type: ${esc(options.accountType)}   |   Currency: ${esc(options.currency)}) Tj`);
    streamCommands.push('0 -15 Td');
    streamCommands.push(`(Statement Period: ${esc(fromStr)} to ${esc(toStr)}) Tj`);
    streamCommands.push('0 -18 Td');
    streamCommands.push('/F2 9 Tf');
    streamCommands.push(`(Opening Bal: ${esc(options.currency)} ${esc(new Decimal(options.openingBalance).toFixed(2))}   |   Credits: +${esc(new Decimal(options.totalCredits).toFixed(2))}   |   Debits: -${esc(new Decimal(options.totalDebits).toFixed(2))}   |   Closing Bal: ${esc(options.currency)} ${esc(new Decimal(options.closingBalance).toFixed(2))}) Tj`);
    streamCommands.push('ET');

    // Table Header
    streamCommands.push('q');
    streamCommands.push('0.15 0.23 0.36 rg');
    streamCommands.push('40 605 515.28 20 re f');
    streamCommands.push('Q');

    streamCommands.push('BT');
    streamCommands.push('1 1 1 rg');
    streamCommands.push('/F2 8 Tf');
    streamCommands.push('50 611 Td');
    streamCommands.push('(Date) Tj');
    streamCommands.push('65 0 Td');
    streamCommands.push('(Reference) Tj');
    streamCommands.push('90 0 Td');
    streamCommands.push('(Type) Tj');
    streamCommands.push('95 0 Td');
    streamCommands.push('(Narrative / Description) Tj');
    streamCommands.push('160 0 Td');
    streamCommands.push('(Debit) Tj');
    streamCommands.push('50 0 Td');
    streamCommands.push('(Credit) Tj');
    streamCommands.push('ET');

    // Table Rows
    let currentY = 590;
    const maxTxs = Math.min(options.transactions.length, 30);
    for (let i = 0; i < maxTxs; i++) {
      const tx = options.transactions[i];
      const rowBg = i % 2 === 0 ? '1 1 1' : '0.97 0.98 0.99';
      streamCommands.push('q');
      streamCommands.push(`${rowBg} rg`);
      streamCommands.push(`40 ${currentY - 4} 515.28 16 re f`);
      streamCommands.push('0.9 0.92 0.95 RG 0.5 w');
      streamCommands.push(`40 ${currentY - 4} 515.28 16 re S`);
      streamCommands.push('Q');

      const txDateStr = new Date(tx.date).toISOString().slice(0, 10);
      const isDebit = tx.type === 'DEBIT';
      const debitStr = isDebit ? `${new Decimal(tx.amount).toFixed(2)}` : '-';
      const creditStr = !isDebit ? `${new Decimal(tx.amount).toFixed(2)}` : '-';
      const descShort = tx.description.slice(0, 32);

      streamCommands.push('BT');
      streamCommands.push('0.2 0.25 0.35 rg');
      streamCommands.push('/F1 7 Tf');
      streamCommands.push(`50 ${currentY} Td`);
      streamCommands.push(`(${esc(txDateStr)}) Tj`);
      streamCommands.push(`65 0 Td`);
      streamCommands.push(`(${esc(tx.reference.slice(-10))}) Tj`);
      streamCommands.push(`90 0 Td`);
      streamCommands.push(`(${esc(tx.type)}) Tj`);
      streamCommands.push(`95 0 Td`);
      streamCommands.push(`(${esc(descShort)}) Tj`);
      streamCommands.push(`160 0 Td`);
      streamCommands.push(`(${esc(debitStr)}) Tj`);
      streamCommands.push(`50 0 Td`);
      streamCommands.push(`(${esc(creditStr)}) Tj`);
      streamCommands.push('ET');

      currentY -= 16;
    }

    // Security Footer
    streamCommands.push('q');
    streamCommands.push('0.92 0.94 0.96 rg');
    streamCommands.push('40 40 515.28 35 re f');
    streamCommands.push('Q');

    streamCommands.push('BT');
    streamCommands.push('0.3 0.35 0.45 rg');
    streamCommands.push('/F2 7 Tf');
    streamCommands.push('50 62 Td');
    streamCommands.push(`(VERIFIED OFFICIAL DOCUMENT - SHA256 INTEGRITY: ${esc(verificationHash.slice(0, 48))}...) Tj`);
    streamCommands.push('0 -10 Td');
    streamCommands.push('/F1 6.5 Tf');
    streamCommands.push('(Certified Electronic Statement issued by Silverhawk Digital Bank. Regulated Financial Institution.) Tj');
    streamCommands.push('ET');

    const contentStream = streamCommands.join('\n');
    const streamLen = Buffer.byteLength(contentStream);

    const objects: string[] = [];
    objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
    objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj\n');
    objects.push(`4 0 obj\n<< /Length ${streamLen} >>\nstream\n${contentStream}\nendstream\nendobj\n`);
    objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
    objects.push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');

    let offset = 0;
    const header = '%PDF-1.4\n%âãÏÓ\n';
    offset += Buffer.byteLength(header);

    const xrefEntries: string[] = ['0000000000 65535 f \n'];
    let body = '';
    for (const obj of objects) {
      const entryOffset = String(offset + Buffer.byteLength(body)).padStart(10, '0');
      xrefEntries.push(`${entryOffset} 00000 n \n`);
      body += obj;
    }

    const startXref = offset + Buffer.byteLength(body);
    const xref = `xref\n0 ${objects.length + 1}\n${xrefEntries.join('')}`;
    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;

    return Buffer.from(header + body + xref + trailer);
  }

  /**
   * Generates RFC-4180 compliant CSV statement
   */
  public static generateCsvStatement(options: GenerateStatementOptions): string {
    const fromStr = options.startDate ? new Date(options.startDate).toISOString().slice(0, 10) : 'Opening';
    const toStr = options.endDate ? new Date(options.endDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

    const lines: string[] = [];
    lines.push(`"SILVERHAWK DIGITAL BANK - OFFICIAL ACCOUNT STATEMENT"`);
    lines.push(`"Account Holder:","${options.accountHolder}"`);
    lines.push(`"Account Number:","${options.accountNumber}"`);
    lines.push(`"Account Type:","${options.accountType}"`);
    lines.push(`"Currency:","${options.currency}"`);
    lines.push(`"Statement Period:","${fromStr} to ${toStr}"`);
    lines.push(`"Opening Balance:","${options.currency} ${new Decimal(options.openingBalance).toFixed(2)}"`);
    lines.push(`"Total Credits:","+${options.currency} ${new Decimal(options.totalCredits).toFixed(2)}"`);
    lines.push(`"Total Debits:","-${options.currency} ${new Decimal(options.totalDebits).toFixed(2)}"`);
    lines.push(`"Closing Balance:","${options.currency} ${new Decimal(options.closingBalance).toFixed(2)}"`);
    lines.push(`"Generated At:","${new Date().toISOString()}"`);
    lines.push(``);
    lines.push(`"Date (UTC)","Reference","Type","Description","Debit","Credit","Currency"`);

    for (const tx of options.transactions) {
      const isDebit = tx.type === 'DEBIT';
      const debitStr = isDebit ? `"${new Decimal(tx.amount).toFixed(2)}"` : `""`;
      const creditStr = !isDebit ? `"${new Decimal(tx.amount).toFixed(2)}"` : `""`;
      const dateStr = new Date(tx.date).toISOString();
      const desc = (tx.description || '').replace(/"/g, '""');

      lines.push(`"${dateStr}","${tx.reference}","${tx.type}","${desc}",${debitStr},${creditStr},"${tx.currency}"`);
    }

    return lines.join('\r\n');
  }
  /**
   * Generates a SWIFT MT940 format text electronic bank statement (ISO 15022)
   */
  public static generateMt940(
    accountNumber: string,
    statementSeq: number,
    openingBalance: number,
    closingBalance: number,
    currency: string,
    statementDate: Date,
    transactions: StatementTransactionItem[],
  ): string {
    const formatDateYYMMDD = (d: Date) => {
      const yy = String(d.getFullYear()).slice(-2);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yy}${mm}${dd}`;
    };

    const formatAmount = (amt: number) => {
      return new Decimal(Math.abs(amt)).toFixed(2).replace('.', ',');
    };

    const stDateStr = formatDateYYMMDD(statementDate);
    const lines: string[] = [];

    // Tag 20: Transaction Reference Number
    lines.push(`:20:REMIV-STMT-${statementSeq}-${Date.now().toString().slice(-6)}`);

    // Tag 25: Account Identification
    lines.push(`:25:REMIVUS33/${accountNumber}`);

    // Tag 28C: Statement Number / Sequence Number
    lines.push(`:28C:${statementSeq}/1`);

    // Tag 60F: First Opening Balance (C = Credit/Positive, D = Debit/Overdrawn)
    const opIndicator = openingBalance >= 0 ? 'C' : 'D';
    lines.push(`:60F:${opIndicator}${stDateStr}${currency}${formatAmount(openingBalance)}`);

    // Tag 61 & 86: Transaction entries
    transactions.forEach((tx) => {
      const txDate = new Date(tx.date);
      const txDateStr = formatDateYYMMDD(txDate);
      const valDateStr = String(txDate.getMonth() + 1).padStart(2, '0') + String(txDate.getDate()).padStart(2, '0');
      const ind = tx.type === 'CREDIT' ? 'C' : 'D';
      const numAmount = typeof tx.amount === 'string' ? parseFloat(tx.amount) : tx.amount;
      const amtStr = formatAmount(numAmount);

      // :61: Statement line
      lines.push(`:61:${txDateStr}${valDateStr}${ind}${amtStr}NTRFNONREF//${tx.reference}`);

      // :86: Information to Account Owner
      lines.push(`:86:${tx.description.replace(/[\r\n]+/g, ' ').slice(0, 65)}`);
    });

    // Tag 62F: Final Closing Balance
    const clIndicator = closingBalance >= 0 ? 'C' : 'D';
    lines.push(`:62F:${clIndicator}${stDateStr}${currency}${formatAmount(closingBalance)}`);
    lines.push('-');

    return lines.join('\r\n');
  }

  /**
   * Generates ISO 20022 CAMT.053.001.02 XML Bank Statement
   */
  public static generateCamt053Xml(
    accountNumber: string,
    statementId: string,
    openingBalance: number,
    closingBalance: number,
    currency: string,
    fromDate: Date,
    toDate: Date,
    transactions: StatementTransactionItem[],
  ): string {
    const msgId = `MSG-${Date.now()}`;
    const creationTs = new Date().toISOString();
    const fromStr = fromDate.toISOString().slice(0, 10);
    const toStr = toDate.toISOString().slice(0, 10);

    let entriesXml = '';
    transactions.forEach((tx) => {
      const numAmount = typeof tx.amount === 'string' ? parseFloat(tx.amount) : tx.amount;
      const amtDec = new Decimal(Math.abs(numAmount)).toFixed(2);
      const cdtDbt = tx.type === 'CREDIT' ? 'CRDT' : 'DBIT';
      const bkgDate = new Date(tx.date).toISOString().slice(0, 10);

      entriesXml += `
        <Ntry>
          <Amt Ccy="${currency}">${amtDec}</Amt>
          <CdtDbtInd>${cdtDbt}</CdtDbtInd>
          <Sts>BOOK</Sts>
          <BookgDt>
            <Dt>${bkgDate}</Dt>
          </BookgDt>
          <NtryDtls>
            <TxDtls>
              <Refs>
                <AcctSvcrRef>${tx.reference}</AcctSvcrRef>
              </Refs>
              <RmtInf>
                <Ustrd>${tx.description}</Ustrd>
              </RmtInf>
            </TxDtls>
          </NtryDtls>
        </Ntry>`;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr>
      <MsgId>${msgId}</MsgId>
      <CreDtTm>${creationTs}</CreDtTm>
    </GrpHdr>
    <Stmt>
      <Id>${statementId}</Id>
      <ElctrncSeqNb>1</ElctrncSeqNb>
      <CreDtTm>${creationTs}</CreDtTm>
      <FrToDt>
        <FrDt>${fromStr}</FrDt>
        <ToDt>${toStr}</ToDt>
      </FrToDt>
      <Acct>
        <Id>
          <Othr>
            <Id>${accountNumber}</Id>
          </Othr>
        </Id>
        <Ccy>${currency}</Ccy>
        <Svcr>
          <FinInstnId>
            <BICFI>REMIVUS33XXX</BICFI>
            <Nm>Silverhawk Digital Federal Bank</Nm>
          </FinInstnId>
        </Svcr>
      </Acct>
      <Bal>
        <Tp>
          <CdOrPrtry>
            <Cd>OPBD</Cd>
          </CdOrPrtry>
        </Tp>
        <Amt Ccy="${currency}">${new Decimal(openingBalance).toFixed(2)}</Amt>
        <CdtDbtInd>${openingBalance >= 0 ? 'CRDT' : 'DBIT'}</CdtDbtInd>
        <Dt>
          <Dt>${fromStr}</Dt>
        </Dt>
      </Bal>
      ${entriesXml}
      <Bal>
        <Tp>
          <CdOrPrtry>
            <Cd>CLBD</Cd>
          </CdOrPrtry>
        </Tp>
        <Amt Ccy="${currency}">${new Decimal(closingBalance).toFixed(2)}</Amt>
        <CdtDbtInd>${closingBalance >= 0 ? 'CRDT' : 'DBIT'}</CdtDbtInd>
        <Dt>
          <Dt>${toStr}</Dt>
        </Dt>
      </Bal>
    </Stmt>
  </BkToCstmrStmt>
</Document>`.trim();
  }

  /**
   * Computes Annual Form 1099-INT Tax Statement for interest-bearing accounts
   */
  public static computeAnnualTax1099Int(
    taxYear: number,
    recipientName: string,
    recipientTaxId: string,
    savingsAccountsInterestEarned: Array<{
      accountNumber: string;
      interestEarned: number;
      earlyWithdrawalPenalty?: number;
      taxWithheld?: number;
    }>,
  ): Tax1099IntSummary {
    let totalInterest = new Decimal(0);
    let totalPenalty = new Decimal(0);
    let totalWithheld = new Decimal(0);

    savingsAccountsInterestEarned.forEach((acc) => {
      totalInterest = totalInterest.plus(new Decimal(acc.interestEarned || 0));
      totalPenalty = totalPenalty.plus(new Decimal(acc.earlyWithdrawalPenalty || 0));
      totalWithheld = totalWithheld.plus(new Decimal(acc.taxWithheld || 0));
    });

    const maskedTaxId = recipientTaxId.length >= 4 
      ? `***-**-${recipientTaxId.slice(-4)}` 
      : '***-**-0000';

    const stmtRef = `1099INT-${taxYear}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    return {
      taxYear,
      recipientName,
      recipientTaxIdMasked: maskedTaxId,
      payerName: 'Silverhawk Digital Banking Inc.',
      payerTin: '12-3456789',
      box1InterestIncome: totalInterest.toFixed(2),
      box2EarlyWithdrawalPenalty: totalPenalty.toFixed(2),
      box4FederalTaxWithheld: totalWithheld.toFixed(2),
      totalEligibleSavingsAccounts: savingsAccountsInterestEarned.length,
      statementReference: stmtRef,
    };
  }
}

