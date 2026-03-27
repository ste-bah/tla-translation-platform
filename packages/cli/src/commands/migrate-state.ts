/**
 * migrate-state command — generates Terraform state migration commands from
 * a translation output directory.
 *
 * Pipeline:
 *   load manifest.json from translated-dir
 *     → (optional) parse .tfstate file via StateDataSchema
 *     → (optional) filter manifest by stack prefixes
 *     → call transformState to produce move/import/remove commands
 *     → detect orphans + cross-stack dependencies
 *     → (optional) generate backend config
 *     → (optional) generate rollback manifest
 *     → format output to stdout
 *
 * Security: NEVER includes state resource attribute values in output.
 *
 * @module commands/migrate-state
 */

import { resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { StateDataSchema } from '@tla/shared';
import type {
  StateData,
  TranslationManifest,
  TranslationFinding,
} from '@tla/shared';
import {
  transformState,
  normalizeState,
  generateAzureBackend,
  generateGcpBackend,
  writeTerraformBlock,
} from '@tla/translator';
import type {
  StateTransformPlan,
  StateMoveCommand,
  StateImportCommand,
  StateRemoveCommand,
  RollbackManifest,
} from '@tla/translator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MigrateStateOptions {
  target: 'azure' | 'gcp';
  scope: 'full' | 'stack';
  stacks?: string[];
  stateFile?: string;
  generateBackend: boolean;
  generateRollback: boolean;
  format: 'text' | 'json';
}

interface MigrateStatePlanSummary {
  moves: number;
  imports: number;
  removes: number;
  orphans: number;
  warnings: number;
}

interface OrphanWarning {
  address: string;
  resourceType: string;
  reason: string;
}

interface CrossStackWarning {
  sourceAddress: string;
  dependsOnAddress: string;
  reason: string;
}

interface BackendConfig {
  provider: 'azure' | 'gcp';
  hclSnippet: string;
}

