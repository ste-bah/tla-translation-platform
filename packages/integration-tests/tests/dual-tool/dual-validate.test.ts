/**
 * TASK-GAP-011: Dual-tool validation — Terraform and OpenTofu
 *
 * For each available CLI tool (terraform, tofu) this test:
 *   1. Runs the full E2E translation pipeline on the aws-reference-stack fixture
 *      targeting both 'azure' and 'gcp'.
 *   2. Writes the generated .tf files to a temporary directory.
 *   3. Runs `<tool> init -backend=false` then `<tool> validate -json`.
 *   4. Asserts the JSON result contains no errors.
 *
 * Tests are skipped gracefully when a tool is not available on PATH.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve, join, dirname } from 'node:path';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { parseHclDirectory, DependencyGraph, IrEmitter, resolveRegistryKey } from '@tla/ingestion';
import { TranslationCompiler, runTerraformValidate } from '@tla/translator';
import { RegistryApi, loadRegistryFromDirectory, validateRegistryEntries } from '@tla/registry';
import type { RegistryEntry } from '@tla/shared';
import type { CompilerOptions, TranslationResult } from '@tla/shared';
import type { RegistryApi as RegistryApiType } from '@tla/registry';

import { detectTerraformTools } from '../../src/tool-detector.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const FIXTURES_DIR = resolve(__dirname, '../../fixtures/aws-reference-stack');
const REGISTRY_DIR = resolve(__dirname, '../../../registry/data');

// ---------------------------------------------------------------------------
// Bridge registry (same pattern as e2e-azure / e2e-gcp)
// ---------------------------------------------------------------------------

function makeBridgeRegistry(realRegistry: RegistryApi): RegistryApiType {
  return {
    lookup: (awsResourceType: string): RegistryEntry | undefined => {
      const shortKey = resolveRegistryKey(awsResourceType);
      if (shortKey !== undefined) {
        return realRegistry.lookup(shortKey);
      }
      return realRegistry.lookup(awsResourceType);
    },
    lookupMany: (types: ReadonlyArray<string>): Map<string, RegistryEntry> => {
      const result = new Map<string, RegistryEntry>();
      for (const t of types) {
        const entry = makeBridgeRegistry(realRegistry).lookup(t);
        if (entry) {
          result.set(t, entry);
        }
      }
      return result;
    },
  } as unknown as RegistryApiType;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Writes all files from a TranslationResult into a freshly-created temp dir.
 * Returns the temp dir path.
 */
function writeTempDir(result: TranslationResult): string {
  const dir = mkdtempSync(join(tmpdir(), 'tla-validate-'));
  for (const [filename, content] of Object.entries(result.files)) {
    const fullPath = join(dir, filename);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
  }
  return dir;
}

/**
 * Runs the full translation pipeline for the aws-reference-stack fixture
 * against the given target provider and returns the TranslationResult.
 */
async function buildTranslationResult(
  target: 'azure' | 'gcp',
): Promise<TranslationResult> {
  const parseResult = await parseHclDirectory(FIXTURES_DIR);
  expect(
    parseResult.errors,
    `HCL parse errors: ${parseResult.errors.map((e) => e.error.message).join(', ')}`,
  ).toHaveLength(0);

  const graph = new DependencyGraph();
  graph.build(parseResult.asts);

  const realRegistry = new RegistryApi(
    REGISTRY_DIR,
    loadRegistryFromDirectory,
    validateRegistryEntries,
  );
  await realRegistry.init();
  const registry = makeBridgeRegistry(realRegistry);

  const emitter = new IrEmitter(registry);
  const { ir } = emitter.emit(parseResult.asts, graph);

  const options: CompilerOptions = {
    targetProvider: target,
    registryVersion: '2025.03.01',
    emitComments: true,
    sortKeys: false,
  };

  const compiler = new TranslationCompiler(registry);
  return compiler.translate(ir, options);
}

// ---------------------------------------------------------------------------
// Suite-level setup
// ---------------------------------------------------------------------------

let azureResult: TranslationResult;
let gcpResult: TranslationResult;
const tools = detectTerraformTools();

