/**
 * Verifies audit entry artifact hashes against files on disk.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AuditEntry } from './audit-types.js';

export interface IntegrityCheckResult {
  valid: boolean;
  mismatches: Array<{ file: string; expected: string; actual: string }>;
  missing: string[];
}

/**
 * Verifies an audit entry's artifact hashes against the actual files on disk.
 */
export async function checkAuditIntegrity(
  outputDir: string,
  entry: AuditEntry,
): Promise<IntegrityCheckResult> {
  const mismatches: IntegrityCheckResult['mismatches'] = [];
  const missing: string[] = [];

  for (const [file, expectedHash] of Object.entries(entry.artifactHashes)) {
    try {
      const content = await readFile(resolve(outputDir, file), 'utf-8');
      const actualHash = createHash('sha256').update(content).digest('hex');
      if (actualHash !== expectedHash) {
        mismatches.push({ file, expected: expectedHash, actual: actualHash });
      }
    } catch {
      missing.push(file);
    }
  }

  return { valid: mismatches.length === 0 && missing.length === 0, mismatches, missing };
}
