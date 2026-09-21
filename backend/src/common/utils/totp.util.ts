import * as crypto from 'crypto';

export class TotpUtil {
  private static readonly BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  /**
   * Encode a buffer into a Base32 string
   */
  static base32Encode(buffer: Buffer): string {
    let bits = 0;
    let value = 0;
    let output = '';

    for (let i = 0; i < buffer.length; i++) {
      value = (value << 8) | buffer[i];
      bits += 8;

      while (bits >= 5) {
        output += this.BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      output += this.BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }

    return output;
  }

  /**
   * Decode a Base32 string into a Buffer
   */
  static base32Decode(base32: string): Buffer {
    const cleaned = base32.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
    let bits = 0;
    let value = 0;
    const output: number[] = [];

    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      const index = this.BASE32_ALPHABET.indexOf(char);
      if (index === -1) continue;

      value = (value << 5) | index;
      bits += 5;

      if (bits >= 8) {
        output.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }

    return Buffer.from(output);
  }

  /**
   * Generate a random cryptographically secure 20-byte Base32 TOTP secret
   */
  static generateSecret(byteLength: number = 20): string {
    const buffer = crypto.randomBytes(byteLength);
    return this.base32Encode(buffer);
  }

  /**
   * Build the standard otpauth:// URL for QR code scanners
   */
  static generateKeyUri(accountName: string, secret: string, issuer: string = 'Silverhawk Bank'): string {
    const encodedIssuer = encodeURIComponent(issuer);
    const encodedAccount = encodeURIComponent(accountName);
    return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
  }

  /**
   * Generate a 6-digit RFC 6238 TOTP code for a specific counter (30s interval)
   */
  static generateTotp(secret: string, counter?: number): string {
    const timeStep = counter !== undefined ? counter : Math.floor(Date.now() / 1000 / 30);
    const secretBuffer = this.base32Decode(secret);

    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigInt64BE(BigInt(timeStep), 0);

    const hmac = crypto.createHmac('sha1', secretBuffer);
    hmac.update(counterBuffer);
    const digest = hmac.digest();

    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);

    const otp = binary % 1000000;
    return otp.toString().padStart(6, '0');
  }

  /**
   * Verify an RFC 6238 TOTP token with configurable time drift tolerance window
   */
  static verifyTotp(token: string, secret: string, windowTolerance: number = 1): boolean {
    if (!token || token.length !== 6 || !/^\d{6}$/.test(token)) {
      return false;
    }

    const currentCounter = Math.floor(Date.now() / 1000 / 30);

    for (let i = -windowTolerance; i <= windowTolerance; i++) {
      const generated = this.generateTotp(secret, currentCounter + i);
      if (crypto.timingSafeEqual(Buffer.from(token, 'utf8'), Buffer.from(generated, 'utf8'))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generate 10 cryptographically secure backup recovery codes (e.g. "A9X2-K4P8")
   */
  static generateBackupCodes(count: number = 10): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const p1 = crypto.randomBytes(2).toString('hex').toUpperCase();
      const p2 = crypto.randomBytes(2).toString('hex').toUpperCase();
      codes.push(`${p1}-${p2}`);
    }
    return codes;
  }
}

