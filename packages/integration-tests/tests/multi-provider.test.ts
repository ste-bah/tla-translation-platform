/**
 * TASK-INT-004: Multi-Provider Source Handling
 *
 * Exercises the classifyProvider / classifyResources functions and verifies
 * that the full pipeline (parse → IR → classify → translate) correctly
 * handles a fixture containing resources from multiple Terraform providers:
 *
 *   aws_s3_bucket  → 'aws'           translated to Azure blob / storage account
 *   null_resource  → 'procedural'    advisory stub in manifest
 *   random_id      → 'utility'       preserved (skipped by translator, advisory)
 *   helm_release   → 'orchestration' skipped / advisory
 *
 * NOTE: `data "external"` blocks are NOT emitted as IR resources by the
 * IrEmitter (only `resource` blocks are processed). They are tested here via
 * direct classifyProvider() calls rather than through the full pipeline.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import {
  parseHclDirectory,
  DependencyGraph,
  IrEmitter,
  resolveRegistryKey,
  classifyProvider,
  classifyResources,
} from '@tla/ingestion';
import type { ProviderClassification } from '@tla/ingestion';
import { TranslationCompiler } from '@tla/translator';
import { RegistryApi, loadRegistryFromDirectory, validateRegistryEntries } from '@tla/registry';
import type { RegistryEntry } from '@tla/shared';
import type { CanonicalIR, CompilerOptions, TranslationResult } from '@tla/shared';
import type { RegistryApi as RegistryApiType } from '@tla/registry';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const FIXTURE_DIR = resolve(__dirname, '../fixtures/multi-provider');
const REGISTRY_DIR = resolve(__dirname, '../../registry/data');

// ---------------------------------------------------------------------------
// Bridge registry (same pattern as e2e and edge-case tests)
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
// Pipeline helpers
// ---------------------------------------------------------------------------

interface PipelineResult {
  ir: CanonicalIR;
  result: TranslationResult;
  classifications: Map<string, ProviderClassification>;
  parseErrors: Array<{ file: string; error: Error }>;
  unmappedTypes: string[];
}

async function runPipeline(
  fixtureDir: string,
  registry: RegistryApiType,
  targetProvider: 'azure' | 'gcp' = 'azure',
): Promise<PipelineResult> {
  const parseResult = await parseHclDirectory(fixtureDir);
  const graph = new DependencyGraph();
  graph.build(parseResult.asts);

  const emitter = new IrEmitter(registry);
  const emitResult = emitter.emit(parseResult.asts, graph);

  const options: CompilerOptions = {
    targetProvider,
    registryVersion: '2025.03.01',
  };

  const compiler = new TranslationCompiler(registry);
  const translationResult = compiler.translate(emitResult.ir, options);

  // Classify after IR emission so we work with actual IrResource objects
  const classifications = classifyResources(emitResult.ir.resources);

  return {
    ir: emitResult.ir,
    result: translationResult,
    classifications,
    parseErrors: parseResult.errors,
    unmappedTypes: emitResult.unmappedTypes,
  };
}

/**
 * Assert every IR resource has a corresponding manifest entry (no silent drops).
 */
function assertNoSilentDrops(ir: CanonicalIR, result: TranslationResult): void {
  const manifestIds = new Set(result.manifest.entries.map((e) => e.sourceId));
  for (const irRes of ir.resources) {
    expect(
      manifestIds.has(irRes.id),
      `IR resource ${irRes.id} (${irRes.sourceType}.${irRes.sourceName}) has no manifest entry`,
    ).toBe(true);
  }
  expect(result.manifest.counts.total).toBe(ir.resources.length);
}

// ---------------------------------------------------------------------------
// Suite-level setup
// ---------------------------------------------------------------------------

let realRegistry: RegistryApi;
let registry: RegistryApiType;
let pipeline: PipelineResult;

beforeAll(async () => {
  realRegistry = new RegistryApi(REGISTRY_DIR, loadRegistryFromDirectory, validateRegistryEntries);
  await realRegistry.init();
  registry = makeBridgeRegistry(realRegistry);
  pipeline = await runPipeline(FIXTURE_DIR, registry);
}, 30000);

// ===========================================================================
// Unit tests — classifyProvider() (no pipeline required)
// ===========================================================================

describe('classifyProvider() — AWS resources', () => {
  it('classifies aws_s3_bucket as aws', () => {
    expect(classifyProvider('aws_s3_bucket')).toBe('aws');
  });

  it('classifies aws_instance as aws', () => {
    expect(classifyProvider('aws_instance')).toBe('aws');
  });

  it('classifies aws_vpc as aws', () => {
    expect(classifyProvider('aws_vpc')).toBe('aws');
  });

  it('classifies aws_lambda_function as aws', () => {
    expect(classifyProvider('aws_lambda_function')).toBe('aws');
  });
});

