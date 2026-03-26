/**
 * Tests for parametric/vpn-mapping.ts
 *
 * Covers:
 * - aws_vpn_gateway    -> Azure: azurerm_virtual_network_gateway (type=Vpn)
 * - aws_vpn_gateway    -> GCP:   google_compute_vpn_gateway
 * - aws_vpn_connection -> Azure: azurerm_virtual_network_gateway_connection (shared_key placeholder)
 * - aws_vpn_connection -> GCP:   google_compute_vpn_tunnel (shared_secret placeholder)
 * - aws_customer_gateway -> Azure: azurerm_local_network_gateway (ip_address, bgp_settings)
 * - aws_customer_gateway -> GCP:   google_compute_external_vpn_gateway
 * - PSK scrubbing: shared_key / shared_secret NEVER literal (NFR-SEC-001)
 * - VPN_PSK_PLACEHOLDER warning always emitted for connection resources
 * - VPN_DUAL_TUNNEL_HA warning always emitted
 * - IKEv1-only source emits VPN_IKE_VERSION warning
 * - BGP ASN advisory findings
 * - Tags propagated for both providers
 * - Dispatch via parametric engine
 *
 * @module tests/engines/vpn-mapping
 */

import { describe, it, expect, vi } from 'vitest';
import {
  translateVpnGateway,
  translateVpnConnection,
  translateCustomerGateway,
} from '../../src/engines/parametric/vpn-mapping.js';
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
    id: 'res-vpn-001',
    sourceType: 'aws_vpn_gateway',
    sourceName: 'my_vpn_gw',
    sourceModule: null,
    category: 'networking',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: 'SER-NET-VPN-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-NET-VPN-001',
    aws_service: 'aws_vpn_gateway',
    aws_family: 'networking',
    azure_targets: ['azurerm_virtual_network_gateway'],
    gcp_targets: ['google_compute_vpn_gateway'],
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

function makeCompilerOptions(provider: CloudProvider = 'azure'): CompilerOptions {
  return {
    targetProvider: provider,
    registryVersion: '2025.03.01',
    emitComments: true,
    sortKeys: true,
  };
}

function makeCtx(
  attrs: Record<string, unknown> = {},
  sourceType: string = 'aws_vpn_gateway',
  provider: CloudProvider = 'azure',
  registryOverrides: Partial<RegistryEntry> = {},
): TranslationContext {
  const resource = makeIrResource({ sourceType, sourceName: 'test_resource', attributes: attrs });
  const entry = makeRegistryEntry({ aws_service: sourceType, ...registryOverrides });
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
    options: makeCompilerOptions(provider),
  };
}

// ---------------------------------------------------------------------------
// A. aws_vpn_gateway
// ---------------------------------------------------------------------------

describe('translateVpnGateway — Azure', () => {
  it('A1: emits 1 azurerm_virtual_network_gateway resource', () => {
    const result = translateVpnGateway(makeCtx({}, 'aws_vpn_gateway', 'azure'));
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_virtual_network_gateway');
  });

  it('A2: type is Vpn', () => {
    const result = translateVpnGateway(makeCtx({}, 'aws_vpn_gateway', 'azure'));
    expect(result.translated[0]!.attributes['type']).toBe('Vpn');
  });

  it('A3: sku defaults to VpnGw1', () => {
    const result = translateVpnGateway(makeCtx({}, 'aws_vpn_gateway', 'azure'));
    expect(result.translated[0]!.attributes['sku']).toBe('VpnGw1');
  });

  it('A4: always emits VPN_DUAL_TUNNEL_HA warning', () => {
    const result = translateVpnGateway(makeCtx({}, 'aws_vpn_gateway', 'azure'));
    const finding = result.findings.find((f) => f.code === 'VPN_DUAL_TUNNEL_HA');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
  });

  it('A5: emits VPN_BGP_ASN info when amazon_side_asn present', () => {
    const result = translateVpnGateway(makeCtx({ amazon_side_asn: 64512 }, 'aws_vpn_gateway', 'azure'));
    const finding = result.findings.find((f) => f.code === 'VPN_BGP_ASN');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.message).toContain('64512');
  });

  it('A6: no VPN_BGP_ASN when amazon_side_asn absent', () => {
    const result = translateVpnGateway(makeCtx({}, 'aws_vpn_gateway', 'azure'));
    expect(result.findings.some((f) => f.code === 'VPN_BGP_ASN')).toBe(false);
  });

  it('A7: propagates tags', () => {
    const result = translateVpnGateway(
      makeCtx({ tags: { env: 'staging' } }, 'aws_vpn_gateway', 'azure'),
    );
    const tags = result.translated[0]!.attributes['tags'] as Record<string, string>;
    expect(tags['env']).toBe('staging');
  });

  it('A8: traceability engine is parametric/vpn-gateway', () => {
    const result = translateVpnGateway(makeCtx({}, 'aws_vpn_gateway', 'azure'));
    expect(result.translated[0]!.traceability.engineUsed).toBe('parametric/vpn-gateway');
    expect(result.translated[0]!.traceability.mappingType).toBe('parametric');
  });
});

