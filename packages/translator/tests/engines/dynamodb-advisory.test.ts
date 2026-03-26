import { describe, it, expect, vi } from 'vitest';
import { translateDynamoDb } from '../../src/engines/advisory/dynamodb-advisory.js';
import type { TranslationContext, EngineResult } from '../../src/engines/mapping-engine.js';
import type {
  IrResource,
  RegistryEntry,
  CanonicalIR,
  CloudProvider,
  CompilerOptions,
} from '@tla/shared';
import type { RegistryApi } from '@tla/registry';

// ===========================================================================
// Factory helpers (mirroring advisory-engine.test.ts patterns)
// ===========================================================================

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'res-ddb-001',
    sourceType: 'aws_dynamodb_table',
    sourceName: 'my_table',
    sourceModule: null,
    category: 'database',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: 'SER-DB-DDB-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-DB-DDB-001',
    aws_service: 'aws_dynamodb_table',
    aws_family: 'database',
    azure_targets: [],
    gcp_targets: [],
    mapping_type: 'none',
    output_mode: 'native_emit_only',
    band: 'P4',
    confidence: 0,
    portable_provider_candidate: false,
    behavioral_gaps: [],
    manual_review_required: true,
    review_domains: [],
    test_status: 'unit_tested',
    owner: 'team-infra',
    registry_version: '2025.03.01',
    last_updated: '2025-03-01T00:00:00Z',
    related_requirements: [],
    related_edge_cases: [],
    ...overrides,
  };
}

function makeMockRegistry(): RegistryApi {
  return {
    lookup: vi.fn().mockReturnValue(undefined),
    lookupMany: vi.fn().mockReturnValue(new Map()),
  } as unknown as RegistryApi;
}

function makeCompilerOptions(overrides: Partial<CompilerOptions> = {}): CompilerOptions {
  return {
    targetProvider: 'azure',
    registryVersion: '2025.03.01',
    emitComments: true,
    sortKeys: true,
    ...overrides,
  };
}

function makeCtx(
  overrides: Partial<TranslationContext> & { attributes?: Record<string, unknown>; targetProvider?: CloudProvider } = {},
): TranslationContext {
  const attributes = overrides.attributes ?? {};
  const targetProvider = overrides.targetProvider ?? 'azure';
  const resource = overrides.resource ?? makeIrResource({ attributes });
  const entry = overrides.registryEntry ?? makeRegistryEntry();
  return {
    targetProvider,
    resource,
    registryEntry: entry,
    relationships: [],
    siblingResources: [],
    ir: {
      version: '1.0.0',
      sourceProvider: 'aws',
      resources: [resource],
      relationships: [],
      modules: [],
      intents: [],
      metadata: {
        generatedAt: new Date().toISOString(),
        sourceFiles: ['main.tf'],
        toolVersion: '0.1.0',
        resourceCount: 1,
        relationshipCount: 0,
      },
    } as CanonicalIR,
    registry: makeMockRegistry(),
    options: makeCompilerOptions({ targetProvider }),
    ...overrides,
  };
}

/** Parse the JSON detail field of a finding, returning the parsed object. */
function parseDetail(result: EngineResult, index: number): Record<string, unknown> {
  const detail = result.findings[index]?.detail;
  expect(detail).toBeDefined();
  return JSON.parse(detail!) as Record<string, unknown>;
}

// ===========================================================================
// Backward Compatibility
// ===========================================================================

