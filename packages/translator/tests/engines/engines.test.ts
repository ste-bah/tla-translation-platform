import { describe, it, expect, vi } from 'vitest';
import { engineRegistry, getEngine } from '../../src/engines/index.js';
import type {
  TranslationContext,
  EngineResult,
  MappingEngine,
} from '../../src/engines/index.js';
import type {
  IrResource,
  RegistryEntry,
  CanonicalIR,
  MappingType,
  CloudProvider,
  CompilerOptions,
} from '@tla/shared';
import type { RegistryApi } from '@tla/registry';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'res-001',
    sourceType: 'aws_instance',
    sourceName: 'my_instance',
    sourceModule: null,
    category: 'compute',
    attributes: { ami: 'ami-12345', instance_type: 't3.micro' },
    sourceAttributes: { ami: 'ami-12345', instance_type: 't3.micro' },
    registryEntryId: 'SER-COMPUTE-EC2-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-COMPUTE-EC2-001',
    aws_service: 'aws_instance',
    aws_family: 'compute',
    azure_targets: ['azurerm_virtual_machine'],
    gcp_targets: ['google_compute_instance'],
    mapping_type: 'direct',
    output_mode: 'native_emit_only',
    band: 'P1',
    confidence: 0.9,
    portable_provider_candidate: false,
    behavioral_gaps: [],
    manual_review_required: false,
    review_domains: [],
    test_status: 'passing',
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

function makeTranslationContext(overrides: Partial<TranslationContext> = {}): TranslationContext {
  const resource = makeIrResource();
  const entry = makeRegistryEntry();
  return {
    targetProvider: 'azure',
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
      metadata: { generatedAt: new Date().toISOString(), sourceFiles: ['main.tf'], toolVersion: '0.1.0' },
    } as CanonicalIR,
    registry: makeMockRegistry(),
    options: makeCompilerOptions(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// directEngine
// ---------------------------------------------------------------------------

describe('directEngine', () => {
  it('should be registered under "direct"', () => {
    expect(engineRegistry.has('direct')).toBe(true);
  });

  it('should return 1 TranslatedResource for azure target', () => {
    const engine = getEngine('direct');
    const ctx = makeTranslationContext({ targetProvider: 'azure' });
    const result = engine.translate(ctx);

    expect(result.translated).toHaveLength(1);
    expect(result.findings.length).toBeGreaterThanOrEqual(0);
    expect(result.translated[0]!.targetType).toBe('azurerm_virtual_machine');
  });

  it('should return 1 TranslatedResource for gcp target', () => {
    const engine = getEngine('direct');
    const entry = makeRegistryEntry();
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      registryEntry: entry,
    });
    const result = engine.translate(ctx);

    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_compute_instance');
  });

  it('should copy attributes from source resource', () => {
    const engine = getEngine('direct');
    const ctx = makeTranslationContext();
    const result = engine.translate(ctx);

    expect(result.translated[0]!.attributes).toEqual({ ami: 'ami-12345', instance_type: 't3.micro' });
  });

  it('should preserve sourceName as targetName', () => {
    const engine = getEngine('direct');
    const resource = makeIrResource({ sourceName: 'web_server' });
    const ctx = makeTranslationContext({ resource });
    const result = engine.translate(ctx);

    expect(result.translated[0]!.targetName).toBe('web_server');
  });

  it('should set traceability with mappingType "direct"', () => {
    const engine = getEngine('direct');
    const ctx = makeTranslationContext();
    const result = engine.translate(ctx);

    const trace = result.translated[0]!.traceability;
    expect(trace.mappingType).toBe('direct');
    expect(trace.engineUsed).toMatch(/^direct/);
    expect(trace.sourceId).toBe('res-001');
    expect(trace.registryEntryId).toBe('SER-COMPUTE-EC2-001');
    expect(trace.confidence).toBe(0.9);
  });

  it('should set sourceId on translated resource', () => {
    const engine = getEngine('direct');
    const ctx = makeTranslationContext();
    const result = engine.translate(ctx);

    expect(result.translated[0]!.sourceId).toBe('res-001');
  });

  it('should return blocker finding when azure_targets is empty', () => {
    const engine = getEngine('direct');
    const entry = makeRegistryEntry({ azure_targets: [] });
    const ctx = makeTranslationContext({ registryEntry: entry, targetProvider: 'azure' });
    const result = engine.translate(ctx);

    expect(result.translated).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.severity).toBe('blocker');
    expect(result.findings[0]!.code).toBe('NO_TARGET_TYPE');
  });

  it('should return blocker finding when gcp_targets is empty', () => {
    const engine = getEngine('direct');
    const entry = makeRegistryEntry({ gcp_targets: [] });
    const ctx = makeTranslationContext({ registryEntry: entry, targetProvider: 'gcp' });
    const result = engine.translate(ctx);

    expect(result.translated).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.severity).toBe('blocker');
  });

  it('should not mutate original resource attributes', () => {
    const engine = getEngine('direct');
    const resource = makeIrResource({ attributes: { key: 'value' } });
    const ctx = makeTranslationContext({ resource });
    const result = engine.translate(ctx);

    result.translated[0]!.attributes['new_key'] = 'new_value';
    expect(resource.attributes).not.toHaveProperty('new_key');
  });
});

