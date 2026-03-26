/**
 * TASK-GAP-006: Determinism Benchmarks
 *
 * Runs full translation of the aws-reference-stack fixture 3 times and asserts
 * that every run produces bit-for-bit identical output (after normalization).
 *
 * Normalization:
 *   - JSON.stringify with sorted keys
 *   - Strip timestamp fields
 *   - Sort file-name arrays
 *
 * Excluded from the default test run — use `npm run test:bench` to execute.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseHclDirectory, DependencyGraph, IrEmitter, resolveRegistryKey } from '@tla/ingestion';
import { TranslationCompiler } from '@tla/translator';
import { RegistryApi, loadRegistryFromDirectory, validateRegistryEntries } from '@tla/registry';
import type { RegistryEntry } from '@tla/shared';
import type { CompilerOptions, TranslationResult } from '@tla/shared';
import type { RegistryApi as RegistryApiType } from '@tla/registry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const FIXTURE_DIR = resolve(__dirname, '../../fixtures/aws-reference-stack');
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
// Normalization helpers
// ---------------------------------------------------------------------------

/** Timestamp-like field names to strip before hashing. */
const TIMESTAMP_KEYS = new Set([
  'timestamp',
  'generatedAt',
  'createdAt',
  'updatedAt',
  'translatedAt',
  'completedAt',
  'startedAt',
]);

/**
 * Recursively sort object keys and strip timestamp fields so that
 * structurally identical results hash identically regardless of key
 * insertion order or generation time.
 */
function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeValue).sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      if (TIMESTAMP_KEYS.has(key)) continue;
      sorted[key] = normalizeValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Normalize a TranslationResult for determinism comparison:
 *   1. Strip timestamps
 *   2. Sort all arrays
 *   3. Sort file names (Object.keys order is not guaranteed)
 */
function normalizeResult(result: TranslationResult): string {
  // Normalize the files map by sorting by file name first
  const sortedFiles: Record<string, unknown> = {};
  for (const filename of Object.keys(result.files).sort()) {
    sortedFiles[filename] = result.files[filename];
  }

  const normalized = normalizeValue({
    target: result.target,
    resources: result.resources,
    manifest: result.manifest,
    files: sortedFiles,
  });

  return JSON.stringify(normalized);
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Suite-level setup — build a shared registry (init once)
// ---------------------------------------------------------------------------

let registry: RegistryApiType;

beforeAll(async () => {
  const realRegistry = new RegistryApi(REGISTRY_DIR, loadRegistryFromDirectory, validateRegistryEntries);
  await realRegistry.init();
  registry = makeBridgeRegistry(realRegistry);
}, 30_000);

// ---------------------------------------------------------------------------
// Helper: run the full pipeline from scratch each time
// ---------------------------------------------------------------------------

async function runFullPipeline(): Promise<TranslationResult> {
  const parseResult = await parseHclDirectory(FIXTURE_DIR);
  expect(parseResult.errors).toHaveLength(0);

  const graph = new DependencyGraph();
  graph.build(parseResult.asts);

  const emitter = new IrEmitter(registry);
  const emitResult = emitter.emit(parseResult.asts, graph);

  const options: CompilerOptions = {
    targetProvider: 'azure',
    registryVersion: '2025.03.01',
  };

  const compiler = new TranslationCompiler(registry);
  return compiler.translate(emitResult.ir, options);
}

// ---------------------------------------------------------------------------
// Determinism test
// ---------------------------------------------------------------------------

describe('Determinism', () => {
  it(
    'produces identical SHA-256 hash across 3 independent translation runs',
    async () => {
      const hashes: string[] = [];

      for (let run = 1; run <= 3; run++) {
        const result = await runFullPipeline();
        const normalized = normalizeResult(result);
        const hash = sha256(normalized);
        hashes.push(hash);
        console.log(`  Run ${run}: ${hash}`);
      }

      expect(hashes[0], 'Run 1 hash must be defined').toBeTruthy();
      expect(hashes[1], `Run 2 hash differs from run 1:\n  run1=${hashes[0]}\n  run2=${hashes[1]}`).toBe(hashes[0]);
      expect(hashes[2], `Run 3 hash differs from run 1:\n  run1=${hashes[0]}\n  run3=${hashes[2]}`).toBe(hashes[0]);
    },
    90_000 /* 3 × 30s */,
  );
});
