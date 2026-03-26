import { describe, it, expect, vi } from 'vitest';
import {
  translateTransitGateway,
  translateTransitGatewayRouteTable,
} from '../../src/engines/structural/transit-gateway-mapping.js';
import { translateHybridConnectivity } from '../../src/engines/structural/hybrid-connectivity-mapping.js';
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
// Factory helpers (aligned with structural-engine.test.ts pattern)
// ===========================================================================

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'tgw-001',
    sourceType: 'aws_ec2_transit_gateway',
    sourceName: 'my_tgw',
    sourceModule: null,
    category: 'networking',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: 'SER-NET-TGW-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-NET-TGW-001',
    aws_service: 'aws_ec2_transit_gateway',
    aws_family: 'networking',
    azure_targets: ['azurerm_virtual_wan', 'azurerm_virtual_hub'],
    gcp_targets: ['google_network_connectivity_hub'],
    mapping_type: 'structural',
    output_mode: 'native_emit_only',
    band: 'P3',
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

function makeCtx(overrides: Partial<TranslationContext> = {}): TranslationContext {
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

function findFinding(findings: { code: string }[], code: string) {
  return findings.find((f) => f.code === code);
}

function findAllFindings(findings: { code: string }[], code: string) {
  return findings.filter((f) => f.code === code);
}

function hasFinding(findings: { code: string }[], code: string): boolean {
  return findings.some((f) => f.code === code);
}

// Helper to create a VPC attachment sibling resource
function makeAttachmentSibling(
  overrides: Partial<IrResource> & { attributes?: Record<string, unknown> } = {},
): IrResource {
  return makeIrResource({
    id: 'att-001',
    sourceType: 'aws_ec2_transit_gateway_vpc_attachment',
    sourceName: 'my_attachment',
    attributes: {
      transit_gateway_id: 'tgw-001',
      vpc_id: 'my_vpc',
      ...((overrides.attributes as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}

// ===========================================================================
// TGW Azure (~8 tests)
// ===========================================================================

describe('translateTransitGateway — Azure TGW', () => {
  it('should produce azurerm_virtual_wan + azurerm_virtual_hub (1:2 minimum)', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: { tags: { env: 'prod' } } }),
    });
    const result = translateTransitGateway(ctx);

    const types = result.translated.map((r) => r.targetType);
    expect(types).toContain('azurerm_virtual_wan');
    expect(types).toContain('azurerm_virtual_hub');
    expect(result.translated.length).toBeGreaterThanOrEqual(2);
  });

  it('should propagate tags to Azure resources', () => {
    const tags = { env: 'staging', team: 'infra' };
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: { tags } }),
    });
    const result = translateTransitGateway(ctx);

    const wan = result.translated.find((r) => r.targetType === 'azurerm_virtual_wan');
    const hub = result.translated.find((r) => r.targetType === 'azurerm_virtual_hub');
    expect(wan!.attributes['tags']).toBeDefined();
    expect(hub!.attributes['tags']).toBeDefined();
  });

  it('should emit TGW_TOPOLOGY_EXPANDED info finding', () => {
    const ctx = makeCtx({ targetProvider: 'azure' });
    const result = translateTransitGateway(ctx);

    const f = findFinding(result.findings, 'TGW_TOPOLOGY_EXPANDED');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
  });

  it('should emit TGW_MANUAL_REVIEW warning finding', () => {
    const ctx = makeCtx({ targetProvider: 'azure' });
    const result = translateTransitGateway(ctx);

    expect(hasFinding(result.findings, 'TGW_MANUAL_REVIEW')).toBe(true);
    const reviews = findAllFindings(result.findings, 'TGW_MANUAL_REVIEW');
    expect(reviews.some((f) => (f as any).severity === 'warning')).toBe(true);
  });

  it('should clamp confidence to [0.50, 0.65]', () => {
    const ctx = makeCtx({ targetProvider: 'azure' });
    const result = translateTransitGateway(ctx);

    for (const r of result.translated) {
      expect(r.traceability.confidence).toBeGreaterThanOrEqual(0.50);
      expect(r.traceability.confidence).toBeLessThanOrEqual(0.65);
    }
  });

  it('should emit STRUCTURAL_TOPOLOGY finding when description present', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: { description: 'Main hub' } }),
    });
    const result = translateTransitGateway(ctx);

    const f = findFinding(result.findings, 'STRUCTURAL_TOPOLOGY');
    expect(f).toBeDefined();
    expect((f as any).message).toContain('Main hub');
  });

  it('should emit ASN advisory when amazon_side_asn is present', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: { amazon_side_asn: 64512 } }),
    });
    const result = translateTransitGateway(ctx);

    const reviews = findAllFindings(result.findings, 'TGW_MANUAL_REVIEW');
    expect(reviews.some((f) => (f as any).message?.includes('amazon_side_asn'))).toBe(true);
  });

  it('should include inline attachment hub connections when siblings present', () => {
    const att = makeAttachmentSibling();
    const ctx = makeCtx({
      targetProvider: 'azure',
      siblingResources: [att],
    });
    const result = translateTransitGateway(ctx);

    const connections = result.translated.filter(
      (r) => r.targetType === 'azurerm_virtual_hub_connection',
    );
    expect(connections.length).toBe(1);
    // Total: wan + hub + 1 connection = 3
    expect(result.translated.length).toBe(3);
  });
});

