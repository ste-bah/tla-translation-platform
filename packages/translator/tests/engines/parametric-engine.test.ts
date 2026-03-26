import { describe, it, expect, vi } from 'vitest';
import { parametricEngine } from '../../src/engines/parametric-engine.js';
import {
  gapSeverityToFinding,
  computeConfidence,
  emitBehavioralGapFindings,
  findSiblingVpc,
  azToRegion,
} from '../../src/engines/direct/attribute-transformer.js';
import { translateVpc } from '../../src/engines/parametric/vpc-mapping.js';
import { translateSubnet } from '../../src/engines/parametric/subnet-mapping.js';
import { translateNat } from '../../src/engines/parametric/nat-mapping.js';
import { translateKms } from '../../src/engines/parametric/kms-mapping.js';
import { translateSecrets } from '../../src/engines/parametric/secrets-mapping.js';
import { translateEks } from '../../src/engines/parametric/eks-mapping.js';
import type { TranslationContext } from '../../src/engines/mapping-engine.js';
import type {
  IrResource,
  IrRelationship,
  RegistryEntry,
  CanonicalIR,
  CloudProvider,
  CompilerOptions,
  BehavioralGap,
} from '@tla/shared';
import type { RegistryApi } from '@tla/registry';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'res-001',
    sourceType: 'aws_vpc',
    sourceName: 'my_vpc',
    sourceModule: null,
    category: 'networking',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: 'SER-NETWORK-VPC-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-NETWORK-VPC-001',
    aws_service: 'aws_vpc',
    aws_family: 'networking',
    azure_targets: ['azurerm_virtual_network'],
    gcp_targets: ['google_compute_network'],
    mapping_type: 'parametric',
    output_mode: 'native_emit_only',
    band: 'P1',
    confidence: 0.9,
    portable_provider_candidate: false,
    behavioral_gaps: [],
    manual_review_required: false,
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

function makeTranslationContext(overrides: Partial<TranslationContext> = {}): TranslationContext {
  const resource = overrides.resource ?? makeIrResource();
  const entry = overrides.registryEntry ?? makeRegistryEntry();
  return {
    targetProvider: 'azure' as CloudProvider,
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
      },
    } as CanonicalIR,
    registry: makeMockRegistry(),
    options: makeCompilerOptions(),
    ...overrides,
  };
}

function makeBehavioralGap(overrides: Partial<BehavioralGap> = {}): BehavioralGap {
  return {
    gap_id: 'BGR-NET-VPC-001',
    gap_type: 'feature_gap',
    description: 'Test gap description',
    severity: 'major',
    affected_targets: ['azure', 'gcp'],
    workaround: null,
    requires_manual_review: false,
    ...overrides,
  };
}

// ===========================================================================
// attribute-transformer new helpers
// ===========================================================================