// ---------------------------------------------------------------------------
// parametricEngine
// ---------------------------------------------------------------------------

describe('parametricEngine', () => {
  it('should be registered under "parametric"', () => {
    expect(engineRegistry.has('parametric')).toBe(true);
  });

  it('should return 1 TranslatedResource for azure target', () => {
    const engine = getEngine('parametric');
    const ctx = makeTranslationContext({ targetProvider: 'azure' });
    const result = engine.translate(ctx);

    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_virtual_machine');
  });

  it('should set traceability with mappingType "parametric"', () => {
    const engine = getEngine('parametric');
    const ctx = makeTranslationContext();
    const result = engine.translate(ctx);

    expect(result.translated[0]!.traceability.mappingType).toBe('parametric');
    expect(result.translated[0]!.traceability.engineUsed).toMatch(/^parametric/);
  });

  it('should return blocker finding when no target defined', () => {
    const engine = getEngine('parametric');
    const entry = makeRegistryEntry({ azure_targets: [] });
    const ctx = makeTranslationContext({ registryEntry: entry });
    const result = engine.translate(ctx);

    expect(result.translated).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.code).toBe('NO_TARGET_TYPE');
  });
});

// ---------------------------------------------------------------------------
// compoundEngine
// ---------------------------------------------------------------------------

