import * as argon2 from 'argon2';
import * as crypto from 'crypto';

export class CryptoUtil {
  /**
   * Hash a password or sensitive text using Argon2id
   */
  static async hash(plainText: string): Promise<string> {
    return argon2.hash(plainText, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MB
      timeCost: 3,       // 3 iterations
      parallelism: 4,
    });
  }

  /**
   * Verify plain text against an Argon2id hash
   */
  static async verify(hash: string, plainText: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plainText);
    } catch {
      return false;
    }
  }

  /**
   * Generate a cryptographically secure random numeric OTP (e.g. 6 digits)
   */
  static generateNumericOtp(digits: number = 6): string {
    const min = Math.pow(10, digits - 1);
    const max = Math.pow(10, digits) - 1;
    return crypto.randomInt(min, max + 1).toString();
  }

  /**
   * Generate a secure random hex token (e.g. for password resets or sessions)
   */
  static generateSecureToken(bytes: number = 32): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  /**
   * Generate a unique 10-digit bank account number
   */
  static generateAccountNumber(): string {
    const prefix = '100';
    const randomDigits = crypto.randomInt(1000000, 9999999).toString();
    return `${prefix}${randomDigits}`;
  }

  /**
   * Generate a unique transaction reference (e.g., TXN-20260910-ABC123XYZ)
   */
  static generateTransactionReference(prefix: string = 'TXN'): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }

  /**
   * Compute SHA-256 cryptographic hash (used for Proof-of-Payment certificates & Merkle validation)
   */
  static hashSha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