describe('attribute-transformer new helpers', () => {
  // -----------------------------------------------------------------------
  // gapSeverityToFinding
  // -----------------------------------------------------------------------
  describe('gapSeverityToFinding', () => {
    it('should map blocker to blocker', () => {
      expect(gapSeverityToFinding('blocker')).toBe('blocker');
    });

    it('should map major to warning', () => {
      expect(gapSeverityToFinding('major')).toBe('warning');
    });

    it('should map minor to info', () => {
      expect(gapSeverityToFinding('minor')).toBe('info');
    });

    it('should map informational to info', () => {
      expect(gapSeverityToFinding('informational')).toBe('info');
    });
  });

  // -----------------------------------------------------------------------
  // computeConfidence
  // -----------------------------------------------------------------------
  describe('computeConfidence', () => {
    it('should return registryConfidence when all keys are mapped', () => {
      const attrs = { a: 1, b: 2, c: 3 };
      const result = computeConfidence(0.9, attrs, ['a', 'b', 'c']);
      expect(result).toBe(0.9);
    });

    it('should penalise for unmapped keys', () => {
      const attrs = { a: 1, b: 2, c: 3, d: 4 };
      // 3/4 mapped = 0.75 coverage; 0.9 * 0.75 = 0.675 -> rounded to 0.68
      const result = computeConfidence(0.9, attrs, ['a', 'b', 'c']);
      expect(result).toBe(0.68);
    });

    it('should return registryConfidence when attrs is empty (zero totalKeys)', () => {
      const result = computeConfidence(0.85, {}, []);
      expect(result).toBe(0.85);
    });

    it('should clamp to 0 when confidence would be negative', () => {
      // coverage = 0/3 = 0 -> raw = -0.5 * 0 = 0
      const result = computeConfidence(-0.5, { a: 1, b: 2, c: 3 }, []);
      expect(result).toBe(0);
    });

    it('should clamp to 1 when confidence exceeds 1', () => {
      // registryConfidence 1.5, all keys mapped -> 1.5 * 1 = 1.5 clamped to 1
      const result = computeConfidence(1.5, { a: 1 }, ['a']);
      expect(result).toBe(1);
    });

    it('should return 0 when no keys are mapped and registryConfidence is positive', () => {
      const result = computeConfidence(0.9, { a: 1, b: 2 }, []);
      expect(result).toBe(0);
    });

    it('should handle partial coverage correctly', () => {
      // 1/2 = 0.5 coverage; 0.8 * 0.5 = 0.4
      const result = computeConfidence(0.8, { a: 1, b: 2 }, ['a']);
      expect(result).toBe(0.4);
    });

    it('should ignore mapped keys not present in attrs', () => {
      // attrs has {a, b}, mappedKeys = ['a', 'x'] -> mappedCount = 1/2 = 0.5
      const result = computeConfidence(1.0, { a: 1, b: 2 }, ['a', 'x']);
      expect(result).toBe(0.5);
    });
  });

  // -----------------------------------------------------------------------
  // emitBehavioralGapFindings
  // -----------------------------------------------------------------------
  describe('emitBehavioralGapFindings', () => {
    it('should emit findings for gaps affecting the target provider', () => {
      const gap = makeBehavioralGap({
        severity: 'major',
        affected_targets: ['azure'],
        description: 'Azure gap',
      });
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        registryEntry: makeRegistryEntry({ behavioral_gaps: [gap] }),
      });

      const findings = emitBehavioralGapFindings(ctx);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe('warning');
      expect(findings[0]!.message).toBe('Azure gap');
    });

    it('should skip gaps not affecting the target provider', () => {
      const gap = makeBehavioralGap({
        affected_targets: ['gcp'],
      });
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        registryEntry: makeRegistryEntry({ behavioral_gaps: [gap] }),
      });

      const findings = emitBehavioralGapFindings(ctx);
      expect(findings).toHaveLength(0);
    });

    it('should return empty array when no behavioral_gaps exist', () => {
      const ctx = makeTranslationContext({
        registryEntry: makeRegistryEntry({ behavioral_gaps: [] }),
      });

      const findings = emitBehavioralGapFindings(ctx);
      expect(findings).toHaveLength(0);
    });

    it('should include workaround as detail when present', () => {
      const gap = makeBehavioralGap({
        affected_targets: ['azure'],
        workaround: 'Use manual setup',
      });
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        registryEntry: makeRegistryEntry({ behavioral_gaps: [gap] }),
      });

      const findings = emitBehavioralGapFindings(ctx);
      expect(findings[0]!.detail).toBe('Use manual setup');
    });

    it('should not include detail when workaround is null', () => {
      const gap = makeBehavioralGap({
        affected_targets: ['azure'],
        workaround: null,
      });
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        registryEntry: makeRegistryEntry({ behavioral_gaps: [gap] }),
      });

      const findings = emitBehavioralGapFindings(ctx);
      expect(findings[0]!.detail).toBeUndefined();
    });

    it('should map blocker gap severity to blocker finding', () => {
      const gap = makeBehavioralGap({
        severity: 'blocker',
        affected_targets: ['gcp'],
      });
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        registryEntry: makeRegistryEntry({ behavioral_gaps: [gap] }),
      });

      const findings = emitBehavioralGapFindings(ctx);
      expect(findings[0]!.severity).toBe('blocker');
    });

    it('should emit multiple findings for multiple applicable gaps', () => {
      const gaps = [
        makeBehavioralGap({ gap_id: 'BGR-NET-VPC-001', affected_targets: ['azure'] }),
        makeBehavioralGap({ gap_id: 'BGR-NET-VPC-002', affected_targets: ['azure', 'gcp'] }),
        makeBehavioralGap({ gap_id: 'BGR-NET-VPC-003', affected_targets: ['gcp'] }),
      ];
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        registryEntry: makeRegistryEntry({ behavioral_gaps: gaps }),
      });

      const findings = emitBehavioralGapFindings(ctx);
      expect(findings).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // findSiblingVpc
  // -----------------------------------------------------------------------
  describe('findSiblingVpc', () => {
    it('should find VPC via relationship edge', () => {
      const vpcResource = makeIrResource({
        id: 'vpc-001',
        sourceType: 'aws_vpc',
        sourceName: 'main_vpc',
      });
      const subnetResource = makeIrResource({
        id: 'subnet-001',
        sourceType: 'aws_subnet',
        sourceName: 'my_subnet',
      });
      const rel: IrRelationship = { from: 'subnet-001', to: 'vpc-001', type: 'depends_on' };

      const ctx = makeTranslationContext({
        resource: subnetResource,
        relationships: [rel],
        siblingResources: [vpcResource],
      });

      const result = findSiblingVpc(ctx);
      expect(result).toEqual({ sourceName: 'main_vpc', id: 'vpc-001' });
    });

    it('should find VPC via reverse relationship edge', () => {
      const vpcResource = makeIrResource({
        id: 'vpc-001',
        sourceType: 'aws_vpc',
        sourceName: 'main_vpc',
      });
      const subnetResource = makeIrResource({
        id: 'subnet-001',
        sourceType: 'aws_subnet',
      });
      const rel: IrRelationship = { from: 'vpc-001', to: 'subnet-001', type: 'depends_on' };

      const ctx = makeTranslationContext({
        resource: subnetResource,
        relationships: [rel],
        siblingResources: [vpcResource],
      });

      const result = findSiblingVpc(ctx);
      expect(result).toEqual({ sourceName: 'main_vpc', id: 'vpc-001' });
    });

    it('should find VPC via vpc_id attribute match (by id)', () => {
      const vpcResource = makeIrResource({
        id: 'vpc-123',
        sourceType: 'aws_vpc',
        sourceName: 'main_vpc',
      });
      const subnetResource = makeIrResource({
        id: 'subnet-001',
        sourceType: 'aws_subnet',
        attributes: { vpc_id: 'vpc-123' },
      });

      const ctx = makeTranslationContext({
        resource: subnetResource,
        siblingResources: [vpcResource],
      });

      const result = findSiblingVpc(ctx);
      expect(result).toEqual({ sourceName: 'main_vpc', id: 'vpc-123' });
    });

    it('should find VPC via vpc_id attribute match (by sourceName)', () => {
      const vpcResource = makeIrResource({
        id: 'vpc-001',
        sourceType: 'aws_vpc',
        sourceName: 'main_vpc',
      });
      const subnetResource = makeIrResource({
        id: 'subnet-001',
        sourceType: 'aws_subnet',
        attributes: { vpc_id: 'main_vpc' },
      });

      const ctx = makeTranslationContext({
        resource: subnetResource,
        siblingResources: [vpcResource],
      });

      const result = findSiblingVpc(ctx);
      expect(result).toEqual({ sourceName: 'main_vpc', id: 'vpc-001' });
    });

    it('should return undefined when no VPC exists', () => {
      const subnetResource = makeIrResource({
        id: 'subnet-001',
        sourceType: 'aws_subnet',
      });

      const ctx = makeTranslationContext({
        resource: subnetResource,
        siblingResources: [],
      });

      const result = findSiblingVpc(ctx);
      expect(result).toBeUndefined();
    });

    it('should fall back to first VPC sibling when no relationship or vpc_id', () => {
      const vpcResource = makeIrResource({
        id: 'vpc-001',
        sourceType: 'aws_vpc',
        sourceName: 'fallback_vpc',
      });
      const subnetResource = makeIrResource({
        id: 'subnet-001',
        sourceType: 'aws_subnet',
        attributes: {},
      });

      const ctx = makeTranslationContext({
        resource: subnetResource,
        siblingResources: [vpcResource],
      });

      const result = findSiblingVpc(ctx);
      expect(result).toEqual({ sourceName: 'fallback_vpc', id: 'vpc-001' });
    });

    it('should prefer relationship edge over vpc_id attribute fallback', () => {
      const vpcByRel = makeIrResource({
        id: 'vpc-rel',
        sourceType: 'aws_vpc',
        sourceName: 'rel_vpc',
      });
      const vpcByAttr = makeIrResource({
        id: 'vpc-attr',
        sourceType: 'aws_vpc',
        sourceName: 'attr_vpc',
      });
      const subnetResource = makeIrResource({
        id: 'subnet-001',
        sourceType: 'aws_subnet',
        attributes: { vpc_id: 'vpc-attr' },
      });
      const rel: IrRelationship = { from: 'subnet-001', to: 'vpc-rel', type: 'depends_on' };

      const ctx = makeTranslationContext({
        resource: subnetResource,
        relationships: [rel],
        siblingResources: [vpcByRel, vpcByAttr],
      });

      const result = findSiblingVpc(ctx);
      expect(result).toEqual({ sourceName: 'rel_vpc', id: 'vpc-rel' });
    });
  });

  // -----------------------------------------------------------------------
  // azToRegion
  // -----------------------------------------------------------------------
  describe('azToRegion', () => {
    it('should extract region from AZ with dash-letter suffix like foo-a', () => {
      // The regex ^(.+)-[a-z]$ strips a trailing "-<letter>"
      expect(azToRegion('us-east-a')).toBe('us-east');
    });

    it('should return as-is for standard AZ format us-east-1a (no dash before letter)', () => {
      // us-east-1a does NOT have a dash before the final "a", so regex does not match
      expect(azToRegion('us-east-1a')).toBe('us-east-1a');
    });

    it('should return as-is for eu-west-2b (no dash before letter)', () => {
      expect(azToRegion('eu-west-2b')).toBe('eu-west-2b');
    });

    it('should return as-is when no trailing AZ letter matches', () => {
      expect(azToRegion('us-east-1')).toBe('us-east-1');
    });

    it('should return as-is for empty string', () => {
      expect(azToRegion('')).toBe('');
    });

    it('should strip trailing dash-letter suffix', () => {
      expect(azToRegion('something-z')).toBe('something');
    });
  });
});