// ===========================================================================
// TGW GCP (~6 tests)
// ===========================================================================

describe('translateTransitGateway — GCP TGW', () => {
  it('should produce google_network_connectivity_hub', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeIrResource(),
    });
    const result = translateTransitGateway(ctx);

    const types = result.translated.map((r) => r.targetType);
    expect(types).toContain('google_network_connectivity_hub');
  });

  it('should propagate labels to GCP resources', () => {
    const tags = { env: 'prod' };
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeIrResource({ attributes: { tags } }),
    });
    const result = translateTransitGateway(ctx);

    const hub = result.translated.find(
      (r) => r.targetType === 'google_network_connectivity_hub',
    );
    expect(hub!.attributes['labels']).toBeDefined();
  });

  it('should emit TGW_MANUAL_REVIEW warning', () => {
    const ctx = makeCtx({ targetProvider: 'gcp' });
    const result = translateTransitGateway(ctx);

    expect(hasFinding(result.findings, 'TGW_MANUAL_REVIEW')).toBe(true);
  });

  it('should clamp confidence to [0.50, 0.65]', () => {
    const ctx = makeCtx({ targetProvider: 'gcp' });
    const result = translateTransitGateway(ctx);

    for (const r of result.translated) {
      expect(r.traceability.confidence).toBeGreaterThanOrEqual(0.50);
      expect(r.traceability.confidence).toBeLessThanOrEqual(0.65);
    }
  });

  it('should emit TGW_TOPOLOGY_EXPANDED info finding', () => {
    const ctx = makeCtx({ targetProvider: 'gcp' });
    const result = translateTransitGateway(ctx);

    const f = findFinding(result.findings, 'TGW_TOPOLOGY_EXPANDED');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
  });

  it('should include inline spokes when attachment siblings present', () => {
    const att = makeAttachmentSibling();
    const ctx = makeCtx({
      targetProvider: 'gcp',
      siblingResources: [att],
    });
    const result = translateTransitGateway(ctx);

    const spokes = result.translated.filter(
      (r) => r.targetType === 'google_network_connectivity_spoke',
    );
    expect(spokes.length).toBe(1);
    // hub + 1 spoke = 2
    expect(result.translated.length).toBe(2);
  });
});

// ===========================================================================
// VPC Attachment Azure (~5 tests)
// ===========================================================================

