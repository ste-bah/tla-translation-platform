/**
 * handleTranslate — implementation of the `translate` MCP tool.
 *
 * Pipeline:
 *   parse HCL (file | directory | inline)
 *     → build dependency graph
 *     → emit Canonical IR
 *     → (assessment) return inventory
 *     → (full/selected) run TranslationCompiler
 *     → write files to outputDir
 *     → return structured result
 *
 * Never throws — all errors are caught and returned as { success: false, error }.
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  parseHclFile,
  parseHclDirectory,
  DependencyGraph,
  IrEmitter,
  identifyAwsServices,
} from '@tla/ingestion';
import { TranslationCompiler, buildTranslationReport } from '@tla/translator';
import type { CanonicalIR, TranslationManifest, TranslationFinding } from '@tla/shared';

import type { RegistryManager } from '../registry-manager.js';
import type { McpServerConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface TranslateArgs {
  /** Absolute file path, directory path, or raw HCL content */
  source: string;
  /** Whether `source` is a file path, directory path, or inline HCL string */
  sourceType: 'file' | 'directory' | 'inline';
  /** Target cloud provider */
  target: 'azure' | 'gcp';
  /** Translation scope */
  scope: 'full' | 'assessment' | 'selected';
  /** Resource addresses to include (only relevant when scope === 'selected') */
  selectedResources?: string[];
  /** Directory to write output files; a temp directory is used when omitted */
  outputDir?: string;
}

export interface TranslateResult {
  success: boolean;
  target?: 'azure' | 'gcp';
  outputDir?: string;
  files?: string[];
  manifest?: ManifestSummary;
  confidence?: number;
  findings?: TranslationFinding[];
  inventory?: InventorySummary;
  error?: string;
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
// Main handler
// ---------------------------------------------------------------------------

/**
 * Executes the full translate pipeline.
 *
 * Always returns a result object; never throws.
 */
export async function handleTranslate(
  args: TranslateArgs,
  _config: McpServerConfig,
  registryManager: RegistryManager,
): Promise<TranslateResult> {
  try {
    // 1. Load registry
    const registryResult = await registryManager.getRegistry();
    if (!registryResult.ok) {
      return { success: false, error: `Registry unavailable: ${registryResult.error}` };
    }
    const registry = registryResult.api;

    // 2. Resolve registry version (used in CompilerOptions)
    const allEntries = registry.search({});
    const registryVersion = allEntries[0]?.registry_version ?? '1.0.0';

    // 3. Parse source HCL into ASTs
    let asts: Awaited<ReturnType<typeof parseHclDirectory>>['asts'];
    let tempDir: string | undefined;

    if (args.sourceType === 'inline') {
      // Write inline HCL to a temp file so the parser can process it
      tempDir = await mkdtemp(join(tmpdir(), 'tla-inline-'));
      const inlineFile = join(tempDir, 'inline.tf');
      await writeFile(inlineFile, args.source, 'utf-8');
      const ast = await parseHclFile(inlineFile);
      asts = [ast];
    } else if (args.sourceType === 'file') {
      const ast = await parseHclFile(args.source);
      asts = [ast];
    } else {
      // directory
      const result = await parseHclDirectory(args.source);
      asts = result.asts;
    }

    if (asts.length === 0) {
      return { success: false, error: 'No .tf files found in the specified source.' };
    }

    // 4. Assessment-only mode — return inventory without running translation
    if (args.scope === 'assessment') {
      return buildAssessmentResult(asts, args.target);
    }

    // 5. Build dependency graph
    const graph = new DependencyGraph();
    graph.build(asts);

    // 6. Emit Canonical IR
    const emitter = new IrEmitter(registry);
    const { ir: fullIr } = emitter.emit(asts, graph);

    // 7. Apply resource filter when scope === 'selected'
    const ir: CanonicalIR =
      args.scope === 'selected' && args.selectedResources && args.selectedResources.length > 0
        ? filterIr(fullIr, args.selectedResources)
        : fullIr;

    // 8. Run translation compiler
    const compiler = new TranslationCompiler(registry);
    const translationResult = compiler.translate(ir, {
      targetProvider: args.target,
      registryVersion,
      emitComments: true,
      sortKeys: true,
    });

    // 9. Determine / create output directory
    const outputDir =
      args.outputDir ??
      (await mkdtemp(join(tmpdir(), `tla-output-${args.target}-`)));

    await mkdir(outputDir, { recursive: true });

    // 10. Write generated files
    const writtenFiles: string[] = [];
    for (const [fileName, content] of Object.entries(translationResult.files)) {
      const filePath = join(outputDir, fileName);
      await writeFile(filePath, content, 'utf-8');
      writtenFiles.push(fileName);
    }

    // 10b. Write manifest.json
    await writeFile(join(outputDir, 'manifest.json'), JSON.stringify(translationResult.manifest, null, 2), 'utf-8');
    writtenFiles.push('manifest.json');

    // 10c. Write translation-report.md
    const report = buildTranslationReport(translationResult, args.source, args.target, outputDir);
    await writeFile(join(outputDir, 'translation-report.md'), report, 'utf-8');
    writtenFiles.push('translation-report.md');

    // 11. Build summary
    const manifest = translationResult.manifest;

    return {
      success: true,
      target: args.target,
      outputDir,
      files: writtenFiles,
      manifest: buildManifestSummary(manifest),
      confidence: manifest.confidenceOverall,
      findings: translationResult.findings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns an inventory of AWS services without running translation.
 */
function buildAssessmentResult(
  asts: Awaited<ReturnType<typeof parseHclDirectory>>['asts'],
  target: 'azure' | 'gcp',
): TranslateResult {
  const inventory = identifyAwsServices(asts);

  const byFamily: Record<string, number> = {};
  for (const service of inventory.identified_services) {
    byFamily[service.family] = (byFamily[service.family] ?? 0) + service.count;
  }

  const inventorySummary: InventorySummary = {
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

  return {
    success: true,
    target,
    inventory: inventorySummary,
  };
}

/**
 * Filters a Canonical IR to only include resources matching `selectedResources`.
 *
 * Each entry in `selectedResources` is expected to be a resource address in
 * the form `<resource_type>.<resource_name>` (Terraform style), which matches
 * the `id` field on IrResource.
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
 * Converts a full TranslationManifest to the condensed summary included in
 * the MCP tool response.
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