// ===========================================================================
// parametricEngine dispatch
// ===========================================================================

describe('parametricEngine dispatch', () => {
  it('should have mappingType "parametric"', () => {
    expect(parametricEngine.mappingType).toBe('parametric');
  });

  it('should use generic fallback for aws_vpc (moved to structural-engine)', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_vpc', attributes: { cidr_block: '10.0.0.0/16' } }),
    });

    const result = parametricEngine.translate(ctx);
    expect(result.findings.some((f) => f.code === 'GENERIC_PARAMETRIC_FALLBACK')).toBe(true);
  });

  it('should use generic fallback for aws_subnet (moved to structural-engine)', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_subnet', attributes: { cidr_block: '10.0.1.0/24' } }),
      registryEntry: makeRegistryEntry({ azure_targets: ['azurerm_subnet'] }),
    });

    const result = parametricEngine.translate(ctx);
    expect(result.findings.some((f) => f.code === 'GENERIC_PARAMETRIC_FALLBACK')).toBe(true);
  });

  it('should dispatch aws_nat_gateway correctly', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_nat_gateway' }),
    });

    const result = parametricEngine.translate(ctx);
    expect(result.translated.length).toBe(2); // Azure: public_ip + nat_gateway
  });

  it('should dispatch aws_kms_key correctly', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_kms_key' }),
    });

    const result = parametricEngine.translate(ctx);
    expect(result.translated[0]!.targetType).toContain('key_vault_key');
  });

  it('should dispatch aws_secretsmanager_secret correctly', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_secretsmanager_secret' }),
    });

    const result = parametricEngine.translate(ctx);
    expect(result.translated[0]!.targetType).toContain('key_vault_secret');
  });

  it('should dispatch aws_eks_cluster correctly', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_eks_cluster' }),
    });

    const result = parametricEngine.translate(ctx);
    expect(result.translated[0]!.targetType).toContain('kubernetes_cluster');
  });

  it('should use generic fallback for unknown sourceType', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_unknown_thing', attributes: { foo: 'bar' } }),
      registryEntry: makeRegistryEntry({ azure_targets: ['azurerm_something'] }),
    });

    const result = parametricEngine.translate(ctx);
    expect(result.findings.some((f) => f.code === 'GENERIC_PARAMETRIC_FALLBACK')).toBe(true);
    expect(result.translated[0]!.attributes).toEqual({ foo: 'bar' });
  });

  it('should return NO_TARGET_TYPE finding when no target defined for fallback', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_unknown' }),
      registryEntry: makeRegistryEntry({ azure_targets: [] }),
    });

    const result = parametricEngine.translate(ctx);
    expect(result.translated).toHaveLength(0);
    expect(result.findings.some((f) => f.code === 'NO_TARGET_TYPE')).toBe(true);
  });

  it('should use generic fallback for gcp provider with unknown type', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ sourceType: 'aws_unknown_thing', attributes: { a: 1 } }),
      registryEntry: makeRegistryEntry({ gcp_targets: ['google_something'] }),
    });

    const result = parametricEngine.translate(ctx);
    expect(result.translated[0]!.targetType).toBe('google_something');
    expect(result.findings.some((f) => f.code === 'GENERIC_PARAMETRIC_FALLBACK')).toBe(true);
  });

  it('should sort attributes in generic fallback for determinism', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({
        sourceType: 'aws_unknown',
        attributes: { z_attr: 'z', a_attr: 'a', m_attr: 'm' },
      }),
      registryEntry: makeRegistryEntry({ azure_targets: ['azurerm_something'] }),
    });

    const result = parametricEngine.translate(ctx);
    const keys = Object.keys(result.translated[0]!.attributes);
    expect(keys).toEqual(['a_attr', 'm_attr', 'z_attr']);
  });

  it('should set traceability mappingType to parametric in generic fallback', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_unknown' }),
      registryEntry: makeRegistryEntry({ azure_targets: ['azurerm_something'] }),
    });

    const result = parametricEngine.translate(ctx);
    expect(result.translated[0]!.traceability.mappingType).toBe('parametric');
  });
});

// ===========================================================================
// translateVpc
// ===========================================================================

