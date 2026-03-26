import type { RegistryEntry, TranslationBand } from '@tla/shared';
import type {
  BreakingChange,
  ModifiedEntry,
  RegistryDiff,
  RegistryDiffOptions,
} from './types.js';

/**
 * Numeric rank for translation bands (higher = more confident).
 * Used to detect band downgrades as breaking changes.
 */
const BAND_RANK: Record<TranslationBand, number> = {
  P1: 4,
  P2: 3,
  N1: 2,
  M1: 1,
};

/**
 * Fields to compare when detecting modifications.
 * Excludes metadata fields like last_updated and registry_version.
 */
const COMPARABLE_FIELDS: ReadonlyArray<keyof RegistryEntry> = [
  'aws_service',
  'aws_family',
  'azure_targets',
  'gcp_targets',
  'mapping_type',
  'output_mode',
  'band',
  'confidence',
  'portable_provider_candidate',
  'behavioral_gaps',
  'manual_review_required',
  'review_domains',
  'test_status',
  'owner',
  'related_requirements',
  'related_edge_cases',
];

/**
 * Deep-equality check for JSON-serialisable values.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
      if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }

  return false;
}

/**
 * Compares two registry versions and produces a structured diff.
 *
 * This is a pure, synchronous function. It does not throw.
 *
 * Breaking changes are flagged for:
 * - Entry removal
 * - Band downgrade (e.g. P1 -> P2, P2 -> N1)
 * - Confidence drop exceeding threshold (default 0.10)
 * - mapping_type change
 *
 * All output arrays are sorted by registry_entry_id for deterministic results.
 *
 * @param before - Previous version of registry entries
 * @param after - Current version of registry entries
 * @param options - Optional configuration (e.g. confidence drop threshold)
 * @returns A RegistryDiff with added, removed, modified, unchanged, and breaking changes
 */
export function diffRegistries(
  before: ReadonlyArray<RegistryEntry>,
  after: ReadonlyArray<RegistryEntry>,
  options?: RegistryDiffOptions,
): RegistryDiff {
  const confidenceDropThreshold = options?.confidenceDropThreshold ?? 0.10;

  // Build maps by entry ID
  const beforeMap = new Map<string, RegistryEntry>();
  for (const entry of before) {
    beforeMap.set(entry.registry_entry_id, entry);
  }

  const afterMap = new Map<string, RegistryEntry>();
  for (const entry of after) {
    afterMap.set(entry.registry_entry_id, entry);
  }

  const added: string[] = [];
  const removed: string[] = [];
  const modified: ModifiedEntry[] = [];
  const unchanged: string[] = [];
  const breakingChanges: BreakingChange[] = [];

  // Detect removed entries (in before but not in after)
  for (const id of beforeMap.keys()) {
    if (!afterMap.has(id)) {
      removed.push(id);
      breakingChanges.push({
        entryId: id,
        reason: 'Entry removed',
      });
    }
  }

  // Detect added entries (in after but not in before)
  for (const id of afterMap.keys()) {
    if (!beforeMap.has(id)) {
      added.push(id);
    }
  }

  // Detect modified and unchanged entries
  for (const [id, afterEntry] of afterMap) {
    const beforeEntry = beforeMap.get(id);
    if (beforeEntry === undefined) continue; // already captured as 'added'

    const changedFields: string[] = [];
    for (const field of COMPARABLE_FIELDS) {
      if (!deepEqual(beforeEntry[field], afterEntry[field])) {
        changedFields.push(field);
      }
    }

    if (changedFields.length === 0) {
      unchanged.push(id);
    } else {
      modified.push({ entryId: id, changedFields: [...changedFields].sort() });

      // Check for breaking changes in modifications
      // Band downgrade
      const beforeRank = BAND_RANK[beforeEntry.band];
      const afterRank = BAND_RANK[afterEntry.band];
      if (afterRank < beforeRank) {
        breakingChanges.push({
          entryId: id,
          reason: `Band downgraded from ${beforeEntry.band} to ${afterEntry.band}`,
        });
      }

      // Confidence drop
      const drop = beforeEntry.confidence - afterEntry.confidence;
      if (drop > confidenceDropThreshold) {
        breakingChanges.push({
          entryId: id,
          reason: `Confidence dropped by ${drop.toFixed(2)} (from ${String(beforeEntry.confidence)} to ${String(afterEntry.confidence)})`,
        });
      }

      // mapping_type change
      if (beforeEntry.mapping_type !== afterEntry.mapping_type) {
        breakingChanges.push({
          entryId: id,
          reason: `mapping_type changed from "${beforeEntry.mapping_type}" to "${afterEntry.mapping_type}"`,
        });
      }
    }
  }

  // Sort all arrays by entry ID for deterministic output
  added.sort();
  removed.sort();
  modified.sort((a, b) => a.entryId.localeCompare(b.entryId));
  unchanged.sort();
  breakingChanges.sort((a, b) => a.entryId.localeCompare(b.entryId));

  return {
    added,
    removed,
    modified,
    unchanged,
    breakingChanges,
    summary: {
      addedCount: added.length,
      removedCount: removed.length,
      modifiedCount: modified.length,
      unchangedCount: unchanged.length,
      breakingChangeCount: breakingChanges.length,
    },
  };
}
