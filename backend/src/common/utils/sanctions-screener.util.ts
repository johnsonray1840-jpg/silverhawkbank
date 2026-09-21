/**
 * Automated AML / Sanctions Screening & Fuzzy Name Matching Utility (Jaro-Winkler Metric)
 */

export interface WatchlistEntry {
  id: string;
  primaryName: string;
  aliases: string[];
  listSource: 'OFAC_SDN' | 'UN_SANCTIONS' | 'EU_CONSOLIDATED' | 'UK_HMT' | 'GLOBAL_PEP';
  category: 'INDIVIDUAL' | 'ENTITY' | 'VESSEL' | 'PEP';
  country?: string;
  notes?: string;
}

export interface ScreeningMatch {
  matchedName: string;
  matchType: 'PRIMARY' | 'ALIAS';
  listSource: string;
  category: string;
  similarityScore: number; // 0.0 to 1.0 (e.g. 0.92 = 92% match)
}

export interface ScreeningResult {
  queryName: string;
  isHit: boolean; // true if similarity >= 0.85
  maxScore: number;
  matches: ScreeningMatch[];
  recommendation: 'AUTO_PASS' | 'COMPLIANCE_REVIEW_REQUIRED' | 'IMMEDIATE_BLOCK';
}

export class SanctionsScreenerUtil {
  // Built-in Global Sanctions & PEP Baseline Watchlist
  private static watchlist: WatchlistEntry[] = [
    {
      id: 'WL-001',
      primaryName: 'Viktor Anatolyevich Bout',
      aliases: ['Victor Bout', 'Vadim Markovich Aminov', 'Viktor But'],
      listSource: 'OFAC_SDN',
      category: 'INDIVIDUAL',
      country: 'RU',
    },
    {
      id: 'WL-002',
      primaryName: 'Lazarus Group',
      aliases: ['Guardians of Peace', 'Whois Team', 'Hidden Cobra'],
      listSource: 'OFAC_SDN',
      category: 'ENTITY',
      country: 'KP',
    },
    {
      id: 'WL-003',
      primaryName: 'Slobodan Milosevic',
      aliases: ['Milosevic Slobodan'],
      listSource: 'UN_SANCTIONS',
      category: 'INDIVIDUAL',
      country: 'RS',
    },
    {
      id: 'WL-004',
      primaryName: 'Alexander Vladimirovich Shchetinin',
      aliases: ['Alexander Shchetinin'],
      listSource: 'EU_CONSOLIDATED',
      category: 'INDIVIDUAL',
      country: 'RU',
    },
    {
      id: 'WL-005',
      primaryName: 'Sergei Mikhailovich Roldugin',
      aliases: ['Sergey Roldugin'],
      listSource: 'UK_HMT',
      category: 'INDIVIDUAL',
      country: 'RU',
    },
    {
      id: 'WL-006',
      primaryName: 'Al-Shabaab Financial Network',
      aliases: ['Harakat al-Shabaab al-Mujahideen'],
      listSource: 'UN_SANCTIONS',
      category: 'ENTITY',
      country: 'SO',
    },
  ];

  /**
   * Jaro Distance between two strings
   */
  static jaroDistance(s1: string, s2: string): number {
    const a = s1.toLowerCase().trim();
    const b = s2.toLowerCase().trim();

    if (a === b) return 1.0;
    if (a.length === 0 || b.length === 0) return 0.0;

    const matchWindow = Math.floor(Math.max(a.length, b.length) / 2) - 1;
    const aMatches = new Array(a.length).fill(false);
    const bMatches = new Array(b.length).fill(false);

    let matches = 0;
    let transpositions = 0;

    for (let i = 0; i < a.length; i++) {
      const start = Math.max(0, i - matchWindow);
      const end = Math.min(i + matchWindow + 1, b.length);

      for (let j = start; j < end; j++) {
        if (bMatches[j] || a[i] !== b[j]) continue;
        aMatches[i] = true;
        bMatches[j] = true;
        matches++;
        break;
      }
    }

    if (matches === 0) return 0.0;

    let k = 0;
    for (let i = 0; i < a.length; i++) {
      if (!aMatches[i]) continue;
      while (!bMatches[k]) k++;
      if (a[i] !== b[k]) transpositions++;
      k++;
    }

    const m = matches;
    return (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3.0;
  }

  /**
   * Jaro-Winkler Similarity with prefix scale
   */
  static jaroWinklerSimilarity(s1: string, s2: string, prefixScale: number = 0.1): number {
    const jaroDist = this.jaroDistance(s1, s2);
    if (jaroDist < 0.7) return jaroDist;

    const a = s1.toLowerCase().trim();
    const b = s2.toLowerCase().trim();

    let prefixLen = 0;
    const maxPrefix = Math.min(4, Math.min(a.length, b.length));

    for (let i = 0; i < maxPrefix; i++) {
      if (a[i] === b[i]) {
        prefixLen++;
      } else {
        break;
      }
    }

    return Math.min(1.0, jaroDist + prefixLen * prefixScale * (1 - jaroDist));
  }

  /**
   * Screen a query name against the watchlist
   */
  static screenName(name: string, threshold: number = 0.85): ScreeningResult {
    const matches: ScreeningMatch[] = [];
    let maxScore = 0;

    for (const entry of this.watchlist) {
      // 1. Compare against primary name
      const primaryScore = this.jaroWinklerSimilarity(name, entry.primaryName);
      if (primaryScore >= threshold) {
        matches.push({
          matchedName: entry.primaryName,
          matchType: 'PRIMARY',
          listSource: entry.listSource,
          category: entry.category,
          similarityScore: parseFloat(primaryScore.toFixed(4)),
        });
      }
      maxScore = Math.max(maxScore, primaryScore);

      // 2. Compare against aliases
      for (const alias of entry.aliases) {
        const aliasScore = this.jaroWinklerSimilarity(name, alias);
        if (aliasScore >= threshold) {
          matches.push({
            matchedName: alias,
            matchType: 'ALIAS',
            listSource: entry.listSource,
            category: entry.category,
            similarityScore: parseFloat(aliasScore.toFixed(4)),
          });
        }
        maxScore = Math.max(maxScore, aliasScore);
      }
    }

    const isHit = maxScore >= threshold;
    let recommendation: 'AUTO_PASS' | 'COMPLIANCE_REVIEW_REQUIRED' | 'IMMEDIATE_BLOCK' = 'AUTO_PASS';

    if (maxScore >= 0.95) {
      recommendation = 'IMMEDIATE_BLOCK';
    } else if (maxScore >= threshold) {
      recommendation = 'COMPLIANCE_REVIEW_REQUIRED';
    }

    return {
      queryName: name,
      isHit,
      maxScore: parseFloat(maxScore.toFixed(4)),
      matches: matches.sort((a, b) => b.similarityScore - a.similarityScore),
      recommendation,
    };
  }

  /**
   * Detect potential structuring / smurfing pattern
   * E.g., Multiple transactions just below $10,000 reporting threshold within rolling window
   */
  static detectStructuring(amounts: number[], threshold: number = 10000): { isStructuring: boolean; reason?: string } {
    const nearLimitTxns = amounts.filter((amt) => amt >= threshold * 0.75 && amt < threshold);
    if (nearLimitTxns.length >= 2) {
      const sum = nearLimitTxns.reduce((a, b) => a + b, 0);
      return {
        isStructuring: true,
        reason: `Detected ${nearLimitTxns.length} sub-threshold transactions totaling $${sum.toFixed(2)} designed to avoid CTR $${threshold} limit`,
      };
    }
    return { isStructuring: false };
  }
}