describe('translateVpc', () => {
  describe('Azure', () => {
    it('should produce azurerm_virtual_network with address_space', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { cidr_block: '10.1.0.0/16' },
        }),
      });

      const result = translateVpc(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('azurerm_virtual_network');
      expect(result.translated[0]!.attributes['address_space']).toEqual(['10.1.0.0/16']);
    });

    it('should default cidr_block to 10.0.0.0/16 if missing', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: {} }),
      });

      const result = translateVpc(ctx);
      expect(result.translated[0]!.attributes['address_space']).toEqual(['10.0.0.0/16']);
    });

    it('should include location, name, and resource_group_name', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceName: 'test_vpc' }),
      });

      const result = translateVpc(ctx);
      const attrs = result.translated[0]!.attributes;
      expect(attrs['name']).toBe('test_vpc');
      expect(attrs['resource_group_name']).toBe('${azurerm_resource_group.main.name}');
      expect(attrs['location']).toBeDefined();
    });

    it('should transform tags for Azure', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { tags: { Env: 'prod', Team: 'infra' } },
        }),
      });

      const result = translateVpc(ctx);
      expect(result.translated[0]!.attributes['tags']).toEqual({ Env: 'prod', Team: 'infra' });
    });

    it('should not include tags key when no tags present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: {} }),
      });

      const result = translateVpc(ctx);
      expect(result.translated[0]!.attributes).not.toHaveProperty('tags');
    });

    it('should emit unmapped attribute findings', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { cidr_block: '10.0.0.0/16', custom_attr: 'value' },
        }),
      });

      const result = translateVpc(ctx);
      expect(result.findings.some((f) => f.code === 'UNMAPPED_ATTRIBUTE' && f.message.includes('custom_attr'))).toBe(true);
    });

    it('should set traceability with mappingType parametric', () => {
      const ctx = makeTranslationContext({ targetProvider: 'azure' });
      const result = translateVpc(ctx);
      expect(result.translated[0]!.traceability.mappingType).toBe('parametric');
      expect(result.translated[0]!.traceability.engineUsed).toBe('parametric/vpc');
    });
  });

  describe('GCP', () => {
    it('should produce google_compute_network with auto_create_subnetworks false', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: { cidr_block: '10.0.0.0/16' } }),
      });

      const result = translateVpc(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('google_compute_network');
      expect(result.translated[0]!.attributes['auto_create_subnetworks']).toBe(false);
    });

    it('should set routing_mode to REGIONAL', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({}),
      });

      const result = translateVpc(ctx);
      expect(result.translated[0]!.attributes['routing_mode']).toBe('REGIONAL');
    });

    it('should transform tags to GCP labels (lowercase)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          attributes: { tags: { 'My-Tag': 'value', 'UPPER': 'val' } },
        }),
      });

      const result = translateVpc(ctx);
      const labels = result.translated[0]!.attributes['labels'] as Record<string, string>;
      expect(labels['my-tag']).toBe('value');
      expect(labels['upper']).toBe('val');
    });

    it('should set name from sourceName', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceName: 'gcp_vpc' }),
      });

      const result = translateVpc(ctx);
      expect(result.translated[0]!.attributes['name']).toBe('gcp_vpc');
    });
  });
});

// ===========================================================================
// translateSubnet
// ===========================================================================

describe('translateSubnet', () => {
  const vpcSibling = makeIrResource({
    id: 'vpc-001',
    sourceType: 'aws_vpc',
    sourceName: 'main_vpc',
  });

  describe('Azure', () => {
    it('should produce azurerm_subnet with address_prefixes', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_subnet',
          attributes: { cidr_block: '10.0.1.0/24' },
        }),
        siblingResources: [vpcSibling],
      });

      const result = translateSubnet(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('azurerm_subnet');
      expect(result.translated[0]!.attributes['address_prefixes']).toEqual(['10.0.1.0/24']);
    });

    it('should resolve VPC cross-ref via sibling', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceType: 'aws_subnet' }),
        siblingResources: [vpcSibling],
      });

      const result = translateSubnet(ctx);
      expect(result.translated[0]!.attributes['virtual_network_name']).toContain('main_vpc');
    });

    it('should fall back to vpc_id when no sibling VPC', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_subnet',
          attributes: { vpc_id: 'vpc-12345' },
        }),
        siblingResources: [],
      });

      const result = translateSubnet(ctx);
      expect(result.translated[0]!.attributes['virtual_network_name']).toBe('vpc-12345');
    });

    it('should emit PUBLIC_IP_LAUNCH finding when map_public_ip_on_launch is true', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_subnet',
          attributes: { map_public_ip_on_launch: true },
        }),
      });

      const result = translateSubnet(ctx);
      expect(result.findings.some((f) => f.code === 'PUBLIC_IP_LAUNCH')).toBe(true);
    });

    it('should not emit PUBLIC_IP_LAUNCH finding when false', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_subnet',
          attributes: { map_public_ip_on_launch: false },
        }),
      });

      const result = translateSubnet(ctx);
      expect(result.findings.some((f) => f.code === 'PUBLIC_IP_LAUNCH')).toBe(false);
    });

    it('should default cidr to 10.0.1.0/24 when missing', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceType: 'aws_subnet', attributes: {} }),
      });

      const result = translateSubnet(ctx);
      expect(result.translated[0]!.attributes['address_prefixes']).toEqual(['10.0.1.0/24']);
    });

    it('should include tags when present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_subnet',
          attributes: { tags: { Name: 'my-subnet' } },
        }),
      });

      const result = translateSubnet(ctx);
      expect(result.translated[0]!.attributes['tags']).toEqual({ Name: 'my-subnet' });
    });
  });

  describe('GCP', () => {
    it('should produce google_compute_subnetwork with ip_cidr_range', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_subnet',
          attributes: { cidr_block: '10.0.2.0/24' },
        }),
        siblingResources: [vpcSibling],
      });

      const result = translateSubnet(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('google_compute_subnetwork');
      expect(result.translated[0]!.attributes['ip_cidr_range']).toBe('10.0.2.0/24');
    });

    it('should resolve VPC cross-ref as network attribute', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_subnet' }),
        siblingResources: [vpcSibling],
      });

      const result = translateSubnet(ctx);
      expect(result.translated[0]!.attributes['network']).toContain('main_vpc');
    });

    it('should pass AZ through azToRegion then transformRegion for GCP region', () => {
      // azToRegion('us-east-1a') returns 'us-east-1a' (no dash before 'a'),
      // transformRegion('gcp', 'us-east-1a') has no map entry -> returns as-is
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_subnet',
          attributes: { availability_zone: 'us-east-1a' },
        }),
      });

      const result = translateSubnet(ctx);
      // The AZ string goes through azToRegion -> transformRegion
      expect(result.translated[0]!.attributes['region']).toBe('us-east-1a');
    });

    it('should default to us-east-1 region when no AZ provided', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_subnet', attributes: {} }),
      });

      const result = translateSubnet(ctx);
      expect(result.translated[0]!.attributes['region']).toBe('us-east1');
    });

    it('should set traceability with parametric/subnet engine', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_subnet' }),
      });

      const result = translateSubnet(ctx);
      expect(result.translated[0]!.traceability.engineUsed).toBe('parametric/subnet');
      expect(result.translated[0]!.traceability.mappingType).toBe('parametric');
    });

    it('should transform tags to GCP labels', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_subnet',
          attributes: { tags: { 'My-Tag': 'val' } },
        }),
      });

      const result = translateSubnet(ctx);
      const labels = result.translated[0]!.attributes['labels'] as Record<string, string>;
      expect(labels['my-tag']).toBe('val');
    });
  });
});

