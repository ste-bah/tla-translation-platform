/**
 * Tests for compound/apigateway-mapping.ts
 *
 * Covers:
 * - Basic Azure translation (2 resources: APIM + APIM API)
 * - Basic GCP translation (3 resources: API + Config + Gateway)
 * - APIGW_METHODS_ADVISORY always present
 * - APIGW_AUTHORIZER_ADVISORY when Lambda authorizer sibling exists
 * - APIGW_TYPE_ADVISORY for HTTP/WebSocket protocol_type
 * - COMPOUND_EXPANSION info finding
 * - Tags propagated for both providers
 * - Description propagated
 *
 * @module tests/engines/apigateway-mapping
 */

import { describe, it, expect, vi } from 'vitest';
import { translateApiGateway, apiGatewayMapper } from '../../src/engines/compound/apigateway-mapping.js';
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
    id: 'res-apigw-001',
    sourceType: 'aws_api_gateway_rest_api',
    sourceName: 'my_api',
    sourceModule: null,
    category: 'api',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: 'SER-API-GW-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-API-GW-001',
    aws_service: 'aws_api_gateway_rest_api',
    aws_family: 'api',
    azure_targets: ['azurerm_api_management', 'azurerm_api_management_api'],
    gcp_targets: ['google_api_gateway_api', 'google_api_gateway_api_config', 'google_api_gateway_gateway'],
    mapping_type: 'compound',
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

