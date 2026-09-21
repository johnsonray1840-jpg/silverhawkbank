import * as crypto from 'crypto';

export interface AuditLogEntry {
  index: number;
  timestamp: string;
  transactionReference: string;
  totalDebit: number;
  totalCredit: number;
  currency: string;
  previousHash: string;
  hash: string;
}

export interface MerkleVerificationResult {
  isValid: boolean;
  totalVerifiedEntries: number;
  genesisHash: string;
  latestHash: string;
  merkleRoot: string;
  tamperedIndex?: number;
  error?: string;
}

export class AuditChainUtil {
  public static readonly GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

  /**
   * Computes SHA-256 hash for a specific ledger entry in the chain
   */
  public static computeEntryHash(
    index: number,
    timestamp: string,
    transactionReference: string,
    totalDebit: number,
    totalCredit: number,
    currency: string,
    previousHash: string,
  ): string {
    const payload = `${index}|${timestamp}|${transactionReference}|${totalDebit.toFixed(4)}|${totalCredit.toFixed(4)}|${currency}|${previousHash}`;
    return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  }

  /**
   * Generates a tamper-evident audit hash chain from an array of financial transactions
   */
  public static buildAuditChain(
    transactions: Array<{
      reference: string;
      createdAt: Date | string;
      amount: number;
      currency: string;
    }>,
  ): AuditLogEntry[] {
    const chain: AuditLogEntry[] = [];
    let prevHash = this.GENESIS_HASH;

    transactions.forEach((tx, idx) => {
      const ts = new Date(tx.createdAt).toISOString();
      const currentHash = this.computeEntryHash(
        idx,
        ts,
        tx.reference,
        tx.amount,
        tx.amount,
        tx.currency,
        prevHash,
      );

      const entry: AuditLogEntry = {
        index: idx,
        timestamp: ts,
        transactionReference: tx.reference,
        totalDebit: tx.amount,
        totalCredit: tx.amount,
        currency: tx.currency,
        previousHash: prevHash,
        hash: currentHash,
      };

      chain.push(entry);
      prevHash = currentHash;
    });

    return chain;
  }

  /**
   * Cryptographically verifies the integrity of an audit chain and computes the Merkle Root
   */
  public static verifyAuditChain(chain: AuditLogEntry[]): MerkleVerificationResult {
    if (!chain || chain.length === 0) {
      return {
        isValid: true,
        totalVerifiedEntries: 0,
        genesisHash: this.GENESIS_HASH,
        latestHash: this.GENESIS_HASH,
        merkleRoot: this.GENESIS_HASH,
      };
    }

    let expectedPrevHash = this.GENESIS_HASH;

    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i];

      // 1. Verify previous hash link
      if (entry.previousHash !== expectedPrevHash) {
        return {
          isValid: false,
          totalVerifiedEntries: i,
          genesisHash: this.GENESIS_HASH,
          latestHash: entry.hash,
          merkleRoot: '',
          tamperedIndex: i,
          error: `Broken chain linkage at index ${i}: expected previousHash ${expectedPrevHash}, found ${entry.previousHash}`,
        };
      }

      // 2. Recompute current hash and verify match
      const recalculatedHash = this.computeEntryHash(
        entry.index,
        entry.timestamp,
        entry.transactionReference,
        entry.totalDebit,
        entry.totalCredit,
        entry.currency,
        entry.previousHash,
      );

      if (recalculatedHash !== entry.hash) {
        return {
          isValid: false,
          totalVerifiedEntries: i,
          genesisHash: this.GENESIS_HASH,
          latestHash: entry.hash,
          merkleRoot: '',
          tamperedIndex: i,
          error: `Data tampering detected at index ${i}: stored hash does not match computed hash`,
        };
      }

      expectedPrevHash = entry.hash;
    }

    // 3. Compute Merkle Root of all leaf entry hashes
    const leafHashes = chain.map((e) => e.hash);
    const merkleRoot = this.computeMerkleRoot(leafHashes);

    return {
      isValid: true,
      totalVerifiedEntries: chain.length,
      genesisHash: this.GENESIS_HASH,
      latestHash: chain[chain.length - 1].hash,
      merkleRoot,
    };
  }

  /**
   * Computes the Merkle Root of an array of leaf hashes using pairwise hashing
   */
  public static computeMerkleRoot(hashes: string[]): string {
    if (hashes.length === 0) return this.GENESIS_HASH;
    if (hashes.length === 1) return hashes[0];

    let currentLevel = [...hashes];

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
        const combined = crypto
          .createHash('sha256')
          .update(left + right, 'utf8')
          .digest('hex');
        nextLevel.push(combined);
      }
      currentLevel = nextLevel;
    }

    return currentLevel[0];
  }
}

