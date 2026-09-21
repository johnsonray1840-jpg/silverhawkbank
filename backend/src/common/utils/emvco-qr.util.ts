/**
 * EMVCo QR Code Generator & Parser for Merchant Instant Payments (ISO/IEC 18004 & EMVCo standard)
 */

export interface EmvcoQrOptions {
  pointOfInitiation?: 'STATIC' | 'DYNAMIC'; // 11 = Static, 12 = Dynamic
  merchantId: string;
  merchantName: string;
  merchantCity?: string;
  currencyCode?: string; // ISO 4217 Numeric or Alpha (e.g. 840 or USD)
  amount?: string;
  reference: string;
  countryCode?: string;
}

export interface ParsedEmvcoQr {
  pointOfInitiation: string;
  merchantId: string;
  merchantName: string;
  merchantCity: string;
  amount?: string;
  currency: string;
  reference: string;
  countryCode: string;
  checksum: string;
  isValidChecksum: boolean;
}

export class EmvcoQrUtil {
  /**
   * Format Tag-Length-Value (TLV)
   */
  static formatTlv(tag: string, value: string): string {
    const length = value.length.toString().padStart(2, '0');
    return `${tag}${length}${value}`;
  }

  /**
   * Calculate CRC-16 CCITT Checksum (Polynomial 0x1021, Initial 0xFFFF)
   */
  static calculateCrc16(data: string): string {
    let crc = 0xffff;
    for (let i = 0; i < data.length; i++) {
      const code = data.charCodeAt(i);
      crc ^= code << 8;
      for (let j = 0; j < 8; j++) {
        if ((crc & 0x8000) !== 0) {
          crc = ((crc << 1) ^ 0x1021) & 0xffff;
        } else {
          crc = (crc << 1) & 0xffff;
        }
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  /**
   * Generate standard EMVCo Merchant QR Payload
   */
  static generateQrPayload(options: EmvcoQrOptions): string {
    let payload = '';

    // Tag 00: Payload Format Indicator ("01")
    payload += this.formatTlv('00', '01');

    // Tag 01: Point of Initiation Method ("11" Static, "12" Dynamic)
    const poi = options.pointOfInitiation === 'STATIC' ? '11' : '12';
    payload += this.formatTlv('01', poi);

    // Tag 26: Merchant Account Information (Silverhawk Bank Sub-Tag 00 = Reverse Domain, 01 = Merchant ID)
    const subMerchant = `${this.formatTlv('00', 'com.silverhawkbank')}${this.formatTlv('01', options.merchantId)}`;
    payload += this.formatTlv('26', subMerchant);

    // Tag 52: Merchant Category Code ("6011" Financial Institution)
    payload += this.formatTlv('52', '6011');

    // Tag 53: Transaction Currency (Default "840" for USD)
    const currency = options.currencyCode === 'EUR' ? '978' : options.currencyCode === 'GBP' ? '826' : '840';
    payload += this.formatTlv('53', currency);

    // Tag 54: Transaction Amount (if specified)
    if (options.amount) {
      payload += this.formatTlv('54', options.amount);
    }

    // Tag 58: Country Code (Default "US")
    payload += this.formatTlv('58', options.countryCode || 'US');

    // Tag 59: Merchant Name
    payload += this.formatTlv('59', options.merchantName.slice(0, 25));

    // Tag 60: Merchant City
    payload += this.formatTlv('60', (options.merchantCity || 'New York').slice(0, 15));

    // Tag 62: Additional Data Field (Reference)
    const subRef = this.formatTlv('05', options.reference);
    payload += this.formatTlv('62', subRef);

    // Tag 63: CRC-16 Checksum Header ("6304")
    const payloadWithCrcTag = `${payload}6304`;
    const checksum = this.calculateCrc16(payloadWithCrcTag);

    return `${payloadWithCrcTag}${checksum}`;
  }

  /**
   * Parse EMVCo QR String
   */
  static parseQrPayload(qrString: string): ParsedEmvcoQr {
    let index = 0;
    const tags: Record<string, string> = {};

    while (index < qrString.length) {
      const tag = qrString.slice(index, index + 2);
      const length = parseInt(qrString.slice(index + 2, index + 4), 10);
      if (isNaN(length)) break;
      const value = qrString.slice(index + 4, index + 4 + length);
      tags[tag] = value;
      index += 4 + length;
    }

    const rawDataForChecksum = qrString.slice(0, qrString.length - 4);
    const expectedChecksum = this.calculateCrc16(rawDataForChecksum);
    const providedChecksum = tags['63'] || '';

    // Extract reference from Tag 62
    let reference = '';
    if (tags['62']) {
      const refTag = tags['62'].slice(0, 2);
      const refLen = parseInt(tags['62'].slice(2, 4), 10);
      if (refTag === '05' && !isNaN(refLen)) {
        reference = tags['62'].slice(4, 4 + refLen);
      }
    }

    return {
      pointOfInitiation: tags['01'] === '12' ? 'DYNAMIC' : 'STATIC',
      merchantId: tags['26'] || '',
      merchantName: tags['59'] || 'Silverhawk Merchant',
      merchantCity: tags['60'] || '',
      amount: tags['54'],
      currency: tags['53'] === '978' ? 'EUR' : tags['53'] === '826' ? 'GBP' : 'USD',
      reference: reference || 'REF-QR-TXN',
      countryCode: tags['58'] || 'US',
      checksum: providedChecksum,
      isValidChecksum: expectedChecksum === providedChecksum,
    };
  }
}

