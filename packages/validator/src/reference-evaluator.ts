import type { IrResource, IrRelationship, ManifestEntry, TranslationFinding, DimensionResult } from '@tla/shared';
import { createEquivalenceFinding, FINDING_CODES } from './finding-helpers.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a reference target (IrRelationship.to) is resolvable in
 * the translated manifest. A reference is "preserved" if the target has
 * a manifest entry with at least one target resource.
 */
function isReferencePreserved(
  rel: IrRelationship,
  allEntries: Map<string, ManifestEntry>,
): 'preserved' | 'dangling' | 'broken' {
  const targetEntry = allEntries.get(rel.to);

  // If the target resource has no manifest entry at all → broken
  if (!targetEntry) {
    return 'broken';
  }

  // If the target entry is blocked/advisory with no target resources → dangling
  if (targetEntry.targetResources.length === 0) {
    return 'dangling';
  }

  // The target entry exists and has translated resources — the reference
  // is preservable (the target is reachable in the translated output).
  return 'preserved';
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate the reference-preservation dimension.
 *
 * For each outgoing relationship from the source resource, check whether the
 * referenced target is present and reachable in the translated manifest.
 *
 * Score = preservedCount / totalReferences.
 */
export function evaluateReferences(
  source: IrResource,
  relationships: IrRelationship[],
  allEntries: Map<string, ManifestEntry>,
): { result: DimensionResult; findings: TranslationFinding[] } {
  const findings: TranslationFinding[] = [];

  // Filter relationships originating from this resource
  const outgoing = relationships.filter((r) => r.from === source.id);

  // No outgoing references → perfect score
  if (outgoing.length === 0) {
    return {
      result: {
        dimension: 'references',
        score: 1.0,
        maxScore: 1.0,
        details: ['No outgoing references to check'],
      },
      findings,
    };
  }

  let preserved = 0;
  const details: string[] = [];

  for (const rel of outgoing) {
    const status = isReferencePreserved(rel, allEntries);

    switch (status) {
      case 'preserved':
        preserved++;
        details.push(`${rel.type} → ${rel.to}: preserved`);
        break;
      case 'dangling':
        details.push(`${rel.type} → ${rel.to}: dangling`);
        findings.push(
          createEquivalenceFinding(
            source.id,
            'warning',
            FINDING_CODES.EQUIV_REFERENCE_DANGLING,
            `Reference to ${rel.to} is dangling (target has no translated resources)`,
            `Relationship type: ${rel.type}`,
          ),
        );
        break;
      case 'broken':
        details.push(`${rel.type} → ${rel.to}: broken`);
        findings.push(
          createEquivalenceFinding(
            source.id,
            'warning',
            FINDING_CODES.EQUIV_REFERENCE_BROKEN,
            `Reference to ${rel.to} is broken (target not in manifest)`,
            `Relationship type: ${rel.type}`,
          ),
        );
        break;
    }
  }

  const score = preserved / outgoing.length;

  return {
    result: {
      dimension: 'references',
      score,
      maxScore: 1.0,
      details,
    },
    findings,
  };
}
