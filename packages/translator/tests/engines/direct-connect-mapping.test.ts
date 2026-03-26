/**
 * Tests for parametric/direct-connect-mapping.ts
 *
 * Covers:
 * - aws_dx_connection -> Azure: azurerm_express_route_circuit (bandwidth, SKU, location placeholder)
 * - aws_dx_connection -> GCP: google_compute_interconnect_attachment (bandwidth enum, type)
 * - aws_dx_gateway    -> Azure: azurerm_express_route_gateway (scale_units, virtual_hub)
 * - aws_dx_gateway    -> GCP: google_compute_router (bgp.asn from amazon_side_asn)
 * - DX_PHYSICAL_PROCUREMENT advisory always emitted
 * - DX_BGP_ASN info finding for gateway resources
 * - Bandwidth normalisation (Gbps -> Mbps)
 * - Unknown bandwidth emits DX_BANDWIDTH_UNKNOWN warning
 * - Tags propagated for both providers
 * - Dispatch via parametric engine
 *
 * @module tests/engines/direct-connect-mapping
 */

import { describe, it, expect, vi } from 'vitest';
import {
  translateDxConnection,
  translateDxGateway,
} from '../../src/engines/parametric/direct-connect-mapping.js';
import { parametricEngine } from '../../src/engines/parametric-engine.js';
import type { TranslationContext } from '../../src/engines/mapping-engine.js';
import type {
  IrResource,
  RegistryEntry,
  CanonicalIR,
  CloudProvider,
  CompilerOptions,
} from '@tla/shared';
import type { RegistryApi } from '@tla/registry';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'res-dx-001',
    sourceType: 'aws_dx_connection',
    sourceName: 'my_dx_conn',
    sourceModule: null,
    category: 'networking',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: 'SER-NET-DX-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-NET-DX-001',
    aws_service: 'aws_dx_connection',
    aws_family: 'networking',
    azure_targets: ['azurerm_express_route_circuit'],
    gcp_targets: ['google_compute_interconnect_attachment'],
    mapping_type: 'parametric',
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

