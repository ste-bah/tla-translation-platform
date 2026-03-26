/**
 * Tests for TASK-NET-007: PrivateLink Translation.
 *
 * Covers:
 *  - Consumer Interface Azure: azurerm_private_endpoint
 *  - Consumer Interface GCP: google_compute_address + google_compute_forwarding_rule
 *  - Gateway Endpoint Advisory (S3/DynamoDB)
 *  - Producer Advisory (aws_vpc_endpoint_service)
 *  - Cross-Account Blocker (12-digit account ID)
 *  - Edge cases: unknown sourceType, missing attrs, confidence clamping
 *
 * @generated for TASK-NET-007 (test-generator)
 */

import { describe, it, expect, vi } from 'vitest';
import { translatePrivateLink } from '../../src/engines/structural/privatelink-mapping.js';
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
    id: 'pl-001',
    sourceType: 'aws_vpc_endpoint',
    sourceName: 'my_endpoint',
    sourceModule: null,
    category: 'networking',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: 'SER-NET-PL-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-NET-PL-001',
    aws_service: 'aws_vpc_endpoint',
    aws_family: 'networking',
    azure_targets: ['azurerm_private_endpoint'],
    gcp_targets: ['google_compute_address', 'google_compute_forwarding_rule'],
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

// ===========================================================================
// Helpers
// ===========================================================================

function findFinding(findings: { code: string }[], code: string) {
  return findings.find((f) => f.code === code);
}

function hasFinding(findings: { code: string }[], code: string): boolean {
  return findings.some((f) => f.code === code);
}

// ===========================================================================
// Consumer Interface — Azure
// ===========================================================================

describe('translatePrivateLink — Consumer Interface Azure', () => {
  const baseAttrs = {
    vpc_endpoint_type: 'Interface',
    service_name: 'com.amazonaws.us-east-1.s3',
    vpc_id: 'vpc-abc',
    subnet_ids: ['subnet-1'],
    tags: { Name: 'my-endpoint', env: 'prod' },
  };

  function makeAzureCtx(attrOverrides: Record<string, unknown> = {}): TranslationContext {
    return makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        sourceType: 'aws_vpc_endpoint',
        attributes: { ...baseAttrs, ...attrOverrides },
      }),
    });
  }

  it('should produce exactly 1 azurerm_private_endpoint resource', () => {
    const result = translatePrivateLink(makeAzureCtx());
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0].targetType).toBe('azurerm_private_endpoint');
  });

  it('should include private_service_connection block', () => {
    const result = translatePrivateLink(makeAzureCtx());
    const attrs = result.translated[0].attributes as Record<string, unknown>;
    const psc = attrs['private_service_connection'] as Record<string, unknown>;
    expect(psc).toBeDefined();
    expect(psc['name']).toBe('my_endpoint-psc');
    expect(psc['is_manual_connection']).toBe(false);
    expect(psc['private_connection_resource_id']).toBe(
      '${var.private_link_target_resource_id}',
    );
  });

  it('should emit PRIVATELINK_SERVICE_ID_MANUAL warning', () => {
    const result = translatePrivateLink(makeAzureCtx());
    const f = findFinding(result.findings, 'PRIVATELINK_SERVICE_ID_MANUAL');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
    expect(f!.message).toContain('private_connection_resource_id');
  });

  it('should emit STRUCTURAL_TOPOLOGY info finding', () => {
    const result = translatePrivateLink(makeAzureCtx());
    const f = findFinding(result.findings, 'STRUCTURAL_TOPOLOGY');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
    expect(f!.message).toContain('azurerm_private_endpoint');
  });

  it('should propagate tags', () => {
    const result = translatePrivateLink(makeAzureCtx());
    const attrs = result.translated[0].attributes as Record<string, unknown>;
    expect(attrs['tags']).toBeDefined();
  });

  it('should reference subnet from subnet_ids[0]', () => {
    const result = translatePrivateLink(makeAzureCtx());
    const attrs = result.translated[0].attributes as Record<string, unknown>;
    expect(attrs['subnet_id']).toContain('subnet-1');
  });

  it('should fallback to VPC-based placeholder subnet when subnet_ids is empty', () => {
    const result = translatePrivateLink(makeAzureCtx({ subnet_ids: [] }));
    const attrs = result.translated[0].attributes as Record<string, unknown>;
    expect(attrs['subnet_id']).toContain('vpc-abc_default');
  });

  it('should emit DNS zone advisory when private_dns_enabled is true', () => {
    const result = translatePrivateLink(makeAzureCtx({ private_dns_enabled: true }));
    const f = findFinding(result.findings, 'PRIVATELINK_DNS_ZONE_MANUAL');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
    expect(f!.message).toContain('Azure private DNS zone');
  });

  it('should NOT emit DNS zone advisory when private_dns_enabled is false', () => {
    const result = translatePrivateLink(makeAzureCtx({ private_dns_enabled: false }));
    expect(hasFinding(result.findings, 'PRIVATELINK_DNS_ZONE_MANUAL')).toBe(false);
  });
});

