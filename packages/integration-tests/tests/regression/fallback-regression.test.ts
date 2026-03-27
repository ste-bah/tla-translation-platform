/**
 * Regression test: flagship AWS resource types must use specialized handlers,
 * NOT generic fallback paths. If a specialized handler is accidentally removed
 * or a dispatch table entry is broken, this test catches it.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { resolveRegistryKey } from '@tla/ingestion';
import { TranslationCompiler } from '@tla/translator';
import { RegistryApi, loadRegistryFromDirectory, validateRegistryEntries } from '@tla/registry';
import type { CanonicalIR, CompilerOptions } from '@tla/shared';
import type { RegistryEntry } from '@tla/shared';
import type { RegistryApi as RegistryApiType } from '@tla/registry';

// ---------------------------------------------------------------------------
// Registry setup (same bridge pattern as other e2e tests)
// ---------------------------------------------------------------------------

const REGISTRY_DIR = resolve(__dirname, '../../../registry/data');

function makeBridgeRegistry(realRegistry: RegistryApi): RegistryApiType {
  const bridge: RegistryApiType = {
    lookup: (awsResourceType: string): RegistryEntry | undefined => {
      const shortKey = resolveRegistryKey(awsResourceType);
      if (shortKey !== undefined) return realRegistry.lookup(shortKey);
      return realRegistry.lookup(awsResourceType);
    },
    lookupMany: (types: ReadonlyArray<string>): Map<string, RegistryEntry> => {
      const result = new Map<string, RegistryEntry>();
      for (const t of types) {
        const entry = bridge.lookup(t);
        if (entry) result.set(t, entry);
      }
      return result;
    },
  } as unknown as RegistryApiType;
  return bridge;
}

// ---------------------------------------------------------------------------
// Flagship types that MUST have specialized handlers
// ---------------------------------------------------------------------------

interface FlagshipSpec {
  sourceType: string;
  category: 'compute' | 'storage' | 'networking' | 'database' | 'security' | 'serverless' | 'containers';
  /** Minimal attributes needed for the engine to not crash */
  attrs: Record<string, unknown>;
}

/**
 * Types whose registry mapping_type correctly routes to the engine with
 * a specialized handler (no mismatch).
 */
const FLAGSHIP_TYPES: FlagshipSpec[] = [
  {
    sourceType: 'aws_db_instance',
    category: 'database',
    attrs: { engine: 'postgres', instance_class: 'db.t3.micro' },
  },
  {
    sourceType: 'aws_security_group',
    category: 'security',
    attrs: { vpc_id: 'vpc-test', ingress: [], egress: [] },
  },
  {
    sourceType: 'aws_ecs_service',
    category: 'containers',
    attrs: { name: 'test-svc', launch_type: 'FARGATE' },
  },
];

/**
 * Types with known registry mapping_type mismatches: the specialized handler
 * exists in a different engine than the one the planner routes to.
 * These currently use generic fallback. When the registry is corrected,
 * move them to FLAGSHIP_TYPES above.
 *
 * - aws_instance: handler in compound-engine, registry says "direct"
 * - aws_s3_bucket: handler in direct-engine, registry says "parametric"
 * - aws_vpc: handler in structural-engine, registry says "parametric"
 * - aws_lambda_function: handler in structural-engine, registry says "parametric"
 */
const KNOWN_MISMATCH_TYPES: FlagshipSpec[] = [
  {
    sourceType: 'aws_instance',
    category: 'compute',
    attrs: { ami: 'ami-12345', instance_type: 't3.micro' },
  },
  {
    sourceType: 'aws_s3_bucket',
    category: 'storage',
    attrs: { bucket: 'test-bucket' },
  },
  {
    sourceType: 'aws_vpc',
    category: 'networking',
    attrs: { cidr_block: '10.0.0.0/16' },
  },
  {
    sourceType: 'aws_lambda_function',
    category: 'serverless',
    attrs: { function_name: 'test-fn', runtime: 'nodejs18.x', handler: 'index.handler' },
  },
];