// ===========================================================================
// translateNat
// ===========================================================================

describe('translateNat', () => {
  const vpcSibling = makeIrResource({
    id: 'vpc-001',
    sourceType: 'aws_vpc',
    sourceName: 'main_vpc',
  });

  describe('Azure', () => {
    it('should produce 2 resources: public_ip and nat_gateway', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_nat_gateway',
          sourceName: 'my_nat',
          attributes: {},
        }),
      });

      const result = translateNat(ctx);
      expect(result.translated).toHaveLength(2);
      expect(result.translated[0]!.targetType).toBe('azurerm_public_ip');
      expect(result.translated[1]!.targetType).toBe('azurerm_nat_gateway');
    });

    it('should name public_ip with _pip suffix', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_nat_gateway',
          sourceName: 'my_nat',
        }),
      });

      const result = translateNat(ctx);
      expect(result.translated[0]!.targetName).toBe('my_nat_pip');
      expect(result.translated[0]!.attributes['name']).toBe('my_nat_pip');
    });

    it('should set public_ip SKU to Standard and allocation_method to Static', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceType: 'aws_nat_gateway' }),
      });

      const result = translateNat(ctx);
      expect(result.translated[0]!.attributes['sku']).toBe('Standard');
      expect(result.translated[0]!.attributes['allocation_method']).toBe('Static');
    });

    it('should set nat_gateway sku_name to Standard', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceType: 'aws_nat_gateway' }),
      });

      const result = translateNat(ctx);
      expect(result.translated[1]!.attributes['sku_name']).toBe('Standard');
    });

    it('should emit NAT_EIP_ASSOCIATION finding when allocation_id present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_nat_gateway',
          attributes: { allocation_id: 'eipalloc-123' },
        }),
      });

      const result = translateNat(ctx);
      expect(result.findings.some((f) => f.code === 'NAT_EIP_ASSOCIATION')).toBe(true);
    });

    it('should not emit NAT_EIP_ASSOCIATION finding when allocation_id absent', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_nat_gateway',
          attributes: {},
        }),
      });

      const result = translateNat(ctx);
      expect(result.findings.some((f) => f.code === 'NAT_EIP_ASSOCIATION')).toBe(false);
    });

    it('should apply tags to both resources', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_nat_gateway',
          attributes: { tags: { Env: 'prod' } },
        }),
      });

      const result = translateNat(ctx);
      expect(result.translated[0]!.attributes['tags']).toEqual({ Env: 'prod' });
      expect(result.translated[1]!.attributes['tags']).toEqual({ Env: 'prod' });
    });
  });

  describe('GCP', () => {
    it('should produce 2 resources: router and router_nat', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_nat_gateway',
          sourceName: 'my_nat',
        }),
        siblingResources: [vpcSibling],
      });

      const result = translateNat(ctx);
      expect(result.translated).toHaveLength(2);
      expect(result.translated[0]!.targetType).toBe('google_compute_router');
      expect(result.translated[1]!.targetType).toBe('google_compute_router_nat');
    });

    it('should name router with _router suffix', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_nat_gateway',
          sourceName: 'my_nat',
        }),
        siblingResources: [vpcSibling],
      });

      const result = translateNat(ctx);
      expect(result.translated[0]!.targetName).toBe('my_nat_router');
      expect(result.translated[0]!.attributes['name']).toBe('my_nat_router');
    });

    it('should set router_nat to reference the router', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_nat_gateway',
          sourceName: 'my_nat',
        }),
        siblingResources: [vpcSibling],
      });

      const result = translateNat(ctx);
      expect(result.translated[1]!.attributes['router']).toContain('my_nat_router');
    });

    it('should resolve VPC cross-ref for router network', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_nat_gateway' }),
        siblingResources: [vpcSibling],
      });

      const result = translateNat(ctx);
      expect(result.translated[0]!.attributes['network']).toContain('main_vpc');
    });

    it('should set nat_ip_allocate_option to AUTO_ONLY', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_nat_gateway' }),
      });

      const result = translateNat(ctx);
      expect(result.translated[1]!.attributes['nat_ip_allocate_option']).toBe('AUTO_ONLY');
    });

    it('should emit NAT_PRIVATE_CONNECTIVITY warning for private type', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_nat_gateway',
          attributes: { connectivity_type: 'private' },
        }),
      });

      const result = translateNat(ctx);
      expect(result.findings.some((f) => f.code === 'NAT_PRIVATE_CONNECTIVITY')).toBe(true);
      expect(result.findings.find((f) => f.code === 'NAT_PRIVATE_CONNECTIVITY')!.severity).toBe('warning');
    });

    it('should not emit NAT_PRIVATE_CONNECTIVITY when connectivity_type is public', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_nat_gateway',
          attributes: { connectivity_type: 'public' },
        }),
      });

      const result = translateNat(ctx);
      expect(result.findings.some((f) => f.code === 'NAT_PRIVATE_CONNECTIVITY')).toBe(false);
    });

    it('should apply tags as labels only on router (not router_nat)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_nat_gateway',
          attributes: { tags: { Env: 'prod' } },
        }),
      });

      const result = translateNat(ctx);
      expect(result.translated[0]!.attributes['labels']).toBeDefined();
      expect(result.translated[1]!.attributes).not.toHaveProperty('labels');
    });
  });
});

// ===========================================================================
// translateKms
// ===========================================================================