// ===========================================================================
// Consumer Interface — GCP
// ===========================================================================

describe('translatePrivateLink — Consumer Interface GCP', () => {
  const baseAttrs = {
    vpc_endpoint_type: 'Interface',
    service_name: 'com.amazonaws.us-east-1.s3',
    vpc_id: 'vpc-abc',
    subnet_ids: ['subnet-1'],
    tags: { Name: 'my-endpoint', env: 'prod' },
  };

  function makeGcpCtx(attrOverrides: Record<string, unknown> = {}): TranslationContext {
    return makeTranslationContext({
      targetProvider: 'gcp' as CloudProvider,
      resource: makeIrResource({
        sourceType: 'aws_vpc_endpoint',
        attributes: { ...baseAttrs, ...attrOverrides },
      }),
    });
  }

  it('should produce exactly 2 GCP resources (address + forwarding_rule)', () => {
    const result = translatePrivateLink(makeGcpCtx());
    expect(result.translated).toHaveLength(2);
    const types = result.translated.map((r) => r.targetType);
    expect(types).toContain('google_compute_address');
    expect(types).toContain('google_compute_forwarding_rule');
  });

  it('should set load_balancing_scheme to empty string on forwarding rule', () => {
    const result = translatePrivateLink(makeGcpCtx());
    const fwd = result.translated.find(
      (r) => r.targetType === 'google_compute_forwarding_rule',
    )!;
    expect((fwd.attributes as Record<string, unknown>)['load_balancing_scheme']).toBe('');
  });

  it('should set address purpose to GCE_ENDPOINT', () => {
    const result = translatePrivateLink(makeGcpCtx());
    const addr = result.translated.find(
      (r) => r.targetType === 'google_compute_address',
    )!;
    expect((addr.attributes as Record<string, unknown>)['purpose']).toBe('GCE_ENDPOINT');
  });

  it('should set address_type to INTERNAL', () => {
    const result = translatePrivateLink(makeGcpCtx());
    const addr = result.translated.find(
      (r) => r.targetType === 'google_compute_address',
    )!;
    expect((addr.attributes as Record<string, unknown>)['address_type']).toBe('INTERNAL');
  });

  it('should emit PRIVATELINK_PSC_TARGET_MANUAL warning', () => {
    const result = translatePrivateLink(makeGcpCtx());
    const f = findFinding(result.findings, 'PRIVATELINK_PSC_TARGET_MANUAL');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
    expect(f!.message).toContain('target must be set');
  });

  it('should emit STRUCTURAL_TOPOLOGY info with 2 gcp resources', () => {
    const result = translatePrivateLink(makeGcpCtx());
    const f = findFinding(result.findings, 'STRUCTURAL_TOPOLOGY');
    expect(f).toBeDefined();
    expect(f!.message).toContain('2 gcp resources');
  });

  it('should propagate labels on compute_address', () => {
    const result = translatePrivateLink(makeGcpCtx());
    const addr = result.translated.find(
      (r) => r.targetType === 'google_compute_address',
    )!;
    expect((addr.attributes as Record<string, unknown>)['labels']).toBeDefined();
  });

  it('should reference network and subnet on forwarding rule', () => {
    const result = translatePrivateLink(makeGcpCtx());
    const fwd = result.translated.find(
      (r) => r.targetType === 'google_compute_forwarding_rule',
    )!;
    const attrs = fwd.attributes as Record<string, unknown>;
    expect(attrs['network']).toContain('vpc-abc');
  });

  it('should reference subnetwork from subnet_ids[0] on address', () => {
    const result = translatePrivateLink(makeGcpCtx());
    const addr = result.translated.find(
      (r) => r.targetType === 'google_compute_address',
    )!;
    expect((addr.attributes as Record<string, unknown>)['subnetwork']).toContain('subnet-1');
  });

  it('should emit DNS advisory when private_dns_enabled is true', () => {
    const result = translatePrivateLink(makeGcpCtx({ private_dns_enabled: true }));
    const f = findFinding(result.findings, 'PRIVATELINK_DNS_ZONE_MANUAL');
    expect(f).toBeDefined();
    expect(f!.message).toContain('GCP private DNS zone');
  });

  it('should NOT emit DNS advisory when private_dns_enabled is absent', () => {
    const result = translatePrivateLink(makeGcpCtx({ private_dns_enabled: undefined }));
    expect(hasFinding(result.findings, 'PRIVATELINK_DNS_ZONE_MANUAL')).toBe(false);
  });
});