describe('translateTransitGateway — Azure VPC Attachment', () => {
  function makeAttachmentCtx(overrides: Partial<TranslationContext> = {}): TranslationContext {
    return makeCtx({
      targetProvider: 'azure',
      resource: makeIrResource({
        id: 'att-002',
        sourceType: 'aws_ec2_transit_gateway_vpc_attachment',
        sourceName: 'my_att',
        attributes: { transit_gateway_id: 'tgw-001', vpc_id: 'my_vpc' },
      }),
      ...overrides,
    });
  }

  it('should produce azurerm_virtual_hub_connection', () => {
    const ctx = makeAttachmentCtx();
    const result = translateTransitGateway(ctx);

    expect(result.translated.length).toBe(1);
    expect(result.translated[0].targetType).toBe('azurerm_virtual_hub_connection');
  });

  it('should reference hub via interpolation from parent TGW sibling', () => {
    const tgwSibling = makeIrResource({
      id: 'tgw-001',
      sourceType: 'aws_ec2_transit_gateway',
      sourceName: 'main_tgw',
    });
    const ctx = makeAttachmentCtx({
      siblingResources: [tgwSibling],
    });
    const result = translateTransitGateway(ctx);

    const conn = result.translated[0];
    expect(conn.attributes['virtual_hub_id']).toContain('azurerm_virtual_hub.main_tgw_hub');
  });

  it('should reference VPC via sibling lookup when vpc_id present', () => {
    const ctx = makeAttachmentCtx();
    const result = translateTransitGateway(ctx);

    const conn = result.translated[0];
    expect(conn.attributes['remote_virtual_network_id']).toContain('my_vpc');
  });

  it('should fallback hub reference when no TGW sibling found', () => {
    const ctx = makeAttachmentCtx({ siblingResources: [] });
    const result = translateTransitGateway(ctx);

    const conn = result.translated[0];
    expect(conn.attributes['virtual_hub_id']).toContain('main_hub');
  });

  it('should emit appliance_mode advisory when enabled', () => {
    const ctx = makeAttachmentCtx({
      resource: makeIrResource({
        id: 'att-002',
        sourceType: 'aws_ec2_transit_gateway_vpc_attachment',
        sourceName: 'my_att',
        attributes: {
          transit_gateway_id: 'tgw-001',
          vpc_id: 'my_vpc',
          appliance_mode_support: 'enable',
        },
      }),
    });
    const result = translateTransitGateway(ctx);

    const reviews = findAllFindings(result.findings, 'TGW_MANUAL_REVIEW');
    expect(reviews.some((f) => (f as any).message?.includes('appliance_mode'))).toBe(true);
  });
});

// ===========================================================================
// VPC Attachment GCP (~5 tests)
// ===========================================================================

describe('translateTransitGateway — GCP VPC Attachment', () => {
  function makeGcpAttachmentCtx(
    overrides: Partial<TranslationContext> = {},
  ): TranslationContext {
    return makeCtx({
      targetProvider: 'gcp',
      resource: makeIrResource({
        id: 'att-003',
        sourceType: 'aws_ec2_transit_gateway_vpc_attachment',
        sourceName: 'gcp_att',
        attributes: { transit_gateway_id: 'tgw-001', vpc_id: 'my_vpc' },
      }),
      ...overrides,
    });
  }

  it('should produce google_network_connectivity_spoke', () => {
    const ctx = makeGcpAttachmentCtx();
    const result = translateTransitGateway(ctx);

    expect(result.translated.length).toBe(1);
    expect(result.translated[0].targetType).toBe('google_network_connectivity_spoke');
  });

  it('should include linked_vpc_network block', () => {
    const ctx = makeGcpAttachmentCtx();
    const result = translateTransitGateway(ctx);

    const spoke = result.translated[0];
    expect(spoke.attributes['linked_vpc_network']).toBeDefined();
    expect((spoke.attributes['linked_vpc_network'] as any).uri).toContain('my_vpc');
  });

  it('should reference hub from TGW sibling', () => {
    const tgwSibling = makeIrResource({
      id: 'tgw-001',
      sourceType: 'aws_ec2_transit_gateway',
      sourceName: 'main_tgw',
    });
    const ctx = makeGcpAttachmentCtx({
      siblingResources: [tgwSibling],
    });
    const result = translateTransitGateway(ctx);

    const spoke = result.translated[0];
    expect(spoke.attributes['hub']).toContain('google_network_connectivity_hub.main_tgw');
  });

  it('should fallback hub reference when no TGW sibling', () => {
    const ctx = makeGcpAttachmentCtx({ siblingResources: [] });
    const result = translateTransitGateway(ctx);

    const spoke = result.translated[0];
    expect(spoke.attributes['hub']).toContain('google_network_connectivity_hub.main');
  });

  it('should emit ipv6 advisory when ipv6_support enabled', () => {
    const ctx = makeGcpAttachmentCtx({
      resource: makeIrResource({
        id: 'att-003',
        sourceType: 'aws_ec2_transit_gateway_vpc_attachment',
        sourceName: 'gcp_att',
        attributes: {
          transit_gateway_id: 'tgw-001',
          vpc_id: 'my_vpc',
          ipv6_support: 'enable',
        },
      }),
    });
    const result = translateTransitGateway(ctx);

    const reviews = findAllFindings(result.findings, 'TGW_MANUAL_REVIEW');
    expect(reviews.some((f) => (f as any).message?.includes('ipv6'))).toBe(true);
  });
});

