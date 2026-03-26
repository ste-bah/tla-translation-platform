/**
 * Multi-Provider Handler — classifies Terraform resource types by their
 * originating provider so downstream pipeline stages can decide how to
 * process each resource (translate, preserve, advisory, skip, or flag).
 *
 * Provider classification rules:
 *   'aws'           — aws_* resources: translate to target cloud
 *   'utility'       — random_*, template_*: stateless helpers, preserve as-is
 *   'procedural'    — null_resource, external, terraform_data: advisory output
 *   'orchestration' — helm_*, kubernetes_*: out-of-scope, skip
 *   'target'        — azurerm_*, google_*: already target-cloud, skip
 *   'unknown'       — anything else: flag for manual review
 */

import type { IrResource } from '@tla/shared';
import { createComponentLogger } from '@tla/shared';

const logger = createComponentLogger('multi-provider-handler');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The provider classification bucket for a single Terraform resource type.
 *
 * - 'aws'           → translate to target cloud via the mapping engine
 * - 'utility'       → stateless helper (random_*, template_*); preserve as-is
 * - 'procedural'    → side-effect resource (null_resource, external); emit
 *                     advisory stub, do NOT translate
 * - 'orchestration' → Kubernetes/Helm resource; out of scope, skip entirely
 * - 'target'        → already a target-cloud resource (azurerm_*, google_*);
 *                     skip (nothing to translate)
 * - 'unknown'       → unrecognised provider; flag for manual review
 */
export type ProviderClassification =
  | 'aws'
  | 'utility'
  | 'procedural'
  | 'orchestration'
  | 'target'
  | 'unknown';

// ---------------------------------------------------------------------------
// Internal prefix/exact-match tables
// ---------------------------------------------------------------------------

/**
 * Exact resource types classified as procedural.
 * These are stateful side-effect resources with no cloud-infra counterpart.
 */
const PROCEDURAL_EXACT = new Set<string>([
  'null_resource',
  'terraform_data',
  'external',
  'time_sleep',
  'time_offset',
  'time_rotating',
  'time_static',
]);

/**
 * Prefix-to-classification mapping.
 * Entries are evaluated in order; first match wins.
 */
const PREFIX_TABLE: ReadonlyArray<readonly [string, ProviderClassification]> = [
  // AWS resources — translate
  ['aws_', 'aws'],

  // Utility providers — preserve as-is (stateless, no cloud-infra equivalent)
  ['random_', 'utility'],
  ['template_', 'utility'],

  // Orchestration providers — skip (handled by a separate orchestration layer)
  ['helm_', 'orchestration'],
  ['kubernetes_', 'orchestration'],

  // Target-cloud resources — skip (already translated or natively authored)
  ['azurerm_', 'target'],
  ['google_', 'target'],

  // GCP provider aliases
  ['googleworkspace_', 'target'],
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a single Terraform resource type string.
 *
 * @param resourceType - Full Terraform resource type, e.g. `"aws_s3_bucket"`,
 *   `"null_resource"`, `"helm_release"`.
 * @returns The provider classification for that type.
 *
 * @example
 * classifyProvider('aws_s3_bucket')   // → 'aws'
 * classifyProvider('random_id')       // → 'utility'
 * classifyProvider('null_resource')   // → 'procedural'
 * classifyProvider('helm_release')    // → 'orchestration'
 * classifyProvider('azurerm_storage') // → 'target'
 * classifyProvider('custom_thing')    // → 'unknown'
 */
export function classifyProvider(resourceType: string): ProviderClassification {
  // Exact-match procedural types first (highest specificity)
  if (PROCEDURAL_EXACT.has(resourceType)) {
    return 'procedural';
  }

  // Prefix-based matching
  for (const [prefix, classification] of PREFIX_TABLE) {
    if (resourceType.startsWith(prefix)) {
      return classification;
    }
  }

  return 'unknown';
}

/**
 * Classify a collection of IR resources by provider.
 *
 * @param resources - Array of IR resources to classify.
 * @returns A map from `IrResource.id` to its `ProviderClassification`.
 *
 * @example
 * const map = classifyResources(ir.resources);
 * const classification = map.get(resource.id); // → 'aws' | 'utility' | …
 */
export function classifyResources(
  resources: IrResource[],
): Map<string, ProviderClassification> {
  logger.debug({ count: resources.length }, 'Classifying resources by provider');

  const result = new Map<string, ProviderClassification>();

  for (const resource of resources) {
    const classification = classifyProvider(resource.sourceType);
    result.set(resource.id, classification);
  }

  const counts = countClassifications(result);
  logger.info({ counts, total: resources.length }, 'Provider classification complete');

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Summarise classification counts for logging.
 * @internal
 */
function countClassifications(
  map: Map<string, ProviderClassification>,
): Record<ProviderClassification, number> {
  const counts: Record<ProviderClassification, number> = {
    aws: 0,
    utility: 0,
    procedural: 0,
    orchestration: 0,
    target: 0,
    unknown: 0,
  };
  for (const classification of map.values()) {
    counts[classification]++;
  }
  return counts;
}