// ===========================================================================
// Gateway Endpoint Advisory
// ===========================================================================

describe('translatePrivateLink — Gateway Endpoint Advisory', () => {
  function makeGatewayCtx(
    provider: CloudProvider,
    serviceName?: string,
  ): TranslationContext {
    return makeTranslationContext({
      targetProvider: provider,
      resource: makeIrResource({
        sourceType: 'aws_vpc_endpoint',
        attributes: {
          vpc_endpoint_type: 'Gateway',
          service_name: serviceName ?? 'com.amazonaws.us-east-1.s3',
          vpc_id: 'vpc-abc',
        },
      }),
    });
  }

  it('should produce empty translated array for Gateway type', () => {
    const result = translatePrivateLink(makeGatewayCtx('azure'));
    expect(result.translated).toHaveLength(0);
  });

  it('should emit PRIVATELINK_GATEWAY_ADVISORY warning', () => {
    const result = translatePrivateLink(makeGatewayCtx('azure'));
    const f = findFinding(result.findings, 'PRIVATELINK_GATEWAY_ADVISORY');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  it('should include Azure-specific migration steps for Azure provider', () => {
    const result = translatePrivateLink(makeGatewayCtx('azure'));
    const f = findFinding(result.findings, 'PRIVATELINK_GATEWAY_ADVISORY');
    expect(f).toBeDefined();
    expect(f!.message).toContain('Azure');
  });

  it('should include GCP-specific migration steps for GCP provider', () => {
    const result = translatePrivateLink(makeGatewayCtx('gcp'));
    const f = findFinding(result.findings, 'PRIVATELINK_GATEWAY_ADVISORY');
    expect(f).toBeDefined();
    expect(f!.message).toContain('GCP');
  });

  it('should detect S3 service name in advisory detail', () => {
    const result = translatePrivateLink(
      makeGatewayCtx('azure', 'com.amazonaws.us-east-1.s3'),
    );
    const f = findFinding(result.findings, 'PRIVATELINK_GATEWAY_ADVISORY');
    expect(f!.message).toContain('s3');
  });
});

// ===========================================================================
// Producer Advisory
// ===========================================================================

describe('translatePrivateLink — Producer Advisory', () => {
  function makeProducerCtx(provider: CloudProvider): TranslationContext {
    return makeTranslationContext({
      targetProvider: provider,
      resource: makeIrResource({
        sourceType: 'aws_vpc_endpoint_service',
        sourceName: 'my_service',
        attributes: {
          acceptance_required: true,
          network_load_balancer_arns: ['arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/net/my-nlb/abc'],
          tags: { Name: 'my-service' },
        },
      }),
    });
  }

  it('should produce empty translated array for producer', () => {
    const result = translatePrivateLink(makeProducerCtx('azure'));
    expect(result.translated).toHaveLength(0);
  });

  it('should emit PRIVATELINK_PRODUCER_ADVISORY warning', () => {
    const result = translatePrivateLink(makeProducerCtx('azure'));
    const f = findFinding(result.findings, 'PRIVATELINK_PRODUCER_ADVISORY');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  it('should include Azure PLS migration steps for Azure', () => {
    const result = translatePrivateLink(makeProducerCtx('azure'));
    const f = findFinding(result.findings, 'PRIVATELINK_PRODUCER_ADVISORY');
    expect(f!.message).toContain('Azure');
  });

  it('should include GCP Service Attachment steps for GCP', () => {
    const result = translatePrivateLink(makeProducerCtx('gcp'));
    const f = findFinding(result.findings, 'PRIVATELINK_PRODUCER_ADVISORY');
    expect(f!.message).toContain('GCP');
  });
});

// ===========================================================================
// Cross-Account Blocker
// ===========================================================================

describe('translatePrivateLink — Cross-Account Blocker', () => {
  function makeCrossAccountCtx(serviceName: string): TranslationContext {
    return makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        sourceType: 'aws_vpc_endpoint',
        attributes: {
          vpc_endpoint_type: 'Interface',
          service_name: serviceName,
          vpc_id: 'vpc-abc',
          subnet_ids: ['subnet-1'],
        },
      }),
    });
  }

  it('should block when service_name contains a 12-digit account ID', () => {
    const result = translatePrivateLink(
      makeCrossAccountCtx('com.amazonaws.vpce.us-east-1.vpce-svc-123456789012'),
    );
    expect(result.translated).toHaveLength(0);
    const f = findFinding(result.findings, 'PRIVATELINK_CROSS_ACCOUNT_BLOCKER');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('blocker');
  });

  it('should NOT block when service_name has no 12-digit account ID', () => {
    const result = translatePrivateLink(
      makeCrossAccountCtx('com.amazonaws.us-east-1.s3'),
    );
    expect(result.translated.length).toBeGreaterThan(0);
    expect(hasFinding(result.findings, 'PRIVATELINK_CROSS_ACCOUNT_BLOCKER')).toBe(false);
  });

  it('should include migration steps in the blocker detail', () => {
    const result = translatePrivateLink(
      makeCrossAccountCtx('com.amazonaws.vpce.us-east-1.vpce-svc-123456789012'),
    );
    const f = findFinding(result.findings, 'PRIVATELINK_CROSS_ACCOUNT_BLOCKER');
    expect(f).toBeDefined();
    const parsed = JSON.parse(f!.detail!);
    expect(parsed.migrationSteps).toBeDefined();
    expect(parsed.migrationSteps.length).toBeGreaterThan(0);
  });

  it('should include the AWS service name in blocker detail', () => {
    const svcName = 'com.amazonaws.vpce.us-east-1.vpce-svc-123456789012';
    const result = translatePrivateLink(makeCrossAccountCtx(svcName));
    const f = findFinding(result.findings, 'PRIVATELINK_CROSS_ACCOUNT_BLOCKER');
    const parsed = JSON.parse(f!.detail!);
    expect(parsed.awsServiceName).toBe(svcName);
  });
});

