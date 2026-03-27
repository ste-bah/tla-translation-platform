/**
 * confidence-report.ts — Builds a structured JSON confidence report
 * from a completed translation result.
 *
 * Written alongside the other output artefacts (manifest.json,
 * translation-report.md, audit-log.jsonl) so reviewers have a
 * machine-readable breakdown of per-resource confidence and
 * escalation flags.
 */

import type {
  TranslationResult,
  ManifestEntry,
  TranslationFinding,
} from '@tla/shared';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Per-resource confidence entry in the report. */
export interface ResourceConfidence {
  sourceId: string;
  sourceType: string;
  status: string;
  confidence: number;
  /** true when confidence < 0.5 OR status is 'blocked'. */
  escalationRequired: boolean;
  /** Human-readable factors that reduced confidence. */
  factors: string[];
}

/** The full confidence report structure. */
export interface ConfidenceReport {
  generatedAt: string; // ISO-8601
  target: string;
  confidenceOverall: number;
  totalResources: number;
  /** Count of resources requiring escalation. */
  escalationCount: number;
  /** Per-resource breakdown. */
  resources: ResourceConfidence[];
  /** Summary by status. */
  statusBreakdown: Record<string, number>;
  /** Summary by confidence band: high (>=0.8), medium (0.5–0.8), low (<0.5). */
  confidenceBands: {
    high: number;
    medium: number;
    low: number;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds a structured confidence report from a translation result.
 */
export function buildConfidenceReport(
  result: TranslationResult,
): ConfidenceReport {
  const resources: ResourceConfidence[] = result.manifest.entries.map(
    (entry) => {
      const factors = deriveFactors(entry, result.findings);
      const escalationRequired =
        entry.confidence < 0.5 || entry.status === 'blocked';
      return {
        sourceId: entry.sourceId,
        sourceType: entry.sourceType,
        status: entry.status,
        confidence: entry.confidence,
        escalationRequired,
        factors,
      };
    },
  );

  // Confidence bands
  let high = 0;
  let medium = 0;
  let low = 0;
  for (const r of resources) {
    if (r.confidence >= 0.8) high++;
    else if (r.confidence >= 0.5) medium++;
    else low++;
  }

  // Status breakdown
  const statusBreakdown: Record<string, number> = {};
  for (const r of resources) {
    statusBreakdown[r.status] = (statusBreakdown[r.status] ?? 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    target: result.target,
    confidenceOverall: result.manifest.confidenceOverall,
    totalResources: resources.length,
    escalationCount: resources.filter((r) => r.escalationRequired).length,
    resources,
    statusBreakdown,
    confidenceBands: { high, medium, low },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Derives human-readable factor strings from an entry's findings.
 */
function deriveFactors(
  entry: ManifestEntry,
  allFindings: TranslationFinding[],
): string[] {
  const factors: string[] = [];

  // Per-entry findings (blocker / warning only — info is noise here)
  for (const f of entry.findings) {
    if (f.severity === 'blocker') factors.push(`Blocker: ${f.message}`);
    else if (f.severity === 'warning') factors.push(`Warning: ${f.message}`);
  }

  // Global findings that reference this resource but weren't already
  // attached to the entry (avoid duplicates by comparing codes).
  const entryCodes = new Set(entry.findings.map((ef) => ef.code));
  const globalForResource = allFindings.filter(
    (f) => f.resourceId === entry.sourceId && !entryCodes.has(f.code),
  );
  for (const f of globalForResource) {
    if (f.severity === 'blocker') factors.push(`Blocker: ${f.message}`);
    else if (f.severity === 'warning') factors.push(`Warning: ${f.message}`);
  }

  if (entry.status === 'advisory') {
    factors.push('No automated translation available');
  }
  if (entry.status === 'partial') {
    factors.push('Partial translation — manual review required');
  }

  return factors;
}
