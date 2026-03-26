/**
 * handleMigrateState — implementation of the `migrate-state` MCP tool.
 *
 * Pipeline:
 *   parse state file (v3/v4 JSON)
 *     → load manifest from translationResultDir
 *     → (optional) filter by selectedStacks module prefixes
 *     → call transformState (normalizeState → buildAddressMap → classifyByMappingType)
 *     → detect orphans (state resources not in manifest)
 *     → detect cross-stack dependencies
 *     → (optional) generateBackend config
 *     → (optional) generateRollback manifest
 *     → return structured JSON
 *
 * Security: NEVER includes state resource attribute values in output.
 * Never throws — all errors are caught and returned as structured failures.
 *
 * @module tools/migrate-state
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

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
// Input / output types
// ---------------------------------------------------------------------------

export interface MigrateStateArgs {
  /** Optional path to the AWS Terraform state file. When omitted no state parsing occurs. */
  stateFile?: string;
  /** Path to the translated output directory (must contain manifest.json). */
  translationResultDir: string;
  /** Target cloud provider. */
  target: 'azure' | 'gcp';
  /** Migration scope. */
  scope: 'full' | 'stack';
  /** Module name prefixes to include when scope is "stack". */
  selectedStacks?: string[];
  /** When true, generate target-provider backend configuration. */
  generateBackend: boolean;
  /** When true, include rollback manifest in output. */
  generateRollback: boolean;
}

export interface MigrateStatePlanSummary {
  moves: number;
  imports: number;
  removes: number;
  orphans: number;
  warnings: number;
}

export interface OrphanWarning {
  address: string;
  resourceType: string;
  reason: string;
}

export interface CrossStackWarning {
  sourceAddress: string;
  dependsOnAddress: string;
  reason: string;
}

export interface BackendConfig {
  provider: 'azure' | 'gcp';
  hclSnippet: string;
}

