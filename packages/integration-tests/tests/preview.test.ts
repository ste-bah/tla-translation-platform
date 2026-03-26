/**
 * TASK-INT-005: Diff/Plan Preview Mode
 *
 * Exercises previewTranslation() against the real AWS reference fixture and
 * registry data. Verifies:
 *   - Every IR resource produces a preview item
 *   - Summary counts are internally consistent
 *   - No mapping engine is invoked (plan-only)
 *   - Both azure and gcp targets are handled
 *   - Performance < 5 seconds
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { parseHclDirectory, DependencyGraph, IrEmitter, resolveRegistryKey } from '@tla/ingestion';
import { RegistryApi, loadRegistryFromDirectory, validateRegistryEntries } from '@tla/registry';
import { previewTranslation } from '@tla/translator';
import type { RegistryEntry } from '@tla/shared';
import type { CanonicalIR } from '@tla/shared';
import type { TranslationPreview } from '@tla/translator';
import type { RegistryApi as RegistryApiType } from '@tla/registry';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const FIXTURES_DIR = resolve(__dirname, '../fixtures/aws-reference-stack');
const REGISTRY_DIR = resolve(__dirname, '../../registry/data');

// ---------------------------------------------------------------------------
// Bridge registry wrapper (mirrors e2e-azure.test.ts pattern)
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
// Suite-level setup — parse once, preview for both targets
// ---------------------------------------------------------------------------

let ir: CanonicalIR;
let azurePreview: TranslationPreview;
let gcpPreview: TranslationPreview;
let setupDurationMs: number;

beforeAll(async () => {
  const startMs = Date.now();

  // 1. Parse HCL fixture directory
  const parseResult = await parseHclDirectory(FIXTURES_DIR);
  expect(
    parseResult.errors,
    `HCL parse errors: ${parseResult.errors.map((e) => e.error.message).join(', ')}`,
  ).toHaveLength(0);
  expect(parseResult.asts.length).toBeGreaterThan(0);

  // 2. Build dependency graph
  const graph = new DependencyGraph();
  graph.build(parseResult.asts);

  // 3. Load registry
  const realRegistry = new RegistryApi(REGISTRY_DIR, loadRegistryFromDirectory, validateRegistryEntries);
  await realRegistry.init();
  const registry = makeBridgeRegistry(realRegistry);

  // 4. Emit IR
  const emitter = new IrEmitter(registry);
  const emitResult = emitter.emit(parseResult.asts, graph);
  ir = emitResult.ir;

  expect(ir.resources.length, 'IR should contain at least one resource').toBeGreaterThan(0);

  // 5. Preview for both targets (no engine execution)
  azurePreview = previewTranslation(ir, 'azure', registry as unknown as RegistryApi);
  gcpPreview = previewTranslation(ir, 'gcp', registry as unknown as RegistryApi);

  setupDurationMs = Date.now() - startMs;
}, 30000);

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

describe('Preview performance', () => {
  it('completes setup (parse + IR + two previews) in under 5 seconds', () => {
    expect(setupDurationMs).toBeLessThan(5000);
  });
});

// ---------------------------------------------------------------------------
// Azure preview — structural correctness
// ---------------------------------------------------------------------------

describe('Azure preview — structural correctness', () => {
  it('returns target "azure"', () => {
    expect(azurePreview.target).toBe('azure');
  });

  it('produces one preview item per IR resource', () => {
    expect(azurePreview.items).toHaveLength(ir.resources.length);
  });

  it('every item has a non-empty sourceType and sourceName', () => {
    for (const item of azurePreview.items) {
      expect(item.sourceType.length).toBeGreaterThan(0);
      expect(item.sourceName.length).toBeGreaterThan(0);
    }
  });

  it('every item has a valid status', () => {
    const validStatuses = new Set(['translated', 'expanded', 'partial', 'blocked', 'advisory']);
    for (const item of azurePreview.items) {
      expect(validStatuses.has(item.status)).toBe(true);
    }
  });

  it('confidence is in [0, 1] for every item', () => {
    for (const item of azurePreview.items) {
      expect(item.confidence).toBeGreaterThanOrEqual(0);
      expect(item.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('targetTypes is empty for blocked/advisory items', () => {
    for (const item of azurePreview.items) {
      if (item.status === 'blocked' || item.status === 'advisory') {
        expect(item.targetTypes).toHaveLength(0);
      }
    }
  });

  it('targetTypes is non-empty for translated/expanded items', () => {
    const actionable = azurePreview.items.filter(
      (i) => i.status === 'translated' || i.status === 'expanded',
    );
    // At least some resources should be actionable
    expect(actionable.length).toBeGreaterThan(0);
    for (const item of actionable) {
      expect(item.targetTypes.length).toBeGreaterThan(0);
    }
  });

  it('manualTasks is an array for every item', () => {
    for (const item of azurePreview.items) {
      expect(Array.isArray(item.manualTasks)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Azure preview — summary counts
// ---------------------------------------------------------------------------

describe('Azure preview — summary counts', () => {
  it('summary.total equals IR resource count', () => {
    expect(azurePreview.summary.total).toBe(ir.resources.length);
  });

  it('status counts sum to total', () => {
    const { total, translated, expanded, partial, blocked, advisory } = azurePreview.summary;
    expect(translated + expanded + partial + blocked + advisory).toBe(total);
  });

  it('overallConfidence is in [0, 1]', () => {
    expect(azurePreview.summary.overallConfidence).toBeGreaterThanOrEqual(0);
    expect(azurePreview.summary.overallConfidence).toBeLessThanOrEqual(1);
  });

  it('summary counts are non-negative integers', () => {
    const { total, translated, expanded, partial, blocked, advisory } = azurePreview.summary;
    for (const n of [total, translated, expanded, partial, blocked, advisory]) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('item-level status counts match summary', () => {
    const counts: Record<string, number> = {
      translated: 0, expanded: 0, partial: 0, blocked: 0, advisory: 0,
    };
    for (const item of azurePreview.items) {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
    }
    expect(azurePreview.summary.translated).toBe(counts['translated']);
    expect(azurePreview.summary.expanded).toBe(counts['expanded']);
    expect(azurePreview.summary.partial).toBe(counts['partial']);
    expect(azurePreview.summary.blocked).toBe(counts['blocked']);
    expect(azurePreview.summary.advisory).toBe(counts['advisory']);
  });
});

// ---------------------------------------------------------------------------
// GCP preview — target and parity
// ---------------------------------------------------------------------------

describe('GCP preview — target and parity', () => {
  it('returns target "gcp"', () => {
    expect(gcpPreview.target).toBe('gcp');
  });

  it('produces one preview item per IR resource', () => {
    expect(gcpPreview.items).toHaveLength(ir.resources.length);
  });

  it('gcp summary.total equals azure summary.total', () => {
    expect(gcpPreview.summary.total).toBe(azurePreview.summary.total);
  });

  it('status per resource is the same for azure and gcp (registry-driven)', () => {
    for (let i = 0; i < azurePreview.items.length; i++) {
      const az = azurePreview.items[i]!;
      const gc = gcpPreview.items[i]!;
      expect(gc.sourceType).toBe(az.sourceType);
      expect(gc.sourceName).toBe(az.sourceName);
      // Status is determined by registry entry, not provider — must match
      expect(gc.status).toBe(az.status);
      expect(gc.confidence).toBe(az.confidence);
      expect(gc.band).toBe(az.band);
    }
  });

  it('gcp targetTypes differ from azure targetTypes for actionable resources', () => {
    const actionable = azurePreview.items.filter(
      (i) => i.status === 'translated' || i.status === 'expanded',
    );
    // Find at least one resource where the azure and gcp target types differ
    let foundDifference = false;
    for (let i = 0; i < azurePreview.items.length; i++) {
      const az = azurePreview.items[i]!;
      const gc = gcpPreview.items[i]!;
      if (
        (az.status === 'translated' || az.status === 'expanded') &&
        JSON.stringify(az.targetTypes) !== JSON.stringify(gc.targetTypes)
      ) {
        foundDifference = true;
        break;
      }
    }
    // Only assert if there are actionable resources at all
    if (actionable.length > 0) {
      expect(foundDifference).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// No engine execution guard
// ---------------------------------------------------------------------------

describe('No engine execution', () => {
  it('preview items do not include translated resource attributes (engine output)', () => {
    // ResourcePreviewItem does NOT have an "attributes" or "targetResources" field
    for (const item of azurePreview.items) {
      expect((item as Record<string, unknown>)['attributes']).toBeUndefined();
      expect((item as Record<string, unknown>)['targetResources']).toBeUndefined();
    }
  });

  it('preview items do not include translation findings (engine output)', () => {
    for (const item of azurePreview.items) {
      expect((item as Record<string, unknown>)['findings']).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Specific fixture assertions
// ---------------------------------------------------------------------------

describe('Fixture-specific assertions', () => {
  it('VPC resource appears in azure preview', () => {
    const vpc = azurePreview.items.find((i) => i.sourceType === 'aws_vpc');
    expect(vpc).toBeDefined();
    expect(vpc?.sourceName).toBe('main');
  });

  it('VPC resource has azure target types', () => {
    const vpc = azurePreview.items.find((i) => i.sourceType === 'aws_vpc');
    if (vpc && (vpc.status === 'translated' || vpc.status === 'expanded')) {
      expect(vpc.targetTypes.length).toBeGreaterThan(0);
    }
  });

  it('RDS resource appears in azure preview', () => {
    const rds = azurePreview.items.find((i) => i.sourceType === 'aws_db_instance');
    expect(rds).toBeDefined();
  });

  it('ALB resource appears in gcp preview', () => {
    const alb = gcpPreview.items.find((i) => i.sourceType === 'aws_lb');
    expect(alb).toBeDefined();
  });
});