describe('translateDynamoDb — backward compatibility', () => {
  it('should return exactly 1 finding (base DYNAMODB_ADVISORY) for empty attributes on azure', () => {
    const ctx = makeCtx({ targetProvider: 'azure', attributes: {} });
    const result = translateDynamoDb(ctx);

    expect(result.translated).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.code).toBe('DYNAMODB_ADVISORY');
  });

  it('should return exactly 1 finding (base DYNAMODB_ADVISORY) for empty attributes on gcp', () => {
    const ctx = makeCtx({ targetProvider: 'gcp', attributes: {} });
    const result = translateDynamoDb(ctx);

    expect(result.translated).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.code).toBe('DYNAMODB_ADVISORY');
  });

  it('should mention Cosmos DB in alternatives for azure target', () => {
    const ctx = makeCtx({ targetProvider: 'azure', attributes: {} });
    const result = translateDynamoDb(ctx);
    const detail = parseDetail(result, 0);
    const altText = (detail.alternatives as string[]).join(' ');
    expect(altText).toContain('Cosmos');
  });

  it('should mention Bigtable or Firestore in alternatives for gcp target', () => {
    const ctx = makeCtx({ targetProvider: 'gcp', attributes: {} });
    const result = translateDynamoDb(ctx);
    const detail = parseDetail(result, 0);
    const altText = (detail.alternatives as string[]).join(' ');
    expect(altText).toMatch(/Bigtable|Firestore/);
  });

  it('should include migrationSteps in the base finding detail', () => {
    const ctx = makeCtx({ targetProvider: 'azure', attributes: {} });
    const result = translateDynamoDb(ctx);
    const detail = parseDetail(result, 0);
    expect(Array.isArray(detail.migrationSteps)).toBe(true);
    expect((detail.migrationSteps as string[]).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Pattern: simple-kv
// ===========================================================================

describe('translateDynamoDb — simple-kv pattern', () => {
  const simpleKvAttrs = { hash_key: 'id' };

  it('should detect simple-kv when hash_key present, no range_key, no GSIs', () => {
    const ctx = makeCtx({ targetProvider: 'azure', attributes: simpleKvAttrs });
    const result = translateDynamoDb(ctx);

    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]!.code).toBe('DYNAMODB_ADVISORY');
    expect(result.findings[1]!.code).toBe('DYNAMODB_SIMPLE_KV');
  });

  it('should include pattern and confidence in detail JSON', () => {
    const ctx = makeCtx({ targetProvider: 'azure', attributes: simpleKvAttrs });
    const result = translateDynamoDb(ctx);
    const detail = parseDetail(result, 1);

    expect(detail.pattern).toBe('simple-kv');
    expect(detail.confidence).toBe(0.30);
    expect(detail.evidence).toBeDefined();
  });

  it('should include azure targetGuidance for azure provider', () => {
    const ctx = makeCtx({ targetProvider: 'azure', attributes: simpleKvAttrs });
    const result = translateDynamoDb(ctx);
    const detail = parseDetail(result, 1);

    expect(detail.targetGuidance).toContain('Cosmos DB');
  });

  it('should include gcp targetGuidance for gcp provider', () => {
    const ctx = makeCtx({ targetProvider: 'gcp', attributes: simpleKvAttrs });
    const result = translateDynamoDb(ctx);
    const detail = parseDetail(result, 1);

    expect(detail.targetGuidance).toMatch(/Firestore|Bigtable/);
  });

  it('should NOT detect simple-kv when range_key is present', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'id', range_key: 'sort' },
    });
    const result = translateDynamoDb(ctx);

    const codes = result.findings.map((f) => f.code);
    expect(codes).not.toContain('DYNAMODB_SIMPLE_KV');
  });

  it('should NOT detect simple-kv when GSIs are present', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'id', global_secondary_index: [{}] },
    });
    const result = translateDynamoDb(ctx);

    const codes = result.findings.map((f) => f.code);
    expect(codes).not.toContain('DYNAMODB_SIMPLE_KV');
  });

  it('should NOT detect simple-kv when LSIs are present', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'id', local_secondary_index: [{}] },
    });
    const result = translateDynamoDb(ctx);

    const codes = result.findings.map((f) => f.code);
    expect(codes).not.toContain('DYNAMODB_SIMPLE_KV');
  });
});

// ===========================================================================
// Pattern: single-table
// ===========================================================================

