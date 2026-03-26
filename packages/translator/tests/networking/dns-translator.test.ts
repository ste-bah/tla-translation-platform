import { describe, it, expect, vi } from 'vitest';
import { translateDns } from '../../src/engines/structural/dns-mapping.js';
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
// Factory helpers (adapted from structural-engine.test.ts)
// ===========================================================================

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'res-001',
    sourceType: 'aws_route53_zone',
    sourceName: 'my_zone',
    sourceModule: null,
    category: 'networking',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: 'SER-NET-DNS-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-NET-DNS-001',
    aws_service: 'aws_route53_zone',
    aws_family: 'networking',
    azure_targets: ['azurerm_dns_zone'],
    gcp_targets: ['google_dns_managed_zone'],
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

/** Build a zone context for the given provider and attributes. */
function makeZoneCtx(
  provider: 'azure' | 'gcp',
  attrs: Record<string, unknown> = {},
  sourceName = 'my_zone',
): TranslationContext {
  const resource = makeIrResource({
    sourceType: 'aws_route53_zone',
    sourceName,
    attributes: attrs,
  });
  return makeTranslationContext({
    targetProvider: provider as CloudProvider,
    resource,
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
  });
}

/** Build a record context for the given provider with optional parent zone in IR. */
function makeRecordCtx(
  provider: 'azure' | 'gcp',
  attrs: Record<string, unknown> = {},
  sourceName = 'my_record',
  irResources?: IrResource[],
): TranslationContext {
  const resource = makeIrResource({
    id: 'rec-001',
    sourceType: 'aws_route53_record',
    sourceName,
    attributes: attrs,
  });
  const allResources = irResources ? [resource, ...irResources] : [resource];
  return makeTranslationContext({
    targetProvider: provider as CloudProvider,
    resource,
    ir: {
      version: '1.0.0',
      sourceProvider: 'aws',
      resources: allResources,
      relationships: [],
      modules: [],
      intents: [],
      metadata: {
        generatedAt: new Date().toISOString(),
        sourceFiles: ['main.tf'],
        toolVersion: '0.1.0',
        resourceCount: allResources.length,
        relationshipCount: 0,
      },
    } as CanonicalIR,
  });
}

// ===========================================================================
// Zone translation tests - Azure
// ===========================================================================