describe('translateVpnGateway — GCP', () => {
  it('A9: emits 1 google_compute_vpn_gateway resource', () => {
    const result = translateVpnGateway(makeCtx({}, 'aws_vpn_gateway', 'gcp'));
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_compute_vpn_gateway');
  });

  it('A10: always emits VPN_DUAL_TUNNEL_HA warning for GCP', () => {
    const result = translateVpnGateway(makeCtx({}, 'aws_vpn_gateway', 'gcp'));
    const finding = result.findings.find((f) => f.code === 'VPN_DUAL_TUNNEL_HA');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
  });

  it('A11: propagates tags as labels for GCP', () => {
    const result = translateVpnGateway(
      makeCtx({ tags: { team: 'ops' } }, 'aws_vpn_gateway', 'gcp'),
    );
    const labels = result.translated[0]!.attributes['labels'] as Record<string, string>;
    expect(labels['team']).toBe('ops');
  });
});

// ---------------------------------------------------------------------------
// B. aws_vpn_connection — PSK scrubbing is critical
// ---------------------------------------------------------------------------

describe('translateVpnConnection — Azure (PSK scrubbing)', () => {
  it('B1: emits 1 azurerm_virtual_network_gateway_connection resource', () => {
    const result = translateVpnConnection(makeCtx({}, 'aws_vpn_connection', 'azure'));
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_virtual_network_gateway_connection');
  });

  it('B2: shared_key is ${var.vpn_psk} placeholder (NEVER literal)', () => {
    const result = translateVpnConnection(
      makeCtx(
        { tunnel1_preshared_key: 'super-secret-psk', tunnel2_preshared_key: 'another-secret' },
        'aws_vpn_connection',
        'azure',
      ),
    );
    const sharedKey = result.translated[0]!.attributes['shared_key'];
    expect(sharedKey).toBe('${var.vpn_psk}');
    // Literal keys must NOT appear anywhere in translated attributes
    const attrsJson = JSON.stringify(result.translated.map((t) => t.attributes));
    expect(attrsJson).not.toContain('super-secret-psk');
    expect(attrsJson).not.toContain('another-secret');
  });

  it('B3: always emits VPN_PSK_PLACEHOLDER warning', () => {
    const result = translateVpnConnection(makeCtx({}, 'aws_vpn_connection', 'azure'));
    const finding = result.findings.find((f) => f.code === 'VPN_PSK_PLACEHOLDER');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
    expect(finding!.message).toContain('NFR-SEC-001');
  });

  it('B4: always emits VPN_DUAL_TUNNEL_HA warning', () => {
    const result = translateVpnConnection(makeCtx({}, 'aws_vpn_connection', 'azure'));
    const finding = result.findings.find((f) => f.code === 'VPN_DUAL_TUNNEL_HA');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
  });

  it('B5: connection_protocol defaults to IKEv2', () => {
    const result = translateVpnConnection(makeCtx({}, 'aws_vpn_connection', 'azure'));
    expect(result.translated[0]!.attributes['connection_protocol']).toBe('IKEv2');
  });

  it('B6: emits VPN_IKE_VERSION warning when IKEv1 only', () => {
    const result = translateVpnConnection(
      makeCtx(
        {
          tunnel1_ike_versions: ['ikev1'],
          tunnel2_ike_versions: ['ikev1'],
        },
        'aws_vpn_connection',
        'azure',
      ),
    );
    const finding = result.findings.find((f) => f.code === 'VPN_IKE_VERSION');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
    expect(finding!.message).toContain('IKEv1');
  });

  it('B7: no VPN_IKE_VERSION when IKEv2 used', () => {
    const result = translateVpnConnection(
      makeCtx(
        {
          tunnel1_ike_versions: ['ikev2'],
          tunnel2_ike_versions: ['ikev2'],
        },
        'aws_vpn_connection',
        'azure',
      ),
    );
    expect(result.findings.some((f) => f.code === 'VPN_IKE_VERSION')).toBe(false);
  });

  it('B8: no VPN_IKE_VERSION when ike_versions absent', () => {
    const result = translateVpnConnection(makeCtx({}, 'aws_vpn_connection', 'azure'));
    expect(result.findings.some((f) => f.code === 'VPN_IKE_VERSION')).toBe(false);
  });

  it('B9: type is IPsec', () => {
    const result = translateVpnConnection(makeCtx({}, 'aws_vpn_connection', 'azure'));
    expect(result.translated[0]!.attributes['type']).toBe('IPsec');
  });
});

