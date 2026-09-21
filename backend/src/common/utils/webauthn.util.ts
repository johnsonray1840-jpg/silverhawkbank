import * as crypto from 'crypto';

export class WebAuthnUtil {
  /**
   * Convert Buffer to Base64URL string (RFC 4648 §5)
   */
  static bufferToBase64Url(buffer: Buffer): string {
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Convert Base64URL string to Buffer
   */
  static base64UrlToBuffer(base64Url: string): Buffer {
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    return Buffer.from(base64, 'base64');
  }

  /**
   * Generate 32-byte cryptographically random challenge
   */
  static generateChallenge(): string {
    return this.bufferToBase64Url(crypto.randomBytes(32));
  }

  /**
   * Generate simulated test keypair (ECDSA P-256 / ES256)
   */
  static generateTestKeyPair(): { publicKeyPem: string; privateKeyPem: string; credentialId: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });

    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const credentialId = this.bufferToBase64Url(crypto.randomBytes(16));

    return { publicKeyPem, privateKeyPem, credentialId };
  }

  /**
   * Sign assertion using private key (for testing / simulation)
   */
  static signAssertion(data: string | Buffer, privateKeyPem: string): string {
    const signer = crypto.createSign('SHA256');
    signer.update(data);
    signer.end();
    const signature = signer.sign(privateKeyPem);
    return this.bufferToBase64Url(signature);
  }

  /**
   * Verify signature using public key PEM
   */
  static verifySignature(data: string | Buffer, signatureBase64Url: string, publicKeyPem: string): boolean {
    try {
      const verifier = crypto.createVerify('SHA256');
      verifier.update(data);
      verifier.end();
      const signatureBuffer = this.base64UrlToBuffer(signatureBase64Url);
      return verifier.verify(publicKeyPem, signatureBuffer);
    } catch {
      return false;
    }
  }
}

