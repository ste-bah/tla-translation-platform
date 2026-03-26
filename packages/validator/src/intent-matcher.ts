import type { InfraIntent, ManifestEntry, TranslationFinding, DimensionResult } from '@tla/shared';
import { createEquivalenceFinding, FINDING_CODES } from './finding-helpers.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a manifest entry's target resources or findings reference
 * an intent kind. A simple heuristic: look for the intent kind/subtype
 * in resource type names, attribute keys, or finding codes/messages.
 */
function intentCoveredByEntry(intent: InfraIntent, entry: ManifestEntry): 'full' | 'partial' | 'missing' {
  const kindLower = intent.kind.toLowerCase();
  const subtypeLower = intent.subtype.toLowerCase();

  // Check target resources for type or attribute matches
  let typeMatch = false;
  let attrMatch = false;

  for (const tr of entry.targetResources) {
    const typeLower = tr.targetType.toLowerCase();
    if (typeLower.includes(kindLower) || typeLower.includes(subtypeLower)) {
      typeMatch = true;
    }
    // Check attributes for intent-related keys
    for (const key of Object.keys(tr.attributes)) {
      const keyLower = key.toLowerCase();
      if (keyLower.includes(kindLower) || keyLower.includes(subtypeLower)) {
        attrMatch = true;
      }
    }
  }

  // Check findings for advisory mentions of this intent
  let findingMention = false;
  for (const f of entry.findings) {
    const msgLower = f.message.toLowerCase();
    const codeLower = f.code.toLowerCase();
    if (
      msgLower.includes(kindLower) ||
      msgLower.includes(subtypeLower) ||
      codeLower.includes(kindLower) ||
      codeLower.includes(subtypeLower)
    ) {
      findingMention = true;
    }
  }

  if (typeMatch) return 'full';
  if (attrMatch || findingMention) return 'partial';
  return 'missing';
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate the intent-preservation dimension.
 *
 * For each intent that references this source resource, check whether the
 * translated output preserves that intent (fully, partially, or not at all).
 *
 * Score = sum(intentScores) / totalIntents, where full=1.0, partial=0.5, missing=0.0.
 */
export function evaluateIntents(
  sourceId: string,
  intents: InfraIntent[],
  entry: ManifestEntry,
): { result: DimensionResult; findings: TranslationFinding[] } {
  const findings: TranslationFinding[] = [];

  // Filter intents relevant to this resource
  const relevantIntents = intents.filter((i) => i.resources.includes(sourceId));

  // No intents → perfect score (nothing to preserve)
  if (relevantIntents.length === 0) {
    return {
      result: {
        dimension: 'intents',
        score: 1.0,
        maxScore: 1.0,
        details: ['No intents reference this resource'],
      },
      findings,
    };
  }

  let totalScore = 0;
  const details: string[] = [];

  for (const intent of relevantIntents) {
    const coverage = intentCoveredByEntry(intent, entry);

    switch (coverage) {
      case 'full':
        totalScore += 1.0;
        details.push(`${intent.kind}/${intent.subtype}: fully preserved`);
        break;
      case 'partial':
        totalScore += 0.5;
        details.push(`${intent.kind}/${intent.subtype}: partially preserved`);
        findings.push(
          createEquivalenceFinding(
            sourceId,
            'warning',
            FINDING_CODES.EQUIV_INTENT_PARTIAL,
            `Intent ${intent.kind}/${intent.subtype} only partially preserved`,
            `Intent references resource ${sourceId} but only partial evidence found in translation`,
          ),
        );
        break;
      case 'missing':
        totalScore += 0.0;
        details.push(`${intent.kind}/${intent.subtype}: missing`);
        findings.push(
          createEquivalenceFinding(
            sourceId,
            'warning',
            FINDING_CODES.EQUIV_INTENT_MISSING,
            `Intent ${intent.kind}/${intent.subtype} not preserved in translation`,
            `Intent references resource ${sourceId} but no evidence found in translated output`,
          ),
        );
        break;
    }
  }

  const score = totalScore / relevantIntents.length;

  return {
    result: {
      dimension: 'intents',
      score,
      maxScore: 1.0,
      details,
    },
    findings,
  };
}
