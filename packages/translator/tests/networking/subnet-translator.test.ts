/**
 * Tests for TASK-NET-002: Subnet CIDR + Availability Zone Mapping.
 *
 * Covers:
 *  - subnet-cidr-validator: parseCidr, isCidrContained, detectCidrOverlap, isIpv6Cidr
 *  - subnet-az-mapper:      extractAzSuffix, mapAzToAzureZone, mapAzToGcpZone
 *  - structural/subnet-mapping: translateSubnet (Azure + GCP, CIDR validation,
 *    AZ mapping, IPv6 advisory, overlap/containment findings, public-IP finding)
 *
 * @generated for TASK-NET-002 (data-layer-implementer)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  parseCidr,
  isCidrContained,
  detectCidrOverlap,
  isIpv6Cidr,
} from '../../src/engines/structural/subnet-cidr-validator.js';
import {
  extractAzSuffix,
  mapAzToAzureZone,
  mapAzToGcpZone,
} from '../../src/engines/structural/subnet-az-mapper.js';
import { translateSubnet } from '../../src/engines/structural/subnet-mapping.js';
import type { TranslationContext } from '../../src/engines/mapping-engine.js';
import type {
  IrResource,
  RegistryEntry,
  CanonicalIR,
  CloudProvider,
  CompilerOptions,
} from '@tla/shared';
import type { RegistryApi } from '@tla/registry';

// ===========================================================================
// Factory helpers
// ===========================================================================

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'subnet-001',
    sourceType: 'aws_subnet',
    sourceName: 'my_subnet',
    sourceModule: null,
    category: 'networking',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: 'SER-NET-SUBNET-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-NET-SUBNET-001',
    aws_service: 'aws_subnet',
    aws_family: 'networking',
    azure_targets: ['azurerm_subnet'],
    gcp_targets: ['google_compute_subnetwork'],
    mapping_type: 'structural',
    output_mode: 'native_emit_only',
    band: 'P2',
    confidence: 0.85,
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
        resourceCount: 1,
        relationshipCount: 0,
      },
    } as CanonicalIR,
    registry: makeMockRegistry(),
    options: makeCompilerOptions(),
    ...overrides,
  };
}

// Helper: find a finding by code
function findFinding(findings: { code: string }[], code: string) {
  return findings.find((f) => f.code === code);
}

function hasFinding(findings: { code: string }[], code: string): boolean {
  return findings.some((f) => f.code === code);
}

// ===========================================================================
// subnet-cidr-validator: isIpv6Cidr
// ===========================================================================

describe('isIpv6Cidr', () => {
  it('should return true for IPv6 CIDR', () => {
    expect(isIpv6Cidr('2001:db8::/32')).toBe(true);
  });

  it('should return false for IPv4 CIDR', () => {
    expect(isIpv6Cidr('10.0.1.0/24')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isIpv6Cidr('')).toBe(false);
  });
});

// ===========================================================================
// subnet-cidr-validator: parseCidr
// ===========================================================================

describe('parseCidr', () => {
  it('should parse a standard /24 CIDR', () => {
    const result = parseCidr('10.0.1.0/24');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe(24);
  });

  it('should parse a /16 CIDR and derive correct network address', () => {
    const result = parseCidr('10.0.0.0/16');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe(16);
    // mask for /16 = 0xFFFF0000
    expect(result!.mask >>> 0).toBe(0xffff0000);
    // network: 10.0.0.0 = 0x0A000000
    expect(result!.network >>> 0).toBe(0x0a000000);
  });

  it('should parse /32 (single host)', () => {
    const result = parseCidr('192.168.1.1/32');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe(32);
  });

  it('should parse /0 (default route)', () => {
    const result = parseCidr('0.0.0.0/0');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe(0);
    expect(result!.mask).toBe(0);
    expect(result!.network).toBe(0);
  });

  it('should return null for IPv6 input', () => {
    expect(parseCidr('2001:db8::/32')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseCidr('')).toBeNull();
  });

  it('should return null when there is no slash', () => {
    expect(parseCidr('10.0.1.0')).toBeNull();
  });

  it('should return null for prefix > 32', () => {
    expect(parseCidr('10.0.0.0/33')).toBeNull();
  });

  it('should return null for negative prefix', () => {
    expect(parseCidr('10.0.0.0/-1')).toBeNull();
  });

  it('should return null for wrong octet count', () => {
    expect(parseCidr('10.0.0/24')).toBeNull();
  });

  it('should return null for octet value > 255', () => {
    expect(parseCidr('10.0.0.256/24')).toBeNull();
  });

  it('should return null for non-numeric octet', () => {
    expect(parseCidr('10.a.0.0/24')).toBeNull();
  });

  it('should normalise host bits to network address', () => {
    // 10.0.1.5/24 -> network should be 10.0.1.0
    const result = parseCidr('10.0.1.5/24');
    expect(result).not.toBeNull();
    // 10.0.1.0 = 0x0A000100
    expect(result!.network >>> 0).toBe(0x0a000100);
  });

  it('should return null for non-string input', () => {
    // @ts-expect-error testing runtime behaviour
    expect(parseCidr(null)).toBeNull();
    // @ts-expect-error testing runtime behaviour
    expect(parseCidr(undefined)).toBeNull();
  });
});

// ===========================================================================
// subnet-cidr-validator: isCidrContained
// ===========================================================================

describe('isCidrContained', () => {
  it('should return true when inner is strictly inside outer', () => {
    expect(isCidrContained('10.0.1.0/24', '10.0.0.0/16')).toBe(true);
  });

  it('should return true when inner equals outer (identical ranges)', () => {
    expect(isCidrContained('10.0.0.0/16', '10.0.0.0/16')).toBe(true);
  });

  it('should return false when inner is larger than outer', () => {
    expect(isCidrContained('10.0.0.0/16', '10.0.1.0/24')).toBe(false);
  });

  it('should return false when subnets are disjoint', () => {
    expect(isCidrContained('192.168.1.0/24', '10.0.0.0/16')).toBe(false);
  });

  it('should return null when inner is invalid', () => {
    expect(isCidrContained('not-a-cidr', '10.0.0.0/16')).toBeNull();
  });

  it('should return null when outer is invalid', () => {
    expect(isCidrContained('10.0.1.0/24', 'bad')).toBeNull();
  });

  it('should return false when host bits place it outside the outer range', () => {
    // 172.16.0.0/24 is NOT inside 10.0.0.0/8
    expect(isCidrContained('172.16.0.0/24', '10.0.0.0/8')).toBe(false);
  });
});

// ===========================================================================
// subnet-cidr-validator: detectCidrOverlap
// ===========================================================================

describe('detectCidrOverlap', () => {
  it('should return true for identical CIDRs', () => {
    expect(detectCidrOverlap('10.0.1.0/24', '10.0.1.0/24')).toBe(true);
  });

  it('should return true when one CIDR contains the other', () => {
    expect(detectCidrOverlap('10.0.0.0/16', '10.0.1.0/24')).toBe(true);
  });

  it('should return false for disjoint CIDRs', () => {
    expect(detectCidrOverlap('10.0.0.0/24', '10.0.1.0/24')).toBe(false);
  });

  it('should return false for completely different ranges', () => {
    expect(detectCidrOverlap('10.0.0.0/8', '192.168.0.0/16')).toBe(false);
  });

  it('should return null when first CIDR is invalid', () => {
    expect(detectCidrOverlap('invalid', '10.0.0.0/24')).toBeNull();
  });

  it('should return null when second CIDR is invalid', () => {
    expect(detectCidrOverlap('10.0.0.0/24', 'also-invalid')).toBeNull();
  });

  it('should return true for /0 against any valid CIDR', () => {
    expect(detectCidrOverlap('0.0.0.0/0', '10.0.1.0/24')).toBe(true);
  });

  it('should return false for adjacent /24 subnets', () => {
    // 10.0.0.0/24 and 10.0.1.0/24 are adjacent, not overlapping
    expect(detectCidrOverlap('10.0.0.0/24', '10.0.1.0/24')).toBe(false);
  });
});

// ===========================================================================
// subnet-az-mapper: extractAzSuffix
// ===========================================================================

describe('extractAzSuffix', () => {
  it('should extract "a" from us-east-1a', () => {
    expect(extractAzSuffix('us-east-1a')).toBe('a');
  });

  it('should extract "b" from us-east-1b', () => {
    expect(extractAzSuffix('us-east-1b')).toBe('b');
  });

  it('should extract "c" from eu-west-2c', () => {
    expect(extractAzSuffix('eu-west-2c')).toBe('c');
  });

  it('should extract "f" from us-east-1f', () => {
    expect(extractAzSuffix('us-east-1f')).toBe('f');
  });

  it('should return undefined for a bare region string ending in digit', () => {
    expect(extractAzSuffix('us-east-1')).toBeUndefined();
  });

  it('should return undefined for empty string', () => {
    expect(extractAzSuffix('')).toBeUndefined();
  });
});

// ===========================================================================
// subnet-az-mapper: mapAzToAzureZone
// ===========================================================================

describe('mapAzToAzureZone', () => {
  it('should map suffix "a" (us-east-1a) to Azure zone 1', () => {
    expect(mapAzToAzureZone('us-east-1a')).toBe(1);
  });

  it('should map suffix "b" (us-east-1b) to Azure zone 2', () => {
    expect(mapAzToAzureZone('us-east-1b')).toBe(2);
  });

  it('should map suffix "c" (us-east-1c) to Azure zone 3', () => {
    expect(mapAzToAzureZone('us-east-1c')).toBe(3);
  });

  it('should cycle: suffix "d" maps back to Azure zone 1', () => {
    expect(mapAzToAzureZone('us-east-1d')).toBe(1);
  });

  it('should cycle: suffix "e" maps to Azure zone 2', () => {
    expect(mapAzToAzureZone('us-east-1e')).toBe(2);
  });

  it('should cycle: suffix "f" maps to Azure zone 3', () => {
    expect(mapAzToAzureZone('us-east-1f')).toBe(3);
  });

  it('should return undefined when AZ has no recognisable suffix', () => {
    expect(mapAzToAzureZone('us-east-1')).toBeUndefined();
  });

  it('should return a value in [1, 2, 3] for all standard suffixes', () => {
    const suffixes = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (const s of suffixes) {
      const zone = mapAzToAzureZone(`us-east-1${s}`);
      expect(zone).toBeGreaterThanOrEqual(1);
      expect(zone).toBeLessThanOrEqual(3);
    }
  });
});

// ===========================================================================
// subnet-az-mapper: mapAzToGcpZone
// ===========================================================================

describe('mapAzToGcpZone', () => {
  it('should produce a GCP zone string for us-east-1a', () => {
    const zone = mapAzToGcpZone('us-east-1a');
    expect(typeof zone).toBe('string');
    expect(zone).toMatch(/^[a-z0-9-]+-[a-z]$/);
  });

  it('should append the original AWS AZ suffix letter', () => {
    const zone = mapAzToGcpZone('us-east-1a');
    expect(zone).toMatch(/-a$/);
  });

  it('should append the correct suffix for us-east-1b', () => {
    const zone = mapAzToGcpZone('us-east-1b');
    expect(zone).toMatch(/-b$/);
  });

  it('should map eu-west-1a to a europe-west1-based zone', () => {
    const zone = mapAzToGcpZone('eu-west-1a');
    expect(zone).toContain('europe-west1');
    expect(zone).toMatch(/-a$/);
  });

  it('should map us-west-2b to a us-west2-based zone', () => {
    const zone = mapAzToGcpZone('us-west-2b');
    expect(zone).toContain('us-west2');
    expect(zone).toMatch(/-b$/);
  });

  it('should return undefined when AZ has no recognisable suffix', () => {
    expect(mapAzToGcpZone('us-east-1')).toBeUndefined();
  });
});

// ===========================================================================
// translateSubnet: basic Azure translation
// ===========================================================================

describe('translateSubnet — Azure', () => {
  it('should produce a single azurerm_subnet resource', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ sourceName: 'pub_subnet', attributes: { cidr_block: '10.0.1.0/24' } }),
    });
    const result = translateSubnet(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_subnet');
    expect(result.translated[0]!.targetName).toBe('pub_subnet');
  });

  it('should preserve CIDR block in address_prefixes', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: { cidr_block: '172.16.0.0/20' } }),
    });
    const result = translateSubnet(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['address_prefixes']).toEqual(['172.16.0.0/20']);
  });

  it('should default address_prefixes to 10.0.1.0/24 when cidr_block absent', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: {} }),
    });
    const result = translateSubnet(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['address_prefixes']).toEqual(['10.0.1.0/24']);
  });

  it('should set resource_group_name placeholder', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.1.0/24' } }),
    });
    const result = translateSubnet(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['resource_group_name']).toContain('azurerm_resource_group');
  });

  it('should set virtual_network_name to VPC reference when sibling VPC is present', () => {
    const vpcResource = makeIrResource({
      id: 'vpc-001',
      sourceType: 'aws_vpc',
      sourceName: 'main_vpc',
      attributes: { cidr_block: '10.0.0.0/16' },
    });
    const subnetResource = makeIrResource({
      id: 'subnet-001',
      sourceType: 'aws_subnet',
      sourceName: 'priv_subnet',
      attributes: { cidr_block: '10.0.1.0/24', vpc_id: '${aws_vpc.main_vpc.id}' },
    });
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: subnetResource,
      siblingResources: [vpcResource],
    });
    const result = translateSubnet(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['virtual_network_name']).toContain('main_vpc');
  });

  it('should transform tags to Azure tags', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.1.0/24', tags: { Env: 'prod', Team: 'infra' } } }),
    });
    const result = translateSubnet(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['tags']).toEqual({ Env: 'prod', Team: 'infra' });
  });

  it('should emit PUBLIC_IP_LAUNCH info finding when map_public_ip_on_launch is true', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        attributes: { cidr_block: '10.0.1.0/24', map_public_ip_on_launch: true },
      }),
    });
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'PUBLIC_IP_LAUNCH')).toBe(true);
  });

  it('should not emit PUBLIC_IP_LAUNCH when map_public_ip_on_launch is false', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        attributes: { cidr_block: '10.0.1.0/24', map_public_ip_on_launch: false },
      }),
    });
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'PUBLIC_IP_LAUNCH')).toBe(false);
  });

  it('should emit STRUCTURAL_TOPOLOGY info finding', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.1.0/24' } }),
    });
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'STRUCTURAL_TOPOLOGY')).toBe(true);
    const f = findFinding(result.findings, 'STRUCTURAL_TOPOLOGY');
    expect(f!.message).toContain('azurerm_subnet');
  });
});

// ===========================================================================
// translateSubnet: AZ-to-zone mapping — Azure
// ===========================================================================

describe('translateSubnet — Azure AZ mapping', () => {
  it('should emit SUBNET_AZ_MAPPED info finding when AZ is set', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.1.0/24', availability_zone: 'us-east-1a' } }),
    });
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'SUBNET_AZ_MAPPED')).toBe(true);
  });

  it('should mention the Azure zone number in the AZ mapping finding', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.1.0/24', availability_zone: 'us-east-1a' } }),
    });
    const result = translateSubnet(ctx);
    const f = findFinding(result.findings, 'SUBNET_AZ_MAPPED');
    expect(f!.message).toContain('zone 1');
  });

  it('should mention zone 2 for suffix "b"', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.2.0/24', availability_zone: 'us-east-1b' } }),
    });
    const result = translateSubnet(ctx);
    const f = findFinding(result.findings, 'SUBNET_AZ_MAPPED');
    expect(f!.message).toContain('zone 2');
  });

  it('should cycle d-suffix back to zone 1', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.4.0/24', availability_zone: 'us-east-1d' } }),
    });
    const result = translateSubnet(ctx);
    const f = findFinding(result.findings, 'SUBNET_AZ_MAPPED');
    expect(f!.message).toContain('zone 1');
  });

  it('should not emit SUBNET_AZ_MAPPED when availability_zone is absent', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.1.0/24' } }),
    });
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'SUBNET_AZ_MAPPED')).toBe(false);
  });
});

// ===========================================================================
// translateSubnet: basic GCP translation
// ===========================================================================

describe('translateSubnet — GCP', () => {
  it('should produce a single google_compute_subnetwork resource', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ sourceName: 'my_subnet', attributes: { cidr_block: '10.0.1.0/24' } }),
    });
    const result = translateSubnet(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_compute_subnetwork');
    expect(result.translated[0]!.targetName).toBe('my_subnet');
  });

  it('should preserve CIDR block in ip_cidr_range', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ attributes: { cidr_block: '192.168.0.0/20' } }),
    });
    const result = translateSubnet(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['ip_cidr_range']).toBe('192.168.0.0/20');
  });

  it('should default ip_cidr_range to 10.0.1.0/24 when cidr_block absent', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ attributes: {} }),
    });
    const result = translateSubnet(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['ip_cidr_range']).toBe('10.0.1.0/24');
  });

  it('should derive GCP region from availability_zone', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.1.0/24', availability_zone: 'eu-west-1a' } }),
    });
    const result = translateSubnet(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(typeof attrs['region']).toBe('string');
    expect(attrs['region']).toContain('europe-west1');
  });

  it('should default region to GCP equivalent of us-east-1 when AZ absent', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.1.0/24' } }),
    });
    const result = translateSubnet(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['region']).toBe('us-east1');
  });

  it('should set private_ip_google_access when map_public_ip_on_launch is false', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.1.0/24', map_public_ip_on_launch: false } }),
    });
    const result = translateSubnet(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['private_ip_google_access']).toBe(true);
  });

  it('should not set private_ip_google_access when map_public_ip_on_launch is true', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.1.0/24', map_public_ip_on_launch: true } }),
    });
    const result = translateSubnet(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['private_ip_google_access']).toBeUndefined();
  });

  it('should transform tags to GCP labels with lowercase keys', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.1.0/24', tags: { Env: 'prod', 'Cost-Center': '123' } } }),
    });
    const result = translateSubnet(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    const labels = attrs['labels'] as Record<string, string>;
    expect(labels['env']).toBe('prod');
    // GCP label keys: lowercase, [a-z0-9_-] allowed; hyphen is preserved
    expect(labels['cost-center']).toBe('123');
  });

  it('should set network to VPC reference when sibling VPC is present', () => {
    const vpcResource = makeIrResource({
      id: 'vpc-001',
      sourceType: 'aws_vpc',
      sourceName: 'main_vpc',
      attributes: { cidr_block: '10.0.0.0/16' },
    });
    const subnetResource = makeIrResource({
      id: 'subnet-001',
      sourceType: 'aws_subnet',
      sourceName: 'priv_subnet',
      attributes: { cidr_block: '10.0.1.0/24', vpc_id: '${aws_vpc.main_vpc.id}' },
    });
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: subnetResource,
      siblingResources: [vpcResource],
    });
    const result = translateSubnet(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['network']).toContain('main_vpc');
  });

  it('should emit STRUCTURAL_TOPOLOGY finding for GCP', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.1.0/24' } }),
    });
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'STRUCTURAL_TOPOLOGY')).toBe(true);
    const f = findFinding(result.findings, 'STRUCTURAL_TOPOLOGY');
    expect(f!.message).toContain('google_compute_subnetwork');
  });
});

// ===========================================================================
// translateSubnet: AZ-to-zone mapping — GCP
// ===========================================================================

describe('translateSubnet — GCP AZ mapping', () => {
  it('should emit SUBNET_AZ_MAPPED info finding when AZ is set', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.1.0/24', availability_zone: 'us-east-1a' } }),
    });
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'SUBNET_AZ_MAPPED')).toBe(true);
  });

  it('should include GCP zone string in AZ mapping finding', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.1.0/24', availability_zone: 'us-east-1a' } }),
    });
    const result = translateSubnet(ctx);
    const f = findFinding(result.findings, 'SUBNET_AZ_MAPPED');
    expect(f!.message).toContain('us-east1-a');
  });

  it('should not emit SUBNET_AZ_MAPPED when availability_zone is absent', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.1.0/24' } }),
    });
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'SUBNET_AZ_MAPPED')).toBe(false);
  });
});

// ===========================================================================
// translateSubnet: CIDR containment validation
// ===========================================================================

describe('translateSubnet — CIDR containment validation', () => {
  function makeSubnetWithVpc(subnetCidr: string, vpcCidr: string, target: CloudProvider = 'azure') {
    const vpcResource = makeIrResource({
      id: 'vpc-001',
      sourceType: 'aws_vpc',
      sourceName: 'main_vpc',
      attributes: { cidr_block: vpcCidr },
    });
    const subnetResource = makeIrResource({
      id: 'subnet-001',
      sourceType: 'aws_subnet',
      sourceName: 'my_subnet',
      attributes: { cidr_block: subnetCidr, vpc_id: '${aws_vpc.main_vpc.id}' },
    });
    return makeTranslationContext({
      targetProvider: target,
      resource: subnetResource,
      siblingResources: [vpcResource],
    });
  }

  it('should NOT emit SUBNET_CIDR_NOT_IN_VPC when subnet is inside VPC CIDR', () => {
    const ctx = makeSubnetWithVpc('10.0.1.0/24', '10.0.0.0/16');
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'SUBNET_CIDR_NOT_IN_VPC')).toBe(false);
  });

  it('should emit SUBNET_CIDR_NOT_IN_VPC when subnet is outside VPC CIDR', () => {
    const ctx = makeSubnetWithVpc('192.168.1.0/24', '10.0.0.0/16');
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'SUBNET_CIDR_NOT_IN_VPC')).toBe(true);
    const f = findFinding(result.findings, 'SUBNET_CIDR_NOT_IN_VPC');
    expect(f!.severity).toBe('warning');
    expect(f!.message).toContain('192.168.1.0/24');
    expect(f!.message).toContain('10.0.0.0/16');
  });

  it('should emit SUBNET_CIDR_NOT_IN_VPC for GCP as well', () => {
    const ctx = makeSubnetWithVpc('172.16.0.0/20', '10.0.0.0/16', 'gcp');
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'SUBNET_CIDR_NOT_IN_VPC')).toBe(true);
  });

  it('should NOT emit SUBNET_CIDR_NOT_IN_VPC when no sibling VPC is present', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.1.0/24' } }),
      siblingResources: [],
    });
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'SUBNET_CIDR_NOT_IN_VPC')).toBe(false);
  });
});

// ===========================================================================
// translateSubnet: CIDR overlap detection
// ===========================================================================

describe('translateSubnet — CIDR overlap detection', () => {
  function makeMultiSubnetContext(subnetCidrs: string[], targetCidr: string, target: CloudProvider = 'azure') {
    const subnetResources = subnetCidrs.map((cidr, i) =>
      makeIrResource({
        id: `subnet-${i + 1}`,
        sourceType: 'aws_subnet',
        sourceName: `subnet_${i + 1}`,
        attributes: { cidr_block: cidr },
      }),
    );

    // The resource under test is the last in subnetCidrs
    const testResource = makeIrResource({
      id: 'subnet-test',
      sourceType: 'aws_subnet',
      sourceName: 'subnet_test',
      attributes: { cidr_block: targetCidr },
    });

    return makeTranslationContext({
      targetProvider: target,
      resource: testResource,
      siblingResources: subnetResources,
    });
  }

  it('should emit SUBNET_CIDR_OVERLAP when sibling has the same CIDR', () => {
    const ctx = makeMultiSubnetContext(['10.0.1.0/24'], '10.0.1.0/24');
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'SUBNET_CIDR_OVERLAP')).toBe(true);
    const f = findFinding(result.findings, 'SUBNET_CIDR_OVERLAP');
    expect(f!.severity).toBe('warning');
  });

  it('should emit SUBNET_CIDR_OVERLAP when sibling CIDR contains this one', () => {
    const ctx = makeMultiSubnetContext(['10.0.0.0/16'], '10.0.1.0/24');
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'SUBNET_CIDR_OVERLAP')).toBe(true);
  });

  it('should NOT emit SUBNET_CIDR_OVERLAP for non-overlapping siblings', () => {
    const ctx = makeMultiSubnetContext(['10.0.2.0/24', '10.0.3.0/24'], '10.0.1.0/24');
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'SUBNET_CIDR_OVERLAP')).toBe(false);
  });

  it('should not flag non-aws_subnet siblings as overlap sources', () => {
    const routeTable = makeIrResource({
      id: 'rt-001',
      sourceType: 'aws_route_table',
      sourceName: 'main_rt',
      attributes: { cidr_block: '10.0.1.0/24' }, // same CIDR but wrong type
    });
    const testResource = makeIrResource({
      id: 'subnet-test',
      sourceType: 'aws_subnet',
      sourceName: 'test_subnet',
      attributes: { cidr_block: '10.0.1.0/24' },
    });
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: testResource,
      siblingResources: [routeTable],
    });
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'SUBNET_CIDR_OVERLAP')).toBe(false);
  });

  it('should not flag the resource against itself', () => {
    // When the sibling list includes the resource itself, no false overlap
    const self = makeIrResource({
      id: 'subnet-001',
      sourceType: 'aws_subnet',
      sourceName: 'my_subnet',
      attributes: { cidr_block: '10.0.1.0/24' },
    });
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: self,
      siblingResources: [self], // same object, same id
    });
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'SUBNET_CIDR_OVERLAP')).toBe(false);
  });
});

// ===========================================================================
// translateSubnet: IPv6 CIDR advisory
// ===========================================================================

describe('translateSubnet — IPv6 advisory', () => {
  it('should emit SUBNET_IPV6_UNSUPPORTED info finding when ipv6_cidr_block is present', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        attributes: { cidr_block: '10.0.1.0/24', ipv6_cidr_block: '2001:db8::/64' },
      }),
    });
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'SUBNET_IPV6_UNSUPPORTED')).toBe(true);
    const f = findFinding(result.findings, 'SUBNET_IPV6_UNSUPPORTED');
    expect(f!.message).toContain('2001:db8::/64');
  });

  it('should emit SUBNET_IPV6_UNSUPPORTED for GCP as well', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({
        attributes: { cidr_block: '10.0.1.0/24', ipv6_cidr_block: '2001:db8:1::/64' },
      }),
    });
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'SUBNET_IPV6_UNSUPPORTED')).toBe(true);
  });

  it('should NOT emit SUBNET_IPV6_UNSUPPORTED when ipv6_cidr_block is absent', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: { cidr_block: '10.0.1.0/24' } }),
    });
    const result = translateSubnet(ctx);
    expect(hasFinding(result.findings, 'SUBNET_IPV6_UNSUPPORTED')).toBe(false);
  });
});

// ===========================================================================
// translateSubnet: multi-AZ topology (AZ overflow advisory)
// ===========================================================================

describe('translateSubnet — multi-AZ topology', () => {
  it('should correctly map all six standard AZ suffixes without error (Azure)', () => {
    const suffixes = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (const s of suffixes) {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: {
            cidr_block: '10.0.1.0/24',
            availability_zone: `us-east-1${s}`,
          },
        }),
      });
      const result = translateSubnet(ctx);
      expect(hasFinding(result.findings, 'SUBNET_AZ_MAPPED')).toBe(true);
    }
  });

  it('should still produce a translated resource for each of 4 subnets in distinct AZs (Azure)', () => {
    const azs = ['us-east-1a', 'us-east-1b', 'us-east-1c', 'us-east-1d'];
    for (const az of azs) {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { cidr_block: '10.0.1.0/24', availability_zone: az },
        }),
      });
      const result = translateSubnet(ctx);
      expect(result.translated).toHaveLength(1);
    }
  });
});
