/**
 * TASK-INT-002: Cross-Cloud Comparison Test
 *
 * Runs both Azure and GCP translations from the same AWS source IR and
 * verifies that:
 *   - Both manifests cover the same set of source resources (no silent drops)
 *   - Confidence scores may differ between providers (expected)
 *   - The same key resource types produce entries in both manifests
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { parseHclDirectory, DependencyGraph, IrEmitter, resolveRegistryKey } from '@tla/ingestion';
import { TranslationCompiler } from '@tla/translator';
import { RegistryApi } from '@tla/registry';
import { loadRegistryFromDirectory } from '@tla/registry';
import { validateRegistryEntries } from '@tla/registry';
import type { RegistryEntry } from '@tla/shared';
import type { CanonicalIR, CompilerOptions, TranslationResult } from '@tla/shared';
import type { RegistryApi as RegistryApiType } from '@tla/registry';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const FIXTURES_DIR = resolve(
  __dirname,
  '../fixtures/aws-reference-stack',
);

const REGISTRY_DIR = resolve(
  __dirname,
  '../../registry/data',
);

// ---------------------------------------------------------------------------
// Bridge registry wrapper (same pattern as e2e tests)
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
// Suite-level setup — parse once, translate to BOTH providers
// ---------------------------------------------------------------------------

let ir: CanonicalIR;
let azureResult: TranslationResult;
let gcpResult: TranslationResult;

beforeAll(async () => {
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

  // 3. Load registry once, share across both compilations
  const realRegistry = new RegistryApi(REGISTRY_DIR, loadRegistryFromDirectory, validateRegistryEntries);
  await realRegistry.init();
  const registry = makeBridgeRegistry(realRegistry);

  // 4. Emit IR (single source IR used for both translations)
  const emitter = new IrEmitter(registry);
  const emitResult = emitter.emit(parseResult.asts, graph);
  ir = emitResult.ir;

  expect(ir.resources.length, 'IR should contain at least one resource').toBeGreaterThan(0);

  // 5. Translate to Azure
  const azureOptions: CompilerOptions = {
    targetProvider: 'azure',
    registryVersion: '2025.03.01',
  };
  const azureCompiler = new TranslationCompiler(registry);
  azureResult = azureCompiler.translate(ir, azureOptions);

  // 6. Translate to GCP
  const gcpOptions: CompilerOptions = {
    targetProvider: 'gcp',
    registryVersion: '2025.03.01',
  };
  const gcpCompiler = new TranslationCompiler(registry);
  gcpResult = gcpCompiler.translate(ir, gcpOptions);
}, 30000);

// ---------------------------------------------------------------------------
// Basic provider identity checks
// ---------------------------------------------------------------------------

describe('Provider identity', () => {
  it('Azure result targets azure', () => {
    expect(azureResult.target).toBe('azure');
  });

  it('GCP result targets gcp', () => {
    expect(gcpResult.target).toBe('gcp');
  });

  it('both results have the same source IR resource count', () => {
    expect(azureResult.manifest.counts.total).toBe(ir.resources.length);
    expect(gcpResult.manifest.counts.total).toBe(ir.resources.length);
  });
});

// ---------------------------------------------------------------------------
// No silent drops in either manifest
// ---------------------------------------------------------------------------

describe('No silent drops in either manifest', () => {
  it('Azure manifest has an entry for every IR resource', () => {
    const manifestIds = new Set(azureResult.manifest.entries.map((e) => e.sourceId));
    for (const irRes of ir.resources) {
      expect(
        manifestIds.has(irRes.id),
        `Azure manifest missing entry for IR resource ${irRes.id} (${irRes.sourceType}.${irRes.sourceName})`,
      ).toBe(true);
    }
  });

  it('GCP manifest has an entry for every IR resource', () => {
    const manifestIds = new Set(gcpResult.manifest.entries.map((e) => e.sourceId));
    for (const irRes of ir.resources) {
      expect(
        manifestIds.has(irRes.id),
        `GCP manifest missing entry for IR resource ${irRes.id} (${irRes.sourceType}.${irRes.sourceName})`,
      ).toBe(true);
    }
  });

  it('both manifests cover the exact same set of source IDs', () => {
    const azureIds = new Set(azureResult.manifest.entries.map((e) => e.sourceId));
    const gcpIds = new Set(gcpResult.manifest.entries.map((e) => e.sourceId));

    for (const id of azureIds) {
      expect(gcpIds.has(id), `Source ID ${id} in Azure manifest but missing from GCP manifest`).toBe(true);
    }
    for (const id of gcpIds) {
      expect(azureIds.has(id), `Source ID ${id} in GCP manifest but missing from Azure manifest`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Same source resources produce entries in both manifests
// ---------------------------------------------------------------------------

describe('Key resource types appear in both manifests', () => {
  const KEY_SOURCE_TYPES = [
    'aws_vpc',
    'aws_subnet',
    'aws_security_group',
    'aws_lb',
    'aws_db_instance',
    'aws_s3_bucket',
  ];

  for (const sourceType of KEY_SOURCE_TYPES) {
    it(`${sourceType} resources appear in both Azure and GCP manifests`, () => {
      const irResources = ir.resources.filter((r) => r.sourceType === sourceType);
      expect(irResources.length, `No ${sourceType} resources found in IR`).toBeGreaterThan(0);

      for (const irRes of irResources) {
        const azureEntry = azureResult.manifest.entries.find((e) => e.sourceId === irRes.id);
        const gcpEntry = gcpResult.manifest.entries.find((e) => e.sourceId === irRes.id);

        expect(
          azureEntry,
          `${sourceType}.${irRes.sourceName} missing from Azure manifest`,
        ).toBeDefined();
        expect(
          gcpEntry,
          `${sourceType}.${irRes.sourceName} missing from GCP manifest`,
        ).toBeDefined();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Both manifests produce output (translated + expanded > 0)
// ---------------------------------------------------------------------------

describe('Both pipelines produce translated output', () => {
  it('Azure manifest has at least one translated or expanded resource', () => {
    const { translated, expanded } = azureResult.manifest.counts;
    expect(translated + expanded).toBeGreaterThan(0);
  });

  it('GCP manifest has at least one translated or expanded resource', () => {
    const { translated, expanded } = gcpResult.manifest.counts;
    expect(translated + expanded).toBeGreaterThan(0);
  });

  it('both manifests produce HCL output files', () => {
    expect(Object.keys(azureResult.files).length).toBeGreaterThan(0);
    expect(Object.keys(gcpResult.files).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Confidence scores: both are positive; may differ between providers
// ---------------------------------------------------------------------------

describe('Confidence scores', () => {
  it('Azure overall confidence is greater than 0', () => {
    expect(azureResult.manifest.confidenceOverall).toBeGreaterThan(0);
  });

  it('GCP overall confidence is greater than 0', () => {
    expect(gcpResult.manifest.confidenceOverall).toBeGreaterThan(0);
  });

  it('per-resource confidence scores may differ between Azure and GCP (not required to match)', () => {
    // This is an informational assertion — we verify that confidence CAN differ
    // without that being an error. We just check that both are valid numbers [0,1].
    for (const azureEntry of azureResult.manifest.entries) {
      expect(azureEntry.confidence).toBeGreaterThanOrEqual(0);
      expect(azureEntry.confidence).toBeLessThanOrEqual(1);
    }
    for (const gcpEntry of gcpResult.manifest.entries) {
      expect(gcpEntry.confidence).toBeGreaterThanOrEqual(0);
      expect(gcpEntry.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('sum of manifest status counts equals total for both providers', () => {
    const az = azureResult.manifest.counts;
    expect(az.translated + az.expanded + az.partial + az.blocked + az.advisory).toBe(az.total);

    const gcp = gcpResult.manifest.counts;
    expect(gcp.translated + gcp.expanded + gcp.partial + gcp.blocked + gcp.advisory).toBe(gcp.total);
  });
});

// ---------------------------------------------------------------------------
// Provider-specific target type verification (spot checks)
// ---------------------------------------------------------------------------

describe('Azure-specific target types (spot check)', () => {
  it('VPC maps to azurerm_virtual_network in Azure', () => {
    const vpcIr = ir.resources.find((r) => r.sourceType === 'aws_vpc');
    expect(vpcIr).toBeDefined();
    const vnet = azureResult.resources.find(
      (r) => r.sourceId === vpcIr!.id && r.targetType === 'azurerm_virtual_network',
    );
    expect(vnet).toBeDefined();
  });

  it('S3 maps to azurerm_storage_account in Azure', () => {
    const s3Ir = ir.resources.find((r) => r.sourceType === 'aws_s3_bucket');
    expect(s3Ir).toBeDefined();
    const storage = azureResult.resources.find(
      (r) => r.sourceId === s3Ir!.id && r.targetType === 'azurerm_storage_account',
    );
    expect(storage).toBeDefined();
  });

  it('RDS maps to azurerm_postgresql_flexible_server in Azure', () => {
    const rdsIr = ir.resources.find((r) => r.sourceType === 'aws_db_instance');
    expect(rdsIr).toBeDefined();
    const flexServer = azureResult.resources.find(
      (r) => r.sourceId === rdsIr!.id && r.targetType === 'azurerm_postgresql_flexible_server',
    );
    expect(flexServer).toBeDefined();
  });
});

describe('GCP-specific target types (spot check)', () => {
  it('VPC maps to google_compute_network in GCP', () => {
    const vpcIr = ir.resources.find((r) => r.sourceType === 'aws_vpc');
    expect(vpcIr).toBeDefined();
    const network = gcpResult.resources.find(
      (r) => r.sourceId === vpcIr!.id && r.targetType === 'google_compute_network',
    );
    expect(network).toBeDefined();
  });

  it('S3 maps to google_storage_bucket in GCP', () => {
    const s3Ir = ir.resources.find((r) => r.sourceType === 'aws_s3_bucket');
    expect(s3Ir).toBeDefined();
    const bucket = gcpResult.resources.find(
      (r) => r.sourceId === s3Ir!.id && r.targetType === 'google_storage_bucket',
    );
    expect(bucket).toBeDefined();
  });

  it('RDS maps to google_sql_database_instance in GCP', () => {
    const rdsIr = ir.resources.find((r) => r.sourceType === 'aws_db_instance');
    expect(rdsIr).toBeDefined();
    const sqlInstance = gcpResult.resources.find(
      (r) => r.sourceId === rdsIr!.id && r.targetType === 'google_sql_database_instance',
    );
    expect(sqlInstance).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// No resource type produces output on one cloud but is completely absent on the other
// ---------------------------------------------------------------------------

describe('Symmetry: no resource type produces zero output on one cloud while positive on the other', () => {
  it('for each source type, if Azure translates it GCP also produces output', () => {
    const sourceTypes = [...new Set(ir.resources.map((r) => r.sourceType))];

    for (const sourceType of sourceTypes) {
      const irIds = ir.resources.filter((r) => r.sourceType === sourceType).map((r) => r.id);

      const azureResourceCount = azureResult.resources.filter((r) =>
        irIds.includes(r.sourceId),
      ).length;
      const gcpResourceCount = gcpResult.resources.filter((r) =>
        irIds.includes(r.sourceId),
      ).length;

      // If one provider produces translated resources, the other must too.
      // Advisory-only resources may produce 0 translated[] on both — that's fine.
      if (azureResourceCount > 0) {
        expect(
          gcpResourceCount,
          `${sourceType} produces ${azureResourceCount} Azure resources but 0 GCP resources`,
        ).toBeGreaterThan(0);
      }
      if (gcpResourceCount > 0) {
        expect(
          azureResourceCount,
          `${sourceType} produces ${gcpResourceCount} GCP resources but 0 Azure resources`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