describe('translateDynamoDb — single-table pattern', () => {
  const singleTableAttrs = {
    hash_key: 'pk',
    range_key: 'sk',
    global_secondary_index: [{}, {}, {}],
  };

  it('should detect single-table with 3+ GSIs', () => {
    const ctx = makeCtx({ targetProvider: 'azure', attributes: singleTableAttrs });
    const result = translateDynamoDb(ctx);

    expect(result.findings).toHaveLength(2);
    expect(result.findings[1]!.code).toBe('DYNAMODB_SINGLE_TABLE');
  });

  it('should include pattern and confidence in detail JSON', () => {
    const ctx = makeCtx({ targetProvider: 'azure', attributes: singleTableAttrs });
    const result = translateDynamoDb(ctx);
    const detail = parseDetail(result, 1);

    expect(detail.pattern).toBe('single-table');
    expect(detail.confidence).toBe(0.35);
  });

  it('should detect single-table with exactly 3 GSIs (boundary)', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'pk', global_secondary_index: [{}, {}, {}] },
    });
    const result = translateDynamoDb(ctx);

    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain('DYNAMODB_SINGLE_TABLE');
  });

  it('should NOT detect single-table with 2 GSIs', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'pk', global_secondary_index: [{}, {}] },
    });
    const result = translateDynamoDb(ctx);

    const codes = result.findings.map((f) => f.code);
    expect(codes).not.toContain('DYNAMODB_SINGLE_TABLE');
  });

  it('should detect single-table with 5 GSIs', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      attributes: { hash_key: 'pk', global_secondary_index: [{}, {}, {}, {}, {}] },
    });
    const result = translateDynamoDb(ctx);

    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain('DYNAMODB_SINGLE_TABLE');
  });

  it('should include gcp targetGuidance mentioning Firestore or Bigtable', () => {
    const ctx = makeCtx({ targetProvider: 'gcp', attributes: singleTableAttrs });
    const result = translateDynamoDb(ctx);
    const detail = parseDetail(result, 1);

    expect(detail.targetGuidance).toMatch(/Firestore|Bigtable/);
  });
});

// ===========================================================================
// Pattern: time-series
// ===========================================================================

describe('translateDynamoDb — time-series pattern', () => {
  it('should detect time-series when range_key contains "timestamp"', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'device_id', range_key: 'timestamp' },
    });
    const result = translateDynamoDb(ctx);

    expect(result.findings).toHaveLength(2);
    expect(result.findings[1]!.code).toBe('DYNAMODB_TIME_SERIES');
  });

  it('should include pattern and confidence in detail JSON', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'device_id', range_key: 'timestamp' },
    });
    const result = translateDynamoDb(ctx);
    const detail = parseDetail(result, 1);

    expect(detail.pattern).toBe('time-series');
    expect(detail.confidence).toBe(0.25);
  });

  it.each([
    ['created_at', 'created'],
    ['event_date', 'date'],
    ['ts', 'ts'],
    ['updated_time', 'time'],
    ['epoch_ms', 'epoch'],
    ['datetime_value', 'datetime'],
  ])('should detect time-series for range_key "%s" (keyword: %s)', (rangeKey) => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'pk', range_key: rangeKey },
    });
    const result = translateDynamoDb(ctx);

    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain('DYNAMODB_TIME_SERIES');
  });

  it('should NOT detect time-series for range_key without temporal keywords', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'pk', range_key: 'sort_key' },
    });
    const result = translateDynamoDb(ctx);

    const codes = result.findings.map((f) => f.code);
    expect(codes).not.toContain('DYNAMODB_TIME_SERIES');
  });

  it('should be case-insensitive for range_key keyword matching', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'pk', range_key: 'TIMESTAMP' },
    });
    const result = translateDynamoDb(ctx);

    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain('DYNAMODB_TIME_SERIES');
  });

  it('should include azure targetGuidance mentioning Cosmos DB or Data Explorer', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'pk', range_key: 'timestamp' },
    });
    const result = translateDynamoDb(ctx);
    const detail = parseDetail(result, 1);

    expect(detail.targetGuidance).toMatch(/Cosmos DB|Data Explorer/);
  });

  it('should include gcp targetGuidance mentioning Bigtable or BigQuery', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      attributes: { hash_key: 'pk', range_key: 'timestamp' },
    });
    const result = translateDynamoDb(ctx);
    const detail = parseDetail(result, 1);

    expect(detail.targetGuidance).toMatch(/Bigtable|BigQuery/);
  });
});

