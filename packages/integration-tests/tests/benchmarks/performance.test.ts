/**
 * TASK-GAP-006: Performance Benchmarks
 *
 * Measures translation pipeline throughput against a 500-resource fixture.
 * Excluded from the default test run — use `npm run test:bench` to execute.
 *
 * Thresholds:
 *   Full translation (parse→IR→translate Azure): < 600 000 ms (10 min)
 *   Assessment only (parse→IR→registry lookup):  < 180 000 ms ( 3 min)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { parseHclDirectory, DependencyGraph, IrEmitter, resolveRegistryKey } from '@tla/ingestion';
import { TranslationCompiler } from '@tla/translator';
import { RegistryApi, loadRegistryFromDirectory, validateRegistryEntries } from '@tla/registry';
import type { RegistryEntry } from '@tla/shared';
import type { CanonicalIR, CompilerOptions } from '@tla/shared';
import type { RegistryApi as RegistryApiType } from '@tla/registry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const FIXTURE_DIR = resolve(__dirname, '../../fixtures/benchmark-500');
const REGISTRY_DIR = resolve(__dirname, '../../../registry/data');

// ---------------------------------------------------------------------------
// Bridge registry (same pattern as e2e-azure.test.ts)
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
        if (entry) result.set(t, entry);
      }
      return result;
    },
  } as unknown as RegistryApiType;
}

// ---------------------------------------------------------------------------
// Suite-level setup — build the shared IR once
// ---------------------------------------------------------------------------

let registry: RegistryApiType;
let ir: CanonicalIR;

beforeAll(async () => {
  // Fixture must exist — run `npx tsx scripts/generate-benchmark-fixture.ts` first.
  expect(
    existsSync(FIXTURE_DIR),
    `Benchmark fixture not found at ${FIXTURE_DIR}. ` +
      'Run: npx tsx scripts/generate-benchmark-fixture.ts',
  ).toBe(true);

  // Parse
  const parseResult = await parseHclDirectory(FIXTURE_DIR);
  expect(
    parseResult.errors,
    `HCL parse errors: ${parseResult.errors.map((e) => e.error.message).join(', ')}`,
  ).toHaveLength(0);
  expect(parseResult.asts.length).toBeGreaterThan(0);

  // Dependency graph
  const graph = new DependencyGraph();
  graph.build(parseResult.asts);

  // Registry
  const realRegistry = new RegistryApi(REGISTRY_DIR, loadRegistryFromDirectory, validateRegistryEntries);
  await realRegistry.init();
  registry = makeBridgeRegistry(realRegistry);

  // IR
  const emitter = new IrEmitter(registry);
  const emitResult = emitter.emit(parseResult.asts, graph);
  ir = emitResult.ir;

  expect(ir.resources.length, 'IR must contain resources').toBeGreaterThan(0);
}, 120_000 /* 2 min setup timeout */);

// ---------------------------------------------------------------------------
// Test 1: Full translation (parse→IR already done in beforeAll; here: translate)
// ---------------------------------------------------------------------------

describe('Performance benchmarks', () => {
  it(
    'full translation (IR→Azure) completes within 10 minutes',
    () => {
      const options: CompilerOptions = {
        targetProvider: 'azure',
        registryVersion: '2025.03.01',
      };
      const compiler = new TranslationCompiler(registry);

      const t0 = performance.now();
      const result = compiler.translate(ir, options);
      const elapsed = performance.now() - t0;

      console.log(
        `Full translation: ${ir.resources.length} resources in ${elapsed.toFixed(0)} ms` +
          ` (${(elapsed / ir.resources.length).toFixed(2)} ms/resource)`,
      );

      expect(result.resources.length, 'Translation produced no output resources').toBeGreaterThan(0);
      expect(elapsed, `Translation exceeded 10-minute threshold (${elapsed.toFixed(0)} ms)`).toBeLessThan(600_000);
    },
    620_000 /* test timeout slightly above threshold */,
  );

  it(
    'assessment only (registry lookup for all IR resources) completes within 3 minutes',
    () => {
      const t0 = performance.now();

      let lookedUp = 0;
      for (const resource of ir.resources) {
        const entry = registry.lookup(resource.sourceType);
        if (entry !== undefined) lookedUp++;
      }

      const elapsed = performance.now() - t0;

      console.log(
        `Assessment: ${ir.resources.length} registry lookups in ${elapsed.toFixed(0)} ms` +
          ` (${lookedUp} mapped, ${ir.resources.length - lookedUp} unmapped)`,
      );

      expect(elapsed, `Assessment exceeded 3-minute threshold (${elapsed.toFixed(0)} ms)`).toBeLessThan(180_000);
    },
    200_000 /* test timeout slightly above threshold */,
  );
});