describe('compoundEngine', () => {
  it('should be registered under "compound"', () => {
    expect(engineRegistry.has('compound')).toBe(true);
  });

  it('should return N resources (one per azure target)', () => {
    const engine = getEngine('compound');
    const entry = makeRegistryEntry({
      azure_targets: ['azurerm_resource_group', 'azurerm_virtual_network', 'azurerm_subnet'],
    });
    const ctx = makeTranslationContext({ registryEntry: entry });
    const result = engine.translate(ctx);

    expect(result.translated).toHaveLength(3);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.code).toBe('GENERIC_COMPOUND_FALLBACK');
  });

  it('should return N resources (one per gcp target)', () => {
    const engine = getEngine('compound');
    const entry = makeRegistryEntry({
      gcp_targets: ['google_compute_network', 'google_compute_subnetwork'],
    });
    const ctx = makeTranslationContext({ registryEntry: entry, targetProvider: 'gcp' });
    const result = engine.translate(ctx);

    expect(result.translated).toHaveLength(2);
  });

  it('should suffix targetName with index', () => {
    const engine = getEngine('compound');
    const entry = makeRegistryEntry({
      azure_targets: ['azurerm_a', 'azurerm_b'],
    });
    const resource = makeIrResource({ sourceName: 'my_vpc' });
    const ctx = makeTranslationContext({ registryEntry: entry, resource });
    const result = engine.translate(ctx);

    expect(result.translated[0]!.targetName).toBe('my_vpc_0');
    expect(result.translated[1]!.targetName).toBe('my_vpc_1');
  });

  it('should set traceability with mappingType "compound"', () => {
    const engine = getEngine('compound');
    const entry = makeRegistryEntry({ azure_targets: ['azurerm_a'] });
    const ctx = makeTranslationContext({ registryEntry: entry });
    const result = engine.translate(ctx);

    expect(result.translated[0]!.traceability.mappingType).toBe('compound');
    expect(result.translated[0]!.traceability.engineUsed).toBe('compound');
  });

  it('should return blocker finding when targets list is empty', () => {
    const engine = getEngine('compound');
    const entry = makeRegistryEntry({ azure_targets: [] });
    const ctx = makeTranslationContext({ registryEntry: entry });
    const result = engine.translate(ctx);

    expect(result.translated).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.severity).toBe('blocker');
    expect(result.findings[0]!.code).toBe('NO_TARGET_TYPE');
  });

  it('should copy attributes to each translated resource', () => {
    const engine = getEngine('compound');
    const entry = makeRegistryEntry({ azure_targets: ['azurerm_a', 'azurerm_b'] });
    const resource = makeIrResource({ attributes: { cidr: '10.0.0.0/16' } });
    const ctx = makeTranslationContext({ registryEntry: entry, resource });
    const result = engine.translate(ctx);

    for (const r of result.translated) {
      expect(r.attributes).toEqual({ cidr: '10.0.0.0/16' });
    }
  });

  it('should set correct targetType for each translated resource', () => {
    const engine = getEngine('compound');
    const entry = makeRegistryEntry({ azure_targets: ['azurerm_a', 'azurerm_b', 'azurerm_c'] });
    const ctx = makeTranslationContext({ registryEntry: entry });
    const result = engine.translate(ctx);

    expect(result.translated.map((r) => r.targetType)).toEqual([
      'azurerm_a',
      'azurerm_b',
      'azurerm_c',
    ]);
  });
});

// ---------------------------------------------------------------------------
// structuralEngine
// ---------------------------------------------------------------------------

describe('structuralEngine', () => {
  it('should be registered under "structural"', () => {
    expect(engineRegistry.has('structural')).toBe(true);
  });

  it('should return translated resources for a dispatched sourceType', () => {
    const engine = getEngine('structural');
    const resource = makeIrResource({
      sourceType: 'aws_sqs_queue',
      sourceName: 'my_queue',
      attributes: { name: 'my_queue' },
    });
    const entry = makeRegistryEntry({ mapping_type: 'structural' });
    const ctx = makeTranslationContext({ resource, registryEntry: entry, targetProvider: 'azure' });
    const result = engine.translate(ctx);

    expect(result.translated.length).toBeGreaterThanOrEqual(1);
  });

  it('should set traceability with mappingType "structural"', () => {
    const engine = getEngine('structural');
    const resource = makeIrResource({
      sourceType: 'aws_sqs_queue',
      sourceName: 'my_queue',
      attributes: { name: 'my_queue' },
    });
    const entry = makeRegistryEntry({ mapping_type: 'structural' });
    const ctx = makeTranslationContext({ resource, registryEntry: entry, targetProvider: 'azure' });
    const result = engine.translate(ctx);

    expect(result.translated[0]!.traceability.mappingType).toBe('structural');
    expect(result.translated[0]!.traceability.engineUsed).toMatch(/^structural/);
  });

  it('should return warning finding for unknown structural sourceType', () => {
    const engine = getEngine('structural');
    // aws_instance is NOT in the structural dispatch table -> fallback
    const ctx = makeTranslationContext();
    const result = engine.translate(ctx);

    expect(result.translated).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.severity).toBe('warning');
    expect(result.findings[0]!.code).toBe('UNKNOWN_STRUCTURAL_TYPE');
  });

  it('should preserve sourceName as targetName for dispatched type', () => {
    const engine = getEngine('structural');
    const resource = makeIrResource({
      sourceType: 'aws_sqs_queue',
      sourceName: 'order_events',
      attributes: { name: 'order_events' },
    });
    const entry = makeRegistryEntry({ mapping_type: 'structural' });
    const ctx = makeTranslationContext({ resource, registryEntry: entry, targetProvider: 'azure' });
    const result = engine.translate(ctx);

    expect(result.translated[0]!.targetName).toBe('order_events');
  });
});