// ===========================================================================
// Pattern: event-store
// ===========================================================================

describe('translateDynamoDb — event-store pattern', () => {
  // Use range_key + GSI to avoid triggering simple-kv (which requires no range_key, 0 GSI)
  const eventStoreAttrs = {
    hash_key: 'pk',
    range_key: 'sort',
    stream_enabled: true,
    stream_view_type: 'NEW_AND_OLD_IMAGES',
  };

  it('should detect event-store when stream_enabled and stream_view_type present', () => {
    const ctx = makeCtx({ targetProvider: 'azure', attributes: eventStoreAttrs });
    const result = translateDynamoDb(ctx);

    expect(result.findings).toHaveLength(2);
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain('DYNAMODB_ADVISORY');
    expect(codes).toContain('DYNAMODB_EVENT_STORE');
  });

  it('should include pattern and confidence in detail JSON', () => {
    const ctx = makeCtx({ targetProvider: 'azure', attributes: eventStoreAttrs });
    const result = translateDynamoDb(ctx);
    const eventStoreFinding = result.findings.find((f) => f.code === 'DYNAMODB_EVENT_STORE')!;
    const detail = JSON.parse(eventStoreFinding.detail!) as Record<string, unknown>;

    expect(detail.pattern).toBe('event-store');
    expect(detail.confidence).toBe(0.35);
  });

  it('should include evidence mentioning the view type', () => {
    const ctx = makeCtx({ targetProvider: 'azure', attributes: eventStoreAttrs });
    const result = translateDynamoDb(ctx);
    const eventStoreFinding = result.findings.find((f) => f.code === 'DYNAMODB_EVENT_STORE')!;
    const detail = JSON.parse(eventStoreFinding.detail!) as Record<string, unknown>;

    expect(detail.evidence).toContain('NEW_AND_OLD_IMAGES');
  });

  it('should detect event-store with other stream_view_type values', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'pk', stream_enabled: true, stream_view_type: 'KEYS_ONLY' },
    });
    const result = translateDynamoDb(ctx);

    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain('DYNAMODB_EVENT_STORE');
  });

  it('should NOT detect event-store when stream_enabled is false', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'pk', stream_enabled: false, stream_view_type: 'NEW_AND_OLD_IMAGES' },
    });
    const result = translateDynamoDb(ctx);

    const codes = result.findings.map((f) => f.code);
    expect(codes).not.toContain('DYNAMODB_EVENT_STORE');
  });

  it('should NOT detect event-store when stream_view_type is missing', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'pk', stream_enabled: true },
    });
    const result = translateDynamoDb(ctx);

    const codes = result.findings.map((f) => f.code);
    expect(codes).not.toContain('DYNAMODB_EVENT_STORE');
  });

  it('should include azure targetGuidance mentioning Change Feed or Event Hubs', () => {
    const ctx = makeCtx({ targetProvider: 'azure', attributes: eventStoreAttrs });
    const result = translateDynamoDb(ctx);
    const eventStoreFinding = result.findings.find((f) => f.code === 'DYNAMODB_EVENT_STORE')!;
    const detail = JSON.parse(eventStoreFinding.detail!) as Record<string, unknown>;

    expect(detail.targetGuidance).toMatch(/Change Feed|Event Hubs/);
  });

  it('should include gcp targetGuidance mentioning Pub/Sub or Change Streams', () => {
    const ctx = makeCtx({ targetProvider: 'gcp', attributes: eventStoreAttrs });
    const result = translateDynamoDb(ctx);
    const eventStoreFinding = result.findings.find((f) => f.code === 'DYNAMODB_EVENT_STORE')!;
    const detail = JSON.parse(eventStoreFinding.detail!) as Record<string, unknown>;

    expect(detail.targetGuidance).toMatch(/Pub\/Sub|Change Streams/);
  });
});