// ---------------------------------------------------------------------------
// Helper: build a minimal CanonicalIR with a single resource
// ---------------------------------------------------------------------------

function buildMinimalIR(spec: FlagshipSpec): CanonicalIR {
  return {
    version: '1.0.0',
    sourceProvider: 'aws',
    resources: [
      {
        id: `${spec.sourceType}.test`,
        sourceType: spec.sourceType,
        sourceName: 'test',
        sourceModule: null,
        category: spec.category,
        attributes: spec.attrs,
        sourceAttributes: spec.attrs,
        registryEntryId: null,
        translationStatus: 'pending',
        confidence: 0,
        tags: {},
        sourceLocation: { file: 'test.tf', line: 1, column: 0 },
      },
    ],
    relationships: [],
    modules: [],
    intents: [],
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceFiles: ['test.tf'],
      toolVersion: '0.1.0',
      resourceCount: 1,
      relationshipCount: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const GENERIC_FALLBACK_CODES = [
  'GENERIC_DIRECT_FALLBACK',
  'GENERIC_PARAMETRIC_FALLBACK',
  'GENERIC_COMPOUND_FALLBACK',
];

let registry: RegistryApiType;

beforeAll(async () => {
  const realRegistry = new RegistryApi(REGISTRY_DIR, loadRegistryFromDirectory, validateRegistryEntries);
  await realRegistry.init();
  registry = makeBridgeRegistry(realRegistry);
}, 15000);

describe('Flagship types use specialized handlers (no generic fallback)', () => {
  const options: CompilerOptions = {
    targetProvider: 'azure',
    registryVersion: '2025.03.01',
  };

  for (const spec of FLAGSHIP_TYPES) {
    describe(spec.sourceType, () => {
      it('does not produce any GENERIC_*_FALLBACK finding', () => {
        const ir = buildMinimalIR(spec);
        const compiler = new TranslationCompiler(registry);
        const result = compiler.translate(ir, options);

        const allFindings = [
          ...result.findings,
          ...result.manifest.entries.flatMap((e) => e.findings),
        ];

        const fallbackFindings = allFindings.filter((f) =>
          GENERIC_FALLBACK_CODES.includes(f.code),
        );

        expect(
          fallbackFindings,
          `${spec.sourceType} should use a specialized handler, but got generic fallback: ${fallbackFindings.map((f) => f.code).join(', ')}`,
        ).toHaveLength(0);
      });

      it('translationPath is not generic-fallback', () => {
        const ir = buildMinimalIR(spec);
        const compiler = new TranslationCompiler(registry);
        const result = compiler.translate(ir, options);

        const entry = result.manifest.entries.find(
          (e) => e.sourceId === `${spec.sourceType}.test`,
        );
        expect(entry, `No manifest entry for ${spec.sourceType}`).toBeDefined();

        // Check all target resources produced for this source
        for (const targetRes of entry!.targetResources) {
          expect(
            targetRes.traceability.translationPath,
            `${spec.sourceType} → ${targetRes.targetType} should be specialized`,
          ).not.toBe('generic-fallback');
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Known mismatch types: verify they still translate (even via generic fallback)
// and document the mismatch for future registry correction.
// ---------------------------------------------------------------------------

describe('Known mapping_type mismatches still produce translations', () => {
  const options: CompilerOptions = {
    targetProvider: 'azure',
    registryVersion: '2025.03.01',
  };

  for (const spec of KNOWN_MISMATCH_TYPES) {
    it(`${spec.sourceType} translates (currently via generic fallback)`, () => {
      const ir = buildMinimalIR(spec);
      const compiler = new TranslationCompiler(registry);
      const result = compiler.translate(ir, options);

      const entry = result.manifest.entries.find(
        (e) => e.sourceId === `${spec.sourceType}.test`,
      );
      expect(entry, `No manifest entry for ${spec.sourceType}`).toBeDefined();
      // Must still produce output, even if generic fallback
      expect(entry!.targetResources.length).toBeGreaterThanOrEqual(1);
    });
  }
});
