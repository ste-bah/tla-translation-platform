/**
 * assess command — standalone assessment-only analysis (inventory + registry
 * enrichment + confidence) without running translation.
 *
 * Pipeline:
 *   detect source kind (file | directory)
 *     → parse HCL into ASTs
 *     → identifyAwsServices → ServiceInventory
 *     → load registry, lookupMany for per-resource enrichment
 *     → format and print results
 */

import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import type { Command } from 'commander';
import {
  parseHclFile,
  parseHclDirectory,
  identifyAwsServices,
} from '@tla/ingestion';
import {
  RegistryApi,
  loadRegistryFromDirectory,
  validateRegistryEntries,
} from '@tla/registry';
import type { ServiceInventory } from '@tla/shared';
import type { RegistryEntry } from '@tla/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssessOptions {
  target: 'azure' | 'gcp';
  format: 'text' | 'json';
  registry: string;
}

interface ResourceSummary {
  resource_type: string;
  count: number;
  family: string;
  band?: string;
  confidence?: number;
  target_types: string[];
}

interface ReadinessClassification {
  safe: number;
  review: number;
  blocked: number;
}

interface ReadinessReport {
  score: number;
  classification: ReadinessClassification;
  recommendation: string;
}

interface AssessResult {
  success: true;
  target: 'azure' | 'gcp';
  source: string;
  total_resources: number;
  total_aws_resources: number;
  procedural: number;
  unknown: number;
  by_family: Record<string, number>;
  resources: ResourceSummary[];
  readiness: ReadinessReport;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detects whether a path points to a file or directory.
 */
async function detectSourceKind(sourcePath: string): Promise<'file' | 'directory'> {
  const info = await stat(sourcePath);
  return info.isDirectory() ? 'directory' : 'file';
}

/**
 * Parses HCL from a file or directory and returns the AST array.
 */
async function parseHclSource(
  sourcePath: string,
): Promise<Awaited<ReturnType<typeof parseHclDirectory>>['asts']> {
  const sourceKind = await detectSourceKind(sourcePath);
  if (sourceKind === 'file') {
    const ast = await parseHclFile(sourcePath);
    return [ast];
  }
  const result = await parseHclDirectory(sourcePath);
  return result.asts;
}

/**
 * Builds enriched resource summaries by combining inventory data with
 * registry lookup results.
 */
function buildEnrichedResources(
  inventory: ServiceInventory,
  registryMap: Map<string, RegistryEntry>,
  target: 'azure' | 'gcp',
): ResourceSummary[] {
  return inventory.identified_services.map((s) => {
    const entry = registryMap.get(s.resource_type);
    const targetTypes = entry
      ? (target === 'azure' ? entry.azure_targets : entry.gcp_targets)
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
}

/**
 * Builds family counts from an inventory.
 */
function buildFamilyCounts(inventory: ServiceInventory): Record<string, number> {
  const byFamily: Record<string, number> = {};
  for (const service of inventory.identified_services) {
    byFamily[service.family] = (byFamily[service.family] ?? 0) + service.count;
  }
  return byFamily;
}

/**
 * Computes the readiness report from enriched resource summaries.
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

/**
 * Formats the assessment result as plain text for terminal output.
 */
function formatAssessText(result: AssessResult): string {
  const lines: string[] = [];
  lines.push(`Assessment: ${result.source} → ${result.target}`);
  lines.push('================================');
  lines.push('');
  lines.push(
    `Resources: ${String(result.total_resources)} total (${String(result.total_aws_resources)} AWS, ${String(result.procedural)} procedural, ${String(result.unknown)} unknown)`,
  );
  lines.push('');

  const familyEntries = Object.entries(result.by_family).sort();
  if (familyEntries.length > 0) {
    lines.push('By Family:');
    // Pad family names for alignment
    const maxLen = Math.max(...familyEntries.map(([f]) => f.length));
    for (const [family, count] of familyEntries) {
      lines.push(`  ${family.padEnd(maxLen + 1)} ${String(count)}`);
    }
    lines.push('');
  }

  // Readiness section
  const rd = result.readiness;
  lines.push(
    `Readiness: ${String(rd.score)}% (${String(rd.classification.safe)} safe, ${String(rd.classification.review)} review, ${String(rd.classification.blocked)} blocked)`,
  );
  lines.push(`Recommendation: ${rd.recommendation}`);
  lines.push('');

  if (result.resources.length > 0) {
    lines.push('Registry Enrichment:');
    // Pad resource types for alignment
    const maxTypeLen = Math.max(...result.resources.map((r) => r.resource_type.length));
    for (const r of result.resources) {
      const band = r.band ?? '--';
      const conf = r.confidence !== undefined ? r.confidence.toFixed(2) : '----';
      const target =
        r.target_types.length > 0 ? r.target_types.join(', ') : '(advisory)';
      lines.push(
        `  ${r.resource_type.padEnd(maxTypeLen + 1)} ${band.padEnd(3)} confidence: ${conf}  → ${target}`,
      );
    }
  }

  return lines.join('\n');
}

/**
 * Classifies a caught error into a safe, non-reflective message for stderr.
 */
function classifyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('ENOENT')) {
    return 'Source path or registry directory not found. Check the paths and try again.';
  }
  if (raw.includes('parse') || raw.includes('Parse') || raw.includes('syntax')) {
    return 'Failed to parse HCL source. Check the file for syntax errors.';
  }
  return 'Assessment failed unexpectedly. Check inputs and try again.';
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Registers the `assess` command on a Commander program.
 */
export function registerAssess(program: Command): void {
  program
    .command('assess')
    .description('Assess Terraform HCL — inventory + registry enrichment without translation')
    .argument('<source>', 'Path to .tf file or directory containing .tf files')
    .option('-t, --target <provider>', 'Target cloud provider: azure or gcp', 'azure')
    .option('-f, --format <format>', 'Output format: text or json', 'text')
    .option(
      '-r, --registry <dir>',
      'Path to registry data directory (default: TLA_REGISTRY_DIR env or ./data/registry)',
      process.env['TLA_REGISTRY_DIR'] ?? './data/registry',
    )
    .action(async (source: string, opts: AssessOptions) => {
      try {
        // Validate options
        if (!['azure', 'gcp'].includes(opts.target)) {
          process.stderr.write('Error: --target must be azure or gcp\n');
          process.exitCode = 1;
          return;
        }
        if (!['text', 'json'].includes(opts.format)) {
          process.stderr.write('Error: --format must be text or json\n');
          process.exitCode = 1;
          return;
        }

        const sourcePath = resolve(source);

        // 1. Parse HCL
        const asts = await parseHclSource(sourcePath);
        if (asts.length === 0) {
          process.stderr.write('Error: No .tf files found in the specified source.\n');
          process.exitCode = 1;
          return;
        }

        // 2. Identify AWS services
        const inventory = identifyAwsServices(asts);

        // 3. Load registry and enrich
        const registryDir = resolve(opts.registry);
        const registry = new RegistryApi(
          registryDir,
          loadRegistryFromDirectory,
          validateRegistryEntries,
        );
        await registry.init();

        const resourceTypes = inventory.identified_services.map((s) => s.resource_type);
        const registryMap = registry.lookupMany(resourceTypes);

        // 4. Build result
        const resources = buildEnrichedResources(inventory, registryMap, opts.target);
        const byFamily = buildFamilyCounts(inventory);

        const readiness = computeReadiness(resources);

        const result: AssessResult = {
          success: true,
          target: opts.target,
          source: sourcePath,
          total_resources: inventory.total_resources,
          total_aws_resources: inventory.total_aws_resources,
          procedural: inventory.procedural_resources.length,
          unknown: inventory.unknown_providers.length,
          by_family: byFamily,
          resources,
          readiness,
        };

        // 5. Output
        const out =
          opts.format === 'json'
            ? JSON.stringify(result, null, 2)
            : formatAssessText(result);
        process.stdout.write(out + '\n');
      } catch (err: unknown) {
        process.stderr.write(`Error: ${classifyError(err)}\n`);
        process.exitCode = 1;
      }
    });
}
