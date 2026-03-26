import type { ManifestEntry, DimensionResult, TranslationFinding } from '@tla/shared';
import { createEquivalenceFinding, FINDING_CODES } from './finding-helpers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PresenceEvaluation {
  result: DimensionResult;
  preClassification: 'advisory' | 'blocked' | null;
  findings: TranslationFinding[];
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate the presence dimension for a single source resource.
 *
 * If the manifest entry is missing entirely → score 0.0, classification 'missing'.
 * If the entry status is 'advisory' → score 0.0, pre-classify as advisory.
 * If the entry status is 'blocked' → score 0.0, pre-classify as blocked.
 * Otherwise → score 1.0 (resource is present in the translation).
 */
export function evaluatePresence(
  sourceId: string,
  sourceType: string,
  entry?: ManifestEntry,
): PresenceEvaluation {
  const findings: TranslationFinding[] = [];

  // No manifest entry at all → missing
  if (!entry) {
    findings.push(
      createEquivalenceFinding(
        sourceId,
        'warning',
        FINDING_CODES.EQUIV_PRESENCE_MISSING,
        `Resource ${sourceType} has no corresponding manifest entry`,
        `sourceId: ${sourceId}`,
      ),
    );
    return {
      result: {
        dimension: 'presence',
        score: 0.0,
        maxScore: 1.0,
        details: ['No manifest entry found'],
      },
      preClassification: null,
      findings,
    };
  }

  // Advisory status → pre-classify, skip remaining evaluators
  if (entry.status === 'advisory') {
    findings.push(
      createEquivalenceFinding(
        sourceId,
        'info',
        FINDING_CODES.EQUIV_PRESENCE_ADVISORY,
        `Resource ${sourceType} is advisory-only (manual migration required)`,
      ),
    );
    return {
      result: {
        dimension: 'presence',
        score: 0.0,
        maxScore: 1.0,
        details: ['Advisory status — manual migration required'],
      },
      preClassification: 'advisory',
      findings,
    };
  }

  // Blocked status → pre-classify, skip remaining evaluators
  if (entry.status === 'blocked') {
    findings.push(
      createEquivalenceFinding(
        sourceId,
        'blocker',
        FINDING_CODES.EQUIV_PRESENCE_BLOCKED,
        `Resource ${sourceType} translation is blocked`,
        entry.findings.length > 0
          ? entry.findings.map((f) => f.message).join('; ')
          : undefined,
      ),
    );
    return {
      result: {
        dimension: 'presence',
        score: 0.0,
        maxScore: 1.0,
        details: ['Blocked — translation not possible'],
      },
      preClassification: 'blocked',
      findings,
    };
  }

  // Present and translated/expanded/partial
  return {
    result: {
      dimension: 'presence',
      score: 1.0,
      maxScore: 1.0,
      details: [`Present with status: ${entry.status}`],
    },
    preClassification: null,
    findings,
  };
}