describe('translateVpnConnection — GCP (PSK scrubbing)', () => {
  it('B10: emits 1 google_compute_vpn_tunnel resource', () => {
    const result = translateVpnConnection(makeCtx({}, 'aws_vpn_connection', 'gcp'));
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_compute_vpn_tunnel');
  });

  it('B11: shared_secret is ${var.vpn_psk} placeholder (NEVER literal)', () => {
    const result = translateVpnConnection(
      makeCtx(
        { tunnel1_preshared_key: 'literal-psk-value' },
        'aws_vpn_connection',
        'gcp',
      ),
    );
    const sharedSecret = result.translated[0]!.attributes['shared_secret'];
    expect(sharedSecret).toBe('${var.vpn_psk}');
    const attrsJson = JSON.stringify(result.translated.map((t) => t.attributes));
    expect(attrsJson).not.toContain('literal-psk-value');
  });

  it('B12: always emits VPN_PSK_PLACEHOLDER warning (GCP)', () => {
    const result = translateVpnConnection(makeCtx({}, 'aws_vpn_connection', 'gcp'));
    const finding = result.findings.find((f) => f.code === 'VPN_PSK_PLACEHOLDER');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
  });

  it('B13: ike_version defaults to 2', () => {
    const result = translateVpnConnection(makeCtx({}, 'aws_vpn_connection', 'gcp'));
    expect(result.translated[0]!.attributes['ike_version']).toBe(2);
  });

  it('B14: emits VPN_IKE_VERSION warning when IKEv1 only (GCP)', () => {
    const result = translateVpnConnection(
      makeCtx(
        { tunnel1_ike_versions: ['ikev1'], tunnel2_ike_versions: ['ikev1'] },
        'aws_vpn_connection',
        'gcp',
      ),
    );
    const finding = result.findings.find((f) => f.code === 'VPN_IKE_VERSION');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
  });

  it('B15: literal PSK never in findings output either', () => {
    const secretPsk = 'my-very-secret-psk-12345';
    const result = translateVpnConnection(
      makeCtx(
        { tunnel1_preshared_key: secretPsk, tunnel2_preshared_key: secretPsk },
        'aws_vpn_connection',
        'gcp',
      ),
    );
    const fullOutput = JSON.stringify(result);
    expect(fullOutput).not.toContain(secretPsk);
  });
});

// ---------------------------------------------------------------------------
// C. aws_customer_gateway
// ---------------------------------------------------------------------------