describe('classifyProvider() — utility resources', () => {
  it('classifies random_id as utility', () => {
    expect(classifyProvider('random_id')).toBe('utility');
  });

  it('classifies random_string as utility', () => {
    expect(classifyProvider('random_string')).toBe('utility');
  });

  it('classifies random_password as utility', () => {
    expect(classifyProvider('random_password')).toBe('utility');
  });

  it('classifies template_file as utility', () => {
    expect(classifyProvider('template_file')).toBe('utility');
  });
});

describe('classifyProvider() — procedural resources', () => {
  it('classifies null_resource as procedural', () => {
    expect(classifyProvider('null_resource')).toBe('procedural');
  });

  it('classifies external as procedural', () => {
    // `data "external"` data sources are classified as procedural when the
    // type string is encountered directly (e.g. via classifyProvider).
    expect(classifyProvider('external')).toBe('procedural');
  });

  it('classifies terraform_data as procedural', () => {
    expect(classifyProvider('terraform_data')).toBe('procedural');
  });

  it('classifies time_sleep as procedural', () => {
    expect(classifyProvider('time_sleep')).toBe('procedural');
  });
});

describe('classifyProvider() — orchestration resources', () => {
  it('classifies helm_release as orchestration', () => {
    expect(classifyProvider('helm_release')).toBe('orchestration');
  });

  it('classifies kubernetes_deployment as orchestration', () => {
    expect(classifyProvider('kubernetes_deployment')).toBe('orchestration');
  });

  it('classifies kubernetes_service as orchestration', () => {
    expect(classifyProvider('kubernetes_service')).toBe('orchestration');
  });
});

describe('classifyProvider() — target-cloud resources', () => {
  it('classifies azurerm_storage_account as target', () => {
    expect(classifyProvider('azurerm_storage_account')).toBe('target');
  });

  it('classifies azurerm_resource_group as target', () => {
    expect(classifyProvider('azurerm_resource_group')).toBe('target');
  });

  it('classifies google_storage_bucket as target', () => {
    expect(classifyProvider('google_storage_bucket')).toBe('target');
  });

  it('classifies google_compute_instance as target', () => {
    expect(classifyProvider('google_compute_instance')).toBe('target');
  });
});

describe('classifyProvider() — unknown resources', () => {
  it('classifies completely unknown type as unknown', () => {
    expect(classifyProvider('acme_certificate')).toBe('unknown');
  });

  it('classifies datadog_monitor as unknown', () => {
    expect(classifyProvider('datadog_monitor')).toBe('unknown');
  });

  it('classifies vault_secret as unknown', () => {
    expect(classifyProvider('vault_secret')).toBe('unknown');
  });
});

// ===========================================================================
// Integration tests — full pipeline through multi-provider fixture
// ===========================================================================

describe('multi-provider fixture — parse and emit', () => {
  it('parses the fixture without errors', () => {
    expect(
      pipeline.parseErrors,
      `Parse errors: ${pipeline.parseErrors.map((e) => e.error.message).join(', ')}`,
    ).toHaveLength(0);
  });

  it('emits exactly 4 IR resources (aws_s3_bucket, null_resource, random_id, helm_release)', () => {
    // data "external" is NOT a resource block → not emitted into IR
    expect(pipeline.ir.resources).toHaveLength(4);
  });

  it('IR contains aws_s3_bucket', () => {
    const s3 = pipeline.ir.resources.find((r) => r.sourceType === 'aws_s3_bucket');
    expect(s3).toBeDefined();
  });

  it('IR contains null_resource', () => {
    const nr = pipeline.ir.resources.find((r) => r.sourceType === 'null_resource');
    expect(nr).toBeDefined();
  });

  it('IR contains random_id', () => {
    const rid = pipeline.ir.resources.find((r) => r.sourceType === 'random_id');
    expect(rid).toBeDefined();
  });

  it('IR contains helm_release', () => {
    const helm = pipeline.ir.resources.find((r) => r.sourceType === 'helm_release');
    expect(helm).toBeDefined();
  });
});

