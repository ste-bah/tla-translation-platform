/**
 * Handler for the `assess` MCP tool.
 *
 * Parses a .tf file or directory, runs identifyAwsServices to produce an
 * inventory, then enriches each discovered resource type with registry data
 * (band, confidence, target types) via RegistryApi.lookupMany.
 *
 * Never throws — all errors are caught and returned as { success: false, error }.
 */

import {
  parseHclFile,
  parseHclDirectory,
  identifyAwsServices,
} from '@tla/ingestion';
import type { RegistryManager } from '../registry-manager.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AssessArgs {
  /** Absolute path to a .tf file or a directory. */
  source_path: string;
  /** Target cloud provider for registry enrichment. */
  target_provider: 'azure' | 'gcp';
}

export interface ResourceSummary {
  resource_type: string;
  count: number;
  family: string;
  /** Present when a registry entry exists for this resource type. */
  band?: string;
  /** Present when a registry entry exists for this resource type. */
  confidence?: number;
  /** Target type(s) from the registry, or empty when no entry found. */
  target_types: string[];
}

export interface ReadinessClassification {
  safe: number;
  review: number;
  blocked: number;
}

export interface ReadinessReport {
  score: number;
  classification: ReadinessClassification;
  recommendation: string;
}

export interface AssessResult {
  success: true;
  target_provider: 'azure' | 'gcp';
  total_resources: number;
  total_aws_resources: number;
  procedural: number;
  unknown: number;
  resources: ResourceSummary[];
  readiness: ReadinessReport;
}

export interface AssessError {
  success: false;
  error: string;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Executes the assess pipeline.
 *
 * Pipeline:
 *   detect source type (file vs directory from path)
 *     → parse HCL into ASTs
 *     → identifyAwsServices → ServiceInventory
 *     → lookupMany registry entries for discovered types
 *     → return enriched AssessResult
 *
 * Always returns an object; never throws.
 */
export async function handleAssess(
  args: AssessArgs,
  registryManager: RegistryManager,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }> {
  try {
    // 1. Resolve registry
    const registryResult = await registryManager.getRegistry();
    if (!registryResult.ok) {
      return errorContent({ success: false, error: `Registry unavailable: ${registryResult.error}` }, true);
    }
    const api = registryResult.api;

    // 2. Parse source — treat as directory when path has no .tf extension
    const isFile = args.source_path.endsWith('.tf');
    let asts: Awaited<ReturnType<typeof parseHclDirectory>>['asts'];

    if (isFile) {
      const ast = await parseHclFile(args.source_path);
      asts = [ast];
    } else {
      const result = await parseHclDirectory(args.source_path);
      asts = result.asts;
    }

    if (asts.length === 0) {
      return errorContent({ success: false, error: 'No .tf files found at the specified source_path.' }, true);
    }

    // 3. Identify AWS services
    const inventory = identifyAwsServices(asts);

    // 4. Collect distinct resource types for bulk registry lookup
    const resourceTypes = inventory.identified_services.map((s) => s.resource_type);
    const registryMap = api.lookupMany(resourceTypes);

    // 5. Build enriched resource summaries
    const resources: ResourceSummary[] = inventory.identified_services.map((s) => {
      const entry = registryMap.get(s.resource_type);
      const targetTypes = entry
        ? (args.target_provider === 'azure' ? entry.azure_targets : entry.gcp_targets)
        : [];

      const summary: ResourceSummary = {
        resource_type: s.resource_type,
        count: s.count,
        family: s.family,
        target_types: targetTypes,
      };

      if (entry !== undefined) {
        summary.band = entry.band;
        summary.confidence = entry.confidence;
      }

      return summary;
    });

    const readiness = computeReadiness(resources);

    const assessResult: AssessResult = {
      success: true,
      target_provider: args.target_provider,
      total_resources: inventory.total_resources,
      total_aws_resources: inventory.total_aws_resources,
      procedural: inventory.procedural_resources.length,
      unknown: inventory.unknown_providers.length,
      resources,
      readiness,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(assessResult) }],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorContent({ success: false, error: `Assess failed: ${message}` }, true);
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Computes the readiness report from enriched resource summaries.
 *
 * Classification thresholds:
 *   safe    — confidence >= 0.7
 *   review  — confidence in [0.3, 0.7)
 *   blocked — confidence < 0.3 **or** no registry entry (confidence undefined)
 *
 * The overall score is the weighted average of per-resource confidence
 * (weight = resource count), expressed as 0-100.
 */
function computeReadiness(resources: ResourceSummary[]): ReadinessReport {
  let safe = 0;
  let review = 0;
  let blocked = 0;
  let weightedSum = 0;
  let totalCount = 0;

  for (const r of resources) {
    const conf = r.confidence;
    if (conf === undefined || conf < 0.3) {
      blocked += r.count;
    } else if (conf < 0.7) {
      review += r.count;
    } else {
      safe += r.count;
    }
    weightedSum += (conf ?? 0) * r.count;
    totalCount += r.count;
  }

  const score = totalCount > 0 ? Math.round((weightedSum / totalCount) * 100) : 0;
  const total = safe + review + blocked;
  const recommendation =
    `${String(safe)} of ${String(total)} resources translatable. ` +
    `${String(review)} require manual review. ` +
    `${String(blocked)} blocked. ` +
    `Readiness: ${String(score)}%`;

  return {
    score,
    classification: { safe, review, blocked },
    recommendation,
  };
}

function errorContent(
  body: AssessError,
  isError: true,
): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(body) }],
    isError,
  };
}