// ===========================================================================
// Combinations (multiple patterns)
// ===========================================================================

describe('translateDynamoDb — multiple pattern combinations', () => {
  it('should detect single-table + event-store (3+ GSIs + streams)', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: {
        hash_key: 'pk',
        range_key: 'sk',
        global_secondary_index: [{}, {}, {}],
        stream_enabled: true,
        stream_view_type: 'NEW_AND_OLD_IMAGES',
      },
    });
    const result = translateDynamoDb(ctx);

    expect(result.findings).toHaveLength(3);
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain('DYNAMODB_ADVISORY');
    expect(codes).toContain('DYNAMODB_SINGLE_TABLE');
    expect(codes).toContain('DYNAMODB_EVENT_STORE');
  });

  it('should detect time-series + event-store (temporal range key + streams)', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: {
        hash_key: 'device_id',
        range_key: 'timestamp',
        stream_enabled: true,
        stream_view_type: 'NEW_AND_OLD_IMAGES',
      },
    });
    const result = translateDynamoDb(ctx);

    expect(result.findings).toHaveLength(3);
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain('DYNAMODB_ADVISORY');
    expect(codes).toContain('DYNAMODB_TIME_SERIES');
    expect(codes).toContain('DYNAMODB_EVENT_STORE');
  });

  it('should detect single-table + time-series + event-store (3+ GSIs + temporal key + streams)', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      attributes: {
        hash_key: 'pk',
        range_key: 'created_at',
        global_secondary_index: [{}, {}, {}, {}],
        stream_enabled: true,
        stream_view_type: 'NEW_IMAGE',
      },
    });
    const result = translateDynamoDb(ctx);

    expect(result.findings).toHaveLength(4);
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain('DYNAMODB_ADVISORY');
    expect(codes).toContain('DYNAMODB_SINGLE_TABLE');
    expect(codes).toContain('DYNAMODB_TIME_SERIES');
    expect(codes).toContain('DYNAMODB_EVENT_STORE');
  });

  it('simple-kv and single-table are mutually exclusive (simple-kv requires 0 GSIs)', () => {
    // simple-kv: hash_key, no range_key, 0 GSI, 0 LSI
    // single-table: 3+ GSIs
    // These conditions are mutually exclusive by definition.
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'id' },
    });
    const result = translateDynamoDb(ctx);
    const codes = result.findings.map((f) => f.code);

    // Can have simple-kv but never single-table simultaneously
    if (codes.includes('DYNAMODB_SIMPLE_KV')) {
      expect(codes).not.toContain('DYNAMODB_SINGLE_TABLE');
    }
  });

  it('simple-kv and time-series are mutually exclusive (simple-kv requires no range_key)', () => {
    // simple-kv: no range_key; time-series: requires range_key
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'id' },
    });
    const result = translateDynamoDb(ctx);
    const codes = result.findings.map((f) => f.code);

    if (codes.includes('DYNAMODB_SIMPLE_KV')) {
      expect(codes).not.toContain('DYNAMODB_TIME_SERIES');
    }
  });
});

// ===========================================================================
// Provider differences
// ===========================================================================