// ===========================================================================
// Edge Cases
// ===========================================================================

describe('translatePrivateLink — Edge Cases', () => {
  it('should emit PRIVATELINK_UNKNOWN_SOURCE_TYPE for unknown sourceType', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({
        sourceType: 'aws_unknown_resource' as any,
        attributes: {},
      }),
    });
    const result = translatePrivateLink(ctx);
    expect(result.translated).toHaveLength(0);
    const f = findFinding(result.findings, 'PRIVATELINK_UNKNOWN_SOURCE_TYPE');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  it('should default to Interface when vpc_endpoint_type is missing', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        sourceType: 'aws_vpc_endpoint',
        attributes: {
          service_name: 'com.amazonaws.us-east-1.s3',
          vpc_id: 'vpc-abc',
        },
      }),
    });
    const result = translatePrivateLink(ctx);
    // Missing vpc_endpoint_type should NOT be treated as Gateway;
    // it falls through to consumer (Interface) path
    expect(result.translated.length).toBeGreaterThan(0);
    expect(result.translated[0].targetType).toBe('azurerm_private_endpoint');
  });

  it('should handle empty attributes safely', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        sourceType: 'aws_vpc_endpoint',
        attributes: {},
      }),
    });
    const result = translatePrivateLink(ctx);
    // Should not throw and should produce a result
    expect(result.translated.length).toBeGreaterThanOrEqual(0);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it('should clamp confidence to [0.45, 0.60] range', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        sourceType: 'aws_vpc_endpoint',
        attributes: {
          vpc_endpoint_type: 'Interface',
          service_name: 'com.amazonaws.us-east-1.execute-api',
          vpc_id: 'vpc-abc',
          subnet_ids: ['subnet-1'],
        },
      }),
      registryEntry: makeRegistryEntry({ confidence: 0.95 }),
    });
    const result = translatePrivateLink(ctx);
    expect(result.translated.length).toBeGreaterThan(0);
    const conf = result.translated[0].traceability.confidence;
    expect(conf).toBeGreaterThanOrEqual(0.45);
    expect(conf).toBeLessThanOrEqual(0.60);
  });

  it('should clamp low confidence up to 0.45', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp' as CloudProvider,
      resource: makeIrResource({
        sourceType: 'aws_vpc_endpoint',
        attributes: {
          vpc_endpoint_type: 'Interface',
          service_name: 'com.amazonaws.us-east-1.execute-api',
          vpc_id: 'vpc-abc',
          subnet_ids: ['subnet-1'],
        },
      }),
      registryEntry: makeRegistryEntry({ confidence: 0.10 }),
    });
    const result = translatePrivateLink(ctx);
    const conf = result.translated[0].traceability.confidence;
    expect(conf).toBeGreaterThanOrEqual(0.45);
  });

  it('should set traceability mappingType to structural', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        sourceType: 'aws_vpc_endpoint',
        attributes: {
          vpc_endpoint_type: 'Interface',
          service_name: 'com.amazonaws.us-east-1.execute-api',
          vpc_id: 'vpc-abc',
          subnet_ids: ['subnet-1'],
        },
      }),
    });
    const result = translatePrivateLink(ctx);
    expect(result.translated[0].traceability.mappingType).toBe('structural');
  });

  it('should use "main" as fallback vpc_id when vpc_id is empty', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp' as CloudProvider,
      resource: makeIrResource({
        sourceType: 'aws_vpc_endpoint',
        attributes: {
          vpc_endpoint_type: 'Interface',
          service_name: 'com.amazonaws.us-east-1.execute-api',
          vpc_id: '',
          subnet_ids: [],
        },
      }),
    });
    const result = translatePrivateLink(ctx);
    const fwd = result.translated.find(
      (r) => r.targetType === 'google_compute_forwarding_rule',
    )!;
    expect((fwd.attributes as Record<string, unknown>)['network']).toContain('main');
  });

  it('should not include tags/labels when tags attribute is absent', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        sourceType: 'aws_vpc_endpoint',
        attributes: {
          vpc_endpoint_type: 'Interface',
          service_name: 'com.amazonaws.us-east-1.execute-api',
          vpc_id: 'vpc-abc',
          subnet_ids: ['subnet-1'],
        },
      }),
    });
    const result = translatePrivateLink(ctx);
    const attrs = result.translated[0].attributes as Record<string, unknown>;
    expect(attrs['tags']).toBeUndefined();
  });

  it('should set sourceId on translated resources', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        id: 'res-custom-id',
        sourceType: 'aws_vpc_endpoint',
        attributes: {
          vpc_endpoint_type: 'Interface',
          service_name: 'com.amazonaws.us-east-1.execute-api',
          vpc_id: 'vpc-abc',
          subnet_ids: ['subnet-1'],
        },
      }),
    });
    const result = translatePrivateLink(ctx);
    expect(result.translated[0].sourceId).toBe('res-custom-id');
  });
});