beforeAll(async () => {
  // Only build translation output if at least one tool is available —
  // avoids the expensive pipeline when running in tool-less CI.
  if (!tools.terraform.available && !tools.tofu.available) {
    return;
  }

  [azureResult, gcpResult] = await Promise.all([
    buildTranslationResult('azure'),
    buildTranslationResult('gcp'),
  ]);
}, 60_000);

// ---------------------------------------------------------------------------
// Terraform validation suite
// ---------------------------------------------------------------------------

describe('Terraform CLI dual-tool validation', () => {

  // ---- terraform ----

  describe.skipIf(!tools.terraform.available)(
    `terraform (${tools.terraform.version ?? 'n/a'}) — azure`,
    () => {
      it('terraform validate produces no errors for azure output', () => {
        const dir = writeTempDir(azureResult);
        const runResult = runTerraformValidate(dir, { tool: 'terraform', timeoutMs: 120_000 });

        expect(runResult.ok, `terraform runner failed: ${!runResult.ok ? runResult.message : ''}`).toBe(true);
        if (!runResult.ok) return;

        const parsed = JSON.parse(runResult.stdout) as {
          valid: boolean;
          error_count: number;
          diagnostics: Array<{ severity: string; summary: string }>;
        };

        const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
        expect(
          errors,
          `terraform validate errors (azure): ${errors.map((e) => e.summary).join('; ')}`,
        ).toHaveLength(0);
        expect(parsed.error_count).toBe(0);
      });
    },
  );

  describe.skipIf(!tools.terraform.available)(
    `terraform (${tools.terraform.version ?? 'n/a'}) — gcp`,
    () => {
      it('terraform validate produces no errors for gcp output', () => {
        const dir = writeTempDir(gcpResult);
        const runResult = runTerraformValidate(dir, { tool: 'terraform', timeoutMs: 120_000 });

        expect(runResult.ok, `terraform runner failed: ${!runResult.ok ? runResult.message : ''}`).toBe(true);
        if (!runResult.ok) return;

        const parsed = JSON.parse(runResult.stdout) as {
          valid: boolean;
          error_count: number;
          diagnostics: Array<{ severity: string; summary: string }>;
        };

        const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
        expect(
          errors,
          `terraform validate errors (gcp): ${errors.map((e) => e.summary).join('; ')}`,
        ).toHaveLength(0);
        expect(parsed.error_count).toBe(0);
      });
    },
  );

  // ---- tofu ----

  describe.skipIf(!tools.tofu.available)(
    `tofu (${tools.tofu.version ?? 'n/a'}) — azure`,
    () => {
      it('tofu validate produces no errors for azure output', () => {
        const dir = writeTempDir(azureResult);
        const runResult = runTerraformValidate(dir, { tool: 'tofu', timeoutMs: 120_000 });

        expect(runResult.ok, `tofu runner failed: ${!runResult.ok ? runResult.message : ''}`).toBe(true);
        if (!runResult.ok) return;

        const parsed = JSON.parse(runResult.stdout) as {
          valid: boolean;
          error_count: number;
          diagnostics: Array<{ severity: string; summary: string }>;
        };

        const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
        expect(
          errors,
          `tofu validate errors (azure): ${errors.map((e) => e.summary).join('; ')}`,
        ).toHaveLength(0);
        expect(parsed.error_count).toBe(0);
      });
    },
  );

  describe.skipIf(!tools.tofu.available)(
    `tofu (${tools.tofu.version ?? 'n/a'}) — gcp`,
    () => {
      it('tofu validate produces no errors for gcp output', () => {
        const dir = writeTempDir(gcpResult);
        const runResult = runTerraformValidate(dir, { tool: 'tofu', timeoutMs: 120_000 });

        expect(runResult.ok, `tofu runner failed: ${!runResult.ok ? runResult.message : ''}`).toBe(true);
        if (!runResult.ok) return;

        const parsed = JSON.parse(runResult.stdout) as {
          valid: boolean;
          error_count: number;
          diagnostics: Array<{ severity: string; summary: string }>;
        };

        const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
        expect(
          errors,
          `tofu validate errors (gcp): ${errors.map((e) => e.summary).join('; ')}`,
        ).toHaveLength(0);
        expect(parsed.error_count).toBe(0);
      });
    },
  );

});
