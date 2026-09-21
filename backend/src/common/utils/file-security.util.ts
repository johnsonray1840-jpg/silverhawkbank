import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';

export interface FileValidationResult {
  isValid: boolean;
  error?: string;
  sanitizedFilename?: string;
  secureStoragePath?: string;
  fileHash?: string;
  mimeType?: string;
  fileSize?: number;
  detectedType?: string;
}

export interface FileSignature {
  type: string;
  mimeType: string;
  extensions: string[];
  magicBytes: number[][]; // byte sequences
}

export class FileSecurityUtil {
  public static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  public static readonly MIN_FILE_SIZE = 100; // 100 Bytes

  public static readonly ALLOWED_EXTENSIONS = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.pdf',
    '.webp',
  ]);

  public static readonly ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'application/pdf',
    'image/webp',
  ]);

  public static readonly BLOCKED_EXTENSIONS = new Set([
    '.exe', '.dll', '.so', '.dylib', '.sh', '.bat', '.cmd', '.bin',
    '.msi', '.vbs', '.js', '.mjs', '.ts', '.php', '.phtml', '.py',
    '.elf', '.com', '.scr', '.jar', '.apk', '.html', '.htm', '.svg',
    '.cgi', '.pl', '.asp', '.aspx', '.jsp', '.ps1', '.reg',
  ]);

  /**
   * Known File Signatures (Magic Numbers)
   */
  public static readonly FILE_SIGNATURES: FileSignature[] = [
    {
      type: 'JPEG',
      mimeType: 'image/jpeg',
      extensions: ['.jpg', '.jpeg'],
      magicBytes: [
        [0xff, 0xd8, 0xff, 0xe0],
        [0xff, 0xd8, 0xff, 0xe1],
        [0xff, 0xd8, 0xff, 0xe2],
        [0xff, 0xd8, 0xff, 0xe3],
        [0xff, 0xd8, 0xff, 0xdb],
        [0xff, 0xd8, 0xff, 0xee],
        [0xff, 0xd8, 0xff],
      ],
    },
    {
      type: 'PNG',
      mimeType: 'image/png',
      extensions: ['.png'],
      magicBytes: [
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      ],
    },
    {
      type: 'PDF',
      mimeType: 'application/pdf',
      extensions: ['.pdf'],
      magicBytes: [
        [0x25, 0x50, 0x44, 0x46], // %PDF
      ],
    },
    {
      type: 'WEBP',
      mimeType: 'image/webp',
      extensions: ['.webp'],
      magicBytes: [
        [0x52, 0x49, 0x46, 0x46], // RIFF
      ],
    },
  ];

  /**
   * Inspect binary buffer magic bytes to determine true file type
   */
  public static inspectMagicBytes(buffer: Buffer): { type: string; mimeType: string } | null {
    if (!buffer || buffer.length < 4) {
      return null;
    }

    for (const sig of this.FILE_SIGNATURES) {
      for (const pattern of sig.magicBytes) {
        let match = true;
        for (let i = 0; i < pattern.length; i++) {
          if (buffer[i] !== pattern[i]) {
            match = false;
            break;
          }
        }
        if (match) {
          // Additional check for WEBP: bytes 8..11 must be 'WEBP' (0x57, 0x45, 0x42, 0x50)
          if (sig.type === 'WEBP') {
            if (buffer.length < 12) return null;
            if (
              buffer[8] === 0x57 &&
              buffer[9] === 0x45 &&
              buffer[10] === 0x42 &&
              buffer[11] === 0x50
            ) {
              return { type: sig.type, mimeType: sig.mimeType };
            }
            continue;
          }
          return { type: sig.type, mimeType: sig.mimeType };
        }
      }
    }

    return null;
  }

  /**
   * Strict validation of an uploaded KYC file
   */
  public static validateFile(
    fileBuffer: Buffer,
    originalFilename: string,
    claimedMimeType: string,
  ): FileValidationResult {
    // 1. Check for null byte injection & path traversal in filename
    if (!originalFilename || originalFilename.includes('\0') || originalFilename.includes('..') || /[/\\]/.test(originalFilename)) {
      return {
        isValid: false,
        error: 'ILLEGAL_FILENAME: Filename contains prohibited characters or path traversal sequences',
      };
    }

    // 2. Validate file size
    if (!fileBuffer || fileBuffer.length < this.MIN_FILE_SIZE) {
      return {
        isValid: false,
        error: `FILE_TOO_SMALL: File must be at least ${this.MIN_FILE_SIZE} bytes`,
      };
    }

    if (fileBuffer.length > this.MAX_FILE_SIZE) {
      return {
        isValid: false,
        error: `FILE_TOO_LARGE: File size exceeds ${this.MAX_FILE_SIZE / (1024 * 1024)}MB limit`,
      };
    }

    // 3. Extension Validation
    const ext = path.extname(originalFilename).toLowerCase();
    if (!ext || !this.ALLOWED_EXTENSIONS.has(ext)) {
      return {
        isValid: false,
        error: `UNSUPPORTED_EXTENSION: Extension '${ext}' is not permitted. Allowed: JPG, PNG, PDF, WEBP`,
      };
    }

    // Double extension check (e.g. document.pdf.exe)
    const baseWithoutExt = path.basename(originalFilename, ext);
    const secondaryExt = path.extname(baseWithoutExt).toLowerCase();
    if (secondaryExt && (this.BLOCKED_EXTENSIONS.has(secondaryExt) || this.ALLOWED_EXTENSIONS.has(secondaryExt))) {
      return {
        isValid: false,
        error: 'SUSPICIOUS_DOUBLE_EXTENSION: Multiple file extensions detected',
      };
    }

    // 4. MIME Type Validation
    const normalizedMime = claimedMimeType.toLowerCase().trim();
    if (!this.ALLOWED_MIME_TYPES.has(normalizedMime)) {
      return {
        isValid: false,
        error: `UNSUPPORTED_MIME_TYPE: MIME type '${claimedMimeType}' is prohibited`,
      };
    }

    // 5. Binary Magic Bytes Signature Inspection
    const detected = this.inspectMagicBytes(fileBuffer);
    if (!detected) {
      return {
        isValid: false,
        error: 'INVALID_FILE_SIGNATURE: Binary content does not match legitimate JPEG, PNG, PDF, or WEBP signature',
      };
    }

    // Ensure detected MIME matches allowed MIME
    if (detected.mimeType !== normalizedMime && !(normalizedMime === 'image/jpeg' && detected.mimeType === 'image/jpeg')) {
      return {
        isValid: false,
        error: `MIME_MISMATCH: Claimed MIME type '${claimedMimeType}' does not match binary signature '${detected.mimeType}'`,
      };
    }

    // 6. Compute Cryptographic SHA-256 Hash
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 7. Generate Secure Sanitized Filename
    const uniqueId = crypto.randomUUID();
    const sanitizedFilename = `kyc_${uniqueId}${ext}`;

    return {
      isValid: true,
      sanitizedFilename,
      fileHash,
      mimeType: detected.mimeType,
      fileSize: fileBuffer.length,
      detectedType: detected.type,
    };
  }

  /**
   * Save uploaded KYC document into non-public secure storage directory
   */
  public static async saveSecureDocument(
    storageRootDir: string,
    userId: string,
    fileBuffer: Buffer,
    sanitizedFilename: string,
  ): Promise<string> {
    const userStorageDir = path.join(storageRootDir, 'secure_kyc_vault', userId);
    if (!fs.existsSync(userStorageDir)) {
      fs.mkdirSync(userStorageDir, { recursive: true, mode: 0o700 }); // Restrictive permissions
    }

    const fullFilePath = path.join(userStorageDir, sanitizedFilename);
    await fs.promises.writeFile(fullFilePath, fileBuffer, { mode: 0o600 });
    return fullFilePath;
  }
}