describe('translateDynamoDb — provider-specific guidance', () => {
  it('should produce different targetGuidance for azure vs gcp (simple-kv)', () => {
    const attrs = { hash_key: 'id' };
    const azureResult = translateDynamoDb(makeCtx({ targetProvider: 'azure', attributes: attrs }));
    const gcpResult = translateDynamoDb(makeCtx({ targetProvider: 'gcp', attributes: attrs }));

    const azureDetail = parseDetail(azureResult, 1);
    const gcpDetail = parseDetail(gcpResult, 1);

    expect(azureDetail.targetGuidance).not.toBe(gcpDetail.targetGuidance);
  });

  it('should produce different base finding messages for azure vs gcp', () => {
    const azureResult = translateDynamoDb(makeCtx({ targetProvider: 'azure', attributes: {} }));
    const gcpResult = translateDynamoDb(makeCtx({ targetProvider: 'gcp', attributes: {} }));

    expect(azureResult.findings[0]!.message).not.toBe(gcpResult.findings[0]!.message);
  });

  it('azure base message should mention Cosmos DB', () => {
    const result = translateDynamoDb(makeCtx({ targetProvider: 'azure', attributes: {} }));
    expect(result.findings[0]!.message).toContain('Cosmos DB');
  });

  it('gcp base message should mention Bigtable or Firestore', () => {
    const result = translateDynamoDb(makeCtx({ targetProvider: 'gcp', attributes: {} }));
    expect(result.findings[0]!.message).toMatch(/Bigtable|Firestore/);
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe('translateDynamoDb — edge cases', () => {
  it('should NOT detect event-store when stream_enabled is string "true" (not boolean)', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: {
        hash_key: 'pk',
        stream_enabled: 'true',
        stream_view_type: 'NEW_AND_OLD_IMAGES',
      },
    });
    const result = translateDynamoDb(ctx);

    const codes = result.findings.map((f) => f.code);
    expect(codes).not.toContain('DYNAMODB_EVENT_STORE');
  });

  it('should treat global_secondary_index as 0 GSIs when not an array', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'pk', global_secondary_index: 'not-array' },
    });
    const result = translateDynamoDb(ctx);

    // Should detect simple-kv (hash_key only, 0 GSIs, no range_key)
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain('DYNAMODB_SIMPLE_KV');
    expect(codes).not.toContain('DYNAMODB_SINGLE_TABLE');
  });

  it('should treat hash_key as undefined when it is a number', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 42 },
    });
    const result = translateDynamoDb(ctx);

    // No hash_key means no simple-kv detection
    const codes = result.findings.map((f) => f.code);
    expect(codes).not.toContain('DYNAMODB_SIMPLE_KV');
    // Should only have base advisory
    expect(result.findings).toHaveLength(1);
  });

  it('should detect hasTtl when ttl has enabled:true', () => {
    // This is about attribute extraction correctness; TTL does not affect pattern detection
    // but we can verify the module processes it without error.
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { ttl: { enabled: true } },
    });
    const result = translateDynamoDb(ctx);

    // Should not throw, should return at least the base finding
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    expect(result.translated).toHaveLength(0);
  });

  it('should handle point_in_time_recovery with enabled:false', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { point_in_time_recovery: { enabled: false } },
    });
    const result = translateDynamoDb(ctx);

    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    expect(result.translated).toHaveLength(0);
  });

  it('should handle null attributes gracefully', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: {
        hash_key: null,
        range_key: null,
        global_secondary_index: null,
        stream_enabled: null,
      },
    });
    const result = translateDynamoDb(ctx);

    // Only base finding, no patterns detected
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.code).toBe('DYNAMODB_ADVISORY');
  });

  it('should handle boolean hash_key (bool is not string)', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: true },
    });
    const result = translateDynamoDb(ctx);

    const codes = result.findings.map((f) => f.code);
    expect(codes).not.toContain('DYNAMODB_SIMPLE_KV');
  });

  it('should handle ttl as a non-object value', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { ttl: 'yes' },
    });
    const result = translateDynamoDb(ctx);

    // Should not throw
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle ttl with enabled:true but as string "true"', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { ttl: { enabled: 'true' } },
    });
    const result = translateDynamoDb(ctx);

    // isEnabledBlock checks === true (strict), so string "true" is not true
    // No crash expected
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle empty global_secondary_index array', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      attributes: { hash_key: 'id', global_secondary_index: [] },
    });
    const result = translateDynamoDb(ctx);

    // 0 GSIs + hash_key only → simple-kv
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain('DYNAMODB_SIMPLE_KV');
  });
});