function makeCtx(
  overrides: Partial<TranslationContext> = {},
  provider: CloudProvider = 'azure',
): TranslationContext {
  const resource = overrides.resource ?? makeIrResource();
  const entry = overrides.registryEntry ?? makeRegistryEntry();
  return {
    targetProvider: provider,
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
    options: makeCompilerOptions({ targetProvider: provider }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A. aws_dx_connection -> Azure
// ---------------------------------------------------------------------------

describe('translateDxConnection — Azure', () => {
  it('A1: emits 1 azurerm_express_route_circuit resource', () => {
    const ctx = makeCtx({}, 'azure');
    const result = translateDxConnection(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_express_route_circuit');
  });

  it('A2: resource name matches sourceName', () => {
    const ctx = makeCtx({ resource: makeIrResource({ sourceName: 'prod_dx' }) }, 'azure');
    const result = translateDxConnection(ctx);
    expect(result.translated[0]!.targetName).toBe('prod_dx');
    expect(result.translated[0]!.attributes['name']).toBe('prod_dx');
  });

  it('A3: maps 1Gbps bandwidth to 1000 Mbps', () => {
    const ctx = makeCtx(
      { resource: makeIrResource({ attributes: { bandwidth: '1Gbps' } }) },
      'azure',
    );
    const result = translateDxConnection(ctx);
    expect(result.translated[0]!.attributes['bandwidth_in_mbps']).toBe(1000);
  });

  it('A4: maps 10Gbps bandwidth to 10000 Mbps', () => {
    const ctx = makeCtx(
      { resource: makeIrResource({ attributes: { bandwidth: '10Gbps' } }) },
      'azure',
    );
    const result = translateDxConnection(ctx);
    expect(result.translated[0]!.attributes['bandwidth_in_mbps']).toBe(10000);
  });

  it('A5: maps 500Mbps bandwidth', () => {
    const ctx = makeCtx(
      { resource: makeIrResource({ attributes: { bandwidth: '500Mbps' } }) },
      'azure',
    );
    const result = translateDxConnection(ctx);
    expect(result.translated[0]!.attributes['bandwidth_in_mbps']).toBe(500);
  });

  it('A6: uses ${var.dx_location} placeholder for location and peering_location', () => {
    const ctx = makeCtx({}, 'azure');
    const result = translateDxConnection(ctx);
    const attrs = result.translated[0]!.attributes;
    expect(attrs['location']).toBe('${var.dx_location}');
    expect(attrs['peering_location']).toBe('${var.dx_location}');
  });

  it('A7: sku block is present with family and tier', () => {
    const ctx = makeCtx({}, 'azure');
    const result = translateDxConnection(ctx);
    const sku = result.translated[0]!.attributes['sku'] as Record<string, unknown>;
    expect(sku).toBeDefined();
    expect(sku['family']).toBe('MeteredData');
    expect(sku['tier']).toBe('Standard');
  });

  it('A8: always emits DX_PHYSICAL_PROCUREMENT warning', () => {
    const ctx = makeCtx({}, 'azure');
    const result = translateDxConnection(ctx);
    const finding = result.findings.find((f) => f.code === 'DX_PHYSICAL_PROCUREMENT');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
    expect(finding!.message).toContain('procurement');
  });

  it('A9: emits DX_BANDWIDTH_UNKNOWN when bandwidth cannot be parsed', () => {
    const ctx = makeCtx(
      { resource: makeIrResource({ attributes: { bandwidth: 'fast' } }) },
      'azure',
    );
    const result = translateDxConnection(ctx);
    const finding = result.findings.find((f) => f.code === 'DX_BANDWIDTH_UNKNOWN');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
    expect(finding!.message).toContain('fast');
  });

  it('A10: no DX_BANDWIDTH_UNKNOWN when bandwidth parses cleanly', () => {
    const ctx = makeCtx(
      { resource: makeIrResource({ attributes: { bandwidth: '1Gbps' } }) },
      'azure',
    );
    const result = translateDxConnection(ctx);
    expect(result.findings.some((f) => f.code === 'DX_BANDWIDTH_UNKNOWN')).toBe(false);
  });

  it('A11: propagates tags', () => {
    const ctx = makeCtx(
      { resource: makeIrResource({ attributes: { tags: { env: 'prod' } } }) },
      'azure',
    );
    const result = translateDxConnection(ctx);
    const tags = result.translated[0]!.attributes['tags'] as Record<string, string>;
    expect(tags).toBeDefined();
    expect(tags['env']).toBe('prod');
  });

  it('A12: provider_name is mapped to service_provider_name', () => {
    const ctx = makeCtx(
      { resource: makeIrResource({ attributes: { provider_name: 'Equinix' } }) },
      'azure',
    );
    const result = translateDxConnection(ctx);
    expect(result.translated[0]!.attributes['service_provider_name']).toBe('Equinix');
  });

  it('A13: traceability engine is parametric/direct-connect', () => {
    const ctx = makeCtx({}, 'azure');
    const result = translateDxConnection(ctx);
    expect(result.translated[0]!.traceability.engineUsed).toBe('parametric/direct-connect');
    expect(result.translated[0]!.traceability.mappingType).toBe('parametric');
  });
});

// ---------------------------------------------------------------------------
// B. aws_dx_connection -> GCP
// ---------------------------------------------------------------------------

describe('translateDxConnection — GCP', () => {
  it('B1: emits 1 google_compute_interconnect_attachment resource', () => {
    const ctx = makeCtx({}, 'gcp');
    const result = translateDxConnection(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_compute_interconnect_attachment');
  });

  it('B2: maps 1Gbps to BPS_1G', () => {
    const ctx = makeCtx(
      { resource: makeIrResource({ attributes: { bandwidth: '1Gbps' } }) },
      'gcp',
    );
    const result = translateDxConnection(ctx);
    expect(result.translated[0]!.attributes['bandwidth']).toBe('BPS_1G');
  });

  it('B3: maps 10Gbps to BPS_10G', () => {
    const ctx = makeCtx(
      { resource: makeIrResource({ attributes: { bandwidth: '10Gbps' } }) },
      'gcp',
    );
    const result = translateDxConnection(ctx);
    expect(result.translated[0]!.attributes['bandwidth']).toBe('BPS_10G');
  });

  it('B4: maps 100Mbps to BPS_100M', () => {
    const ctx = makeCtx(
      { resource: makeIrResource({ attributes: { bandwidth: '100Mbps' } }) },
      'gcp',
    );
    const result = translateDxConnection(ctx);
    expect(result.translated[0]!.attributes['bandwidth']).toBe('BPS_100M');
  });

  it('B5: type is DEDICATED', () => {
    const ctx = makeCtx({}, 'gcp');
    const result = translateDxConnection(ctx);
    expect(result.translated[0]!.attributes['type']).toBe('DEDICATED');
  });

  it('B6: interconnect placeholder is ${var.dx_location}', () => {
    const ctx = makeCtx({}, 'gcp');
    const result = translateDxConnection(ctx);
    expect(result.translated[0]!.attributes['interconnect']).toBe('${var.dx_location}');
  });

  it('B7: always emits DX_PHYSICAL_PROCUREMENT warning', () => {
    const ctx = makeCtx({}, 'gcp');
    const result = translateDxConnection(ctx);
    const finding = result.findings.find((f) => f.code === 'DX_PHYSICAL_PROCUREMENT');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
  });

  it('B8: propagates tags as labels', () => {
    const ctx = makeCtx(
      { resource: makeIrResource({ attributes: { tags: { team: 'infra' } } }) },
      'gcp',
    );
    const result = translateDxConnection(ctx);
    const labels = result.translated[0]!.attributes['labels'] as Record<string, string>;
    expect(labels).toBeDefined();
    expect(labels['team']).toBe('infra');
  });
});

// ---------------------------------------------------------------------------
// C. aws_dx_gateway -> Azure
// ---------------------------------------------------------------------------

describe('translateDxGateway — Azure', () => {
  function makeDxGatewayCtx(
    attrs: Record<string, unknown> = {},
    provider: CloudProvider = 'azure',
  ): TranslationContext {
    return makeCtx(
      {
        resource: makeIrResource({
          sourceType: 'aws_dx_gateway',
          sourceName: 'my_dx_gw',
          attributes: attrs,
        }),
        registryEntry: makeRegistryEntry({
          aws_service: 'aws_dx_gateway',
          azure_targets: ['azurerm_express_route_gateway'],
          gcp_targets: ['google_compute_router'],
        }),
      },
      provider,
    );
  }

  it('C1: emits 1 azurerm_express_route_gateway resource', () => {
    const result = translateDxGateway(makeDxGatewayCtx());
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_express_route_gateway');
  });

  it('C2: scale_units defaults to 1', () => {
    const result = translateDxGateway(makeDxGatewayCtx());
    expect(result.translated[0]!.attributes['scale_units']).toBe(1);
  });

  it('C3: virtual_hub_id references main virtual hub', () => {
    const result = translateDxGateway(makeDxGatewayCtx());
    expect(result.translated[0]!.attributes['virtual_hub_id']).toBe(
      '${azurerm_virtual_hub.main.id}',
    );
  });

  it('C4: always emits DX_PHYSICAL_PROCUREMENT warning', () => {
    const result = translateDxGateway(makeDxGatewayCtx());
    const finding = result.findings.find((f) => f.code === 'DX_PHYSICAL_PROCUREMENT');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
  });

  it('C5: emits DX_BGP_ASN info when amazon_side_asn present', () => {
    const result = translateDxGateway(makeDxGatewayCtx({ amazon_side_asn: 64512 }));
    const finding = result.findings.find((f) => f.code === 'DX_BGP_ASN');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.message).toContain('64512');
  });

  it('C6: no DX_BGP_ASN when amazon_side_asn absent', () => {
    const result = translateDxGateway(makeDxGatewayCtx());
    expect(result.findings.some((f) => f.code === 'DX_BGP_ASN')).toBe(false);
  });

  it('C7: traceability engine is parametric/direct-connect-gateway', () => {
    const result = translateDxGateway(makeDxGatewayCtx());
    expect(result.translated[0]!.traceability.engineUsed).toBe(
      'parametric/direct-connect-gateway',
    );
  });
});

// ---------------------------------------------------------------------------
// D. aws_dx_gateway -> GCP
// ---------------------------------------------------------------------------

describe('translateDxGateway — GCP', () => {
  function makeDxGatewayGcpCtx(attrs: Record<string, unknown> = {}): TranslationContext {
    return makeCtx(
      {
        resource: makeIrResource({
          sourceType: 'aws_dx_gateway',
          sourceName: 'my_dx_gw',
          attributes: attrs,
        }),
        registryEntry: makeRegistryEntry({
          aws_service: 'aws_dx_gateway',
          gcp_targets: ['google_compute_router'],
        }),
      },
      'gcp',
    );
  }

  it('D1: emits 1 google_compute_router resource', () => {
    const result = translateDxGateway(makeDxGatewayGcpCtx());
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_compute_router');
  });

  it('D2: bgp.asn defaults to 64512 when amazon_side_asn absent', () => {
    const result = translateDxGateway(makeDxGatewayGcpCtx());
    const bgp = result.translated[0]!.attributes['bgp'] as Record<string, unknown>;
    expect(bgp['asn']).toBe(64512);
  });

  it('D3: bgp.asn uses amazon_side_asn when present', () => {
    const result = translateDxGateway(makeDxGatewayGcpCtx({ amazon_side_asn: 65001 }));
    const bgp = result.translated[0]!.attributes['bgp'] as Record<string, unknown>;
    expect(bgp['asn']).toBe(65001);
  });

  it('D4: always emits DX_PHYSICAL_PROCUREMENT warning', () => {
    const result = translateDxGateway(makeDxGatewayGcpCtx());
    const finding = result.findings.find((f) => f.code === 'DX_PHYSICAL_PROCUREMENT');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
  });

  it('D5: always emits DX_BGP_ASN info for GCP gateway', () => {
    const result = translateDxGateway(makeDxGatewayGcpCtx({ amazon_side_asn: 65000 }));
    const finding = result.findings.find((f) => f.code === 'DX_BGP_ASN');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.message).toContain('65000');
  });

  it('D6: network references main compute network', () => {
    const result = translateDxGateway(makeDxGatewayGcpCtx());
    expect(result.translated[0]!.attributes['network']).toBe(
      '${google_compute_network.main.id}',
    );
  });
});

// ---------------------------------------------------------------------------
// E. Invariants
// ---------------------------------------------------------------------------

describe('invariants', () => {
  const providers: CloudProvider[] = ['azure', 'gcp'];

  for (const provider of providers) {
    it(`${provider}: translateDxConnection produces exactly 1 translated resource`, () => {
      const ctx = makeCtx({}, provider);
      const result = translateDxConnection(ctx);
      expect(result.translated).toHaveLength(1);
    });

    it(`${provider}: translateDxGateway produces exactly 1 translated resource`, () => {
      const ctx = makeCtx(
        {
          resource: makeIrResource({ sourceType: 'aws_dx_gateway', attributes: {} }),
        },
        provider,
      );
      const result = translateDxGateway(ctx);
      expect(result.translated).toHaveLength(1);
    });

    it(`${provider}: all findings have valid severity (info/warning/blocker)`, () => {
      const ctx = makeCtx(
        {
          resource: makeIrResource({
            attributes: {
              bandwidth: '1Gbps',
              location: 'us-east-1',
              provider_name: 'Equinix',
              tags: { env: 'prod' },
            },
          }),
        },
        provider,
      );
      const result = translateDxConnection(ctx);
      for (const finding of result.findings) {
        expect(['info', 'warning', 'blocker']).toContain(finding.severity);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// F. Parametric engine dispatch
// ---------------------------------------------------------------------------

describe('parametric engine dispatch', () => {
  it('F1: dispatches aws_dx_connection to translateDxConnection (Azure)', () => {
    const ctx = makeCtx(
      {
        resource: makeIrResource({ sourceType: 'aws_dx_connection', attributes: { bandwidth: '1Gbps' } }),
      },
      'azure',
    );
    const result = parametricEngine.translate(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_express_route_circuit');
  });

  it('F2: dispatches aws_dx_connection to translateDxConnection (GCP)', () => {
    const ctx = makeCtx(
      {
        resource: makeIrResource({ sourceType: 'aws_dx_connection', attributes: { bandwidth: '1Gbps' } }),
      },
      'gcp',
    );
    const result = parametricEngine.translate(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_compute_interconnect_attachment');
  });

  it('F3: dispatches aws_dx_gateway to translateDxGateway (Azure)', () => {
    const ctx = makeCtx(
      {
        resource: makeIrResource({ sourceType: 'aws_dx_gateway', attributes: {} }),
        registryEntry: makeRegistryEntry({
          aws_service: 'aws_dx_gateway',
          azure_targets: ['azurerm_express_route_gateway'],
        }),
      },
      'azure',
    );
    const result = parametricEngine.translate(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_express_route_gateway');
  });

  it('F4: dispatches aws_dx_gateway to translateDxGateway (GCP)', () => {
    const ctx = makeCtx(
      {
        resource: makeIrResource({ sourceType: 'aws_dx_gateway', attributes: {} }),
        registryEntry: makeRegistryEntry({
          aws_service: 'aws_dx_gateway',
          gcp_targets: ['google_compute_router'],
        }),
      },
      'gcp',
    );
    const result = parametricEngine.translate(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_compute_router');
  });
});
