/**
 * translate command — drives the full TLA translation pipeline from the CLI.
 *
 * Pipeline:
 *   parse HCL (file | directory)
 *     -> build dependency graph
 *     -> emit Canonical IR
 *     -> (assessment) return inventory
 *     -> (full/selected) run TranslationCompiler
 *     -> write files to outputDir
 *     -> format output to stdout
 */

import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { stat, mkdir, writeFile } from 'node:fs/promises';
import type { Command } from 'commander';
import {
  parseHclFile,
  parseHclDirectory,
  DependencyGraph,
  IrEmitter,
  identifyAwsServices,
  extractPlanAddresses,
} from '@tla/ingestion';
import { TranslationCompiler, buildTranslationReport, buildConfidenceReport, buildAuditEntry, appendAuditEntry, generateRemediationPack, buildMigrationPack } from '@tla/translator';
import {
  RegistryApi,
  loadRegistryFromDirectory,
  validateRegistryEntries,
} from '@tla/registry';
import type {
  CanonicalIR,
  TranslationResult,
  TranslationManifest,
  TranslationFinding,
  ServiceInventory,
} from '@tla/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TranslateOptions {
  target: 'azure' | 'gcp';
  output?: string;
  scope: 'full' | 'assessment' | 'selected' | 'stack' | 'module';
  selected?: string[];
  stacks?: string[];
  modules?: string[];
  plan?: string;
  format: 'text' | 'json';
  registry: string;
  assess: boolean;
}

interface ManifestSummary {
  translated: number;
  expanded: number;
  partial: number;
  blocked: number;
  advisory: number;
}

