/**
 * Audit trail writer — builds entries from translation results and appends
 * them to an append-only JSONL log file.
 */

import { createHash, randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TranslationResult } from '@tla/shared';
import type { AuditEntry } from './audit-types.js';

/**
 * Builds an AuditEntry from a completed translation run.
 *
 * @param result       - The compiler output
 * @param source       - Source path or description
 * @param target       - Target cloud provider
 * @param durationMs   - Wall-clock duration of the translation
 * @param manifestJson - The serialized manifest.json (used for hash)
 */
export function buildAuditEntry(
  result: TranslationResult,
  source: string,
  target: 'azure' | 'gcp',
  durationMs: number,
  manifestJson: string,
): AuditEntry {
  const hash = createHash('sha256').update(manifestJson, 'utf-8').digest('hex');

  const findingCounts = { blocker: 0, warning: 0, info: 0 };
  for (const f of result.findings) {
    if (f.severity === 'blocker') findingCounts.blocker++;
    else if (f.severity === 'warning') findingCounts.warning++;
    else findingCounts.info++;
  }

  return {
    timestamp: new Date().toISOString(),
    runId: randomUUID(),
    source,
    target,
    registryVersion: result.manifest.registryVersion,
    resourceCount: result.stats.totalResources,
    counts: {
      translated: result.manifest.counts.translated,
      expanded: result.manifest.counts.expanded,
      partial: result.manifest.counts.partial,
      blocked: result.manifest.counts.blocked,
      advisory: result.manifest.counts.advisory,
      total: result.manifest.counts.total,
    },
    confidenceOverall: result.manifest.confidenceOverall,
    manifestHash: hash,
    findingCounts,
    durationMs,
  };
}

/**
 * Appends an audit entry to the audit log file (JSONL format).
 * Creates the file if it doesn't exist. Append-only — never overwrites.
 * Never throws; errors are logged to stderr.
 */
export async function appendAuditEntry(
  outputDir: string,
  entry: AuditEntry,
): Promise<void> {
  try {
    const logPath = resolve(outputDir, 'audit-log.jsonl');
    const line = JSON.stringify(entry) + '\n';
    await appendFile(logPath, line, 'utf-8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[audit] Failed to write audit log: ${msg}\n`);
  }
}
