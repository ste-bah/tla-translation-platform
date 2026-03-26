/**
 * Plan preview mode: produces a per-resource preview of what a translation
 * run would do, without executing any mapping engine.
 *
 * Uses registry.lookup() to determine band, confidence, and target types for
 * each resource in the IR, then aggregates summary counts.
 *
 * @module plan-previewer
 */

import type { CanonicalIR, RegistryEntry } from '@tla/shared';
import type { CloudProvider, TranslationBand } from '@tla/shared';
import type { TranslationItemStatus } from '@tla/shared';
import type { RegistryApi } from '@tla/registry';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Preview for a single IR resource — what the translation engine would do
 * if it ran, derived purely from registry metadata.
 */
export interface ResourcePreviewItem {
  /** Terraform resource type (e.g. "aws_vpc") */
  sourceType: string;
  /** Logical name in the Terraform config (e.g. "main") */
  sourceName: string;
  /**
   * Predicted translation status, using the same classification rules as
   * the TranslationPlanner:
   *   - no registry entry → "blocked"
   *   - mapping_type "none" OR band "M1" → "advisory"
   *   - mapping_type "compound" | "structural" → "expanded"
   *   - otherwise → "translated"
   */
  status: TranslationItemStatus;
  /**
   * Target resource type names for the given cloud provider.
   * Empty when status is "blocked" or "advisory".
   */
  targetTypes: string[];
  /** Registry confidence score (0–1), or 0 when no entry found. */
  confidence: number;
  /** Registry translation band, or null when no entry found. */
  band: TranslationBand | null;
  /**
   * Human-readable manual task descriptions derived from behavioral gaps
   * that require manual review.
   */
  manualTasks: string[];
}

/**
 * Aggregate summary counts across all previewed resources.
 */
export interface PreviewSummary {
  total: number;
  translated: number;
  expanded: number;
  partial: number;
  blocked: number;
  advisory: number;
  /** Weighted average confidence over all resources (0–1). */
  overallConfidence: number;
}

/**
 * Full translation preview result returned by previewTranslation().
 */
export interface TranslationPreview {
  target: CloudProvider;
  items: ResourcePreviewItem[];
  summary: PreviewSummary;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Applies the same status classification rules as TranslationPlanner.classifyPlanStatus.
 */
function classifyStatus(entry: RegistryEntry | undefined): TranslationItemStatus {
  if (!entry) {
    return 'blocked';
  }

  if (entry.mapping_type === 'none' || entry.band === 'M1') {
    return 'advisory';
  }

  if (entry.mapping_type === 'compound' || entry.mapping_type === 'structural') {
    return 'expanded';
  }

  return 'translated';
}

/**
 * Returns the target type list for the given cloud provider from a registry entry.
 * Returns an empty array for statuses that produce no translated output.
 */
function resolveTargetTypes(
  entry: RegistryEntry,
  target: CloudProvider,
  status: TranslationItemStatus,
): string[] {
  if (status === 'blocked' || status === 'advisory') {
    return [];
  }

  return target === 'azure' ? entry.azure_targets : entry.gcp_targets;
}

/**
 * Collects manual task descriptions from gaps that require manual review.
 */
function collectManualTasks(entry: RegistryEntry | undefined): string[] {
  if (!entry) return [];
  return entry.behavioral_gaps
    .filter((g) => g.requires_manual_review)
    .map((g) => g.description);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Produces a plan-only preview of a translation run.
 *
 * Does NOT invoke any mapping engine. Every resource in the IR is looked up
 * in the registry, classified by status, and aggregated into summary counts.
 *
 * @param ir     - The canonical IR to preview.
 * @param target - The target cloud provider ("azure" | "gcp").
 * @param registry - Initialized RegistryApi instance.
 * @returns TranslationPreview with per-resource items and aggregate summary.
 */
export function previewTranslation(
  ir: CanonicalIR,
  target: CloudProvider,
  registry: RegistryApi,
): TranslationPreview {
  const items: ResourcePreviewItem[] = [];

  let totalConfidence = 0;
  const summary: PreviewSummary = {
    total: 0,
    translated: 0,
    expanded: 0,
    partial: 0,
    blocked: 0,
    advisory: 0,
    overallConfidence: 0,
  };

  for (const resource of ir.resources) {
    const entry = registry.lookup(resource.sourceType);
    const status = classifyStatus(entry);
    const targetTypes = entry ? resolveTargetTypes(entry, target, status) : [];
    const confidence = entry?.confidence ?? 0;
    const band: TranslationBand | null = entry?.band ?? null;
    const manualTasks = collectManualTasks(entry);

    items.push({
      sourceType: resource.sourceType,
      sourceName: resource.sourceName,
      status,
      targetTypes,
      confidence,
      band,
      manualTasks,
    });

    // Accumulate summary
    summary.total += 1;
    summary[status] = (summary[status] as number) + 1;
    totalConfidence += confidence;
  }

  summary.overallConfidence = summary.total > 0 ? totalConfidence / summary.total : 0;

  return { target, items, summary };
}
