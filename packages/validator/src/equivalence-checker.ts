import type {
  CanonicalIR,
  TranslationManifest,
  ManifestEntry,
  TranslationFinding,
  EquivalenceOptions,
  EquivalenceReport,
  ResourceEquivalenceRecord,
  EquivalenceClassification,
  DimensionResult,
} from '@tla/shared';
import { evaluatePresence } from './presence-evaluator.js';
import { evaluateAttributes } from './attribute-evaluator.js';
import { evaluateIntents } from './intent-matcher.js';
import { evaluateReferences } from './reference-evaluator.js';
import { computeOverallScore, classify, DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } from './scoring.js';
import { createEquivalenceFinding, FINDING_CODES } from './finding-helpers.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a Map<sourceId, ManifestEntry> for fast lookup.
 */
function buildEntryMap(manifest: TranslationManifest): Map<string, ManifestEntry> {
  const map = new Map<string, ManifestEntry>();
  for (const entry of manifest.entries) {
    map.set(entry.sourceId, entry);
  }
  return map;
}

/**
 * Evaluate a single resource with all applicable dimensions.
 * Never throws — wraps per-resource errors in a degraded record.
 */
function evaluateResource(
  resourceId: string,
  sourceType: string,
  ir: CanonicalIR,
  entryMap: Map<string, ManifestEntry>,
  options?: EquivalenceOptions,
): { record: ResourceEquivalenceRecord; findings: TranslationFinding[] } {
  const allFindings: TranslationFinding[] = [];
  const weights = options?.weights ?? DEFAULT_WEIGHTS;
  const thresholds = options?.thresholds ?? DEFAULT_THRESHOLDS;

  try {
    const entry = entryMap.get(resourceId);

    // --- Presence ---
    const presence = evaluatePresence(resourceId, sourceType, entry);
    allFindings.push(...presence.findings);

    // Pre-classified resources (advisory/blocked/missing) skip remaining evaluators
    if (presence.preClassification !== null || !entry) {
      const dimensions: ResourceEquivalenceRecord['dimensions'] = {
        presence: presence.result,
      };
      const overall = computeOverallScore(dimensions, weights);
      return {
        record: {
          resourceId,
          sourceType,
          classification: classify(overall, thresholds),
          overallScore: overall,
          dimensions,
          preClassification: presence.preClassification,
        },
        findings: allFindings,
      };
    }

    // --- Find source resource ---
    const source = ir.resources.find((r) => r.id === resourceId);
    if (!source) {
      // Should not happen if IR is consistent, but handle gracefully
      return {
        record: {
          resourceId,
          sourceType,
          classification: 'missing',
          overallScore: 0,
          dimensions: { presence: presence.result },
          preClassification: null,
        },
        findings: allFindings,
      };
    }

    // --- Attributes ---
    const attributes = evaluateAttributes(source, entry);
    allFindings.push(...attributes.findings);

    // --- Intents ---
    const intents = evaluateIntents(resourceId, ir.intents, entry);
    allFindings.push(...intents.findings);

    // --- References ---
    const references = evaluateReferences(source, ir.relationships, entryMap);
    allFindings.push(...references.findings);

    // --- Scoring ---
    const dimensions: Record<string, DimensionResult> = {
      presence: presence.result,
      attributes: attributes.result,
      intents: intents.result,
      references: references.result,
    };

    const overall = computeOverallScore(
      dimensions as ResourceEquivalenceRecord['dimensions'],
      weights,
    );
    const classification = classify(overall, thresholds);

    return {
      record: {
        resourceId,
        sourceType,
        classification,
        overallScore: overall,
        dimensions: {
          presence: presence.result,
          attributes: attributes.result,
          intents: intents.result,
          references: references.result,
        },
        preClassification: null,
      },
      findings: allFindings,
    };
  } catch (err: unknown) {
    // Never throw — return a degraded record with an error finding
    const message = err instanceof Error ? err.message : String(err);
    allFindings.push(
      createEquivalenceFinding(
        resourceId,
        'warning',
        FINDING_CODES.EQUIV_ERROR,
        `Error evaluating resource: ${message}`,
      ),
    );
    return {
      record: {
        resourceId,
        sourceType,
        classification: 'degraded',
        overallScore: 0,
        dimensions: {},
        preClassification: null,
      },
      findings: allFindings,
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check semantic equivalence between a Canonical IR and its translation manifest.
 *
 * Iterates over all IR resources, joins them with manifest entries by sourceId,
 * runs four evaluation dimensions (presence, attributes, intents, references),
 * and produces a scored, classified report.
 *
 * Never throws at the top level — errors are captured per-resource.
 */
export function checkEquivalence(
  ir: CanonicalIR,
  manifest: TranslationManifest,
  options?: EquivalenceOptions,
): EquivalenceReport {
  try {
    const entryMap = buildEntryMap(manifest);
    const records: ResourceEquivalenceRecord[] = [];
    const allFindings: TranslationFinding[] = [];

    for (const resource of ir.resources) {
      const { record, findings } = evaluateResource(
        resource.id,
        resource.sourceType,
        ir,
        entryMap,
        options,
      );
      records.push(record);
      allFindings.push(...findings);
    }

    // Sort records: worst-first (lowest score), then by resourceId for stability
    records.sort((a, b) => {
      if (a.overallScore !== b.overallScore) return a.overallScore - b.overallScore;
      return a.resourceId.localeCompare(b.resourceId);
    });

    // Summary counts
    const summary = {
      total: records.length,
      equivalent: 0,
      partial: 0,
      degraded: 0,
      missing: 0,
    };
    for (const r of records) {
      summary[r.classification]++;
    }

    // Overall report score = average of all resource scores
    const overallScore =
      records.length > 0
        ? records.reduce((sum, r) => sum + r.overallScore, 0) / records.length
        : 0;

    const thresholds = options?.thresholds ?? DEFAULT_THRESHOLDS;
    const classification: EquivalenceClassification = classify(overallScore, thresholds);

    return {
      overallScore,
      classification,
      records,
      summary,
    };
  } catch (err: unknown) {
    // Top-level never-throw: return a fully-degraded report
    return {
      overallScore: 0,
      classification: 'missing',
      records: [],
      summary: {
        total: 0,
        equivalent: 0,
        partial: 0,
        degraded: 0,
        missing: 0,
      },
    };
  }
}
