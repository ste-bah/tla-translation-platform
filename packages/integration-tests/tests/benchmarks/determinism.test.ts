/**
 * TASK-NFR-002: Determinism Benchmarks
 *
 * Runs full translation of a fixed 50-resource fixture 3 times and asserts
 * that every run produces bit-for-bit identical output (after normalization).
 *
 * Normalization:
 *   - JSON.stringify with sorted keys
 *   - Strip timestamp fields
 *   - Sort arrays for order-independent comparison
 *
 * Excluded from the default test run — use `npm run test:bench` to execute.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { parseHclDirectory, DependencyGraph, IrEmitter, resolveRegistryKey } from '@tla/ingestion';
import { TranslationCompiler } from '@tla/translator';
import { generateFixture, getFixtureResourceTypes } from './generate-fixture.js';
import type { RegistryEntry } from '@tla/shared';
import type { CompilerOptions, TranslationResult } from '@tla/shared';
import type { RegistryApi as RegistryApiType } from '@tla/registry';

// ---------------------------------------------------------------------------
// Mock registry — same pattern as performance.test.ts
// ---------------------------------------------------------------------------

function makeMockEntry(awsService: string, index: number): RegistryEntry {
  const n = String(index).padStart(3, '0');
  return {
    registry_entry_id: `SER-BENCH-MOCK-${n}`,
    aws_service: awsService,
    aws_family: 'compute',
    azure_targets: [`azurerm_mock_${awsService}`],
    gcp_targets: [`google_mock_${awsService}`],
    mapping_type: 'direct',
    output_mode: 'native_emit_only',
    band: 'P1',
    confidence: 0.85,
    portable_provider_candidate: false,
    behavioral_gaps: [],
    manual_review_required: false,
    review_domains: [],
    test_status: 'unit_tested',
    owner: 'benchmark',
    registry_version: '2025.03.01',
    last_updated: '2025-03-01T00:00:00Z',
    related_requirements: [],
    related_edge_cases: [],
  };
}

function buildMockRegistry(): RegistryApiType {
  const entryMap = new Map<string, RegistryEntry>();
  const fixtureTypes = getFixtureResourceTypes();
  const seenKeys = new Set<string>();

  fixtureTypes.forEach((tfType, idx) => {
    const registryKey = resolveRegistryKey(tfType);
    const key = registryKey ?? tfType;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      entryMap.set(key, makeMockEntry(key, idx + 1));
    }
  });

  return {
    lookup: (awsResourceType: string): RegistryEntry | undefined => {
      const direct = entryMap.get(awsResourceType);
      if (direct) return direct;
      const shortKey = resolveRegistryKey(awsResourceType);
      if (shortKey !== undefined) return entryMap.get(shortKey);
      return undefined;
    },
    lookupMany: (types: ReadonlyArray<string>): Map<string, RegistryEntry> => {
      const result = new Map<string, RegistryEntry>();
      for (const t of types) {
        const shortKey = resolveRegistryKey(t);
        const key = shortKey ?? t;
        const entry = entryMap.get(key);
        if (entry) result.set(t, entry);
      }
      return result;
    },
  } as unknown as RegistryApiType;
}

// ---------------------------------------------------------------------------
// Temp dir helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  const dir = join(tmpdir(), `tla-det-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
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
 *   3. Sort file names
 */
function normalizeResult(result: TranslationResult): string {
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
// Suite-level setup
// ---------------------------------------------------------------------------

let registry: RegistryApiType;
let fixtureDir: string;

beforeAll(() => {
  registry = buildMockRegistry();

  // Generate a fixed 50-resource fixture (written once, read 3 times)
  fixtureDir = createTempDir();
  const hcl = generateFixture(50);
  writeFileSync(join(fixtureDir, 'main.tf'), hcl, 'utf8');
}, 10_000);

afterAll(() => {
  if (fixtureDir) cleanupTempDir(fixtureDir);
});

// ---------------------------------------------------------------------------
// Helper: run the full pipeline from scratch each time
// ---------------------------------------------------------------------------

async function runFullPipeline(): Promise<TranslationResult> {
  const parseResult = await parseHclDirectory(fixtureDir);
  expect(parseResult.errors).toHaveLength(0);

  const graph = new DependencyGraph();
  graph.build(parseResult.asts);

  const emitter = new IrEmitter(registry);
  const emitResult = emitter.emit(parseResult.asts, graph);

  const options: CompilerOptions = {
    targetProvider: 'azure',
    registryVersion: '2025.03.01',
    emitComments: true,
    sortKeys: true,
  };

  const compiler = new TranslationCompiler(registry);
  return compiler.translate(emitResult.ir, options);
}

// ---------------------------------------------------------------------------
// Determinism test
// ---------------------------------------------------------------------------

describe('Determinism', () => {
  it(
    'produces identical SHA-256 hash across 3 independent translation runs on 50 resources',
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