describe('translateDns — Zone (Azure)', () => {
  it('should translate public zone to azurerm_dns_zone', () => {
    const ctx = makeZoneCtx('azure', { name: 'example.com' });
    const result = translateDns(ctx);

    expect(result.translated).toHaveLength(1);
    expect(result.translated[0].targetType).toBe('azurerm_dns_zone');
    expect(result.translated[0].attributes['name']).toBe('example.com');
    expect(result.translated[0].attributes['resource_group_name']).toBe(
      '${azurerm_resource_group.main.name}',
    );
  });

  it('should translate private zone to azurerm_private_dns_zone + VNet link', () => {
    const ctx = makeZoneCtx('azure', {
      name: 'internal.example.com',
      vpc: { vpc_id: 'vpc-123' },
    });
    const result = translateDns(ctx);

    expect(result.translated).toHaveLength(2);
    expect(result.translated[0].targetType).toBe('azurerm_private_dns_zone');
    expect(result.translated[0].attributes['name']).toBe('internal.example.com');

    expect(result.translated[1].targetType).toBe(
      'azurerm_private_dns_zone_virtual_network_link',
    );
    expect(result.translated[1].attributes['name']).toBe('my_zone-vnet-link');
    expect(result.translated[1].attributes['virtual_network_id']).toBe(
      '${azurerm_virtual_network.main.id}',
    );
  });

  it('should apply tags to public zone', () => {
    const ctx = makeZoneCtx('azure', {
      name: 'example.com',
      tags: { env: 'prod', team: 'infra' },
    });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['tags']).toBeDefined();
  });

  it('should apply tags to both private zone and VNet link', () => {
    const ctx = makeZoneCtx('azure', {
      name: 'internal.example.com',
      vpc: { vpc_id: 'vpc-123' },
      tags: { env: 'staging' },
    });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['tags']).toBeDefined();
    expect(result.translated[1].attributes['tags']).toBeDefined();
  });

  it('should emit STRUCTURAL_TOPOLOGY finding for public zone', () => {
    const ctx = makeZoneCtx('azure', { name: 'example.com' });
    const result = translateDns(ctx);

    const topo = findFinding(result.findings, 'STRUCTURAL_TOPOLOGY');
    expect(topo).toBeDefined();
    expect(topo!.message).toContain('public');
    expect(topo!.message).toContain('azurerm_dns_zone');
  });

  it('should emit STRUCTURAL_TOPOLOGY finding for private zone', () => {
    const ctx = makeZoneCtx('azure', {
      name: 'internal.example.com',
      vpc: { vpc_id: 'vpc-123' },
    });
    const result = translateDns(ctx);

    const topo = findFinding(result.findings, 'STRUCTURAL_TOPOLOGY');
    expect(topo).toBeDefined();
    expect(topo!.message).toContain('private');
    expect(topo!.message).toContain('azurerm_private_dns_zone');
    expect(topo!.message).toContain('azurerm_private_dns_zone_virtual_network_link');
  });

  it('should fallback to sourceName when name attribute missing', () => {
    const ctx = makeZoneCtx('azure', {}, 'fallback_zone');
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['name']).toBe('fallback_zone');
  });

  it('should set traceability with structural/dns and mappingType structural', () => {
    const ctx = makeZoneCtx('azure', { name: 'example.com' });
    const result = translateDns(ctx);

    expect(result.translated[0].traceability).toBeDefined();
    expect(result.translated[0].traceability.engineUsed).toBe('structural/dns');
    expect(result.translated[0].traceability.mappingType).toBe('structural');
  });
});

// ===========================================================================
// Zone translation tests - GCP
// ===========================================================================

describe('translateDns — Zone (GCP)', () => {
  it('should translate public zone to google_dns_managed_zone', () => {
    const ctx = makeZoneCtx('gcp', { name: 'example.com' });
    const result = translateDns(ctx);

    expect(result.translated).toHaveLength(1);
    expect(result.translated[0].targetType).toBe('google_dns_managed_zone');
    expect(result.translated[0].attributes['dns_name']).toBe('example.com.');
  });

  it('should not set visibility for public zone', () => {
    const ctx = makeZoneCtx('gcp', { name: 'example.com' });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['visibility']).toBeUndefined();
    expect(result.translated[0].attributes['private_visibility_config']).toBeUndefined();
  });

  it('should translate private zone with visibility:private and private_visibility_config', () => {
    const ctx = makeZoneCtx('gcp', {
      name: 'internal.example.com',
      vpc: { vpc_id: 'vpc-123' },
    });
    const result = translateDns(ctx);

    expect(result.translated).toHaveLength(1);
    expect(result.translated[0].targetType).toBe('google_dns_managed_zone');
    expect(result.translated[0].attributes['visibility']).toBe('private');
    expect(result.translated[0].attributes['private_visibility_config']).toEqual({
      networks: [{ network_url: '${google_compute_network.main.id}' }],
    });
  });

  it('should append trailing dot to dns_name if not present', () => {
    const ctx = makeZoneCtx('gcp', { name: 'example.com' });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['dns_name']).toBe('example.com.');
  });

  it('should not double trailing dot if already present', () => {
    const ctx = makeZoneCtx('gcp', { name: 'example.com.' });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['dns_name']).toBe('example.com.');
  });

  it('should sanitize zone name to lowercase alphanumeric with dashes', () => {
    const ctx = makeZoneCtx('gcp', { name: 'example.com' }, 'My_Zone.Name');
    const result = translateDns(ctx);

    const gcpName = result.translated[0].attributes['name'] as string;
    expect(gcpName).toBe('my-zone-name');
    expect(gcpName).toMatch(/^[a-z0-9-]+$/);
  });

  it('should use comment as description, or empty string if missing', () => {
    const ctxWithComment = makeZoneCtx('gcp', { name: 'a.com', comment: 'My zone' });
    const ctxNoComment = makeZoneCtx('gcp', { name: 'a.com' });

    expect(translateDns(ctxWithComment).translated[0].attributes['description']).toBe('My zone');
    expect(translateDns(ctxNoComment).translated[0].attributes['description']).toBe('');
  });

  it('should apply labels from tags', () => {
    const ctx = makeZoneCtx('gcp', {
      name: 'example.com',
      tags: { env: 'prod' },
    });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['labels']).toBeDefined();
  });

  it('should emit STRUCTURAL_TOPOLOGY for public GCP zone', () => {
    const ctx = makeZoneCtx('gcp', { name: 'example.com' });
    const result = translateDns(ctx);

    const topo = findFinding(result.findings, 'STRUCTURAL_TOPOLOGY');
    expect(topo).toBeDefined();
    expect(topo!.message).toContain('public');
    expect(topo!.message).toContain('google_dns_managed_zone');
  });

  it('should emit STRUCTURAL_TOPOLOGY for private GCP zone', () => {
    const ctx = makeZoneCtx('gcp', {
      name: 'internal.example.com',
      vpc: { vpc_id: 'vpc-123' },
    });
    const result = translateDns(ctx);

    const topo = findFinding(result.findings, 'STRUCTURAL_TOPOLOGY');
    expect(topo).toBeDefined();
    expect(topo!.message).toContain('private');
    expect(topo!.message).toContain('private_visibility_config');
  });
});

