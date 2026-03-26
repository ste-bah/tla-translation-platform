/**
 * Classifies resources by their translation readiness based on registry data.
 *
 * Determines `translationStatus` and `confidence` for each resource by
 * inspecting the registry entry's mapping_type and output_mode.
 */

import type { RegistryEntry, TranslationStatus } from '@tla/shared';

/**
 * Classification result for a single resource.
 */
export interface ResourceClassification {
  translationStatus: TranslationStatus;
  confidence: number;
}

/**
 * Classify a resource based on its registry entry.
 *
 * Rules:
 * - No registry entry -> blocked, confidence 0
 * - mapping_type 'none' or band 'M1' -> blocked, confidence 0
 * - output_mode 'advisory_manual' -> advisory, use registry confidence
 * - Otherwise -> pending, use registry confidence
 *
 * @param entry - The registry entry for the resource, if one exists.
 * @param _resourceType - The Terraform resource type string. Reserved for
 *   future use when type-specific classification overrides are needed
 *   (e.g. per-type confidence adjustments). Prefixed with `_` to suppress
 *   unused-variable lint warnings until that logic is added.
 */
export function classifyResource(
  entry: RegistryEntry | undefined,
  _resourceType: string,
): ResourceClassification {
  if (entry === undefined) {
    return { translationStatus: 'blocked', confidence: 0 };
  }

  // M1 band or 'none' mapping type -> blocked
  if (entry.mapping_type === 'none' || entry.band === 'M1') {
    return { translationStatus: 'blocked', confidence: 0 };
  }

  // Advisory manual output mode
  if (entry.output_mode === 'advisory_manual') {
    return { translationStatus: 'advisory', confidence: entry.confidence };
  }

  // Standard translatable resource
  return { translationStatus: 'pending', confidence: entry.confidence };
}