interface InventorySummary {
  totalResources: number;
  totalAwsResources: number;
  byFamily: Record<string, number>;
  byResourceType: Array<{ resourceType: string; count: number; family: string }>;
  procedural: number;
  unknown: number;
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
 * Builds an inventory summary from raw HCL ASTs.
 */
function buildInventorySummary(inventory: ServiceInventory): InventorySummary {
  const byFamily: Record<string, number> = {};
  for (const service of inventory.identified_services) {
    byFamily[service.family] = (byFamily[service.family] ?? 0) + service.count;
  }

  return {
    totalResources: inventory.total_resources,
    totalAwsResources: inventory.total_aws_resources,
    byFamily,
    byResourceType: inventory.identified_services.map((s) => ({
      resourceType: s.resource_type,
      count: s.count,
      family: s.family,
    })),
    procedural: inventory.procedural_resources.length,
    unknown: inventory.unknown_providers.length,
  };
}

/**
 * Formats an inventory assessment as plain text.
 */
function formatInventoryText(inventory: InventorySummary): string {
  const lines: string[] = [];
  lines.push('Assessment Inventory');
  lines.push('====================');
  lines.push('');
  lines.push(`Total resources: ${String(inventory.totalResources)}`);
  lines.push(`AWS resources:   ${String(inventory.totalAwsResources)}`);
  lines.push(`Procedural:      ${String(inventory.procedural)}`);
  lines.push(`Unknown:         ${String(inventory.unknown)}`);
  lines.push('');

  if (Object.keys(inventory.byFamily).length > 0) {
    lines.push('By family:');
    for (const [family, count] of Object.entries(inventory.byFamily).sort()) {
      lines.push(`  ${family}: ${String(count)}`);
    }
    lines.push('');
  }

  if (inventory.byResourceType.length > 0) {
    lines.push('By resource type:');
    for (const entry of inventory.byResourceType) {
      lines.push(`  ${entry.resourceType}: ${String(entry.count)} (${entry.family})`);
    }
  }

  return lines.join('\n');
}

/**
 * Converts a full TranslationManifest to a condensed summary.
 */
function buildManifestSummary(manifest: TranslationManifest): ManifestSummary {
  return {
    translated: manifest.counts.translated,
    expanded: manifest.counts.expanded,
    partial: manifest.counts.partial,
    blocked: manifest.counts.blocked,
    advisory: manifest.counts.advisory,
  };
}

/**
 * Formats a translation result as plain text.
 */
function formatTranslationText(
  result: TranslationResult,
  outputDir: string,
  manifestSummary: ManifestSummary,
): string {
  const lines: string[] = [];
  lines.push('Translation Complete');
  lines.push('====================');
  lines.push('');
  lines.push(`Target:     ${result.target}`);
  lines.push(`Output dir: ${outputDir}`);
  lines.push(`Confidence: ${String(Math.round(result.manifest.confidenceOverall * 100))}%`);
  lines.push('');
  lines.push('Manifest:');
  lines.push(`  Translated: ${String(manifestSummary.translated)}`);
  lines.push(`  Expanded:   ${String(manifestSummary.expanded)}`);
  lines.push(`  Partial:    ${String(manifestSummary.partial)}`);
  lines.push(`  Blocked:    ${String(manifestSummary.blocked)}`);
  lines.push(`  Advisory:   ${String(manifestSummary.advisory)}`);
  lines.push('');

  const fileNames = [...Object.keys(result.files), 'canonical-ir.json', 'manifest.json', 'translation-report.md', 'audit-log.jsonl', 'confidence-report.json'];
  if (manifestSummary.blocked > 0 || manifestSummary.advisory > 0) {
    fileNames.push('migration-pack.md');
  }
  if (fileNames.length > 0) {
    lines.push(`Files written (${String(fileNames.length)}):`);
    for (const name of fileNames.sort()) {
      lines.push(`  ${name}`);
    }
    lines.push('');
  }

  const blockers = result.findings.filter((f) => f.severity === 'blocker');
  const warnings = result.findings.filter((f) => f.severity === 'warning');
  if (blockers.length > 0 || warnings.length > 0) {
    lines.push(`Findings: ${String(blockers.length)} blocker(s), ${String(warnings.length)} warning(s)`);
    for (const finding of blockers) {
      lines.push(`  BLOCKER [${finding.code}] ${finding.resourceId}: ${finding.message}`);
    }
    for (const finding of warnings) {
      lines.push(`  WARNING [${finding.code}] ${finding.resourceId}: ${finding.message}`);
    }
  }

  return lines.join('\n');
}

/**
 * Filters a Canonical IR to only include resources matching `selectedResources`.
 */
function filterIr(ir: CanonicalIR, selectedResources: string[]): CanonicalIR {
  const selected = new Set(selectedResources);
  const filteredResources = ir.resources.filter(
    (r) => selected.has(r.id) || selected.has(`${r.sourceType}.${r.id}`),
  );
  const filteredIds = new Set(filteredResources.map((r) => r.id));

  return {
    ...ir,
    resources: filteredResources,
    relationships: ir.relationships.filter(
      (rel) => filteredIds.has(rel.from) && filteredIds.has(rel.to),
    ),
  };
}

/**
 * Filters a Canonical IR to only include resources whose ID starts with any
 * of the provided stack prefixes (e.g. `module.networking`).
 */
function filterIrByStacks(ir: CanonicalIR, stacks: string[]): CanonicalIR {
  const prefixes = stacks.map((s) => (s.endsWith('.') ? s : `${s}.`));
  const filteredResources = ir.resources.filter((r) =>
    prefixes.some((prefix) => r.id.startsWith(prefix)),
  );
  const filteredIds = new Set(filteredResources.map((r) => r.id));

  return {
    ...ir,
    resources: filteredResources,
    relationships: ir.relationships.filter(
      (rel) => filteredIds.has(rel.from) && filteredIds.has(rel.to),
    ),
    modules: ir.modules.filter((m) =>
      m.resources.some((rid) => filteredIds.has(rid)),
    ),
  };
}

/**
 * Filters a Canonical IR to only include resources that belong to any of the
 * provided module names. Uses `ir.modules` membership first; falls back to
 * resource ID prefix `module.<name>.` when no module entry matches.
 */
function filterIrByModules(ir: CanonicalIR, moduleNames: string[]): CanonicalIR {
  const nameSet = new Set(moduleNames);

  // Collect resource IDs from matching ir.modules entries
  const memberIds = new Set<string>();
  const matchedModules: typeof ir.modules = [];
  for (const mod of ir.modules) {
    if (nameSet.has(mod.name)) {
      matchedModules.push(mod);
      for (const rid of mod.resources) {
        memberIds.add(rid);
      }
    }
  }

  // Fallback: for any module name that had no ir.modules entry, match by ID prefix
  const modulesWithEntries = new Set(matchedModules.map((m) => m.name));
  const fallbackPrefixes = moduleNames
    .filter((n) => !modulesWithEntries.has(n))
    .map((n) => `module.${n}.`);

  const filteredResources = ir.resources.filter(
    (r) =>
      memberIds.has(r.id) ||
      fallbackPrefixes.some((prefix) => r.id.startsWith(prefix)),
  );
  const filteredIds = new Set(filteredResources.map((r) => r.id));

  return {
    ...ir,
    resources: filteredResources,
    relationships: ir.relationships.filter(
      (rel) => filteredIds.has(rel.from) && filteredIds.has(rel.to),
    ),
    modules: matchedModules.length > 0
      ? matchedModules
      : ir.modules.filter((m) => m.resources.some((rid) => filteredIds.has(rid))),
  };
}

/**
 * Filters a Canonical IR to only include resources whose address appears in
 * the provided plan address set. Matches against `${sourceType}.${id}` first
 * (the standard terraform address format), then falls back to bare `id`.
 */
function filterIrByAddresses(ir: CanonicalIR, planAddresses: Set<string>): CanonicalIR {
  const filteredResources = ir.resources.filter(
    (r) => planAddresses.has(`${r.sourceType}.${r.id}`) || planAddresses.has(r.id),
  );
  const filteredIds = new Set(filteredResources.map((r) => r.id));

  return {
    ...ir,
    resources: filteredResources,
    relationships: ir.relationships.filter(
      (rel) => filteredIds.has(rel.from) && filteredIds.has(rel.to),
    ),
  };
}

// ---------------------------------------------------------------------------
// Pipeline helpers
// ---------------------------------------------------------------------------

/**
 * Parses HCL from a file or directory and returns the AST array.
 * Returns an empty array when no .tf files are found in a directory.
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
 * Runs the full compile+write pipeline for scope=full or scope=selected.
 * Returns the TranslationResult and the resolved output directory path.
 */
async function runFullTranslation(
  asts: Awaited<ReturnType<typeof parseHclDirectory>>['asts'],
  opts: TranslateOptions,
  scope: 'full' | 'selected' | 'stack' | 'module',
  sourcePath: string,
): Promise<{ result: TranslationResult; outputDir: string }> {
  // Load registry
  const registryDir = resolve(opts.registry);
  const registry = new RegistryApi(registryDir, loadRegistryFromDirectory, validateRegistryEntries);
  await registry.init();
  const registryVersion = registry.search({})[0]?.registry_version ?? '1.0.0';

  // Build dependency graph and emit Canonical IR
  const graph = new DependencyGraph();
  graph.build(asts);
  const emitter = new IrEmitter(registry);
  const { ir: fullIr } = emitter.emit(asts, graph);

  // Apply resource filter based on scope
  let ir: CanonicalIR;
  if (scope === 'selected' && opts.selected && opts.selected.length > 0) {
    ir = filterIr(fullIr, opts.selected);
  } else if (scope === 'stack' && opts.stacks && opts.stacks.length > 0) {
    ir = filterIrByStacks(fullIr, opts.stacks);
  } else if (scope === 'module' && opts.modules && opts.modules.length > 0) {
    ir = filterIrByModules(fullIr, opts.modules);
  } else {
    ir = fullIr;
  }

  // Apply plan-based address filter (narrows to resources present in the plan)
  if (opts.plan) {
    const planAddresses = await extractPlanAddresses(opts.plan);
    ir = filterIrByAddresses(ir, planAddresses);
  }

  // Run translation compiler
  const startTime = Date.now();
  const compiler = new TranslationCompiler(registry);
  const result = compiler.translate(ir, {
    targetProvider: opts.target,
    registryVersion,
    emitComments: true,
    sortKeys: true,
  });

  // Determine / create output directory and write generated files
  const outputDir = resolve(opts.output ?? `./tla-output-${opts.target}`);
  await mkdir(outputDir, { recursive: true });

  // Persist the Canonical IR so validation can auto-discover it
  await writeFile(resolve(outputDir, 'canonical-ir.json'), JSON.stringify(ir, null, 2), 'utf-8');

  for (const [fileName, content] of Object.entries(result.files)) {
    await writeFile(resolve(outputDir, fileName), content, 'utf-8');
  }

  // Write manifest.json alongside the generated .tf files
  const manifestJson = JSON.stringify(result.manifest, null, 2);
  await writeFile(resolve(outputDir, 'manifest.json'), manifestJson, 'utf-8');

  // Write translation-report.md
  const report = buildTranslationReport(result, sourcePath, opts.target, outputDir);
  await writeFile(resolve(outputDir, 'translation-report.md'), report, 'utf-8');

  // Build artifact hashes for audit integrity
  const artifactHashes: Record<string, string> = {};
  const irJson = JSON.stringify(ir, null, 2);
  artifactHashes['canonical-ir.json'] = createHash('sha256').update(irJson).digest('hex');
  for (const [fileName, content] of Object.entries(result.files)) {
    artifactHashes[fileName] = createHash('sha256').update(content).digest('hex');
  }
  artifactHashes['manifest.json'] = createHash('sha256').update(manifestJson).digest('hex');

  // Write audit trail entry (append-only JSONL)
  const auditEntry = buildAuditEntry(result, sourcePath, opts.target, Date.now() - startTime, manifestJson, artifactHashes);
  await appendAuditEntry(outputDir, auditEntry);

  // Generate migration pack for blocked/advisory resources
  const remediationPack = generateRemediationPack(result.manifest, ir);
  const migrationPackMd = buildMigrationPack(remediationPack);
  if (migrationPackMd !== null) {
    await writeFile(resolve(outputDir, 'migration-pack.md'), migrationPackMd, 'utf-8');
  }

  // Write confidence-report.json
  const confidenceReport = buildConfidenceReport(result);
  await writeFile(
    resolve(outputDir, 'confidence-report.json'),
    JSON.stringify(confidenceReport, null, 2),
    'utf-8',
  );

  return { result, outputDir };
}

/**
 * Validates CLI option values and writes an error + sets exit code on failure.
 * Returns false when validation fails so the caller can return early.
 */
function validateOptions(opts: TranslateOptions): boolean {
  if (!['azure', 'gcp'].includes(opts.target)) {
    process.stderr.write('Error: --target must be azure or gcp\n');
    process.exitCode = 1;
    return false;
  }
  if (!['full', 'assessment', 'selected', 'stack', 'module'].includes(opts.scope)) {
    process.stderr.write('Error: --scope must be full, assessment, selected, stack, or module\n');
    process.exitCode = 1;
    return false;
  }
  if (opts.scope === 'stack' && (!opts.stacks || opts.stacks.length === 0)) {
    process.stderr.write('Error: --stacks is required when --scope is stack\n');
    process.exitCode = 1;
    return false;
  }
  if (opts.scope === 'module' && (!opts.modules || opts.modules.length === 0)) {
    process.stderr.write('Error: --modules is required when --scope is module\n');
    process.exitCode = 1;
    return false;
  }
  return true;
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
  return 'Translation failed unexpectedly. Check inputs and try again.';
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Registers the `translate` command on a Commander program.
 */
export function registerTranslate(program: Command): void {
  program
    .command('translate')
    .description('Translate Terraform HCL from AWS to Azure or GCP')
    .argument('<source>', 'Path to .tf file or directory containing .tf files')
    .option('-t, --target <provider>', 'Target cloud provider: azure or gcp', 'azure')
    .option('-o, --output <dir>', 'Output directory (default: ./tla-output-<target>)')
    .option('-s, --scope <scope>', 'Translation scope: full, assessment, selected, stack, or module', 'full')
    .option('--selected <resources...>', 'Resource addresses to include (scope=selected)')
    .option('--stacks <stacks...>', 'Stack/module prefixes for scope=stack (e.g. module.networking)')
    .option('--modules <modules...>', 'Module names for scope=module (e.g. vpc)')
    .option('--plan <path>', 'Path to terraform plan JSON; only resources present in the plan are translated')
    .option('-f, --format <format>', 'Output format: text or json', 'text')
    .option(
      '-r, --registry <dir>',
      'Path to registry data directory (default: TLA_REGISTRY_DIR env or ./data/registry)',
      process.env['TLA_REGISTRY_DIR'] ?? './data/registry',
    )
    .option('-a, --assess', 'Shorthand for --scope assessment', false)
    .action(async (source: string, opts: TranslateOptions) => {
      try {
        if (!validateOptions(opts)) return;

        const scope: TranslateOptions['scope'] = opts.assess ? 'assessment' : opts.scope;
        const sourcePath = resolve(source);
        const asts = await parseHclSource(sourcePath);

        if (asts.length === 0) {
          process.stderr.write('Error: No .tf files found in the specified source.\n');
          process.exitCode = 1;
          return;
        }

        if (scope === 'assessment') {
          const summary = buildInventorySummary(identifyAwsServices(asts));
          const out =
            opts.format === 'json'
              ? JSON.stringify({ success: true, target: opts.target, inventory: summary }, null, 2)
              : formatInventoryText(summary);
          process.stdout.write(out + '\n');
          return;
        }

        const { result, outputDir } = await runFullTranslation(asts, opts, scope, sourcePath);
        const manifestSummary = buildManifestSummary(result.manifest);
        const hasBlockers = result.findings.some((f: TranslationFinding) => f.severity === 'blocker');

        if (opts.format === 'json') {
          const output = {
            success: true,
            target: opts.target,
            outputDir,
            files: [
              ...Object.keys(result.files),
              'manifest.json',
              'translation-report.md',
              ...(manifestSummary.blocked > 0 || manifestSummary.advisory > 0 ? ['migration-pack.md'] : []),
            ].sort(),
            manifest: manifestSummary,
            confidence: result.manifest.confidenceOverall,
            findings: result.findings,
          };
          process.stdout.write(JSON.stringify(output, null, 2) + '\n');
        } else {
          process.stdout.write(formatTranslationText(result, outputDir, manifestSummary) + '\n');
        }

        if (hasBlockers) {
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        process.stderr.write(`Error: ${classifyError(err)}\n`);
        process.exitCode = 1;
      }
    });
}