// ===========================================================================
// Invariants
// ===========================================================================

describe('translateDynamoDb — invariants', () => {
  const testCases: Array<{ label: string; attributes: Record<string, unknown>; provider: CloudProvider }> = [
    { label: 'empty attrs / azure', attributes: {}, provider: 'azure' },
    { label: 'empty attrs / gcp', attributes: {}, provider: 'gcp' },
    { label: 'simple-kv / azure', attributes: { hash_key: 'id' }, provider: 'azure' },
    { label: 'single-table / gcp', attributes: { hash_key: 'pk', range_key: 'sk', global_secondary_index: [{}, {}, {}] }, provider: 'gcp' },
    { label: 'time-series / azure', attributes: { hash_key: 'pk', range_key: 'timestamp' }, provider: 'azure' },
    { label: 'event-store / gcp', attributes: { hash_key: 'pk', stream_enabled: true, stream_view_type: 'NEW_IMAGE' }, provider: 'gcp' },
    {
      label: 'all patterns / azure',
      attributes: {
        hash_key: 'pk',
        range_key: 'created_at',
        global_secondary_index: [{}, {}, {}],
        stream_enabled: true,
        stream_view_type: 'NEW_AND_OLD_IMAGES',
      },
      provider: 'azure',
    },
  ];

  it.each(testCases)('translated is ALWAYS [] ($label)', ({ attributes, provider }) => {
    const result = translateDynamoDb(makeCtx({ targetProvider: provider, attributes }));
    expect(result.translated).toEqual([]);
  });

  it.each(testCases)('all findings have severity "warning" ($label)', ({ attributes, provider }) => {
    const result = translateDynamoDb(makeCtx({ targetProvider: provider, attributes }));
    for (const f of result.findings) {
      expect(f.severity).toBe('warning');
    }
  });

  it.each(testCases)('all findings have non-empty resourceId ($label)', ({ attributes, provider }) => {
    const result = translateDynamoDb(makeCtx({ targetProvider: provider, attributes }));
    for (const f of result.findings) {
      expect(f.resourceId).toBeTruthy();
      expect(typeof f.resourceId).toBe('string');
    }
  });

  it.each(testCases)('all findings have non-empty code ($label)', ({ attributes, provider }) => {
    const result = translateDynamoDb(makeCtx({ targetProvider: provider, attributes }));
    for (const f of result.findings) {
      expect(f.code).toBeTruthy();
      expect(typeof f.code).toBe('string');
    }
  });

  it.each(testCases)('all findings have non-empty message ($label)', ({ attributes, provider }) => {
    const result = translateDynamoDb(makeCtx({ targetProvider: provider, attributes }));
    for (const f of result.findings) {
      expect(f.message).toBeTruthy();
      expect(typeof f.message).toBe('string');
    }
  });

  it.each(testCases)('at least 1 finding is always emitted ($label)', ({ attributes, provider }) => {
    const result = translateDynamoDb(makeCtx({ targetProvider: provider, attributes }));
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
  });

  it.each(testCases)('first finding is always base DYNAMODB_ADVISORY ($label)', ({ attributes, provider }) => {
    const result = translateDynamoDb(makeCtx({ targetProvider: provider, attributes }));
    expect(result.findings[0]!.code).toBe('DYNAMODB_ADVISORY');
  });
});