export interface MigrateStateResult {
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

/**
 * Loads and validates a TranslationManifest from translationResultDir.
 *
 * Expects `manifest.json` at the root of the directory.
 */
async function loadManifest(translationResultDir: string): Promise<TranslationManifest> {
  const manifestPath = join(translationResultDir, 'manifest.json');
  const raw = await readFile(manifestPath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;

  // TranslationManifest has a known structure — do a duck-type check before returning
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

/**
 * Parses the state file.
 *
 * Uses the Zod schema from @tla/shared for validation.
 * Never includes attribute values in the returned data (schema strips them as
 * `z.unknown()`, and we never surface `instances[].attributes` in output).
 */
async function loadStateFile(stateFile: string): Promise<StateData> {
  const raw = await readFile(stateFile, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  const result = StateDataSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid state file: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Filters a manifest to only include entries whose sourceId matches one of
 * the selectedStack module prefixes.
 *
 * sourceId is in "type.name" format. Stack scope filters by matching entries
 * that correspond to resources under a specific module prefix in the state.
 * We use the selectedStacks as module name prefixes and match manifest entries
 * whose sourceId starts with any of the stack prefixes (after "module.<stack>.").
 *
 * Since manifest entries use bare "type.name" sourceIds (not module-qualified),
 * we instead filter the state resources by module prefix, then intersect with
 * the manifest entries that correspond to those resources.
 */
function filterManifestByStacks(
  manifest: TranslationManifest,
  selectedStacks: string[],
  stateData: StateData | null,
): TranslationManifest {
  if (selectedStacks.length === 0) return manifest;

  // Collect the set of sourceIds reachable from the selected stacks in state.
  // When no state is available, fall through and return full manifest.
  if (!stateData) return manifest;

  const resources = normalizeState(stateData);

  // Build set of sourceIds (type.name) from resources in selected stacks
  const stackSourceIds = new Set<string>();
  for (const res of resources) {
    for (const stackName of selectedStacks) {
      // Module addresses look like "module.stackName" or "module.stackName.module.nested"
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

/**
 * Detects orphan resources: state resources not correlated to any manifest entry.
 *
 * A resource is an orphan when it is an AWS resource type (aws_* prefix) that
 * has no corresponding manifest entry. Non-AWS resources (data sources are
 * already filtered by normalizeState) are skipped.
 */
function detectOrphans(
  stateData: StateData,
  manifest: TranslationManifest,
): OrphanWarning[] {
  const resources = normalizeState(stateData);
  const manifestSourceIds = new Set(manifest.entries.map((e) => e.sourceId));

  const orphans: OrphanWarning[] = [];

  for (const res of resources) {
    // Only flag AWS-typed resources as orphans
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

/**
 * Detects cross-stack dependencies.
 *
 * When scope is "stack", a cross-stack dependency exists when a state resource
 * in the selected stacks depends on a resource outside those stacks.
 *
 * Only meaningful when scope === "stack" and state file is provided.
 * For V4 state, uses instances[].dependencies. V3 state has depends_on at the
 * resource level.
 *
 * We report these as warnings — cross-stack refs may require manual terraform
 * state pull / push workflows.
 */
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

      // Check dependencies
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
    // V3: uses depends_on at the resource level
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

/**
 * Generates the backend configuration HCL snippet for the target provider.
 *
 * Uses stub S3BackendAttributes since we are generating a template — the actual
 * bucket/container names come from the user's configuration at apply time.
 */
function generateBackendConfig(target: 'azure' | 'gcp'): BackendConfig {
  // Build a minimal stub S3BackendAttributes for template generation.
  // Only fields defined in S3BackendAttributes are included.
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
// Main handler
// ---------------------------------------------------------------------------

/**
 * Generates a state migration plan for moving from AWS Terraform state
 * to the translated target cloud infrastructure.
 *
 * Always returns a result object; never throws.
 */
export async function handleMigrateState(args: MigrateStateArgs): Promise<MigrateStateResult> {
  const findings: TranslationFinding[] = [];

  try {
    const effectiveScope = args.scope ?? 'full';
    const effectiveSelectedStacks = args.selectedStacks ?? [];

    // ---- Load manifest from translationResultDir ---------------------------
    let manifest: TranslationManifest;
    try {
      manifest = await loadManifest(args.translationResultDir);
    } catch (err: unknown) {
      return {
        success: false,
        error: `Failed to load manifest from '${args.translationResultDir}': ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // ---- Load state file (optional) ----------------------------------------
    let stateData: StateData | null = null;
    if (args.stateFile) {
      try {
        stateData = await loadStateFile(args.stateFile);
      } catch (err: unknown) {
        return {
          success: false,
          error: `Failed to parse state file '${args.stateFile}': ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // ---- Apply stack scope filter -------------------------------------------
    const scopedManifest =
      effectiveScope === 'stack' && effectiveSelectedStacks.length > 0
        ? filterManifestByStacks(manifest, effectiveSelectedStacks, stateData)
        : manifest;

    if (effectiveScope === 'stack' && effectiveSelectedStacks.length === 0) {
      findings.push({
        resourceId: '*',
        severity: 'warning',
        code: 'MIGRATE_STATE_SCOPE_EMPTY',
        message: 'scope is "stack" but no selectedStacks were provided — treating as full scope.',
      });
    }

    // ---- Run state transformation (only when state file provided) ----------
    let plan: StateTransformPlan | null = null;
    let orphans: OrphanWarning[] = [];
    let crossStackWarnings: CrossStackWarning[] = [];

    if (stateData) {
      plan = transformState(stateData, scopedManifest);

      // Detect orphan state resources
      orphans = detectOrphans(stateData, scopedManifest);
      if (orphans.length > 0) {
        findings.push({
          resourceId: '*',
          severity: 'warning',
          code: 'MIGRATE_STATE_ORPHANS',
          message: `${orphans.length} state resource(s) have no manifest entry and will not be migrated.`,
        });
      }

      // Detect cross-stack dependencies when stack scope is active
      if (effectiveScope === 'stack' && effectiveSelectedStacks.length > 0) {
        crossStackWarnings = detectCrossStackDependencies(stateData, effectiveSelectedStacks);
        if (crossStackWarnings.length > 0) {
          findings.push({
            resourceId: '*',
            severity: 'warning',
            code: 'MIGRATE_STATE_CROSS_STACK',
            message: `${crossStackWarnings.length} cross-stack dependenc(ies) detected. Manual coordination required.`,
          });
        }
      }
    } else {
      // No state file — produce a manifest-only advisory plan
      findings.push({
        resourceId: '*',
        severity: 'info',
        code: 'MIGRATE_STATE_NO_STATE_FILE',
        message: 'No stateFile provided — returning manifest-only plan without state commands.',
      });
    }

    // ---- Build summary -----------------------------------------------------
    const summary: MigrateStatePlanSummary = {
      moves: plan?.moves.length ?? 0,
      imports: plan?.imports.length ?? 0,
      removes: plan?.removes.length ?? 0,
      orphans: orphans.length,
      warnings: (plan?.warnings.length ?? 0) + crossStackWarnings.length,
    };

    // ---- Backend config (optional) ----------------------------------------
    let backendConfig: BackendConfig | undefined;
    if (args.generateBackend) {
      try {
        backendConfig = generateBackendConfig(args.target);
      } catch (err: unknown) {
        findings.push({
          resourceId: '*',
          severity: 'warning',
          code: 'MIGRATE_STATE_BACKEND_ERROR',
          message: `Backend config generation failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // ---- Rollback manifest (optional) -------------------------------------
    let rollbackManifest: RollbackManifest | undefined;
    if (args.generateRollback && plan) {
      rollbackManifest = plan.rollbackManifest;
    } else if (args.generateRollback && !plan) {
      findings.push({
        resourceId: '*',
        severity: 'info',
        code: 'MIGRATE_STATE_ROLLBACK_SKIP',
        message: 'Rollback manifest skipped: no state file provided.',
      });
    }

    // ---- Build result (NEVER include state attribute values) ---------------
    const result: MigrateStateResult = {
      success: true,
      target: args.target,
      scope: effectiveScope,
      ...(effectiveScope === 'stack' && { selectedStacks: effectiveSelectedStacks }),
      summary,
      // Moves: only address-level information (no attribute values)
      moves: plan?.moves.map((m) => ({
        source: m.source,
        destination: m.destination,
        commandString: m.commandString,
      })) ?? [],
      // Imports: address + resourceType + manualTask flag (no attribute values)
      imports: plan?.imports.map((i) => ({
        address: i.address,
        resourceType: i.resourceType,
        manualTask: i.manualTask,
        commandString: i.commandString,
      })) ?? [],
      // Removes: address + reason (no attribute values)
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
