/**
 * Handler for the `equivalence-lookup` MCP tool.
 *
 * Supports:
 *  - Single lookup:  service (string), target (azure|gcp|both), detail (summary|full)
 *  - Bulk lookup:    services (string[]) → array of per-service results
 *  - Not-found:      prefix-based nearest-match suggestions from registry
 */

import type { RegistryEntry } from '@tla/shared';
import type { RegistryManager } from '../registry-manager.js';

// ---------------------------------------------------------------------------
// Band descriptions (spec §TASK-MCP-003)
// ---------------------------------------------------------------------------

const BAND_DESCRIPTIONS: Record<string, string> = {
  P1: 'Direct mapping, high confidence',
  P2: 'Parametric mapping',
  N1: 'Requires manual attention',
  M1: 'Manual migration only',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EquivalenceLookupArgs {
  service?: string;
  services?: string[];
  target: 'azure' | 'gcp' | 'both';
  detail: 'summary' | 'full';
}

interface TargetSummary {
  types: string[];
  band: string;
  band_description: string;
  confidence: number;
}

interface TargetFull extends TargetSummary {
  behavioral_gaps: RegistryEntry['behavioral_gaps'];
  related_edge_cases: string[];
}

interface LookupResult {
  found: true;
  aws_resource_type: string;
  azure?: TargetSummary | TargetFull;
  gcp?: TargetSummary | TargetFull;
  mapping_type: string;
  manual_review_required: boolean;
}

interface NotFoundResult {
  found: false;
  aws_resource_type: string;
  message: string;
  suggestions: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Finds nearest-match suggestions by shared prefix (e.g. "aws_s3" for "aws_s3_bucket_foobar").
 * Falls back to same-family (aws_<service>) prefix matching.
 */
function findSuggestions(
  awsResourceType: string,
  allServices: string[],
  maxSuggestions = 5,
): string[] {
  // Build prefix candidates: try increasingly shorter leading segments
  const parts = awsResourceType.split('_');
  const prefixes: string[] = [];
  for (let i = parts.length - 1; i >= 2; i--) {
    prefixes.push(parts.slice(0, i).join('_'));
  }

  const scored = allServices.map((svc) => {
    let score = 0;
    for (const prefix of prefixes) {
      if (svc.startsWith(prefix)) {
        score = prefix.length;
        break;
      }
    }
    return { svc, score };
  });

  // Sort by score descending, then alphabetically for stability
  scored.sort((a, b) => b.score - a.score || a.svc.localeCompare(b.svc));

  // Return top N that have at least some common prefix
  return scored
    .filter((x) => x.score > 0)
    .slice(0, maxSuggestions)
    .map((x) => x.svc);
}

function buildTargetSummary(entry: RegistryEntry, provider: 'azure' | 'gcp'): TargetSummary {
  const types =
    provider === 'azure' ? entry.azure_targets : entry.gcp_targets;
  return {
    types,
    band: entry.band,
    band_description: BAND_DESCRIPTIONS[entry.band] ?? entry.band,
    confidence: entry.confidence,
  };
}

function buildTargetFull(entry: RegistryEntry, provider: 'azure' | 'gcp'): TargetFull {
  return {
    ...buildTargetSummary(entry, provider),
    behavioral_gaps: entry.behavioral_gaps,
    related_edge_cases: entry.related_edge_cases,
  };
}

function buildProviderResult(
  entry: RegistryEntry,
  provider: 'azure' | 'gcp',
  detail: 'summary' | 'full',
): TargetSummary | TargetFull {
  return detail === 'full'
    ? buildTargetFull(entry, provider)
    : buildTargetSummary(entry, provider);
}

function buildLookupResult(
  entry: RegistryEntry,
  target: 'azure' | 'gcp' | 'both',
  detail: 'summary' | 'full',
): LookupResult {
  const result: LookupResult = {
    found: true,
    aws_resource_type: entry.aws_service,
    mapping_type: entry.mapping_type,
    manual_review_required: entry.manual_review_required,
  };

  if (target === 'azure' || target === 'both') {
    result.azure = buildProviderResult(entry, 'azure', detail);
  }
  if (target === 'gcp' || target === 'both') {
    result.gcp = buildProviderResult(entry, 'gcp', detail);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public handler
// ---------------------------------------------------------------------------

export async function handleEquivalenceLookup(
  args: EquivalenceLookupArgs,
  registryManager: RegistryManager,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }> {
  try {
  const registryResult = await registryManager.getRegistry();
  if (!registryResult.ok) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ error: 'tool_error', message: registryResult.error }),
        },
      ],
      isError: true,
    };
  }

  const api = registryResult.api;
  const allEntries = api.search({});
  const allServices = allEntries.map((e) => e.aws_service);

  // ---- Bulk lookup ----------------------------------------------------------
  if (args.services !== undefined && args.services.length > 0) {
    const results: Array<LookupResult | NotFoundResult> = args.services.map((svcType) => {
      const entry = api.lookup(svcType);
      if (!entry) {
        const suggestions = findSuggestions(svcType, allServices);
        return {
          found: false as const,
          aws_resource_type: svcType,
          message: `No registry entry found for '${svcType}'.`,
          suggestions,
        };
      }
      return buildLookupResult(entry, args.target, args.detail);
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ results }),
        },
      ],
    };
  }

  // ---- Single lookup --------------------------------------------------------
  const svcType = args.service ?? '';
  const entry = api.lookup(svcType);

  if (!entry) {
    const suggestions = findSuggestions(svcType, allServices);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            found: false,
            aws_resource_type: svcType,
            message: `No registry entry found for '${svcType}'.`,
            suggestions,
          }),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(buildLookupResult(entry, args.target, args.detail)),
      },
    ],
  };
  } catch (_err: unknown) {
    const message = _err instanceof Error ? _err.message : String(_err);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ error: 'tool_error', message: `Equivalence lookup failed: ${message}` }),
        },
      ],
      isError: true,
    };
  }
}
