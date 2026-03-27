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

/** Sub-component confidence breakdown. */
export interface ConfidenceBreakdown {
  /** Base confidence from registry entry (0-1). */
  mapping: number;
  /** Topology cohesion factor — 1.0 if no topology issues, reduced by topology findings. */
  topology: number;
  /** Policy compliance factor — 1.0 if clean, reduced by blocker/warning findings. */
  policy: number;
  /** Translation path factor — 1.0 specialized, 0.6 generic-fallback, 0.3 advisory. */
  translationPath: number;
}

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
  /** Sub-component confidence breakdown. */
  breakdown: ConfidenceBreakdown;
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
  /** Aggregate confidence breakdown across all resources. */
  overallBreakdown?: {
    avgMapping: number;
    avgTopology: number;
    avgPolicy: number;
    avgTranslationPath: number;
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
      const breakdown = computeBreakdown(entry, result.findings);
      const factors = deriveFactors(entry, result.findings, breakdown);
      const escalationRequired =
        entry.confidence < 0.5 || entry.status === 'blocked';
      return {
        sourceId: entry.sourceId,
        sourceType: entry.sourceType,
        status: entry.status,
        confidence: entry.confidence,
        escalationRequired,
        factors,
        breakdown,
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

  // Overall breakdown (average across all resources)
  const overallBreakdown = computeOverallBreakdown(resources);

  return {
    generatedAt: new Date().toISOString(),
    target: result.target,
    confidenceOverall: result.manifest.confidenceOverall,
    totalResources: resources.length,
    escalationCount: resources.filter((r) => r.escalationRequired).length,
    resources,
    statusBreakdown,
    confidenceBands: { high, medium, low },
    overallBreakdown,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Computes the sub-component confidence breakdown for a manifest entry.
 */
function computeBreakdown(
  entry: ManifestEntry,
  allFindings: TranslationFinding[],
): ConfidenceBreakdown {
  // Mapping: base confidence from the entry (already from registry).
  const mapping = entry.confidence;

  // Topology: reduced by TOPOLOGY_ findings affecting this resource.
  const topologyFindings = allFindings.filter(
    (f) => f.resourceId === entry.sourceId && f.code.startsWith('TOPOLOGY_'),
  );
  const topology = topologyFindings.length === 0
    ? 1.0
    : Math.max(0.5, 1.0 - topologyFindings.length * 0.15);

  // Policy: reduced by blocker and warning findings on the entry.
  const blockerCount = entry.findings.filter(
    (f) => f.severity === 'blocker',
  ).length;
  const warningCount = entry.findings.filter(
    (f) => f.severity === 'warning',
  ).length;
  const policy = Math.max(0, 1.0 - blockerCount * 0.5 - warningCount * 0.1);

  // Translation path: derived from the first target resource's traceability.
  const pathType =
    entry.targetResources[0]?.traceability?.translationPath;
  let translationPath = 1.0;
  if (pathType === 'generic-fallback') translationPath = 0.6;
  else if (pathType === 'advisory') translationPath = 0.3;

  return { mapping, topology, policy, translationPath };
}

/**
 * Averages sub-component breakdowns across all resources.
 * Returns undefined when there are no resources.
 */
function computeOverallBreakdown(
  resources: ResourceConfidence[],
): ConfidenceReport['overallBreakdown'] {
  if (resources.length === 0) return undefined;
  const n = resources.length;
  let sumMapping = 0;
  let sumTopology = 0;
  let sumPolicy = 0;
  let sumPath = 0;
  for (const r of resources) {
    sumMapping += r.breakdown.mapping;
    sumTopology += r.breakdown.topology;
    sumPolicy += r.breakdown.policy;
    sumPath += r.breakdown.translationPath;
  }
  return {
    avgMapping: sumMapping / n,
    avgTopology: sumTopology / n,
    avgPolicy: sumPolicy / n,
    avgTranslationPath: sumPath / n,
  };
}

/**
 * Derives human-readable factor strings from an entry's findings.
 */
function deriveFactors(
  entry: ManifestEntry,
  allFindings: TranslationFinding[],
  breakdown: ConfidenceBreakdown,
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

  // Breakdown-derived factors
  if (breakdown.translationPath < 1.0) {
    factors.push(
      `Translation via generic fallback (${breakdown.translationPath}x)`,
    );
  }
  if (breakdown.topology < 1.0) {
    factors.push(`Topology issues detected (${breakdown.topology}x)`);
  }

  return factors;
}
