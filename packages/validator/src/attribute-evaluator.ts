import type { IrResource, ManifestEntry, TranslationFinding, DimensionResult } from '@tla/shared';
import { createEquivalenceFinding, FINDING_CODES } from './finding-helpers.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Keys to ignore when comparing attributes (internal metadata). */
const IGNORED_KEYS = new Set(['tags', 'tags_all', 'arn', 'id', 'owner_id']);

/**
 * Flatten a nested attribute map into dot-separated keys.
 * E.g. { a: { b: 1 } } → Map{ 'a.b' => 1 }
 */
function flattenAttributes(
  attrs: Record<string, unknown>,
  prefix = '',
): Map<string, unknown> {
  const result = new Map<string, unknown>();
  for (const [key, value] of Object.entries(attrs)) {
    if (IGNORED_KEYS.has(key)) continue;
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const nested = flattenAttributes(value as Record<string, unknown>, fullKey);
      for (const [nk, nv] of nested) {
        result.set(nk, nv);
      }
    } else {
      result.set(fullKey, value);
    }
  }
  return result;
}

/**
 * Collect the union of target attribute keys across all translated resources
 * in a manifest entry.
 */
function collectTargetAttributes(entry: ManifestEntry): Map<string, unknown> {
  const merged = new Map<string, unknown>();
  for (const tr of entry.targetResources) {
    const flat = flattenAttributes(tr.attributes);
    for (const [k, v] of flat) {
      merged.set(k, v);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate the attribute-coverage dimension.
 *
 * Compares flattened source attributes against the union of target attributes.
 * Score = coveredSourceKeys / totalSourceKeys.
 * Also detects extra target keys not present in source (informational).
 */
export function evaluateAttributes(
  source: IrResource,
  entry: ManifestEntry,
): { result: DimensionResult; findings: TranslationFinding[] } {
  const findings: TranslationFinding[] = [];

  const sourceAttrs = flattenAttributes(source.attributes);
  const targetAttrs = collectTargetAttributes(entry);

  // Edge case: no source attributes → perfect score
  if (sourceAttrs.size === 0) {
    return {
      result: {
        dimension: 'attributes',
        score: 1.0,
        maxScore: 1.0,
        details: ['No source attributes to compare'],
      },
      findings,
    };
  }

  // Check coverage: how many source keys have a corresponding target key
  let covered = 0;
  const gaps: string[] = [];

  for (const key of sourceAttrs.keys()) {
    if (targetAttrs.has(key)) {
      covered++;
    } else {
      gaps.push(key);
    }
  }

  // Extra target keys not in source
  const extras: string[] = [];
  for (const key of targetAttrs.keys()) {
    if (!sourceAttrs.has(key)) {
      extras.push(key);
    }
  }

  // Emit findings for gaps
  if (gaps.length > 0) {
    findings.push(
      createEquivalenceFinding(
        source.id,
        'warning',
        FINDING_CODES.EQUIV_ATTRIBUTE_GAP,
        `${gaps.length} source attribute(s) not covered in translation`,
        `Missing: ${gaps.slice(0, 10).join(', ')}${gaps.length > 10 ? ` (+${gaps.length - 10} more)` : ''}`,
      ),
    );
  }

  // Emit findings for extras (informational)
  if (extras.length > 0) {
    findings.push(
      createEquivalenceFinding(
        source.id,
        'info',
        FINDING_CODES.EQUIV_ATTRIBUTE_EXTRA,
        `${extras.length} target attribute(s) have no source counterpart`,
        `Extra: ${extras.slice(0, 10).join(', ')}${extras.length > 10 ? ` (+${extras.length - 10} more)` : ''}`,
      ),
    );
  }

  const score = covered / sourceAttrs.size;

  return {
    result: {
      dimension: 'attributes',
      score,
      maxScore: 1.0,
      details: [
        `Covered ${covered}/${sourceAttrs.size} source attributes`,
        ...(gaps.length > 0 ? [`Gaps: ${gaps.slice(0, 5).join(', ')}`] : []),
      ],
    },
    findings,
  };
}