// ===========================================================================
// GCP forwarding rule details
// ===========================================================================

describe('translatePrivateLink — GCP Forwarding Rule Details', () => {
  function makeGcpInterfaceCtx(
    attrOverrides: Record<string, unknown> = {},
  ): TranslationContext {
    return makeTranslationContext({
      targetProvider: 'gcp' as CloudProvider,
      resource: makeIrResource({
        sourceType: 'aws_vpc_endpoint',
        attributes: {
          vpc_endpoint_type: 'Interface',
          service_name: 'com.amazonaws.us-east-1.execute-api',
          vpc_id: 'vpc-main',
          subnet_ids: ['sub-a'],
          ...attrOverrides,
        },
      }),
    });
  }

  it('should set forwarding rule target to PSC placeholder', () => {
    const result = translatePrivateLink(makeGcpInterfaceCtx());
    const fwd = result.translated.find(
      (r) => r.targetType === 'google_compute_forwarding_rule',
    )!;
    expect((fwd.attributes as Record<string, unknown>)['target']).toBe(
      '${var.psc_target_service_attachment}',
    );
  });

  it('should reference the address self_link in forwarding rule ip_address', () => {
    const result = translatePrivateLink(makeGcpInterfaceCtx());
    const fwd = result.translated.find(
      (r) => r.targetType === 'google_compute_forwarding_rule',
    )!;
    const ipAddr = (fwd.attributes as Record<string, unknown>)['ip_address'] as string;
    expect(ipAddr).toContain('google_compute_address');
    expect(ipAddr).toContain('psc_addr');
  });

  it('should set region on both address and forwarding rule', () => {
    const result = translatePrivateLink(makeGcpInterfaceCtx());
    for (const res of result.translated) {
      expect((res.attributes as Record<string, unknown>)['region']).toBeDefined();
    }
  });
});

// ===========================================================================
// Azure naming
// ===========================================================================

describe('translatePrivateLink — Azure Naming', () => {
  it('should append -pe suffix to endpoint name', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        sourceName: 'my_cool_endpoint',
        sourceType: 'aws_vpc_endpoint',
        attributes: {
          vpc_endpoint_type: 'Interface',
          service_name: 'com.amazonaws.us-east-1.execute-api',
          vpc_id: 'vpc-abc',
          subnet_ids: ['subnet-1'],
        },
      }),
    });
    const result = translatePrivateLink(ctx);
    const attrs = result.translated[0].attributes as Record<string, unknown>;
    expect(attrs['name']).toBe('my_cool_endpoint-pe');
  });

  it('should set targetName with _pe suffix', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        sourceName: 'my_cool_endpoint',
        sourceType: 'aws_vpc_endpoint',
        attributes: {
          vpc_endpoint_type: 'Interface',
          service_name: 'com.amazonaws.us-east-1.execute-api',
          vpc_id: 'vpc-abc',
          subnet_ids: ['subnet-1'],
        },
      }),
    });
    const result = translatePrivateLink(ctx);
    expect(result.translated[0].targetName).toBe('my_cool_endpoint_pe');
  });
});