describe('translateCustomerGateway — Azure', () => {
  it('C1: emits 1 azurerm_local_network_gateway resource', () => {
    const result = translateCustomerGateway(
      makeCtx({ ip_address: '203.0.113.1' }, 'aws_customer_gateway', 'azure'),
    );
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_local_network_gateway');
  });

  it('C2: ip_address is mapped directly', () => {
    const result = translateCustomerGateway(
      makeCtx({ ip_address: '198.51.100.5' }, 'aws_customer_gateway', 'azure'),
    );
    expect(result.translated[0]!.attributes['ip_address']).toBe('198.51.100.5');
  });

  it('C3: bgp_settings block present when bgp_asn provided', () => {
    const result = translateCustomerGateway(
      makeCtx({ ip_address: '203.0.113.1', bgp_asn: 65000 }, 'aws_customer_gateway', 'azure'),
    );
    const bgp = result.translated[0]!.attributes['bgp_settings'] as Record<string, unknown>;
    expect(bgp).toBeDefined();
    expect(bgp['asn']).toBe(65000);
  });

  it('C4: no bgp_settings when bgp_asn absent', () => {
    const result = translateCustomerGateway(
      makeCtx({ ip_address: '203.0.113.1' }, 'aws_customer_gateway', 'azure'),
    );
    expect(result.translated[0]!.attributes['bgp_settings']).toBeUndefined();
  });

  it('C5: emits VPN_BGP_ASN info when bgp_asn present', () => {
    const result = translateCustomerGateway(
      makeCtx({ ip_address: '203.0.113.1', bgp_asn: 65001 }, 'aws_customer_gateway', 'azure'),
    );
    const finding = result.findings.find((f) => f.code === 'VPN_BGP_ASN');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.message).toContain('65001');
  });

  it('C6: propagates tags', () => {
    const result = translateCustomerGateway(
      makeCtx({ ip_address: '203.0.113.1', tags: { env: 'prod' } }, 'aws_customer_gateway', 'azure'),
    );
    const tags = result.translated[0]!.attributes['tags'] as Record<string, string>;
    expect(tags['env']).toBe('prod');
  });

  it('C7: traceability engine is parametric/customer-gateway', () => {
    const result = translateCustomerGateway(
      makeCtx({ ip_address: '203.0.113.1' }, 'aws_customer_gateway', 'azure'),
    );
    expect(result.translated[0]!.traceability.engineUsed).toBe('parametric/customer-gateway');
  });
});

describe('translateCustomerGateway — GCP', () => {
  it('C8: emits 1 google_compute_external_vpn_gateway resource', () => {
    const result = translateCustomerGateway(
      makeCtx({ ip_address: '203.0.113.1' }, 'aws_customer_gateway', 'gcp'),
    );
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_compute_external_vpn_gateway');
  });

  it('C9: ip_address is placed in interfaces array', () => {
    const result = translateCustomerGateway(
      makeCtx({ ip_address: '198.51.100.7' }, 'aws_customer_gateway', 'gcp'),
    );
    const interfaces = result.translated[0]!.attributes['interfaces'] as Array<
      Record<string, unknown>
    >;
    expect(interfaces[0]!['ip_address']).toBe('198.51.100.7');
  });

  it('C10: redundancy_type is SINGLE_IP_INTERNALLY_REDUNDANT', () => {
    const result = translateCustomerGateway(
      makeCtx({ ip_address: '203.0.113.1' }, 'aws_customer_gateway', 'gcp'),
    );
    expect(result.translated[0]!.attributes['redundancy_type']).toBe(
      'SINGLE_IP_INTERNALLY_REDUNDANT',
    );
  });

  it('C11: emits VPN_BGP_ASN info for GCP when bgp_asn present', () => {
    const result = translateCustomerGateway(
      makeCtx({ ip_address: '203.0.113.1', bgp_asn: 65002 }, 'aws_customer_gateway', 'gcp'),
    );
    const finding = result.findings.find((f) => f.code === 'VPN_BGP_ASN');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.message).toContain('65002');
  });

  it('C12: propagates tags as labels for GCP', () => {
    const result = translateCustomerGateway(
      makeCtx(
        { ip_address: '203.0.113.1', tags: { team: 'net' } },
        'aws_customer_gateway',
        'gcp',
      ),
    );
    const labels = result.translated[0]!.attributes['labels'] as Record<string, string>;
    expect(labels['team']).toBe('net');
  });
});