// ===========================================================================
// Record translation tests - Azure
// ===========================================================================

describe('translateDns — Record (Azure)', () => {
  it('should translate A record to azurerm_dns_a_record', () => {
    const ctx = makeRecordCtx('azure', {
      type: 'A',
      name: 'www',
      ttl: 300,
      records: ['1.2.3.4'],
    });
    const result = translateDns(ctx);

    expect(result.translated).toHaveLength(1);
    expect(result.translated[0].targetType).toBe('azurerm_dns_a_record');
    expect(result.translated[0].attributes['name']).toBe('www');
    expect(result.translated[0].attributes['ttl']).toBe(300);
    expect(result.translated[0].attributes['records']).toEqual(['1.2.3.4']);
  });

  it('should translate CNAME record to azurerm_dns_cname_record', () => {
    const ctx = makeRecordCtx('azure', {
      type: 'CNAME',
      name: 'mail',
      ttl: 600,
      records: ['mail.example.com'],
    });
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toBe('azurerm_dns_cname_record');
  });

  it('should translate MX record to azurerm_dns_mx_record', () => {
    const ctx = makeRecordCtx('azure', {
      type: 'MX',
      name: '@',
      records: ['10 mx.example.com'],
    });
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toBe('azurerm_dns_mx_record');
  });

  it('should translate AAAA record to azurerm_dns_aaaa_record', () => {
    const ctx = makeRecordCtx('azure', {
      type: 'AAAA',
      name: 'ipv6',
      records: ['::1'],
    });
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toBe('azurerm_dns_aaaa_record');
  });

  it('should translate TXT record to azurerm_dns_txt_record', () => {
    const ctx = makeRecordCtx('azure', {
      type: 'TXT',
      name: '_dmarc',
      records: ['v=DMARC1; p=none'],
    });
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toBe('azurerm_dns_txt_record');
  });

  it('should translate NS record to azurerm_dns_ns_record', () => {
    const ctx = makeRecordCtx('azure', {
      type: 'NS',
      name: 'sub',
      records: ['ns1.example.com'],
    });
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toBe('azurerm_dns_ns_record');
  });

  it('should translate PTR record to azurerm_dns_ptr_record', () => {
    const ctx = makeRecordCtx('azure', {
      type: 'PTR',
      name: '4',
      records: ['host.example.com'],
    });
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toBe('azurerm_dns_ptr_record');
  });

  it('should translate SRV record to azurerm_dns_srv_record', () => {
    const ctx = makeRecordCtx('azure', {
      type: 'SRV',
      name: '_sip._tcp',
      records: ['10 5 5060 sip.example.com'],
    });
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toBe('azurerm_dns_srv_record');
  });

  it('should translate CAA record to azurerm_dns_caa_record', () => {
    const ctx = makeRecordCtx('azure', {
      type: 'CAA',
      name: '@',
      records: ['0 issue "letsencrypt.org"'],
    });
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toBe('azurerm_dns_caa_record');
  });

  it('should default TTL to 300 when not specified', () => {
    const ctx = makeRecordCtx('azure', { type: 'A', records: ['1.2.3.4'] });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['ttl']).toBe(300);
  });

  it('should preserve explicit TTL', () => {
    const ctx = makeRecordCtx('azure', { type: 'A', ttl: 86400, records: ['1.2.3.4'] });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['ttl']).toBe(86400);
  });

  it('should sort records alphabetically', () => {
    const ctx = makeRecordCtx('azure', {
      type: 'A',
      records: ['3.3.3.3', '1.1.1.1', '2.2.2.2'],
    });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['records']).toEqual([
      '1.1.1.1',
      '2.2.2.2',
      '3.3.3.3',
    ]);
  });

  it('should use zone_name referencing public zone by default', () => {
    const ctx = makeRecordCtx('azure', { type: 'A', records: ['1.2.3.4'] });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['zone_name']).toBe(
      '${azurerm_dns_zone.main.name}',
    );
  });

  it('should use private zone record type when parent zone is private', () => {
    const parentZone = makeIrResource({
      id: 'zone-001',
      sourceType: 'aws_route53_zone',
      sourceName: 'private_zone',
      attributes: { name: 'internal.example.com', vpc: { vpc_id: 'vpc-123' } },
    });
    const ctx = makeRecordCtx(
      'azure',
      { type: 'A', name: 'host', records: ['10.0.0.1'], zone_id: 'zone-001' },
      'my_record',
      [parentZone],
    );
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toBe('azurerm_private_dns_a_record');
    expect(result.translated[0].attributes['zone_name']).toBe(
      '${azurerm_private_dns_zone.main.name}',
    );
  });

  it('should translate alias record as CNAME with DNS_ALIAS_NOT_PORTABLE warning', () => {
    const ctx = makeRecordCtx('azure', {
      type: 'A',
      alias: { name: 'elb-123.us-east-1.elb.amazonaws.com', zone_id: 'Z1234' },
    });
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toBe('azurerm_dns_cname_record');
    expect(hasFinding(result.findings, 'DNS_ALIAS_NOT_PORTABLE')).toBe(true);
    expect(result.translated[0].attributes['record']).toBe(
      'elb-123.us-east-1.elb.amazonaws.com',
    );
  });

  it('should translate alias in private zone context as private CNAME', () => {
    const parentZone = makeIrResource({
      id: 'zone-prv',
      sourceType: 'aws_route53_zone',
      sourceName: 'prv_zone',
      attributes: { name: 'internal.example.com', vpc: { vpc_id: 'vpc-123' } },
    });
    const ctx = makeRecordCtx(
      'azure',
      {
        type: 'A',
        alias: { name: 'internal-lb.local', zone_id: 'zone-prv' },
        zone_id: 'zone-prv',
      },
      'alias_rec',
      [parentZone],
    );
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toBe('azurerm_private_dns_cname_record');
  });

  it('should default record type to A when not specified', () => {
    const ctx = makeRecordCtx('azure', { records: ['1.2.3.4'] });
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toBe('azurerm_dns_a_record');
  });

  it('should emit STRUCTURAL_TOPOLOGY finding for record', () => {
    const ctx = makeRecordCtx('azure', { type: 'CNAME', records: ['x.example.com'] });
    const result = translateDns(ctx);

    const topo = findFinding(result.findings, 'STRUCTURAL_TOPOLOGY');
    expect(topo).toBeDefined();
    expect(topo!.message).toContain('aws_route53_record');
    expect(topo!.message).toContain('CNAME');
  });
});