describe('multi-provider fixture — classifyResources()', () => {
  it('classifies aws_s3_bucket as aws', () => {
    const s3 = pipeline.ir.resources.find((r) => r.sourceType === 'aws_s3_bucket');
    expect(s3).toBeDefined();
    expect(pipeline.classifications.get(s3!.id)).toBe('aws');
  });

  it('classifies null_resource as procedural', () => {
    const nr = pipeline.ir.resources.find((r) => r.sourceType === 'null_resource');
    expect(nr).toBeDefined();
    expect(pipeline.classifications.get(nr!.id)).toBe('procedural');
  });

  it('classifies random_id as utility', () => {
    const rid = pipeline.ir.resources.find((r) => r.sourceType === 'random_id');
    expect(rid).toBeDefined();
    expect(pipeline.classifications.get(rid!.id)).toBe('utility');
  });

  it('classifies helm_release as orchestration', () => {
    const helm = pipeline.ir.resources.find((r) => r.sourceType === 'helm_release');
    expect(helm).toBeDefined();
    expect(pipeline.classifications.get(helm!.id)).toBe('orchestration');
  });

  it('returns a classification entry for every IR resource', () => {
    for (const resource of pipeline.ir.resources) {
      expect(
        pipeline.classifications.has(resource.id),
        `No classification for resource ${resource.id} (${resource.sourceType})`,
      ).toBe(true);
    }
  });
});

describe('multi-provider fixture — all resources appear in manifest (no silent drops)', () => {
  it('manifest total equals IR resource count', () => {
    assertNoSilentDrops(pipeline.ir, pipeline.result);
  });

  it('aws_s3_bucket has a manifest entry', () => {
    const s3 = pipeline.ir.resources.find((r) => r.sourceType === 'aws_s3_bucket');
    expect(s3).toBeDefined();
    const entry = pipeline.result.manifest.entries.find((e) => e.sourceId === s3!.id);
    expect(entry).toBeDefined();
  });

  it('null_resource has a manifest entry', () => {
    const nr = pipeline.ir.resources.find((r) => r.sourceType === 'null_resource');
    expect(nr).toBeDefined();
    const entry = pipeline.result.manifest.entries.find((e) => e.sourceId === nr!.id);
    expect(entry).toBeDefined();
  });

  it('random_id has a manifest entry', () => {
    const rid = pipeline.ir.resources.find((r) => r.sourceType === 'random_id');
    expect(rid).toBeDefined();
    const entry = pipeline.result.manifest.entries.find((e) => e.sourceId === rid!.id);
    expect(entry).toBeDefined();
  });

  it('helm_release has a manifest entry', () => {
    const helm = pipeline.ir.resources.find((r) => r.sourceType === 'helm_release');
    expect(helm).toBeDefined();
    const entry = pipeline.result.manifest.entries.find((e) => e.sourceId === helm!.id);
    expect(entry).toBeDefined();
  });
});

describe('multi-provider fixture — translation outcomes', () => {
  it('aws_s3_bucket is translated (not blocked)', () => {
    const s3 = pipeline.ir.resources.find((r) => r.sourceType === 'aws_s3_bucket');
    expect(s3).toBeDefined();
    const entry = pipeline.result.manifest.entries.find((e) => e.sourceId === s3!.id);
    expect(entry).toBeDefined();
    expect(entry!.status).not.toBe('blocked');
  });

  it('null_resource receives advisory treatment (no cloud-infra translation)', () => {
    const nr = pipeline.ir.resources.find((r) => r.sourceType === 'null_resource');
    expect(nr).toBeDefined();
    const entry = pipeline.result.manifest.entries.find((e) => e.sourceId === nr!.id);
    expect(entry).toBeDefined();
    // Procedural resources are not translatable; they should be advisory or blocked
    expect(['advisory', 'blocked']).toContain(entry!.status);
  });

  it('random_id receives advisory or blocked treatment (utility, not translatable infra)', () => {
    const rid = pipeline.ir.resources.find((r) => r.sourceType === 'random_id');
    expect(rid).toBeDefined();
    const entry = pipeline.result.manifest.entries.find((e) => e.sourceId === rid!.id);
    expect(entry).toBeDefined();
    expect(['advisory', 'blocked']).toContain(entry!.status);
  });

  it('helm_release receives advisory or blocked treatment (orchestration, out of scope)', () => {
    const helm = pipeline.ir.resources.find((r) => r.sourceType === 'helm_release');
    expect(helm).toBeDefined();
    const entry = pipeline.result.manifest.entries.find((e) => e.sourceId === helm!.id);
    expect(entry).toBeDefined();
    expect(['advisory', 'blocked']).toContain(entry!.status);
  });

  it('external data source classifies as procedural (direct classifyProvider call)', () => {
    // data "external" blocks are not IR resources, so we verify classification
    // directly. This ensures the provider table correctly handles the external
    // provider even when encountered outside the full pipeline.
    expect(classifyProvider('external')).toBe('procedural');
  });
});