// ---------------------------------------------------------------------------
// D. Invariants
// ---------------------------------------------------------------------------

describe('invariants', () => {
  const providers: CloudProvider[] = ['azure', 'gcp'];

  for (const provider of providers) {
    it(`${provider}: translateVpnGateway produces exactly 1 translated resource`, () => {
      const result = translateVpnGateway(makeCtx({}, 'aws_vpn_gateway', provider));
      expect(result.translated).toHaveLength(1);
    });

    it(`${provider}: translateVpnConnection produces exactly 1 translated resource`, () => {
      const result = translateVpnConnection(makeCtx({}, 'aws_vpn_connection', provider));
      expect(result.translated).toHaveLength(1);
    });

    it(`${provider}: translateCustomerGateway produces exactly 1 translated resource`, () => {
      const result = translateCustomerGateway(
        makeCtx({ ip_address: '1.2.3.4' }, 'aws_customer_gateway', provider),
      );
      expect(result.translated).toHaveLength(1);
    });

    it(`${provider}: PSK values never appear in translateVpnConnection full output`, () => {
      const secret = 'psk-must-not-leak';
      const result = translateVpnConnection(
        makeCtx(
          { tunnel1_preshared_key: secret, tunnel2_preshared_key: secret },
          'aws_vpn_connection',
          provider,
        ),
      );
      expect(JSON.stringify(result)).not.toContain(secret);
    });
  }
});

// ---------------------------------------------------------------------------
// E. Parametric engine dispatch
// ---------------------------------------------------------------------------

describe('parametric engine dispatch', () => {
  it('E1: dispatches aws_vpn_gateway to Azure', () => {
    const ctx = makeCtx({}, 'aws_vpn_gateway', 'azure');
    const result = parametricEngine.translate(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_virtual_network_gateway');
  });

  it('E2: dispatches aws_vpn_gateway to GCP', () => {
    const ctx = makeCtx({}, 'aws_vpn_gateway', 'gcp');
    const result = parametricEngine.translate(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_compute_vpn_gateway');
  });

  it('E3: dispatches aws_vpn_connection to Azure', () => {
    const ctx = makeCtx({}, 'aws_vpn_connection', 'azure', {
      aws_service: 'aws_vpn_connection',
      azure_targets: ['azurerm_virtual_network_gateway_connection'],
    });
    const result = parametricEngine.translate(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe(
      'azurerm_virtual_network_gateway_connection',
    );
  });

  it('E4: dispatches aws_vpn_connection to GCP', () => {
    const ctx = makeCtx({}, 'aws_vpn_connection', 'gcp', {
      aws_service: 'aws_vpn_connection',
      gcp_targets: ['google_compute_vpn_tunnel'],
    });
    const result = parametricEngine.translate(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_compute_vpn_tunnel');
  });

  it('E5: dispatches aws_customer_gateway to Azure', () => {
    const ctx = makeCtx({ ip_address: '1.2.3.4' }, 'aws_customer_gateway', 'azure', {
      aws_service: 'aws_customer_gateway',
      azure_targets: ['azurerm_local_network_gateway'],
    });
    const result = parametricEngine.translate(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_local_network_gateway');
  });

  it('E6: dispatches aws_customer_gateway to GCP', () => {
    const ctx = makeCtx({ ip_address: '1.2.3.4' }, 'aws_customer_gateway', 'gcp', {
      aws_service: 'aws_customer_gateway',
      gcp_targets: ['google_compute_external_vpn_gateway'],
    });
    const result = parametricEngine.translate(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_compute_external_vpn_gateway');
  });
});