// ===========================================================================
// Record translation tests - GCP
// ===========================================================================

describe('translateDns — Record (GCP)', () => {
  it('should translate A record to google_dns_record_set with type A', () => {
    const ctx = makeRecordCtx('gcp', {
      type: 'A',
      name: 'www',
      ttl: 300,
      records: ['1.2.3.4'],
    });
    const result = translateDns(ctx);

    expect(result.translated).toHaveLength(1);
    expect(result.translated[0].targetType).toBe('google_dns_record_set');
    expect(result.translated[0].attributes['type']).toBe('A');
    expect(result.translated[0].attributes['name']).toBe('www');
    expect(result.translated[0].attributes['rrdatas']).toEqual(['1.2.3.4']);
  });

  it('should translate CNAME record to google_dns_record_set with type CNAME', () => {
    const ctx = makeRecordCtx('gcp', {
      type: 'CNAME',
      name: 'mail',
      records: ['mail.example.com'],
    });
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toBe('google_dns_record_set');
    expect(result.translated[0].attributes['type']).toBe('CNAME');
  });

  it('should translate MX record to google_dns_record_set with type MX', () => {
    const ctx = makeRecordCtx('gcp', {
      type: 'MX',
      name: '@',
      records: ['10 mx.example.com'],
    });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['type']).toBe('MX');
  });

  it('should default TTL to 300 when not specified', () => {
    const ctx = makeRecordCtx('gcp', { type: 'A', records: ['1.2.3.4'] });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['ttl']).toBe(300);
  });

  it('should preserve explicit TTL', () => {
    const ctx = makeRecordCtx('gcp', { type: 'A', ttl: 3600, records: ['1.2.3.4'] });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['ttl']).toBe(3600);
  });

  it('should sort rrdatas alphabetically', () => {
    const ctx = makeRecordCtx('gcp', {
      type: 'A',
      records: ['3.3.3.3', '1.1.1.1', '2.2.2.2'],
    });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['rrdatas']).toEqual([
      '1.1.1.1',
      '2.2.2.2',
      '3.3.3.3',
    ]);
  });

  it('should reference managed_zone', () => {
    const ctx = makeRecordCtx('gcp', { type: 'A', records: ['1.2.3.4'] });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['managed_zone']).toBe(
      '${google_dns_managed_zone.main.name}',
    );
  });

  it('should translate alias to CNAME with trailing dot on rrdatas', () => {
    const ctx = makeRecordCtx('gcp', {
      type: 'A',
      alias: { name: 'elb-123.us-east-1.elb.amazonaws.com', zone_id: 'Z1234' },
    });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['type']).toBe('CNAME');
    expect(result.translated[0].attributes['rrdatas']).toEqual([
      'elb-123.us-east-1.elb.amazonaws.com.',
    ]);
    expect(hasFinding(result.findings, 'DNS_ALIAS_NOT_PORTABLE')).toBe(true);
  });

  it('should not double trailing dot on alias name that already has one', () => {
    const ctx = makeRecordCtx('gcp', {
      type: 'A',
      alias: { name: 'elb-123.amazonaws.com.', zone_id: 'Z1234' },
    });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['rrdatas']).toEqual([
      'elb-123.amazonaws.com.',
    ]);
  });

  it('should default record type to A when not specified', () => {
    const ctx = makeRecordCtx('gcp', { records: ['1.2.3.4'] });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['type']).toBe('A');
  });

  it('should emit STRUCTURAL_TOPOLOGY for GCP record', () => {
    const ctx = makeRecordCtx('gcp', { type: 'MX', records: ['10 mx.example.com'] });
    const result = translateDns(ctx);

    const topo = findFinding(result.findings, 'STRUCTURAL_TOPOLOGY');
    expect(topo).toBeDefined();
    expect(topo!.message).toContain('google_dns_record_set');
    expect(topo!.message).toContain('MX');
  });

  it('should emit STRUCTURAL_TOPOLOGY with CNAME type for alias records', () => {
    const ctx = makeRecordCtx('gcp', {
      type: 'A',
      alias: { name: 'target.example.com', zone_id: 'Z1234' },
    });
    const result = translateDns(ctx);

    const topo = findFinding(result.findings, 'STRUCTURAL_TOPOLOGY');
    expect(topo).toBeDefined();
    expect(topo!.message).toContain('CNAME');
  });
});