function makeCtx(overrides: Partial<TranslationContext> = {}): TranslationContext {
  const resource = overrides.resource ?? makeIrResource();
  const entry = overrides.registryEntry ?? makeRegistryEntry();
  const targetProvider = overrides.targetProvider ?? ('azure' as CloudProvider);
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
      },
    } as CanonicalIR,
    registry: makeMockRegistry(),
    options: makeCompilerOptions({ targetProvider }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Azure translation tests
// ---------------------------------------------------------------------------

describe('translateApiGateway — Azure', () => {
  it('produces 2 translated resources for a basic REST API', () => {
    const ctx = makeCtx({ targetProvider: 'azure' });
    const result = translateApiGateway(ctx);

    expect(result.translated).toHaveLength(2);
    expect(result.translated[0]!.targetType).toBe('azurerm_api_management');
    expect(result.translated[1]!.targetType).toBe('azurerm_api_management_api');
  });

  it('sets sourceName as the APIM resource name', () => {
    const resource = makeIrResource({ sourceName: 'payments_api', attributes: {} });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateApiGateway(ctx);

    expect(result.translated[0]!.targetName).toBe('payments_api');
    expect((result.translated[0]!.attributes as Record<string, unknown>)['name']).toBe('payments_api');
  });

  it('sets the APIM API targetName with _api suffix', () => {
    const resource = makeIrResource({ sourceName: 'my_api', attributes: {} });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateApiGateway(ctx);

    expect(result.translated[1]!.targetName).toBe('my_api_api');
  });

  it('propagates description to both resources', () => {
    const resource = makeIrResource({ attributes: { description: 'Payments service API' } });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateApiGateway(ctx);

    const apimAttrs = result.translated[0]!.attributes as Record<string, unknown>;
    const apiAttrs = result.translated[1]!.attributes as Record<string, unknown>;
    expect(apimAttrs['description']).toBe('Payments service API');
    expect(apiAttrs['description']).toBe('Payments service API');
  });

  it('propagates tags to APIM resource', () => {
    const resource = makeIrResource({ attributes: { tags: { Env: 'prod', Team: 'platform' } } });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateApiGateway(ctx);

    const apimAttrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(apimAttrs['tags']).toBeDefined();
  });

  it('always emits APIGW_METHODS_ADVISORY finding', () => {
    const ctx = makeCtx({ targetProvider: 'azure' });
    const result = translateApiGateway(ctx);

    const codes = result.findings.map(f => f.code);
    expect(codes).toContain('APIGW_METHODS_ADVISORY');
  });

  it('always emits COMPOUND_EXPANSION info finding', () => {
    const ctx = makeCtx({ targetProvider: 'azure' });
    const result = translateApiGateway(ctx);

    const info = result.findings.find(f => f.code === 'COMPOUND_EXPANSION');
    expect(info).toBeDefined();
    expect(info!.severity).toBe('info');
    expect(info!.message).toContain('2 azure resources');
  });

  it('does NOT emit APIGW_AUTHORIZER_ADVISORY without Lambda authorizer sibling', () => {
    const ctx = makeCtx({ targetProvider: 'azure' });
    const result = translateApiGateway(ctx);

    const codes = result.findings.map(f => f.code);
    expect(codes).not.toContain('APIGW_AUTHORIZER_ADVISORY');
  });

  it('emits APIGW_AUTHORIZER_ADVISORY when aws_api_gateway_authorizer sibling exists', () => {
    const resource = makeIrResource();
    const authorizerSibling = makeIrResource({
      id: 'res-auth-001',
      sourceType: 'aws_api_gateway_authorizer',
      sourceName: 'my_authorizer',
    });
    const ctx = makeCtx({
      resource,
      targetProvider: 'azure',
      siblingResources: [authorizerSibling],
    });
    const result = translateApiGateway(ctx);

    const codes = result.findings.map(f => f.code);
    expect(codes).toContain('APIGW_AUTHORIZER_ADVISORY');
  });

  it('does NOT emit APIGW_TYPE_ADVISORY for REST API (no protocol_type)', () => {
    const ctx = makeCtx({ targetProvider: 'azure' });
    const result = translateApiGateway(ctx);

    const codes = result.findings.map(f => f.code);
    expect(codes).not.toContain('APIGW_TYPE_ADVISORY');
  });

  it('emits APIGW_TYPE_ADVISORY when protocol_type is HTTP', () => {
    const resource = makeIrResource({ attributes: { protocol_type: 'HTTP' } });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateApiGateway(ctx);

    const codes = result.findings.map(f => f.code);
    expect(codes).toContain('APIGW_TYPE_ADVISORY');
  });

  it('emits APIGW_TYPE_ADVISORY when protocol_type is WEBSOCKET', () => {
    const resource = makeIrResource({ attributes: { protocol_type: 'WEBSOCKET' } });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateApiGateway(ctx);

    const codes = result.findings.map(f => f.code);
    expect(codes).toContain('APIGW_TYPE_ADVISORY');
  });

  it('APIM resource includes publisher_email and publisher_name placeholders', () => {
    const ctx = makeCtx({ targetProvider: 'azure' });
    const result = translateApiGateway(ctx);
    const apimAttrs = result.translated[0]!.attributes as Record<string, unknown>;

    expect(apimAttrs['publisher_email']).toContain('apim_publisher_email');
    expect(apimAttrs['publisher_name']).toContain('apim_publisher_name');
  });

  it('APIM API resource references the APIM instance via interpolation', () => {
    const resource = makeIrResource({ sourceName: 'my_api' });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateApiGateway(ctx);
    const apiAttrs = result.translated[1]!.attributes as Record<string, unknown>;

    expect(apiAttrs['api_management_name']).toContain('azurerm_api_management.my_api.name');
  });

  it('sets sourceId on all translated resources', () => {
    const resource = makeIrResource({ id: 'res-apigw-xyz' });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateApiGateway(ctx);

    for (const t of result.translated) {
      expect(t.sourceId).toBe('res-apigw-xyz');
    }
  });
});

// ---------------------------------------------------------------------------
// GCP translation tests
// ---------------------------------------------------------------------------

describe('translateApiGateway — GCP', () => {
  it('produces 3 translated resources for a basic REST API', () => {
    const ctx = makeCtx({ targetProvider: 'gcp' });
    const result = translateApiGateway(ctx);

    expect(result.translated).toHaveLength(3);
    expect(result.translated[0]!.targetType).toBe('google_api_gateway_api');
    expect(result.translated[1]!.targetType).toBe('google_api_gateway_api_config');
    expect(result.translated[2]!.targetType).toBe('google_api_gateway_gateway');
  });

  it('names GCP resources after sourceName with appropriate suffixes', () => {
    const resource = makeIrResource({ sourceName: 'orders_api' });
    const ctx = makeCtx({ resource, targetProvider: 'gcp' });
    const result = translateApiGateway(ctx);

    expect(result.translated[0]!.targetName).toBe('orders_api');
    expect(result.translated[1]!.targetName).toBe('orders_api_config');
    expect(result.translated[2]!.targetName).toBe('orders_api_gateway');
  });

  it('config resource references the api resource via interpolation', () => {
    const resource = makeIrResource({ sourceName: 'svc_api' });
    const ctx = makeCtx({ resource, targetProvider: 'gcp' });
    const result = translateApiGateway(ctx);
    const configAttrs = result.translated[1]!.attributes as Record<string, unknown>;

    expect(configAttrs['api']).toContain('google_api_gateway_api.svc_api.api_id');
  });

  it('gateway resource references config via interpolation', () => {
    const resource = makeIrResource({ sourceName: 'svc_api' });
    const ctx = makeCtx({ resource, targetProvider: 'gcp' });
    const result = translateApiGateway(ctx);
    const gatewayAttrs = result.translated[2]!.attributes as Record<string, unknown>;

    expect(gatewayAttrs['api_config']).toContain('google_api_gateway_api_config.svc_api_config.id');
  });

  it('propagates tags as labels on GCP resources', () => {
    const resource = makeIrResource({ attributes: { tags: { Project: 'alpha' } } });
    const ctx = makeCtx({ resource, targetProvider: 'gcp' });
    const result = translateApiGateway(ctx);

    // Labels should appear on at least the api resource
    const apiAttrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(apiAttrs['labels']).toBeDefined();
  });

  it('always emits APIGW_METHODS_ADVISORY for GCP', () => {
    const ctx = makeCtx({ targetProvider: 'gcp' });
    const result = translateApiGateway(ctx);

    const codes = result.findings.map(f => f.code);
    expect(codes).toContain('APIGW_METHODS_ADVISORY');
  });

  it('emits COMPOUND_EXPANSION with 3 gcp resources message for GCP', () => {
    const ctx = makeCtx({ targetProvider: 'gcp' });
    const result = translateApiGateway(ctx);

    const info = result.findings.find(f => f.code === 'COMPOUND_EXPANSION');
    expect(info).toBeDefined();
    expect(info!.message).toContain('3 gcp resources');
  });

  it('emits APIGW_AUTHORIZER_ADVISORY when authorizer sibling exists (GCP)', () => {
    const resource = makeIrResource();
    const authorizerSibling = makeIrResource({
      id: 'res-auth-002',
      sourceType: 'aws_api_gateway_authorizer',
      sourceName: 'jwt_auth',
    });
    const ctx = makeCtx({
      resource,
      targetProvider: 'gcp',
      siblingResources: [authorizerSibling],
    });
    const result = translateApiGateway(ctx);

    const codes = result.findings.map(f => f.code);
    expect(codes).toContain('APIGW_AUTHORIZER_ADVISORY');
  });

  it('all 3 GCP resources have correct sourceId', () => {
    const resource = makeIrResource({ id: 'res-apigw-gcp' });
    const ctx = makeCtx({ resource, targetProvider: 'gcp' });
    const result = translateApiGateway(ctx);

    for (const t of result.translated) {
      expect(t.sourceId).toBe('res-apigw-gcp');
    }
  });

  it('includes project and region references in gateway resource', () => {
    const ctx = makeCtx({ targetProvider: 'gcp' });
    const result = translateApiGateway(ctx);
    const gatewayAttrs = result.translated[2]!.attributes as Record<string, unknown>;

    expect(gatewayAttrs['project']).toContain('project_id');
    expect(gatewayAttrs['region']).toContain('var.region');
  });
});

// ---------------------------------------------------------------------------
// Export alias test
// ---------------------------------------------------------------------------

describe('apiGatewayMapper export', () => {
  it('is the same function as translateApiGateway', () => {
    expect(apiGatewayMapper).toBe(translateApiGateway);
  });
});