describe('translateKms', () => {
  describe('Azure', () => {
    it('should produce azurerm_key_vault_key', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceType: 'aws_kms_key' }),
      });

      const result = translateKms(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('azurerm_key_vault_key');
    });

    it('should map SYMMETRIC_DEFAULT to RSA 2048', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_kms_key',
          attributes: { customer_master_key_spec: 'SYMMETRIC_DEFAULT' },
        }),
      });

      const result = translateKms(ctx);
      expect(result.translated[0]!.attributes['key_type']).toBe('RSA');
      expect(result.translated[0]!.attributes['key_size']).toBe(2048);
    });

    it('should map RSA_4096 correctly', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_kms_key',
          attributes: { customer_master_key_spec: 'RSA_4096' },
        }),
      });

      const result = translateKms(ctx);
      expect(result.translated[0]!.attributes['key_type']).toBe('RSA');
      expect(result.translated[0]!.attributes['key_size']).toBe(4096);
    });

    it('should map ECC_NIST_P256 to EC 256', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_kms_key',
          attributes: { customer_master_key_spec: 'ECC_NIST_P256' },
        }),
      });

      const result = translateKms(ctx);
      expect(result.translated[0]!.attributes['key_type']).toBe('EC');
      expect(result.translated[0]!.attributes['key_size']).toBe(256);
    });

    it('should map ENCRYPT_DECRYPT key_usage to correct key_opts', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_kms_key',
          attributes: { key_usage: 'ENCRYPT_DECRYPT' },
        }),
      });

      const result = translateKms(ctx);
      expect(result.translated[0]!.attributes['key_opts']).toEqual(['decrypt', 'encrypt', 'wrapKey', 'unwrapKey']);
    });

    it('should map SIGN_VERIFY key_usage to sign/verify key_opts', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_kms_key',
          attributes: { key_usage: 'SIGN_VERIFY' },
        }),
      });

      const result = translateKms(ctx);
      expect(result.translated[0]!.attributes['key_opts']).toEqual(['sign', 'verify']);
    });

    it('should emit KMS_POLICY_RBAC warning when policy present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_kms_key',
          attributes: { policy: '{"Statement":[]}' },
        }),
      });

      const result = translateKms(ctx);
      expect(result.findings.some((f) => f.code === 'KMS_POLICY_RBAC')).toBe(true);
      expect(result.findings.find((f) => f.code === 'KMS_POLICY_RBAC')!.severity).toBe('warning');
    });

    it('should NOT include policy content in translated attributes (PROHIB-1)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_kms_key',
          attributes: { policy: '{"secret":"data"}' },
        }),
      });

      const result = translateKms(ctx);
      const allAttrValues = JSON.stringify(result.translated[0]!.attributes);
      expect(allAttrValues).not.toContain('secret');
      expect(allAttrValues).not.toContain('Statement');
    });

    it('should not emit KMS_POLICY_RBAC when no policy', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_kms_key',
          attributes: {},
        }),
      });

      const result = translateKms(ctx);
      expect(result.findings.some((f) => f.code === 'KMS_POLICY_RBAC')).toBe(false);
    });

    it('should default to SYMMETRIC_DEFAULT / ENCRYPT_DECRYPT when unset', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceType: 'aws_kms_key', attributes: {} }),
      });

      const result = translateKms(ctx);
      expect(result.translated[0]!.attributes['key_type']).toBe('RSA');
      expect(result.translated[0]!.attributes['key_size']).toBe(2048);
      expect(result.translated[0]!.attributes['key_opts']).toEqual(['decrypt', 'encrypt', 'wrapKey', 'unwrapKey']);
    });

    it('should include key_vault_id reference', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceType: 'aws_kms_key' }),
      });

      const result = translateKms(ctx);
      expect(result.translated[0]!.attributes['key_vault_id']).toBe('${azurerm_key_vault.main.id}');
    });
  });

  describe('GCP', () => {
    it('should produce google_kms_crypto_key', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_kms_key' }),
      });

      const result = translateKms(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('google_kms_crypto_key');
    });

    it('should map SYMMETRIC_DEFAULT to GOOGLE_SYMMETRIC_ENCRYPTION', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_kms_key',
          attributes: { customer_master_key_spec: 'SYMMETRIC_DEFAULT' },
        }),
      });

      const result = translateKms(ctx);
      expect(result.translated[0]!.attributes['version_template']).toEqual({ algorithm: 'GOOGLE_SYMMETRIC_ENCRYPTION' });
    });

    it('should map RSA_2048 to RSA_DECRYPT_OAEP_2048_SHA256', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_kms_key',
          attributes: { customer_master_key_spec: 'RSA_2048' },
        }),
      });

      const result = translateKms(ctx);
      expect((result.translated[0]!.attributes['version_template'] as Record<string, string>)['algorithm']).toBe('RSA_DECRYPT_OAEP_2048_SHA256');
    });

    it('should map SIGN_VERIFY usage to ASYMMETRIC_SIGN purpose', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_kms_key',
          attributes: { key_usage: 'SIGN_VERIFY' },
        }),
      });

      const result = translateKms(ctx);
      expect(result.translated[0]!.attributes['purpose']).toBe('ASYMMETRIC_SIGN');
    });

    it('should add rotation_period when enable_key_rotation is true', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_kms_key',
          attributes: { enable_key_rotation: true },
        }),
      });

      const result = translateKms(ctx);
      expect(result.translated[0]!.attributes['rotation_period']).toBe('7776000s');
    });

    it('should not add rotation_period when enable_key_rotation is false', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_kms_key',
          attributes: { enable_key_rotation: false },
        }),
      });

      const result = translateKms(ctx);
      expect(result.translated[0]!.attributes).not.toHaveProperty('rotation_period');
    });

    it('should emit KMS_POLICY_RBAC warning for GCP when policy present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_kms_key',
          attributes: { policy: '{}' },
        }),
      });

      const result = translateKms(ctx);
      const finding = result.findings.find((f) => f.code === 'KMS_POLICY_RBAC');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('GCP IAM bindings');
    });

    it('should include key_ring reference', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_kms_key' }),
      });

      const result = translateKms(ctx);
      expect(result.translated[0]!.attributes['key_ring']).toBe('${google_kms_key_ring.main.id}');
    });

    it('should set traceability with parametric/kms engine', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_kms_key' }),
      });

      const result = translateKms(ctx);
      expect(result.translated[0]!.traceability.engineUsed).toBe('parametric/kms');
    });
  });
});

// ===========================================================================
// translateSecrets
// ===========================================================================

