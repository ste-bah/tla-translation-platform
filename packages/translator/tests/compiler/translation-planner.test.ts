import { describe, it, expect, vi } from 'vitest';
import { buildTranslationPlan } from '../../src/compiler/translation-planner.js';
import type { PlannerInput } from '../../src/engines/mapping-engine.js';
import type {
  IrResource,
  IrRelationship,
  CanonicalIR,
  RegistryEntry,
  CloudProvider,
  MappingType,
} from '@tla/shared';
import { resolveRegistryKey } from '@tla/shared';
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
    attributes: {},
    sourceAttributes: {},
    registryEntryId: null,
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

function makeMockRegistry(entries: Map<string, RegistryEntry>): RegistryApi {
  return {
    lookup: vi.fn((key: string) => {
      // Direct key match first (supports both full type and short name keys)
      const direct = entries.get(key);
      if (direct) return direct;
      // Fallback: search by aws_service field (resolveRegistryKey now sends short keys)
      for (const entry of entries.values()) {
        if (entry.aws_service === key) return entry;
      }
      // Reverse resolve: key is a short registry key, find the entry whose
      // Map key resolves to it via resolveRegistryKey
      for (const [mapKey, entry] of entries.entries()) {
        if (resolveRegistryKey(mapKey) === key) return entry;
      }
      return undefined;
    }),
    lookupMany: vi.fn(),
  } as unknown as RegistryApi;
}

function makeCanonicalIR(overrides: Partial<CanonicalIR> = {}): CanonicalIR {
  return {
    version: '1.0.0',
    sourceProvider: 'aws',
    resources: [],
    relationships: [],
    modules: [],
    intents: [],
    metadata: {
      generatedAt: '2025-03-01T00:00:00Z',
      sourceFiles: ['main.tf'],
      toolVersion: '0.1.0',
    },
    ...overrides,
  } as CanonicalIR;
}

function makePlannerInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  const ir = overrides.ir ?? makeCanonicalIR();
  const entries = new Map<string, RegistryEntry>();
  return {
    ir,
    registry: overrides.registry ?? makeMockRegistry(entries),
    targetProvider: overrides.targetProvider ?? 'azure',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildTranslationPlan', () => {
  describe('basic planning', () => {
    it('should return empty plan for empty IR', () => {
      const input = makePlannerInput();
      const result = buildTranslationPlan(input);

      expect(result.plan.items).toHaveLength(0);
      expect(result.plan.blockedCount).toBe(0);
      expect(result.plan.groupCount).toBe(0);
      expect(result.findings).toHaveLength(0);
    });

    it('should create a single plan item for a single resource', () => {
      const resource = makeIrResource({ id: 'res-1', sourceType: 'aws_instance' });
      const entry = makeRegistryEntry({ aws_service: 'aws_instance' });
      const entries = new Map([['aws_instance', entry]]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources: [resource] }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);

      expect(result.plan.items).toHaveLength(1);
      expect(result.plan.items[0]!.resourceId).toBe('res-1');
      expect(result.plan.items[0]!.mappingType).toBe('direct');
      expect(result.plan.items[0]!.status).toBe('translated');
      expect(result.plan.items[0]!.order).toBe(0);
    });

    it('should set registryEntryId on plan items', () => {
      const resource = makeIrResource({ sourceType: 'aws_instance' });
      const entry = makeRegistryEntry({ registry_entry_id: 'SER-COMPUTE-EC2-001' });
      const entries = new Map([['aws_instance', entry]]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources: [resource] }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      expect(result.plan.items[0]!.registryEntryId).toBe('SER-COMPUTE-EC2-001');
    });

    it('should return registryEntries map with resolved entries', () => {
      const resource = makeIrResource({ sourceType: 'aws_instance' });
      const entry = makeRegistryEntry();
      const entries = new Map([['aws_instance', entry]]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources: [resource] }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      expect(result.registryEntries.size).toBe(1);
      expect(result.registryEntries.get('aws_instance')).toBe(entry);
    });
  });

  describe('topological ordering', () => {
    it('should order independent resources alphabetically by id', () => {
      const resources = [
        makeIrResource({ id: 'c-res', sourceType: 'aws_c' }),
        makeIrResource({ id: 'a-res', sourceType: 'aws_a' }),
        makeIrResource({ id: 'b-res', sourceType: 'aws_b' }),
      ];
      const entries = new Map<string, RegistryEntry>([
        ['aws_a', makeRegistryEntry({ aws_service: 'aws_a' })],
        ['aws_b', makeRegistryEntry({ aws_service: 'aws_b' })],
        ['aws_c', makeRegistryEntry({ aws_service: 'aws_c' })],
      ]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      const ids = result.plan.items.map((i) => i.resourceId);
      expect(ids).toEqual(['a-res', 'b-res', 'c-res']);
    });

    it('should respect linear dependency chain A->B->C (C first, then B, then A)', () => {
      const resources = [
        makeIrResource({ id: 'A', sourceType: 'aws_a' }),
        makeIrResource({ id: 'B', sourceType: 'aws_b' }),
        makeIrResource({ id: 'C', sourceType: 'aws_c' }),
      ];
      // A depends_on B, B depends_on C => order: C, B, A
      const relationships: IrRelationship[] = [
        { from: 'A', to: 'B', type: 'depends_on' },
        { from: 'B', to: 'C', type: 'depends_on' },
      ];
      const entries = new Map<string, RegistryEntry>([
        ['aws_a', makeRegistryEntry({ aws_service: 'aws_a' })],
        ['aws_b', makeRegistryEntry({ aws_service: 'aws_b' })],
        ['aws_c', makeRegistryEntry({ aws_service: 'aws_c' })],
      ]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources, relationships }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      const ids = result.plan.items.map((i) => i.resourceId);
      expect(ids.indexOf('C')).toBeLessThan(ids.indexOf('B'));
      expect(ids.indexOf('B')).toBeLessThan(ids.indexOf('A'));
    });

    it('should handle diamond dependency correctly', () => {
      // D depends on B and C; B depends on A; C depends on A
      const resources = [
        makeIrResource({ id: 'A', sourceType: 'aws_a' }),
        makeIrResource({ id: 'B', sourceType: 'aws_b' }),
        makeIrResource({ id: 'C', sourceType: 'aws_c' }),
        makeIrResource({ id: 'D', sourceType: 'aws_d' }),
      ];
      const relationships: IrRelationship[] = [
        { from: 'B', to: 'A', type: 'depends_on' },
        { from: 'C', to: 'A', type: 'depends_on' },
        { from: 'D', to: 'B', type: 'depends_on' },
        { from: 'D', to: 'C', type: 'depends_on' },
      ];
      const entries = new Map<string, RegistryEntry>([
        ['aws_a', makeRegistryEntry({ aws_service: 'aws_a' })],
        ['aws_b', makeRegistryEntry({ aws_service: 'aws_b' })],
        ['aws_c', makeRegistryEntry({ aws_service: 'aws_c' })],
        ['aws_d', makeRegistryEntry({ aws_service: 'aws_d' })],
      ]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources, relationships }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      const ids = result.plan.items.map((i) => i.resourceId);

      // A must come before B and C; B and C must come before D
      expect(ids.indexOf('A')).toBeLessThan(ids.indexOf('B'));
      expect(ids.indexOf('A')).toBeLessThan(ids.indexOf('C'));
      expect(ids.indexOf('B')).toBeLessThan(ids.indexOf('D'));
      expect(ids.indexOf('C')).toBeLessThan(ids.indexOf('D'));
    });

    it('should handle "references" relationship type for ordering', () => {
      const resources = [
        makeIrResource({ id: 'A', sourceType: 'aws_a' }),
        makeIrResource({ id: 'B', sourceType: 'aws_b' }),
      ];
      const relationships: IrRelationship[] = [
        { from: 'A', to: 'B', type: 'references' },
      ];
      const entries = new Map<string, RegistryEntry>([
        ['aws_a', makeRegistryEntry({ aws_service: 'aws_a' })],
        ['aws_b', makeRegistryEntry({ aws_service: 'aws_b' })],
      ]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources, relationships }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      const ids = result.plan.items.map((i) => i.resourceId);
      expect(ids.indexOf('B')).toBeLessThan(ids.indexOf('A'));
    });

    it('should ignore non-ordering relationship types (contains, secures, etc.)', () => {
      const resources = [
        makeIrResource({ id: 'A', sourceType: 'aws_a' }),
        makeIrResource({ id: 'B', sourceType: 'aws_b' }),
      ];
      const relationships: IrRelationship[] = [
        { from: 'A', to: 'B', type: 'contains' },
      ];
      const entries = new Map<string, RegistryEntry>([
        ['aws_a', makeRegistryEntry({ aws_service: 'aws_a' })],
        ['aws_b', makeRegistryEntry({ aws_service: 'aws_b' })],
      ]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources, relationships }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      const ids = result.plan.items.map((i) => i.resourceId);
      // Alphabetical since 'contains' is not a dependency type
      expect(ids).toEqual(['A', 'B']);
    });

    it('should assign sequential order numbers', () => {
      const resources = [
        makeIrResource({ id: 'A', sourceType: 'aws_a' }),
        makeIrResource({ id: 'B', sourceType: 'aws_b' }),
        makeIrResource({ id: 'C', sourceType: 'aws_c' }),
      ];
      const entries = new Map<string, RegistryEntry>([
        ['aws_a', makeRegistryEntry({ aws_service: 'aws_a' })],
        ['aws_b', makeRegistryEntry({ aws_service: 'aws_b' })],
        ['aws_c', makeRegistryEntry({ aws_service: 'aws_c' })],
      ]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      const orders = result.plan.items.map((i) => i.order);
      expect(orders).toEqual([0, 1, 2]);
    });
  });

  describe('status classification', () => {
    it('should mark resources with no registry entry as "blocked"', () => {
      const resource = makeIrResource({ sourceType: 'aws_unknown' });
      const entries = new Map<string, RegistryEntry>(); // empty

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources: [resource] }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      expect(result.plan.items[0]!.status).toBe('blocked');
      expect(result.plan.items[0]!.blockerReason).toContain('No registry entry');
      expect(result.plan.blockedCount).toBe(1);
    });

    it('should mark "none" mapping_type as "advisory"', () => {
      const resource = makeIrResource({ sourceType: 'aws_none' });
      const entry = makeRegistryEntry({ aws_service: 'aws_none', mapping_type: 'none' });
      const entries = new Map([['aws_none', entry]]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources: [resource] }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      expect(result.plan.items[0]!.status).toBe('advisory');
      expect(result.plan.items[0]!.blockerReason).toContain('none');
    });

    it('should mark M1 band as "advisory"', () => {
      const resource = makeIrResource({ sourceType: 'aws_manual' });
      const entry = makeRegistryEntry({ aws_service: 'aws_manual', band: 'M1' });
      const entries = new Map([['aws_manual', entry]]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources: [resource] }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      expect(result.plan.items[0]!.status).toBe('advisory');
      expect(result.plan.items[0]!.blockerReason).toContain('M1');
    });

    it('should mark compound mapping_type as "expanded"', () => {
      const resource = makeIrResource({ sourceType: 'aws_compound' });
      const entry = makeRegistryEntry({ aws_service: 'aws_compound', mapping_type: 'compound' });
      const entries = new Map([['aws_compound', entry]]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources: [resource] }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      expect(result.plan.items[0]!.status).toBe('expanded');
      expect(result.plan.items[0]!.blockerReason).toBeNull();
    });

    it('should mark structural mapping_type as "expanded"', () => {
      const resource = makeIrResource({ sourceType: 'aws_struct' });
      const entry = makeRegistryEntry({ aws_service: 'aws_struct', mapping_type: 'structural' });
      const entries = new Map([['aws_struct', entry]]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources: [resource] }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      expect(result.plan.items[0]!.status).toBe('expanded');
    });

    it('should mark direct/parametric as "translated"', () => {
      const resource = makeIrResource({ sourceType: 'aws_direct' });
      const entry = makeRegistryEntry({ aws_service: 'aws_direct', mapping_type: 'direct', band: 'P1' });
      const entries = new Map([['aws_direct', entry]]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources: [resource] }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      expect(result.plan.items[0]!.status).toBe('translated');
    });

    it('should default mappingType to "none" when no entry found', () => {
      const resource = makeIrResource({ sourceType: 'aws_missing' });
      const entries = new Map<string, RegistryEntry>();

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources: [resource] }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      expect(result.plan.items[0]!.mappingType).toBe('none');
    });
  });

  describe('compound grouping', () => {
    it('should group resources with same registryEntryId and compound mapping', () => {
      const resources = [
        makeIrResource({ id: 'r1', sourceType: 'aws_vpc' }),
        makeIrResource({ id: 'r2', sourceType: 'aws_vpc' }),
      ];
      const entry = makeRegistryEntry({
        registry_entry_id: 'SER-NET-VPC-001',
        aws_service: 'aws_vpc',
        mapping_type: 'compound',
      });
      const entries = new Map([['aws_vpc', entry]]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      expect(result.plan.groupCount).toBe(1);

      // Both should share the same groupId
      const groupIds = result.plan.items.map((i) => i.groupId);
      expect(groupIds[0]).toBe(groupIds[1]);
      expect(groupIds[0]).toBe('group-SER-NET-VPC-001');
    });

    it('should not group direct/parametric resources', () => {
      const resources = [
        makeIrResource({ id: 'r1', sourceType: 'aws_instance' }),
        makeIrResource({ id: 'r2', sourceType: 'aws_instance' }),
      ];
      const entry = makeRegistryEntry({ aws_service: 'aws_instance', mapping_type: 'direct' });
      const entries = new Map([['aws_instance', entry]]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      expect(result.plan.groupCount).toBe(0);
      expect(result.plan.items[0]!.groupId).toBeNull();
    });

    it('should group structural resources', () => {
      const resources = [
        makeIrResource({ id: 'r1', sourceType: 'aws_struct' }),
        makeIrResource({ id: 'r2', sourceType: 'aws_struct' }),
      ];
      const entry = makeRegistryEntry({
        registry_entry_id: 'SER-NET-STRUCT-001',
        aws_service: 'aws_struct',
        mapping_type: 'structural',
      });
      const entries = new Map([['aws_struct', entry]]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      expect(result.plan.groupCount).toBe(1);
    });
  });

  describe('findings', () => {
    it('should produce REGISTRY_MISS warning when resource has no entry', () => {
      const resource = makeIrResource({ id: 'res-miss', sourceType: 'aws_missing' });
      const entries = new Map<string, RegistryEntry>();

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources: [resource] }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]!.severity).toBe('warning');
      expect(result.findings[0]!.code).toBe('REGISTRY_MISS');
      expect(result.findings[0]!.resourceId).toBe('res-miss');
    });

    it('should produce no findings when all resources have entries', () => {
      const resource = makeIrResource({ sourceType: 'aws_instance' });
      const entry = makeRegistryEntry();
      const entries = new Map([['aws_instance', entry]]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources: [resource] }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      expect(result.findings).toHaveLength(0);
    });

    it('should produce multiple REGISTRY_MISS findings for multiple missing', () => {
      const resources = [
        makeIrResource({ id: 'r1', sourceType: 'aws_x' }),
        makeIrResource({ id: 'r2', sourceType: 'aws_y' }),
      ];
      const entries = new Map<string, RegistryEntry>();

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      expect(result.findings).toHaveLength(2);
    });
  });

  describe('blockedCount', () => {
    it('should count blocked items correctly', () => {
      const resources = [
        makeIrResource({ id: 'r1', sourceType: 'aws_known' }),
        makeIrResource({ id: 'r2', sourceType: 'aws_unknown1' }),
        makeIrResource({ id: 'r3', sourceType: 'aws_unknown2' }),
      ];
      const entry = makeRegistryEntry({ aws_service: 'aws_known' });
      const entries = new Map([['aws_known', entry]]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources }),
        registry: makeMockRegistry(entries),
      });

      const result = buildTranslationPlan(input);
      expect(result.plan.blockedCount).toBe(2);
    });
  });

  describe('determinism', () => {
    it('should produce identical output for same input across multiple calls', () => {
      const resources = [
        makeIrResource({ id: 'C', sourceType: 'aws_c' }),
        makeIrResource({ id: 'A', sourceType: 'aws_a' }),
        makeIrResource({ id: 'B', sourceType: 'aws_b' }),
      ];
      const entries = new Map<string, RegistryEntry>([
        ['aws_a', makeRegistryEntry({ aws_service: 'aws_a' })],
        ['aws_b', makeRegistryEntry({ aws_service: 'aws_b' })],
        ['aws_c', makeRegistryEntry({ aws_service: 'aws_c' })],
      ]);

      const input = makePlannerInput({
        ir: makeCanonicalIR({ resources }),
        registry: makeMockRegistry(entries),
      });

      const result1 = buildTranslationPlan(input);
      const result2 = buildTranslationPlan(input);

      expect(result1.plan.items.map((i) => i.resourceId)).toEqual(
        result2.plan.items.map((i) => i.resourceId),
      );
    });
  });
});