// ===========================================================================
// Advisory / routing policy tests
// ===========================================================================

describe('translateDns — Advisory findings', () => {
  it('should emit DNS_ROUTING_POLICY_ADVISORY for weighted_routing_policy (Azure)', () => {
    const ctx = makeRecordCtx('azure', {
      type: 'A',
      records: ['1.2.3.4'],
      weighted_routing_policy: { weight: 70 },
    });
    const result = translateDns(ctx);

    const finding = findFinding(result.findings, 'DNS_ROUTING_POLICY_ADVISORY');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
    expect(finding!.message).toContain('routing policies');
  });

  it('should emit DNS_ROUTING_POLICY_ADVISORY for failover_routing_policy (Azure)', () => {
    const ctx = makeRecordCtx('azure', {
      type: 'A',
      records: ['1.2.3.4'],
      failover_routing_policy: { type: 'PRIMARY' },
    });
    const result = translateDns(ctx);

    expect(hasFinding(result.findings, 'DNS_ROUTING_POLICY_ADVISORY')).toBe(true);
  });

  it('should emit DNS_ROUTING_POLICY_ADVISORY for weighted_routing_policy (GCP)', () => {
    const ctx = makeRecordCtx('gcp', {
      type: 'A',
      records: ['1.2.3.4'],
      weighted_routing_policy: { weight: 30 },
    });
    const result = translateDns(ctx);

    expect(hasFinding(result.findings, 'DNS_ROUTING_POLICY_ADVISORY')).toBe(true);
  });

  it('should emit DNS_ROUTING_POLICY_ADVISORY for failover_routing_policy (GCP)', () => {
    const ctx = makeRecordCtx('gcp', {
      type: 'A',
      records: ['1.2.3.4'],
      failover_routing_policy: { type: 'SECONDARY' },
    });
    const result = translateDns(ctx);

    expect(hasFinding(result.findings, 'DNS_ROUTING_POLICY_ADVISORY')).toBe(true);
  });

  it('should NOT emit routing policy advisory when no routing policy present', () => {
    const ctx = makeRecordCtx('azure', { type: 'A', records: ['1.2.3.4'] });
    const result = translateDns(ctx);

    expect(hasFinding(result.findings, 'DNS_ROUTING_POLICY_ADVISORY')).toBe(false);
  });

  it('should emit DNS_ALIAS_NOT_PORTABLE for Azure alias', () => {
    const ctx = makeRecordCtx('azure', {
      type: 'A',
      alias: { name: 'target.example.com', zone_id: 'Z1234' },
    });
    const result = translateDns(ctx);

    const finding = findFinding(result.findings, 'DNS_ALIAS_NOT_PORTABLE');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
    expect(finding!.message).toContain('Azure');
  });

  it('should emit DNS_ALIAS_NOT_PORTABLE for GCP alias', () => {
    const ctx = makeRecordCtx('gcp', {
      type: 'A',
      alias: { name: 'target.example.com', zone_id: 'Z1234' },
    });
    const result = translateDns(ctx);

    const finding = findFinding(result.findings, 'DNS_ALIAS_NOT_PORTABLE');
    expect(finding).toBeDefined();
    expect(finding!.message).toContain('GCP');
  });

  it('should emit both routing policy and alias warnings together', () => {
    const ctx = makeRecordCtx('azure', {
      type: 'A',
      alias: { name: 'target.example.com', zone_id: 'Z1234' },
      weighted_routing_policy: { weight: 50 },
    });
    const result = translateDns(ctx);

    expect(hasFinding(result.findings, 'DNS_ROUTING_POLICY_ADVISORY')).toBe(true);
    expect(hasFinding(result.findings, 'DNS_ALIAS_NOT_PORTABLE')).toBe(true);
  });
});

