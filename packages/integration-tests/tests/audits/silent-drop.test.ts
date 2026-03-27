/**
 * TASK-NFR-003: Silent-Drop Audit
 *
 * PRD requires zero silent drops — every source resource must have an
 * explicit status entry in the translation manifest.
 *
 * This test generates a 20-resource fixture, runs the full pipeline
 * (parse -> graph -> IR -> compile), and asserts:
 *   1. manifest.entries.length >= ir.resources.length
 *   2. Every manifest entry has a valid status
 *   3. No IR resource is missing from the manifest (zero orphans)
 *
 * Uses a mock registry (same pattern as performance benchmarks).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parseHclDirectory, DependencyGraph, IrEmitter, resolveRegistryKey } from '@tla/ingestion';
import { TranslationCompiler } from '@tla/translator';
import { generateFixture, getFixtureResourceTypes } from '../benchmarks/generate-fixture.js';
import type { RegistryEntry } from '@tla/shared';
import type { CanonicalIR, CompilerOptions, TranslationResult } from '@tla/shared';
import type { RegistryApi as RegistryApiType } from '@tla/registry';

// ---------------------------------------------------------------------------
// Valid manifest statuses per PRD
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set([
  'translated',
  'expanded',
  'partial',
  'blocked',
  'advisory',
]);

// ---------------------------------------------------------------------------
// Mock registry (same pattern as performance benchmarks)
// ---------------------------------------------------------------------------

function makeMockEntry(awsService: string, index: number): RegistryEntry {
  const n = String(index).padStart(3, '0');
  return {
    registry_entry_id: `SER-AUDIT-MOCK-${n}`,
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
    owner: 'audit',
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
      if (shortKey !== undefined) {
        return entryMap.get(shortKey);
      }
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
  const dir = join(tmpdir(), `tla-audit-${randomUUID()}`);
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
// Suite-level state
// ---------------------------------------------------------------------------

let registry: RegistryApiType;
let ir: CanonicalIR;
let result: TranslationResult;
let fixtureDir: string;

beforeAll(async () => {
  registry = buildMockRegistry();

  // Generate 20-resource fixture
  fixtureDir = createTempDir();
  const hcl = generateFixture(20);
  writeFileSync(join(fixtureDir, 'main.tf'), hcl, 'utf8');

  // Parse
  const parseResult = await parseHclDirectory(fixtureDir);
  expect(
    parseResult.errors,
    `HCL parse errors: ${parseResult.errors.map((e) => e.error.message).join(', ')}`,
  ).toHaveLength(0);
  expect(parseResult.asts.length).toBeGreaterThan(0);

  // Dependency graph
  const graph = new DependencyGraph();
  graph.build(parseResult.asts);

  // IR
  const emitter = new IrEmitter(registry);
  const emitResult = emitter.emit(parseResult.asts, graph);
  ir = emitResult.ir;

  expect(ir.resources.length, 'IR must contain resources').toBeGreaterThan(0);

  // Compile (full translation pipeline)
  const options: CompilerOptions = {
    targetProvider: 'azure',
    registryVersion: '2025.03.01',
    emitComments: true,
    sortKeys: true,
  };
  const compiler = new TranslationCompiler(registry);
  result = compiler.translate(ir, options);
}, 60_000);

afterAll(() => {
  if (fixtureDir) cleanupTempDir(fixtureDir);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Silent-drop audit (TASK-NFR-003)', () => {
  it('manifest has at least as many entries as IR resources', () => {
    expect(
      result.manifest.entries.length,
      `Manifest has ${result.manifest.entries.length} entries but IR has ${ir.resources.length} resources`,
    ).toBeGreaterThanOrEqual(ir.resources.length);
  });

  it('every manifest entry has a valid status', () => {
    for (const entry of result.manifest.entries) {
      expect(
        VALID_STATUSES.has(entry.status),
        `Manifest entry "${entry.sourceId}" has invalid status "${entry.status}". ` +
          `Expected one of: ${[...VALID_STATUSES].join(', ')}`,
      ).toBe(true);
    }
  });

  it('no IR resource is missing from the manifest (zero orphans)', () => {
    const manifestSourceIds = new Set(
      result.manifest.entries.map((e) => e.sourceId),
    );

    const orphans: string[] = [];
    for (const resource of ir.resources) {
      if (!manifestSourceIds.has(resource.id)) {
        orphans.push(`${resource.id} (${resource.sourceType})`);
      }
    }

    expect(
      orphans,
      `Found ${orphans.length} IR resource(s) with no manifest entry (silent drops):\n  ${orphans.join('\n  ')}`,
    ).toHaveLength(0);
  });
});