// ===========================================================================
// Route Table Advisory (~4 tests)
// ===========================================================================

describe('translateTransitGatewayRouteTable', () => {
  it('should always return translated:[] (advisory only)', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeIrResource({
        sourceType: 'aws_ec2_transit_gateway_route_table',
        sourceName: 'my_rt',
      }),
    });
    const result = translateTransitGatewayRouteTable(ctx);

    expect(result.translated).toEqual([]);
  });

  it('should emit TGW_ROUTE_PROPAGATION_ADVISORY warning', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeIrResource({
        sourceType: 'aws_ec2_transit_gateway_route_table',
        sourceName: 'my_rt',
      }),
    });
    const result = translateTransitGatewayRouteTable(ctx);

    const f = findFinding(result.findings, 'TGW_ROUTE_PROPAGATION_ADVISORY');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  it('should include Azure-specific migration steps for azure provider', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeIrResource({
        sourceType: 'aws_ec2_transit_gateway_route_table',
        sourceName: 'my_rt',
      }),
    });
    const result = translateTransitGatewayRouteTable(ctx);

    const f = findFinding(result.findings, 'TGW_ROUTE_PROPAGATION_ADVISORY');
    expect(f).toBeDefined();
    const detail = (f as any).detail ?? (f as any).details;
    expect(detail).toBeDefined();
    const parsed = JSON.parse(detail);
    expect(parsed.migrationSteps).toBeDefined();
    expect(parsed.migrationSteps.some((s: string) => s.includes('Azure'))).toBe(true);
  });

  it('should include GCP-specific migration steps for gcp provider', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeIrResource({
        sourceType: 'aws_ec2_transit_gateway_route_table',
        sourceName: 'my_rt',
      }),
    });
    const result = translateTransitGatewayRouteTable(ctx);

    const f = findFinding(result.findings, 'TGW_ROUTE_PROPAGATION_ADVISORY');
    expect(f).toBeDefined();
    const detail = (f as any).detail ?? (f as any).details;
    const parsed = JSON.parse(detail);
    expect(parsed.migrationSteps.some((s: string) => s.includes('GCP') || s.includes('Cloud Router'))).toBe(true);
  });
});

// ===========================================================================
// Hybrid Connectivity (~8 tests)
// ===========================================================================