// ===========================================================================
// Dispatch tests
// ===========================================================================

describe('translateDns — Dispatch logic', () => {
  it('should dispatch aws_route53_zone to zone translation', () => {
    const ctx = makeZoneCtx('azure', { name: 'example.com' });
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toBe('azurerm_dns_zone');
  });

  it('should dispatch aws_route53_record to record translation', () => {
    const ctx = makeRecordCtx('azure', { type: 'A', records: ['1.2.3.4'] });
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toBe('azurerm_dns_a_record');
  });

  it('should dispatch to Azure when targetProvider is azure', () => {
    const ctx = makeZoneCtx('azure', { name: 'example.com' });
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toContain('azurerm');
  });

  it('should dispatch to GCP when targetProvider is gcp', () => {
    const ctx = makeZoneCtx('gcp', { name: 'example.com' });
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toContain('google_');
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe('translateDns — Edge cases', () => {
  it('should handle empty records array', () => {
    const ctx = makeRecordCtx('azure', { type: 'A', records: [] });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['records']).toEqual([]);
  });

  it('should handle missing records attribute (no rrdatas)', () => {
    const ctx = makeRecordCtx('gcp', { type: 'A' });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['rrdatas']).toBeUndefined();
  });

  it('should handle missing name attribute — fallback to sourceName', () => {
    const ctx = makeRecordCtx('azure', { type: 'A', records: ['1.2.3.4'] }, 'fallback_name');
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['name']).toBe('fallback_name');
  });

  it('should handle alias with missing name field (empty string)', () => {
    const ctx = makeRecordCtx('azure', {
      type: 'A',
      alias: { zone_id: 'Z1234' },
    });
    const result = translateDns(ctx);

    expect(result.translated[0].attributes['record']).toBe('');
  });

  it('should detect parent zone private via zone_id containing sourceName', () => {
    const parentZone = makeIrResource({
      id: 'zone-002',
      sourceType: 'aws_route53_zone',
      sourceName: 'internal_zone',
      attributes: { name: 'internal.example.com', vpc: { vpc_id: 'vpc-456' } },
    });
    const ctx = makeRecordCtx(
      'azure',
      {
        type: 'A',
        name: 'app',
        records: ['10.0.0.5'],
        zone_id: '${aws_route53_zone.internal_zone.zone_id}',
      },
      'my_record',
      [parentZone],
    );
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toBe('azurerm_private_dns_a_record');
  });

  it('should treat zone as public when zoneId is missing', () => {
    const ctx = makeRecordCtx('azure', { type: 'A', records: ['1.2.3.4'] });
    const result = translateDns(ctx);

    expect(result.translated[0].targetType).toBe('azurerm_dns_a_record');
  });

  it('should set sourceId on translated resources', () => {
    const ctx = makeZoneCtx('azure', { name: 'example.com' });
    const result = translateDns(ctx);

    expect(result.translated[0].sourceId).toBe(ctx.resource.id);
  });

  it('should use targetName matching sourceName', () => {
    const ctx = makeZoneCtx('gcp', { name: 'example.com' }, 'custom_zone_name');
    const result = translateDns(ctx);

    expect(result.translated[0].targetName).toBe('custom_zone_name');
  });
});