describe('translateSecrets', () => {
  describe('Azure', () => {
    it('should produce azurerm_key_vault_secret', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceType: 'aws_secretsmanager_secret' }),
      });

      const result = translateSecrets(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('azurerm_key_vault_secret');
    });

    it('should use name attribute for secret name', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_secretsmanager_secret',
          attributes: { name: 'my-secret' },
        }),
      });

      const result = translateSecrets(ctx);
      expect(result.translated[0]!.attributes['name']).toBe('my-secret');
    });

    it('should fall back to sourceName when name attr missing', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_secretsmanager_secret',
          sourceName: 'fallback_name',
          attributes: {},
        }),
      });

      const result = translateSecrets(ctx);
      expect(result.translated[0]!.attributes['name']).toBe('fallback_name');
    });

    it('should set content_type from description when present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_secretsmanager_secret',
          attributes: { description: 'DB connection string' },
        }),
      });

      const result = translateSecrets(ctx);
      expect(result.translated[0]!.attributes['content_type']).toBe('DB connection string');
    });

    it('should not set content_type when description absent', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_secretsmanager_secret',
          attributes: {},
        }),
      });

      const result = translateSecrets(ctx);
      expect(result.translated[0]!.attributes).not.toHaveProperty('content_type');
    });

    it('should use placeholder for value', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceType: 'aws_secretsmanager_secret' }),
      });

      const result = translateSecrets(ctx);
      expect(result.translated[0]!.attributes['value']).toBe('${var.secret_value}');
    });

    it('should emit SECRET_ROTATION warning when rotation_rules present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_secretsmanager_secret',
          attributes: { rotation_rules: { automatically_after_days: 30 } },
        }),
      });

      const result = translateSecrets(ctx);
      expect(result.findings.some((f) => f.code === 'SECRET_ROTATION')).toBe(true);
      expect(result.findings.find((f) => f.code === 'SECRET_ROTATION')!.severity).toBe('warning');
    });

    it('should not emit SECRET_ROTATION when no rotation_rules', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_secretsmanager_secret',
          attributes: {},
        }),
      });

      const result = translateSecrets(ctx);
      expect(result.findings.some((f) => f.code === 'SECRET_ROTATION')).toBe(false);
    });

    it('should include key_vault_id reference', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceType: 'aws_secretsmanager_secret' }),
      });

      const result = translateSecrets(ctx);
      expect(result.translated[0]!.attributes['key_vault_id']).toBe('${azurerm_key_vault.main.id}');
    });

    it('should include tags when present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_secretsmanager_secret',
          attributes: { tags: { team: 'backend' } },
        }),
      });

      const result = translateSecrets(ctx);
      expect(result.translated[0]!.attributes['tags']).toEqual({ team: 'backend' });
    });
  });

  describe('GCP', () => {
    it('should produce google_secret_manager_secret', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_secretsmanager_secret' }),
      });

      const result = translateSecrets(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('google_secret_manager_secret');
    });

    it('should set replication to auto', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_secretsmanager_secret' }),
      });

      const result = translateSecrets(ctx);
      expect(result.translated[0]!.attributes['replication']).toEqual({ auto: {} });
    });

    it('should set secret_id from name attribute', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_secretsmanager_secret',
          attributes: { name: 'gcp-secret' },
        }),
      });

      const result = translateSecrets(ctx);
      expect(result.translated[0]!.attributes['secret_id']).toBe('gcp-secret');
    });

    it('should fall back to sourceName for secret_id', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_secretsmanager_secret',
          sourceName: 'fallback_secret',
          attributes: {},
        }),
      });

      const result = translateSecrets(ctx);
      expect(result.translated[0]!.attributes['secret_id']).toBe('fallback_secret');
    });

    it('should emit SECRET_ROTATION warning for GCP when rotation_rules present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_secretsmanager_secret',
          attributes: { rotation_rules: { automatically_after_days: 60 } },
        }),
      });

      const result = translateSecrets(ctx);
      const finding = result.findings.find((f) => f.code === 'SECRET_ROTATION');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('GCP Cloud Functions');
    });

    it('should transform tags to GCP labels', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_secretsmanager_secret',
          attributes: { tags: { 'My-Tag': 'val' } },
        }),
      });

      const result = translateSecrets(ctx);
      const labels = result.translated[0]!.attributes['labels'] as Record<string, string>;
      expect(labels['my-tag']).toBe('val');
    });

    it('should set traceability with parametric/secrets engine', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_secretsmanager_secret' }),
      });

      const result = translateSecrets(ctx);
      expect(result.translated[0]!.traceability.engineUsed).toBe('parametric/secrets');
      expect(result.translated[0]!.traceability.mappingType).toBe('parametric');
    });
  });
});

// ===========================================================================
// translateEks
// ===========================================================================

