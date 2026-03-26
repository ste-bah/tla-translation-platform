// ---------------------------------------------------------------------------
// Drift Detector  (TASK-GAP-007)
//
// Compares two CanonicalIR snapshots and produces a DriftReport describing
// which resources were added, removed, or modified between them.
//
// Design decisions:
//   - Attribute comparison uses JSON.stringify of the attributes object keys
//     (sorted) plus per-key value serialisation so that structural changes
//     are detected without storing actual values in the output.
//   - Only the `attributes` bag is compared; metadata such as confidence,
//     translationStatus, and tags are not considered drift signals.
// ---------------------------------------------------------------------------

import type { CanonicalIR, IrResource } from '@tla/shared';
import type {
  AttributeChange,
  DriftEntry,
  DriftModification,
  DriftReport,
  DriftSummary,
} from './drift-types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toEntry(resource: IrResource): DriftEntry {
  return {
    resourceId: resource.id,
    sourceType: resource.sourceType,
    category: resource.category,
  };
}

/**
 * Compares the `attributes` bags of two resources and returns the list of
 * per-key changes.  Returns an empty array when attributes are identical.
 * Attribute values are serialised with JSON.stringify for comparison but are
 * NOT included in the returned AttributeChange objects.
 */
function diffAttributes(
  currentAttrs: Record<string, unknown>,
  baselineAttrs: Record<string, unknown>,
): AttributeChange[] {
  const changes: AttributeChange[] = [];

  const currentKeys = new Set(Object.keys(currentAttrs));
  const baselineKeys = new Set(Object.keys(baselineAttrs));

  // Keys added in current
  for (const key of currentKeys) {
    if (!baselineKeys.has(key)) {
      changes.push({ key, action: 'added' });
    }
  }

  // Keys removed from current
  for (const key of baselineKeys) {
    if (!currentKeys.has(key)) {
      changes.push({ key, action: 'removed' });
    }
  }

  // Keys present in both — check if value changed
  for (const key of currentKeys) {
    if (baselineKeys.has(key)) {
      const currentVal = JSON.stringify(currentAttrs[key]);
      const baselineVal = JSON.stringify(baselineAttrs[key]);
      if (currentVal !== baselineVal) {
        changes.push({ key, action: 'changed' });
      }
    }
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detects drift between `currentIR` (the live/new state) and `baselineIR`
 * (the previously captured snapshot).
 *
 * Resources are matched by their `id` field.
 */
export function detectDrift(currentIR: CanonicalIR, baselineIR: CanonicalIR): DriftReport {
  // Build lookup maps keyed by resource id
  const currentMap = new Map<string, IrResource>(
    currentIR.resources.map((r) => [r.id, r]),
  );
  const baselineMap = new Map<string, IrResource>(
    baselineIR.resources.map((r) => [r.id, r]),
  );

  const added: DriftEntry[] = [];
  const removed: DriftEntry[] = [];
  const modified: DriftModification[] = [];
  let unchanged = 0;

  // Resources in current that are not in baseline → added
  for (const [id, resource] of currentMap) {
    if (!baselineMap.has(id)) {
      added.push(toEntry(resource));
    }
  }

  // Resources in baseline that are not in current → removed
  for (const [id, resource] of baselineMap) {
    if (!currentMap.has(id)) {
      removed.push(toEntry(resource));
    }
  }

  // Resources present in both → check for attribute modifications
  for (const [id, currentResource] of currentMap) {
    const baselineResource = baselineMap.get(id);
    if (baselineResource === undefined) {
      continue; // already counted as added above
    }

    const changes = diffAttributes(currentResource.attributes, baselineResource.attributes);

    if (changes.length > 0) {
      modified.push({
        resourceId: id,
        sourceType: currentResource.sourceType,
        changes,
      });
    } else {
      unchanged++;
    }
  }

  // Summary
  const totalCurrent = currentIR.resources.length;
  const totalBaseline = baselineIR.resources.length;
  const driftCount = added.length + removed.length + modified.length;
  const maxTotal = Math.max(totalCurrent, totalBaseline);
  const driftPercent = maxTotal === 0 ? 0 : (driftCount / maxTotal) * 100;

  const summary: DriftSummary = {
    totalCurrent,
    totalBaseline,
    added: added.length,
    removed: removed.length,
    modified: modified.length,
    unchanged,
    driftPercent,
  };

  return { added, removed, modified, unchanged, summary };
}