describe('translateHybridConnectivity', () => {
  describe('VPN resources', () => {
    it('should emit TGW_HYBRID_CONNECTIVITY for aws_vpn_connection (Azure)', () => {
      const ctx = makeCtx({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_vpn_connection',
          sourceName: 'my_vpn',
        }),
      });
      const result = translateHybridConnectivity(ctx);

      expect(result.translated).toEqual([]);
      const f = findFinding(result.findings, 'TGW_HYBRID_CONNECTIVITY');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('warning');
      expect((f as any).message).toContain('Azure VPN Gateway');
    });

    it('should emit TGW_HYBRID_CONNECTIVITY for aws_vpn_gateway (GCP)', () => {
      const ctx = makeCtx({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_vpn_gateway',
          sourceName: 'my_vpn_gw',
        }),
      });
      const result = translateHybridConnectivity(ctx);

      expect(result.translated).toEqual([]);
      const f = findFinding(result.findings, 'TGW_HYBRID_CONNECTIVITY');
      expect(f).toBeDefined();
      expect((f as any).message).toContain('Cloud VPN Gateway');
    });
  });

  describe('Direct Connect resources', () => {
    it('should emit TGW_HYBRID_CONNECTIVITY for aws_dx_connection (Azure)', () => {
      const ctx = makeCtx({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_dx_connection',
          sourceName: 'my_dx',
        }),
      });
      const result = translateHybridConnectivity(ctx);

      expect(result.translated).toEqual([]);
      const f = findFinding(result.findings, 'TGW_HYBRID_CONNECTIVITY');
      expect(f).toBeDefined();
      expect((f as any).message).toContain('Azure ExpressRoute');
    });

    it('should emit TGW_HYBRID_CONNECTIVITY for aws_dx_gateway (GCP)', () => {
      const ctx = makeCtx({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_dx_gateway',
          sourceName: 'my_dx_gw',
        }),
      });
      const result = translateHybridConnectivity(ctx);

      expect(result.translated).toEqual([]);
      const f = findFinding(result.findings, 'TGW_HYBRID_CONNECTIVITY');
      expect(f).toBeDefined();
      expect((f as any).message).toContain('Cloud Interconnect');
    });
  });

  describe('Peering attachment', () => {
    it('should emit TGW_PEERING_ADVISORY for Azure', () => {
      const ctx = makeCtx({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_ec2_transit_gateway_peering_attachment',
          sourceName: 'my_peering',
        }),
      });
      const result = translateHybridConnectivity(ctx);

      expect(result.translated).toEqual([]);
      const f = findFinding(result.findings, 'TGW_PEERING_ADVISORY');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('warning');
    });

    it('should emit TGW_PEERING_ADVISORY for GCP', () => {
      const ctx = makeCtx({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_ec2_transit_gateway_peering_attachment',
          sourceName: 'my_peering',
        }),
      });
      const result = translateHybridConnectivity(ctx);

      expect(result.translated).toEqual([]);
      const f = findFinding(result.findings, 'TGW_PEERING_ADVISORY');
      expect(f).toBeDefined();
    });
  });

  describe('all hybrid resources return translated:[]', () => {
    const hybridTypes = [
      'aws_vpn_connection',
      'aws_vpn_gateway',
      'aws_dx_connection',
      'aws_dx_gateway',
      'aws_ec2_transit_gateway_peering_attachment',
    ];

    for (const sourceType of hybridTypes) {
      it(`should return empty translated array for ${sourceType}`, () => {
        const ctx = makeCtx({
          targetProvider: 'azure',
          resource: makeIrResource({ sourceType, sourceName: 'test_res' }),
        });
        const result = translateHybridConnectivity(ctx);
        expect(result.translated).toEqual([]);
        expect(result.findings.length).toBeGreaterThan(0);
      });
    }
  });
});

// ===========================================================================
// Edge Cases (~4 tests)
// ===========================================================================

describe('translateTransitGateway — Edge Cases', () => {
  it('should produce just hub skeleton when no attachments', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      siblingResources: [],
    });
    const result = translateTransitGateway(ctx);

    // Should have exactly 2: virtual_wan + virtual_hub
    expect(result.translated.length).toBe(2);
    const types = result.translated.map((r) => r.targetType);
    expect(types).toContain('azurerm_virtual_wan');
    expect(types).toContain('azurerm_virtual_hub');
    // No hub connections
    expect(types).not.toContain('azurerm_virtual_hub_connection');
  });

  it('should handle missing attributes with defaults (no tags, no description)', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: {} }),
    });
    const result = translateTransitGateway(ctx);

    // Should still produce resources
    expect(result.translated.length).toBeGreaterThanOrEqual(2);

    // Tags should not be on resources
    const wan = result.translated.find((r) => r.targetType === 'azurerm_virtual_wan');
    expect(wan!.attributes['tags']).toBeUndefined();

    // No STRUCTURAL_TOPOLOGY finding (no description)
    expect(hasFinding(result.findings, 'STRUCTURAL_TOPOLOGY')).toBe(false);
  });

  it('should handle unknown hybrid source type with generic fallback', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeIrResource({
        sourceType: 'aws_some_unknown_hybrid_type',
        sourceName: 'unknown_res',
      }),
    });
    const result = translateHybridConnectivity(ctx);

    expect(result.translated).toEqual([]);
    const f = findFinding(result.findings, 'TGW_HYBRID_CONNECTIVITY');
    expect(f).toBeDefined();
    expect((f as any).message).toContain('manual migration');
  });

  it('should handle GCP TGW with no attachments — just connectivity hub', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      siblingResources: [],
    });
    const result = translateTransitGateway(ctx);

    expect(result.translated.length).toBe(1);
    expect(result.translated[0].targetType).toBe('google_network_connectivity_hub');
  });
});