describe('translateEks', () => {
  describe('Azure', () => {
    it('should produce azurerm_kubernetes_cluster', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceType: 'aws_eks_cluster' }),
      });

      const result = translateEks(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('azurerm_kubernetes_cluster');
    });

    it('should include default_node_pool configuration', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceType: 'aws_eks_cluster' }),
      });

      const result = translateEks(ctx);
      const defaultPool = result.translated[0]!.attributes['default_node_pool'] as Record<string, unknown>;
      expect(defaultPool).toBeDefined();
      expect(defaultPool['name']).toBe('default');
      expect(defaultPool['node_count']).toBe(1);
      expect(defaultPool['vm_size']).toBe('Standard_D2_v5');
    });

    it('should include network_profile with azure plugin', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceType: 'aws_eks_cluster' }),
      });

      const result = translateEks(ctx);
      const netProfile = result.translated[0]!.attributes['network_profile'] as Record<string, unknown>;
      expect(netProfile['network_plugin']).toBe('azure');
    });

    it('should set kubernetes_version when version attribute present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: { version: '1.28' },
        }),
      });

      const result = translateEks(ctx);
      expect(result.translated[0]!.attributes['kubernetes_version']).toBe('1.28');
    });

    it('should not set kubernetes_version when version absent', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: {},
        }),
      });

      const result = translateEks(ctx);
      expect(result.translated[0]!.attributes).not.toHaveProperty('kubernetes_version');
    });

    it('should use name attribute for cluster name', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: { name: 'my-cluster' },
        }),
      });

      const result = translateEks(ctx);
      expect(result.translated[0]!.attributes['name']).toBe('my-cluster');
      expect(result.translated[0]!.attributes['dns_prefix']).toBe('my-cluster');
    });

    it('should fall back to sourceName for cluster name', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          sourceName: 'eks_fallback',
          attributes: {},
        }),
      });

      const result = translateEks(ctx);
      expect(result.translated[0]!.attributes['name']).toBe('eks_fallback');
    });

    it('should emit IRSA_WORKLOAD_IDENTITY warning when role_arn present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: { role_arn: 'arn:aws:iam::123:role/eks-role' },
        }),
      });

      const result = translateEks(ctx);
      expect(result.findings.some((f) => f.code === 'IRSA_WORKLOAD_IDENTITY')).toBe(true);
      expect(result.findings.find((f) => f.code === 'IRSA_WORKLOAD_IDENTITY')!.severity).toBe('warning');
    });

    it('should not emit IRSA_WORKLOAD_IDENTITY when no role_arn', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: {},
        }),
      });

      const result = translateEks(ctx);
      expect(result.findings.some((f) => f.code === 'IRSA_WORKLOAD_IDENTITY')).toBe(false);
    });

    it('should emit CNI_GAP info when kubernetes_network_config present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: { kubernetes_network_config: { service_ipv4_cidr: '10.100.0.0/16' } },
        }),
      });

      const result = translateEks(ctx);
      expect(result.findings.some((f) => f.code === 'CNI_GAP')).toBe(true);
      expect(result.findings.find((f) => f.code === 'CNI_GAP')!.severity).toBe('info');
    });

    it('should not emit CNI_GAP when no kubernetes_network_config', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: {},
        }),
      });

      const result = translateEks(ctx);
      expect(result.findings.some((f) => f.code === 'CNI_GAP')).toBe(false);
    });

    it('should emit EKS_ENCRYPTION_ADVISORY when encryption_config present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: { encryption_config: [{ provider: { key_arn: 'arn:...' } }] },
        }),
      });

      const result = translateEks(ctx);
      expect(result.findings.some((f) => f.code === 'EKS_ENCRYPTION_ADVISORY')).toBe(true);
    });

    it('should add oms_agent when enabled_cluster_log_types has entries', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: { enabled_cluster_log_types: ['api', 'audit'] },
        }),
      });

      const result = translateEks(ctx);
      expect(result.translated[0]!.attributes['oms_agent']).toBeDefined();
    });

    it('should not add oms_agent when enabled_cluster_log_types empty', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: { enabled_cluster_log_types: [] },
        }),
      });

      const result = translateEks(ctx);
      expect(result.translated[0]!.attributes).not.toHaveProperty('oms_agent');
    });

    it('should include identity with SystemAssigned type', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceType: 'aws_eks_cluster' }),
      });

      const result = translateEks(ctx);
      expect(result.translated[0]!.attributes['identity']).toEqual({ type: 'SystemAssigned' });
    });

    it('should include tags when present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: { tags: { cluster: 'prod' } },
        }),
      });

      const result = translateEks(ctx);
      expect(result.translated[0]!.attributes['tags']).toEqual({ cluster: 'prod' });
    });
  });

  describe('GCP', () => {
    it('should produce google_container_cluster', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_eks_cluster' }),
      });

      const result = translateEks(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('google_container_cluster');
    });

    it('should include ip_allocation_policy (VPC-native)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_eks_cluster' }),
      });

      const result = translateEks(ctx);
      expect(result.translated[0]!.attributes['ip_allocation_policy']).toEqual({});
    });

    it('should set remove_default_node_pool to true', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_eks_cluster' }),
      });

      const result = translateEks(ctx);
      expect(result.translated[0]!.attributes['remove_default_node_pool']).toBe(true);
    });

    it('should set initial_node_count to 1', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_eks_cluster' }),
      });

      const result = translateEks(ctx);
      expect(result.translated[0]!.attributes['initial_node_count']).toBe(1);
    });

    it('should set min_master_version when version present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: { version: '1.27' },
        }),
      });

      const result = translateEks(ctx);
      expect(result.translated[0]!.attributes['min_master_version']).toBe('1.27');
    });

    it('should not set min_master_version when version absent', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: {},
        }),
      });

      const result = translateEks(ctx);
      expect(result.translated[0]!.attributes).not.toHaveProperty('min_master_version');
    });

    it('should emit IRSA_WORKLOAD_IDENTITY warning for GCP', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: { role_arn: 'arn:aws:iam::123:role/eks-role' },
        }),
      });

      const result = translateEks(ctx);
      const finding = result.findings.find((f) => f.code === 'IRSA_WORKLOAD_IDENTITY');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('GCP Workload Identity');
    });

    it('should emit CNI_GAP info for GCP with GKE-specific message', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: { kubernetes_network_config: { ip_family: 'ipv4' } },
        }),
      });

      const result = translateEks(ctx);
      const finding = result.findings.find((f) => f.code === 'CNI_GAP');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('GKE');
    });

    it('should emit EKS_ENCRYPTION_ADVISORY for GCP with GKE-specific message', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: { encryption_config: [{}] },
        }),
      });

      const result = translateEks(ctx);
      const finding = result.findings.find((f) => f.code === 'EKS_ENCRYPTION_ADVISORY');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('GKE');
    });

    it('should use resource_labels for GCP tags', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: { tags: { 'My-Cluster': 'production' } },
        }),
      });

      const result = translateEks(ctx);
      const labels = result.translated[0]!.attributes['resource_labels'] as Record<string, string>;
      expect(labels['my-cluster']).toBe('production');
    });

    it('should set traceability with parametric/eks engine', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_eks_cluster' }),
      });

      const result = translateEks(ctx);
      expect(result.translated[0]!.traceability.engineUsed).toBe('parametric/eks');
      expect(result.translated[0]!.traceability.mappingType).toBe('parametric');
    });

    it('should use name attribute for cluster name', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: { name: 'gke-cluster' },
        }),
      });

      const result = translateEks(ctx);
      expect(result.translated[0]!.attributes['name']).toBe('gke-cluster');
    });

    it('should emit all three advisories when all triggers present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_eks_cluster',
          attributes: {
            role_arn: 'arn:aws:iam::123:role/x',
            kubernetes_network_config: { service_ipv4_cidr: '10.0.0.0/16' },
            encryption_config: [{}],
          },
        }),
      });

      const result = translateEks(ctx);
      expect(result.findings.some((f) => f.code === 'IRSA_WORKLOAD_IDENTITY')).toBe(true);
      expect(result.findings.some((f) => f.code === 'CNI_GAP')).toBe(true);
      expect(result.findings.some((f) => f.code === 'EKS_ENCRYPTION_ADVISORY')).toBe(true);
    });
  });
});