// ---------------------------------------------------------------------------
// noneEngine
// ---------------------------------------------------------------------------

describe('noneEngine', () => {
  it('should be registered under "none"', () => {
    expect(engineRegistry.has('none')).toBe(true);
  });

  it('should return 0 translated resources', () => {
    const engine = getEngine('none');
    const ctx = makeTranslationContext();
    const result = engine.translate(ctx);

    expect(result.translated).toHaveLength(0);
  });

  it('should return 1 warning finding (advisory)', () => {
    const engine = getEngine('none');
    const ctx = makeTranslationContext();
    const result = engine.translate(ctx);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.severity).toBe('warning');
    // Advisory engine emits resource-specific codes or generic ADVISORY_NO_MAPPER
    expect(result.findings[0]!.code).toMatch(/ADVISORY|_ADVISORY$/);
  });

  it('should include resource sourceType in finding message', () => {
    const engine = getEngine('none');
    const resource = makeIrResource({ sourceType: 'aws_custom_thing' });
    const ctx = makeTranslationContext({ resource });
    const result = engine.translate(ctx);

    expect(result.findings[0]!.message).toContain('aws_custom_thing');
  });

  it('should include migration guidance in finding message', () => {
    const engine = getEngine('none');
    const ctx = makeTranslationContext({ targetProvider: 'gcp' });
    const result = engine.translate(ctx);

    // Advisory engine emits migration guidance — message mentions manual migration
    expect(result.findings[0]!.message).toMatch(/migration|manual/i);
  });

  it('should set resourceId to the resource id', () => {
    const engine = getEngine('none');
    const resource = makeIrResource({ id: 'res-xyz' });
    const ctx = makeTranslationContext({ resource });
    const result = engine.translate(ctx);

    expect(result.findings[0]!.resourceId).toBe('res-xyz');
  });
});

// ---------------------------------------------------------------------------
// engineRegistry
// ---------------------------------------------------------------------------

describe('engineRegistry', () => {
  it('should contain all 5 MappingType entries', () => {
    const expected: MappingType[] = ['direct', 'parametric', 'compound', 'structural', 'none'];
    for (const mt of expected) {
      expect(engineRegistry.has(mt)).toBe(true);
    }
  });

  it('should have exactly 5 entries', () => {
    expect(engineRegistry.size).toBe(5);
  });

  it('should return engines with matching mappingType property', () => {
    for (const [type, engine] of engineRegistry) {
      expect(engine.mappingType).toBe(type);
    }
  });

  it('should expose ReadonlyMap interface (get but typed as ReadonlyMap)', () => {
    // ReadonlyMap is a TS compile-time constraint; at runtime it's still a Map.
    // Verify the exported type is usable as ReadonlyMap (has get, has, size).
    expect(typeof engineRegistry.get).toBe('function');
    expect(typeof engineRegistry.has).toBe('function');
    expect(typeof engineRegistry.size).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// getEngine
// ---------------------------------------------------------------------------

describe('getEngine', () => {
  it('should return the correct engine for each valid MappingType', () => {
    const types: MappingType[] = ['direct', 'parametric', 'compound', 'structural', 'none'];
    for (const t of types) {
      const engine = getEngine(t);
      expect(engine.mappingType).toBe(t);
    }
  });

  it('should throw TranslationError for unknown type', () => {
    expect(() => getEngine('nonexistent' as MappingType)).toThrow();
  });

  it('should throw an error whose message mentions the mapping type', () => {
    try {
      getEngine('bogus' as MappingType);
      expect.fail('Expected error');
    } catch (err: any) {
      expect(err.message).toContain('bogus');
    }
  });

  it('should return the same engine instance across calls', () => {
    const a = getEngine('direct');
    const b = getEngine('direct');
    expect(a).toBe(b);
  });
});