interface MigrateStateResult {
  success: boolean;
  target?: 'azure' | 'gcp';
  scope?: 'full' | 'stack';
  selectedStacks?: string[];
  summary?: MigrateStatePlanSummary;
  moves?: Pick<StateMoveCommand, 'source' | 'destination' | 'commandString'>[];
  imports?: Pick<StateImportCommand, 'address' | 'resourceType' | 'manualTask' | 'commandString'>[];
  removes?: Pick<StateRemoveCommand, 'address' | 'reason' | 'commandString'>[];
  orphans?: OrphanWarning[];
  crossStackWarnings?: CrossStackWarning[];
  warnings?: string[];
  backendConfig?: BackendConfig;
  rollbackManifest?: RollbackManifest;
  findings?: TranslationFinding[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadManifest(translatedDir: string): Promise<TranslationManifest> {
  const manifestPath = join(translatedDir, 'manifest.json');
  const raw = await readFile(manifestPath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('entries' in parsed) ||
    !Array.isArray((parsed as Record<string, unknown>).entries)
  ) {
    throw new Error('manifest.json is not a valid TranslationManifest (missing entries array)');
  }

  return parsed as TranslationManifest;
}

async function loadStateFile(stateFile: string): Promise<StateData> {
  const raw = await readFile(stateFile, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  const result = StateDataSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid state file: ${result.error.message}`);
  }
  return result.data;
}

function filterManifestByStacks(
  manifest: TranslationManifest,
  selectedStacks: string[],
  stateData: StateData | null,
): TranslationManifest {
  if (selectedStacks.length === 0) return manifest;
  if (!stateData) return manifest;

  const resources = normalizeState(stateData);
  const stackSourceIds = new Set<string>();
  for (const res of resources) {
    for (const stackName of selectedStacks) {
      if (res.address.startsWith(`module.${stackName}`)) {
        stackSourceIds.add(`${res.type}.${res.name}`);
        break;
      }
    }
  }

  return {
    ...manifest,
    entries: manifest.entries.filter((e) => stackSourceIds.has(e.sourceId)),
  };
}

function detectOrphans(
  stateData: StateData,
  manifest: TranslationManifest,
): OrphanWarning[] {
  const resources = normalizeState(stateData);
  const manifestSourceIds = new Set(manifest.entries.map((e) => e.sourceId));
  const orphans: OrphanWarning[] = [];

  for (const res of resources) {
    if (!res.type.startsWith('aws_')) continue;
    const sourceId = `${res.type}.${res.name}`;
    if (!manifestSourceIds.has(sourceId)) {
      orphans.push({
        address: res.address,
        resourceType: res.type,
        reason: `Resource '${res.address}' (${res.type}) has no corresponding manifest entry — may be untranslatable or out of scope.`,
      });
    }
  }

  return orphans.sort((a, b) => a.address.localeCompare(b.address));
}

function detectCrossStackDependencies(
  stateData: StateData,
  selectedStacks: string[],
): CrossStackWarning[] {
  if (selectedStacks.length === 0) return [];

  const warnings: CrossStackWarning[] = [];

  if (stateData.version === 4) {
    for (const res of stateData.resources) {
      if (res.mode === 'data') continue;
      const prefix = res.module ? `${res.module}.` : '';
      const address = `${prefix}${res.type}.${res.name}`;

      const inSelectedStack = selectedStacks.some((s) =>
        address.startsWith(`module.${s}`),
      );
      if (!inSelectedStack) continue;

      for (const instance of res.instances) {
        for (const dep of instance.dependencies) {
          const depInStack = selectedStacks.some((s) =>
            dep.startsWith(`module.${s}`),
          );
          if (!depInStack) {
            warnings.push({
              sourceAddress: address,
              dependsOnAddress: dep,
              reason: `Cross-stack dependency: '${address}' depends on '${dep}' which is outside the selected stacks. Manual coordination may be required.`,
            });
          }
        }
      }
    }
  } else {
    for (const mod of stateData.modules) {
      let prefix = '';
      if (mod.path.length > 1) {
        prefix =
          mod.path
            .slice(1)
            .map((p) => `module.${p}`)
            .join('.') + '.';
      }

      const modInStack = selectedStacks.some((s) => prefix.startsWith(`module.${s}`));
      if (!modInStack) continue;

      for (const [key, res] of Object.entries(mod.resources)) {
        const address = `${prefix}${key}`;
        for (const dep of res.depends_on) {
          const depInStack = selectedStacks.some((s) =>
            dep.startsWith(`module.${s}`),
          );
          if (!depInStack) {
            warnings.push({
              sourceAddress: address,
              dependsOnAddress: dep,
              reason: `Cross-stack dependency: '${address}' depends on '${dep}' which is outside the selected stacks. Manual coordination may be required.`,
            });
          }
        }
      }
    }
  }

  return warnings.sort((a, b) => a.sourceAddress.localeCompare(b.sourceAddress));
}

function generateBackendConfig(target: 'azure' | 'gcp'): BackendConfig {
  const stubAttrs = {
    bucket: '<YOUR_S3_BUCKET>',
    key: '<YOUR_STATE_KEY>',
    region: 'us-east-1',
    encrypt: true,
  };

  let hclSnippet: string;
  if (target === 'azure') {
    const backendEntry = generateAzureBackend(stubAttrs);
    hclSnippet = writeTerraformBlock([backendEntry]);
  } else {
    const backendEntry = generateGcpBackend(stubAttrs);
    hclSnippet = writeTerraformBlock([backendEntry]);
  }

  return { provider: target, hclSnippet };
}

// ---------------------------------------------------------------------------
// Core migration logic
// ---------------------------------------------------------------------------

async function runMigration(
  translatedDir: string,
  opts: MigrateStateOptions,
): Promise<MigrateStateResult> {
  const findings: TranslationFinding[] = [];

  const effectiveScope = opts.scope;
  const effectiveSelectedStacks = opts.stacks ?? [];

  // Load manifest
  let manifest: TranslationManifest;
  try {
    manifest = await loadManifest(translatedDir);
  } catch (err: unknown) {
    return {
      success: false,
      error: `Failed to load manifest: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Load state file (optional)
  let stateData: StateData | null = null;
  if (opts.stateFile) {
    try {
      stateData = await loadStateFile(resolve(opts.stateFile));
    } catch (err: unknown) {
      return {
        success: false,
        error: `Failed to parse state file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Apply stack scope filter
  const scopedManifest =
    effectiveScope === 'stack' && effectiveSelectedStacks.length > 0
      ? filterManifestByStacks(manifest, effectiveSelectedStacks, stateData)
      : manifest;

  if (effectiveScope === 'stack' && effectiveSelectedStacks.length === 0) {
    findings.push({
      resourceId: '*',
      severity: 'warning',
      code: 'MIGRATE_STATE_SCOPE_EMPTY',
      message: 'scope is "stack" but no stacks were provided — treating as full scope.',
    });
  }

  // Run state transformation (only when state file provided)
  let plan: StateTransformPlan | null = null;
  let orphans: OrphanWarning[] = [];
  let crossStackWarnings: CrossStackWarning[] = [];

  if (stateData) {
    plan = transformState(stateData, scopedManifest);

    orphans = detectOrphans(stateData, scopedManifest);
    if (orphans.length > 0) {
      findings.push({
        resourceId: '*',
        severity: 'warning',
        code: 'MIGRATE_STATE_ORPHANS',
        message: `${String(orphans.length)} state resource(s) have no manifest entry and will not be migrated.`,
      });
    }

    if (effectiveScope === 'stack' && effectiveSelectedStacks.length > 0) {
      crossStackWarnings = detectCrossStackDependencies(stateData, effectiveSelectedStacks);
      if (crossStackWarnings.length > 0) {
        findings.push({
          resourceId: '*',
          severity: 'warning',
          code: 'MIGRATE_STATE_CROSS_STACK',
          message: `${String(crossStackWarnings.length)} cross-stack dependenc(ies) detected. Manual coordination required.`,
        });
      }
    }
  } else {
    findings.push({
      resourceId: '*',
      severity: 'info',
      code: 'MIGRATE_STATE_NO_STATE_FILE',
      message: 'No state file provided — returning manifest-only plan without state commands.',
    });
  }

  // Build summary
  const summary: MigrateStatePlanSummary = {
    moves: plan?.moves.length ?? 0,
    imports: plan?.imports.length ?? 0,
    removes: plan?.removes.length ?? 0,
    orphans: orphans.length,
    warnings: (plan?.warnings.length ?? 0) + crossStackWarnings.length,
  };

  // Backend config (optional)
  let backendConfig: BackendConfig | undefined;
  if (opts.generateBackend) {
    try {
      backendConfig = generateBackendConfig(opts.target);
    } catch (err: unknown) {
      findings.push({
        resourceId: '*',
        severity: 'warning',
        code: 'MIGRATE_STATE_BACKEND_ERROR',
        message: `Backend config generation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Rollback manifest (optional)
  let rollbackManifest: RollbackManifest | undefined;
  if (opts.generateRollback && plan) {
    rollbackManifest = plan.rollbackManifest;
  } else if (opts.generateRollback && !plan) {
    findings.push({
      resourceId: '*',
      severity: 'info',
      code: 'MIGRATE_STATE_ROLLBACK_SKIP',
      message: 'Rollback manifest skipped: no state file provided.',
    });
  }

  // Build result (NEVER include state attribute values)
  const result: MigrateStateResult = {
    success: true,
    target: opts.target,
    scope: effectiveScope,
    ...(effectiveScope === 'stack' && { selectedStacks: effectiveSelectedStacks }),
    summary,
    moves: plan?.moves.map((m) => ({
      source: m.source,
      destination: m.destination,
      commandString: m.commandString,
    })) ?? [],
    imports: plan?.imports.map((i) => ({
      address: i.address,
      resourceType: i.resourceType,
      manualTask: i.manualTask,
      commandString: i.commandString,
    })) ?? [],
    removes: plan?.removes.map((r) => ({
      address: r.address,
      reason: r.reason,
      commandString: r.commandString,
    })) ?? [],
    orphans,
    crossStackWarnings,
    warnings: [
      ...(plan?.warnings ?? []),
      ...crossStackWarnings.map((w) => w.reason),
    ],
    findings,
  };

  if (backendConfig) result.backendConfig = backendConfig;
  if (rollbackManifest) result.rollbackManifest = rollbackManifest;

  return result;
}

// ---------------------------------------------------------------------------
// Text formatter
// ---------------------------------------------------------------------------

function formatMigrationText(result: MigrateStateResult, translatedDir: string): string {
  const lines: string[] = [];
  lines.push(`Migration Plan: ${translatedDir} → ${String(result.target)}`);
  lines.push('='.repeat(45));
  lines.push('');

  if (!result.success) {
    lines.push(`Error: ${result.error ?? 'Unknown error'}`);
    return lines.join('\n');
  }

  const s = result.summary;
  if (s) {
    lines.push(`Scope:    ${String(result.scope)}`);
    if (result.selectedStacks && result.selectedStacks.length > 0) {
      lines.push(`Stacks:   ${result.selectedStacks.join(', ')}`);
    }
    lines.push('');
  }

  // Commands (moves)
  const moves = result.moves ?? [];
  const imports = result.imports ?? [];
  const removes = result.removes ?? [];
  const totalCommands = moves.length + imports.length + removes.length;

  if (totalCommands > 0) {
    lines.push(`Commands (${String(totalCommands)}):`);
    for (const m of moves) {
      lines.push(`  ${m.commandString}`);
    }
    for (const i of imports) {
      lines.push(`  ${i.commandString}`);
    }
    for (const r of removes) {
      lines.push(`  ${r.commandString}`);
    }
    lines.push('');
  } else {
    lines.push('Commands (0):');
    lines.push('  (no state file provided — manifest-only plan)');
    lines.push('');
  }

  // Orphans
  const orphans = result.orphans ?? [];
  if (orphans.length > 0) {
    lines.push(`Orphans (${String(orphans.length)}):`);
    for (const o of orphans) {
      lines.push(`  ${o.address} — not in translation manifest`);
    }
    lines.push('');
  }

  // Cross-stack warnings
  const crossStack = result.crossStackWarnings ?? [];
  if (crossStack.length > 0) {
    lines.push(`Cross-Stack Dependencies (${String(crossStack.length)}):`);
    for (const w of crossStack) {
      lines.push(`  ${w.sourceAddress} → ${w.dependsOnAddress}`);
    }
    lines.push('');
  }

  // Backend config
  if (result.backendConfig) {
    lines.push('Backend Config:');
    lines.push(result.backendConfig.hclSnippet);
    lines.push('');
  }

  // Rollback
  if (result.rollbackManifest) {
    const rb = result.rollbackManifest;
    const rbCount = (rb.inverseMoves?.length ?? 0) + (rb.inverseImports?.length ?? 0);
    lines.push(`Rollback (${String(rbCount)} commands):`);
    for (const im of rb.inverseMoves ?? []) {
      lines.push(`  ${im.commandString}`);
    }
    for (const ii of rb.inverseImports ?? []) {
      lines.push(`  ${ii.commandString}`);
    }
    lines.push('');
  }

  // Findings
  const findings = result.findings ?? [];
  if (findings.length > 0) {
    lines.push(`Findings (${String(findings.length)}):`);
    for (const f of findings) {
      lines.push(`  ${f.severity.toUpperCase()} [${f.code}] ${f.resourceId}: ${f.message}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Error classification (safe — never echoes user input)
// ---------------------------------------------------------------------------

function classifyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('ENOENT')) {
    return 'Translated directory or state file not found. Check the paths and try again.';
  }
  if (raw.includes('JSON') || raw.includes('parse') || raw.includes('Parse')) {
    return 'Failed to parse manifest or state file. Ensure they contain valid JSON.';
  }
  if (raw.includes('EACCES') || raw.includes('permission')) {
    return 'Permission denied when reading files. Check file permissions.';
  }
  return 'Migration plan generation failed unexpectedly. Check inputs and try again.';
}

// ---------------------------------------------------------------------------
// Option validation
// ---------------------------------------------------------------------------

const VALID_TARGETS = new Set(['azure', 'gcp']);
const VALID_SCOPES = new Set(['full', 'stack']);
const VALID_FORMATS = new Set(['text', 'json']);

function validateOptions(opts: MigrateStateOptions): boolean {
  if (!VALID_TARGETS.has(opts.target)) {
    process.stderr.write('Error: --target must be azure or gcp\n');
    process.exitCode = 1;
    return false;
  }
  if (!VALID_SCOPES.has(opts.scope)) {
    process.stderr.write('Error: --scope must be full or stack\n');
    process.exitCode = 1;
    return false;
  }
  if (!VALID_FORMATS.has(opts.format)) {
    process.stderr.write('Error: --format must be text or json\n');
    process.exitCode = 1;
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Registers the `migrate-state` command on a Commander program.
 */
export function registerMigrateState(program: Command): void {
  program
    .command('migrate-state')
    .description('Generate Terraform state migration commands from translated output')
    .argument('<translated-dir>', 'Path to directory containing translated .tf files + manifest.json')
    .option('-t, --target <provider>', 'Target cloud provider: azure or gcp', 'azure')
    .option('-s, --scope <scope>', 'Migration scope: full or stack', 'full')
    .option('--stacks <stacks...>', 'Stack prefixes when scope=stack')
    .option('--state-file <path>', 'Path to source .tfstate file (optional)')
    .option('--generate-backend', 'Generate target backend config', false)
    .option('--generate-rollback', 'Generate rollback manifest', false)
    .option('-f, --format <format>', 'Output format: text or json', 'text')
    .action(async (translatedDirArg: string, opts: MigrateStateOptions) => {
      try {
        if (!validateOptions(opts)) return;

        const translatedDir = resolve(translatedDirArg);
        const result = await runMigration(translatedDir, opts);

        if (!result.success) {
          process.stderr.write(`Error: ${result.error ?? 'Unknown error'}\n`);
          process.exitCode = 1;
          return;
        }

        if (opts.format === 'json') {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        } else {
          process.stdout.write(formatMigrationText(result, translatedDir) + '\n');
        }
      } catch (err: unknown) {
        process.stderr.write(`Error: ${classifyError(err)}\n`);
        process.exitCode = 1;
      }
    });
}
