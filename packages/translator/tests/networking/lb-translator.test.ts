/**
 * Tests for TASK-NET-004: Load Balancer Translation.
 *
 * Covers:
 *  - lb-helpers: resolveListenerConfig, resolveTargetGroupConfig, detectWafAssociation,
 *                mapProtocolToAzure, mapProtocolToGcp
 *  - lb-mapping: translateLb (ALB Azure, ALB GCP, NLB Azure, NLB GCP)
 *                with and without sibling enrichment
 *
 * @generated for TASK-NET-004 (test-generator)
 */

import { describe, it, expect, vi } from 'vitest';
import { translateLb } from '../../src/engines/compound/lb-mapping.js';
import {
  resolveListenerConfig,
  resolveTargetGroupConfig,
  detectWafAssociation,
  mapProtocolToAzure,
  mapProtocolToGcp,
  LB_SSL_CERTIFICATE,
  LB_WAF_ADVISORY,
  LB_UNKNOWN_PROTOCOL,
} from '../../src/engines/compound/lb-helpers.js';
import type { TranslationContext } from '../../src/engines/mapping-engine.js';
import type {
  IrResource,
  IrRelationship,
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
    id: 'lb-001',
    sourceType: 'aws_lb',
    sourceName: 'my_alb',
    sourceModule: null,
    category: 'networking',
    attributes: { load_balancer_type: 'application' },
    sourceAttributes: {},
    registryEntryId: 'SER-NET-LB-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeListenerResource(attrs: Record<string, unknown> = {}): IrResource {
  return makeIrResource({
    id: 'listener-001',
    sourceType: 'aws_lb_listener',
    sourceName: 'my_listener',
    attributes: { port: 80, protocol: 'HTTP', ...attrs },
  });
}

function makeTargetGroupResource(attrs: Record<string, unknown> = {}): IrResource {
  return makeIrResource({
    id: 'tg-001',
    sourceType: 'aws_lb_target_group',
    sourceName: 'my_tg',
    attributes: { port: 80, protocol: 'HTTP', ...attrs },
  });
}

function makeWafResource(): IrResource {
  return makeIrResource({
    id: 'waf-001',
    sourceType: 'aws_wafv2_web_acl_association',
    sourceName: 'my_waf',
    attributes: {},
  });
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-NET-LB-001',
    aws_service: 'aws_lb',
    aws_family: 'networking',
    azure_targets: ['azurerm_application_gateway'],
    gcp_targets: ['google_compute_backend_service'],
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

function hasFinding(findings: Array<{ code: string }>, code: string): boolean {
  return findings.some((f) => f.code === code);
}

function findFinding(findings: Array<{ code: string }>, code: string) {
  return findings.find((f) => f.code === code);
}

// ===========================================================================
// lb-helpers unit tests
// ===========================================================================

describe('lb-helpers', () => {
  // -----------------------------------------------------------------------
  // resolveListenerConfig
  // -----------------------------------------------------------------------
  describe('resolveListenerConfig', () => {
    it('should return defaults when no listener sibling exists', () => {
      const ctx = makeTranslationContext({ siblingResources: [] });
      const cfg = resolveListenerConfig(ctx);
      expect(cfg.port).toBe(80);
      expect(cfg.protocol).toBe('HTTP');
      expect(cfg.sslCertificateArn).toBeUndefined();
      expect(cfg.sslPolicy).toBeUndefined();
    });

    it('should use custom defaultProtocol when no sibling exists', () => {
      const ctx = makeTranslationContext({ siblingResources: [] });
      const cfg = resolveListenerConfig(ctx, 'TCP');
      expect(cfg.protocol).toBe('TCP');
    });

    it('should extract port and protocol from listener sibling', () => {
      const listener = makeListenerResource({ port: 443, protocol: 'HTTPS' });
      const ctx = makeTranslationContext({ siblingResources: [listener] });
      const cfg = resolveListenerConfig(ctx);
      expect(cfg.port).toBe(443);
      expect(cfg.protocol).toBe('HTTPS');
    });

    it('should extract sslCertificateArn from listener sibling', () => {
      const listener = makeListenerResource({
        port: 443,
        protocol: 'HTTPS',
        certificate_arn: 'arn:aws:acm:us-east-1:123456:certificate/abc',
      });
      const ctx = makeTranslationContext({ siblingResources: [listener] });
      const cfg = resolveListenerConfig(ctx);
      expect(cfg.sslCertificateArn).toBe('arn:aws:acm:us-east-1:123456:certificate/abc');
    });

    it('should extract sslPolicy from listener sibling', () => {
      const listener = makeListenerResource({
        port: 443,
        protocol: 'HTTPS',
        ssl_policy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
      });
      const ctx = makeTranslationContext({ siblingResources: [listener] });
      const cfg = resolveListenerConfig(ctx);
      expect(cfg.sslPolicy).toBe('ELBSecurityPolicy-TLS13-1-2-2021-06');
    });

    it('should uppercase protocol from sibling', () => {
      const listener = makeListenerResource({ port: 8080, protocol: 'https' });
      const ctx = makeTranslationContext({ siblingResources: [listener] });
      const cfg = resolveListenerConfig(ctx);
      expect(cfg.protocol).toBe('HTTPS');
    });

    it('should default port to 80 if sibling port is not a number', () => {
      const listener = makeListenerResource({ port: 'not-a-number', protocol: 'HTTP' });
      const ctx = makeTranslationContext({ siblingResources: [listener] });
      const cfg = resolveListenerConfig(ctx);
      expect(cfg.port).toBe(80);
    });
  });

  // -----------------------------------------------------------------------
  // resolveTargetGroupConfig
  // -----------------------------------------------------------------------
  describe('resolveTargetGroupConfig', () => {
    it('should return defaults when no target group sibling exists', () => {
      const ctx = makeTranslationContext({ siblingResources: [] });
      const cfg = resolveTargetGroupConfig(ctx);
      expect(cfg.port).toBe(80);
      expect(cfg.protocol).toBe('HTTP');
      expect(cfg.healthCheckPath).toBeUndefined();
      expect(cfg.healthCheckProtocol).toBeUndefined();
      expect(cfg.healthCheckPort).toBeUndefined();
    });

    it('should use custom defaultProtocol when no sibling exists', () => {
      const ctx = makeTranslationContext({ siblingResources: [] });
      const cfg = resolveTargetGroupConfig(ctx, 'TCP');
      expect(cfg.protocol).toBe('TCP');
    });

    it('should extract port and protocol from target group sibling', () => {
      const tg = makeTargetGroupResource({ port: 8080, protocol: 'HTTP' });
      const ctx = makeTranslationContext({ siblingResources: [tg] });
      const cfg = resolveTargetGroupConfig(ctx);
      expect(cfg.port).toBe(8080);
      expect(cfg.protocol).toBe('HTTP');
    });

    it('should extract health check block from target group sibling', () => {
      const tg = makeTargetGroupResource({
        port: 8080,
        protocol: 'HTTP',
        health_check: { path: '/health', protocol: 'http', port: 8081 },
      });
      const ctx = makeTranslationContext({ siblingResources: [tg] });
      const cfg = resolveTargetGroupConfig(ctx);
      expect(cfg.healthCheckPath).toBe('/health');
      expect(cfg.healthCheckProtocol).toBe('HTTP');
      expect(cfg.healthCheckPort).toBe(8081);
    });

    it('should handle missing health check fields gracefully', () => {
      const tg = makeTargetGroupResource({
        port: 3000,
        protocol: 'HTTP',
        health_check: {},
      });
      const ctx = makeTranslationContext({ siblingResources: [tg] });
      const cfg = resolveTargetGroupConfig(ctx);
      expect(cfg.healthCheckPath).toBeUndefined();
      expect(cfg.healthCheckProtocol).toBeUndefined();
      expect(cfg.healthCheckPort).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // detectWafAssociation
  // -----------------------------------------------------------------------
  describe('detectWafAssociation', () => {
    it('should return false when no WAF sibling exists', () => {
      const ctx = makeTranslationContext({ siblingResources: [] });
      expect(detectWafAssociation(ctx)).toBe(false);
    });

    it('should return true when WAF sibling exists', () => {
      const waf = makeWafResource();
      const ctx = makeTranslationContext({ siblingResources: [waf] });
      expect(detectWafAssociation(ctx)).toBe(true);
    });

    it('should ignore non-WAF siblings', () => {
      const listener = makeListenerResource();
      const ctx = makeTranslationContext({ siblingResources: [listener] });
      expect(detectWafAssociation(ctx)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // mapProtocolToAzure
  // -----------------------------------------------------------------------
  describe('mapProtocolToAzure', () => {
    it('should map HTTP to Http', () => {
      const r = mapProtocolToAzure('HTTP');
      expect(r.protocol).toBe('Http');
      expect(r.unknownProtocol).toBe(false);
    });

    it('should map HTTPS to Https', () => {
      const r = mapProtocolToAzure('HTTPS');
      expect(r.protocol).toBe('Https');
      expect(r.unknownProtocol).toBe(false);
    });

    it('should map TCP to Tcp', () => {
      const r = mapProtocolToAzure('TCP');
      expect(r.protocol).toBe('Tcp');
      expect(r.unknownProtocol).toBe(false);
    });

    it('should map TLS to Tcp', () => {
      const r = mapProtocolToAzure('TLS');
      expect(r.protocol).toBe('Tcp');
      expect(r.unknownProtocol).toBe(false);
    });

    it('should map UDP to Udp', () => {
      const r = mapProtocolToAzure('UDP');
      expect(r.protocol).toBe('Udp');
      expect(r.unknownProtocol).toBe(false);
    });

    it('should return unknownProtocol for unknown protocols', () => {
      const r = mapProtocolToAzure('SCTP');
      expect(r.unknownProtocol).toBe(true);
      // Should be title-cased
      expect(r.protocol).toBe('Sctp');
    });

    it('should handle lowercase input', () => {
      const r = mapProtocolToAzure('http');
      expect(r.protocol).toBe('Http');
      expect(r.unknownProtocol).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // mapProtocolToGcp
  // -----------------------------------------------------------------------
  describe('mapProtocolToGcp', () => {
    it('should map HTTP for ALB', () => {
      const r = mapProtocolToGcp('HTTP', true);
      expect(r.protocol).toBe('HTTP');
      expect(r.unknownProtocol).toBe(false);
    });

    it('should map HTTPS for ALB', () => {
      const r = mapProtocolToGcp('HTTPS', true);
      expect(r.protocol).toBe('HTTPS');
      expect(r.unknownProtocol).toBe(false);
    });

    it('should map TCP for NLB', () => {
      const r = mapProtocolToGcp('TCP', false);
      expect(r.protocol).toBe('TCP');
      expect(r.unknownProtocol).toBe(false);
    });

    it('should map TLS to SSL for NLB', () => {
      const r = mapProtocolToGcp('TLS', false);
      expect(r.protocol).toBe('SSL');
      expect(r.unknownProtocol).toBe(false);
    });

    it('should map UDP for NLB', () => {
      const r = mapProtocolToGcp('UDP', false);
      expect(r.protocol).toBe('UDP');
      expect(r.unknownProtocol).toBe(false);
    });

    it('should return unknownProtocol for TCP on ALB map', () => {
      const r = mapProtocolToGcp('TCP', true);
      expect(r.unknownProtocol).toBe(true);
      expect(r.protocol).toBe('TCP');
    });

    it('should return unknownProtocol for HTTP on NLB map', () => {
      const r = mapProtocolToGcp('HTTP', false);
      expect(r.unknownProtocol).toBe(true);
      expect(r.protocol).toBe('HTTP');
    });

    it('should handle lowercase input', () => {
      const r = mapProtocolToGcp('tcp', false);
      expect(r.protocol).toBe('TCP');
      expect(r.unknownProtocol).toBe(false);
    });
  });
});

// ===========================================================================
// translateLb — ALB Azure with siblings
// ===========================================================================

describe('translateLb — ALB Azure with siblings', () => {
  function makeAlbAzureCtx(
    siblings: IrResource[] = [],
    attrs: Record<string, unknown> = {},
  ): TranslationContext {
    return makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'application', ...attrs },
      }),
      siblingResources: siblings,
    });
  }

  it('should use listener port 443 in frontend_port', () => {
    const listener = makeListenerResource({ port: 443, protocol: 'HTTPS' });
    const ctx = makeAlbAzureCtx([listener]);
    const result = translateLb(ctx);

    const agw = result.translated.find(
      (r) => r.targetType === 'azurerm_application_gateway',
    );
    expect(agw).toBeDefined();
    const frontendPort = agw!.attributes['frontend_port'] as Record<string, unknown>;
    expect(frontendPort['port']).toBe(443);
  });

  it('should use listener protocol HTTPS in http_listener', () => {
    const listener = makeListenerResource({ port: 443, protocol: 'HTTPS' });
    const ctx = makeAlbAzureCtx([listener]);
    const result = translateLb(ctx);

    const agw = result.translated.find(
      (r) => r.targetType === 'azurerm_application_gateway',
    );
    const httpListener = agw!.attributes['http_listener'] as Record<string, unknown>;
    expect(httpListener['protocol']).toBe('Https');
  });

  it('should emit LB_SSL_CERTIFICATE finding for SSL certificate', () => {
    const listener = makeListenerResource({
      port: 443,
      protocol: 'HTTPS',
      certificate_arn: 'arn:aws:acm:us-east-1:123456:certificate/abc',
    });
    const ctx = makeAlbAzureCtx([listener]);
    const result = translateLb(ctx);

    expect(hasFinding(result.findings, LB_SSL_CERTIFICATE)).toBe(true);
    const f = findFinding(result.findings, LB_SSL_CERTIFICATE);
    expect(f!.code).toBe('LB_SSL_CERTIFICATE');
  });

  it('should emit LB_WAF_ADVISORY finding for WAF sibling', () => {
    const waf = makeWafResource();
    const ctx = makeAlbAzureCtx([waf]);
    const result = translateLb(ctx);

    expect(hasFinding(result.findings, LB_WAF_ADVISORY)).toBe(true);
  });

  it('should emit COMPOUND_EXPANSION finding with correct resource count', () => {
    const ctx = makeAlbAzureCtx();
    const result = translateLb(ctx);

    expect(hasFinding(result.findings, 'COMPOUND_EXPANSION')).toBe(true);
    const f = findFinding(result.findings, 'COMPOUND_EXPANSION');
    // 2 resources: public IP + application gateway
    expect(f).toBeDefined();
  });

  it('should use target group port in backend_http_settings', () => {
    const tg = makeTargetGroupResource({ port: 8080, protocol: 'HTTP' });
    const ctx = makeAlbAzureCtx([tg]);
    const result = translateLb(ctx);

    const agw = result.translated.find(
      (r) => r.targetType === 'azurerm_application_gateway',
    );
    const settings = agw!.attributes['backend_http_settings'] as Record<string, unknown>;
    expect(settings['port']).toBe(8080);
  });
});

// ===========================================================================
// translateLb — ALB GCP with siblings
// ===========================================================================

describe('translateLb — ALB GCP with siblings', () => {
  function makeAlbGcpCtx(
    siblings: IrResource[] = [],
    attrs: Record<string, unknown> = {},
  ): TranslationContext {
    return makeTranslationContext({
      targetProvider: 'gcp' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'application', ...attrs },
      }),
      siblingResources: siblings,
    });
  }

  it('should use listener port 8080 in forwarding rule port_range', () => {
    const listener = makeListenerResource({ port: 8080, protocol: 'HTTP' });
    const ctx = makeAlbGcpCtx([listener]);
    const result = translateLb(ctx);

    const rule = result.translated.find(
      (r) => r.targetType === 'google_compute_global_forwarding_rule',
    );
    expect(rule).toBeDefined();
    expect(rule!.attributes['port_range']).toBe('8080');
  });

  it('should always emit 4 GCP resources for ALB', () => {
    const ctx = makeAlbGcpCtx();
    const result = translateLb(ctx);
    expect(result.translated).toHaveLength(4);

    const types = result.translated.map((r) => r.targetType);
    expect(types).toContain('google_compute_backend_service');
    expect(types).toContain('google_compute_url_map');
    expect(types).toContain('google_compute_target_http_proxy');
    expect(types).toContain('google_compute_global_forwarding_rule');
  });

  it('should emit LB_SSL_CERTIFICATE for HTTPS listener', () => {
    const listener = makeListenerResource({
      port: 443,
      protocol: 'HTTPS',
      certificate_arn: 'arn:aws:acm:us-east-1:123456:certificate/xyz',
    });
    const ctx = makeAlbGcpCtx([listener]);
    const result = translateLb(ctx);

    expect(hasFinding(result.findings, LB_SSL_CERTIFICATE)).toBe(true);
  });

  it('should use target group protocol in backend service', () => {
    const tg = makeTargetGroupResource({ port: 3000, protocol: 'HTTP' });
    const ctx = makeAlbGcpCtx([tg]);
    const result = translateLb(ctx);

    const backend = result.translated.find(
      (r) => r.targetType === 'google_compute_backend_service',
    );
    expect(backend!.attributes['protocol']).toBe('HTTP');
  });

  it('should emit COMPOUND_EXPANSION with 4 gcp resources', () => {
    const ctx = makeAlbGcpCtx();
    const result = translateLb(ctx);

    const f = findFinding(result.findings, 'COMPOUND_EXPANSION');
    expect(f).toBeDefined();
    expect(f!.message).toContain('4 gcp resources');
  });
});

// ===========================================================================
// translateLb — NLB Azure with siblings
// ===========================================================================

describe('translateLb — NLB Azure with siblings', () => {
  function makeNlbAzureCtx(
    siblings: IrResource[] = [],
    attrs: Record<string, unknown> = {},
  ): TranslationContext {
    return makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'network', ...attrs },
      }),
      siblingResources: siblings,
    });
  }

  it('should use target group port in lb_rule backend_port', () => {
    const tg = makeTargetGroupResource({ port: 9090, protocol: 'TCP' });
    const ctx = makeNlbAzureCtx([tg]);
    const result = translateLb(ctx);

    const lb = result.translated.find((r) => r.targetType === 'azurerm_lb');
    expect(lb).toBeDefined();
    const lbRule = lb!.attributes['lb_rule'] as Record<string, unknown>;
    expect(lbRule['backend_port']).toBe(9090);
  });

  it('should use listener port in lb_rule frontend_port', () => {
    const listener = makeListenerResource({ port: 8443, protocol: 'TCP' });
    const ctx = makeNlbAzureCtx([listener]);
    const result = translateLb(ctx);

    const lb = result.translated.find((r) => r.targetType === 'azurerm_lb');
    const lbRule = lb!.attributes['lb_rule'] as Record<string, unknown>;
    expect(lbRule['frontend_port']).toBe(8443);
  });

  it('should use health check port in probe when provided', () => {
    const tg = makeTargetGroupResource({
      port: 80,
      protocol: 'TCP',
      health_check: { port: 8081 },
    });
    const ctx = makeNlbAzureCtx([tg]);
    const result = translateLb(ctx);

    const lb = result.translated.find((r) => r.targetType === 'azurerm_lb');
    const probe = lb!.attributes['probe'] as Record<string, unknown>;
    expect(probe['port']).toBe(8081);
  });

  it('should map TCP protocol to Tcp in lb_rule', () => {
    const listener = makeListenerResource({ port: 80, protocol: 'TCP' });
    const ctx = makeNlbAzureCtx([listener]);
    const result = translateLb(ctx);

    const lb = result.translated.find((r) => r.targetType === 'azurerm_lb');
    const lbRule = lb!.attributes['lb_rule'] as Record<string, unknown>;
    expect(lbRule['protocol']).toBe('Tcp');
  });

  it('should skip public IP when internal is true', () => {
    const ctx = makeNlbAzureCtx([], { internal: true });
    const result = translateLb(ctx);

    const pip = result.translated.find((r) => r.targetType === 'azurerm_public_ip');
    expect(pip).toBeUndefined();
    expect(result.translated).toHaveLength(1);
  });
});

// ===========================================================================
// translateLb — NLB GCP with siblings
// ===========================================================================

describe('translateLb — NLB GCP with siblings', () => {
  function makeNlbGcpCtx(
    siblings: IrResource[] = [],
    attrs: Record<string, unknown> = {},
  ): TranslationContext {
    return makeTranslationContext({
      targetProvider: 'gcp' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'network', ...attrs },
      }),
      siblingResources: siblings,
    });
  }

  it('should use health check port from target group in health check resource', () => {
    const tg = makeTargetGroupResource({
      port: 80,
      protocol: 'TCP',
      health_check: { port: 8082 },
    });
    const ctx = makeNlbGcpCtx([tg]);
    const result = translateLb(ctx);

    const hc = result.translated.find(
      (r) => r.targetType === 'google_compute_health_check',
    );
    expect(hc).toBeDefined();
    const tcpHc = hc!.attributes['tcp_health_check'] as Record<string, unknown>;
    expect(tcpHc['port']).toBe(8082);
  });

  it('should use target group port when health check port is absent', () => {
    const tg = makeTargetGroupResource({ port: 3000, protocol: 'TCP' });
    const ctx = makeNlbGcpCtx([tg]);
    const result = translateLb(ctx);

    const hc = result.translated.find(
      (r) => r.targetType === 'google_compute_health_check',
    );
    const tcpHc = hc!.attributes['tcp_health_check'] as Record<string, unknown>;
    expect(tcpHc['port']).toBe(3000);
  });

  it('should map TCP protocol in backend service', () => {
    const tg = makeTargetGroupResource({ port: 80, protocol: 'TCP' });
    const ctx = makeNlbGcpCtx([tg]);
    const result = translateLb(ctx);

    const backend = result.translated.find(
      (r) => r.targetType === 'google_compute_region_backend_service',
    );
    expect(backend!.attributes['protocol']).toBe('TCP');
  });

  it('should use listener port in forwarding rule port_range', () => {
    const listener = makeListenerResource({ port: 9999, protocol: 'TCP' });
    const ctx = makeNlbGcpCtx([listener]);
    const result = translateLb(ctx);

    const rule = result.translated.find(
      (r) => r.targetType === 'google_compute_forwarding_rule',
    );
    expect(rule!.attributes['port_range']).toBe('9999');
  });

  it('should always emit 3 GCP resources for NLB', () => {
    const ctx = makeNlbGcpCtx();
    const result = translateLb(ctx);
    expect(result.translated).toHaveLength(3);

    const types = result.translated.map((r) => r.targetType);
    expect(types).toContain('google_compute_health_check');
    expect(types).toContain('google_compute_region_backend_service');
    expect(types).toContain('google_compute_forwarding_rule');
  });
});

// ===========================================================================
// translateLb — backward compatibility (no siblings)
// ===========================================================================

describe('translateLb — backward compatibility (no siblings)', () => {
  it('ALB Azure defaults: port 80, Http protocol', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'application' },
      }),
    });
    const result = translateLb(ctx);

    const agw = result.translated.find(
      (r) => r.targetType === 'azurerm_application_gateway',
    );
    expect(agw).toBeDefined();
    const frontendPort = agw!.attributes['frontend_port'] as Record<string, unknown>;
    expect(frontendPort['port']).toBe(80);
    const httpListener = agw!.attributes['http_listener'] as Record<string, unknown>;
    expect(httpListener['protocol']).toBe('Http');
  });

  it('ALB GCP defaults: port 80 in forwarding rule', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'application' },
      }),
    });
    const result = translateLb(ctx);

    const rule = result.translated.find(
      (r) => r.targetType === 'google_compute_global_forwarding_rule',
    );
    expect(rule!.attributes['port_range']).toBe('80');
  });

  it('NLB Azure defaults: port 80, Tcp protocol', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'network' },
      }),
    });
    const result = translateLb(ctx);

    const lb = result.translated.find((r) => r.targetType === 'azurerm_lb');
    expect(lb).toBeDefined();
    const lbRule = lb!.attributes['lb_rule'] as Record<string, unknown>;
    expect(lbRule['frontend_port']).toBe(80);
    expect(lbRule['backend_port']).toBe(80);
    expect(lbRule['protocol']).toBe('Tcp');
  });

  it('NLB GCP defaults: port 80 in health check and forwarding rule', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'network' },
      }),
    });
    const result = translateLb(ctx);

    const hc = result.translated.find(
      (r) => r.targetType === 'google_compute_health_check',
    );
    const tcpHc = hc!.attributes['tcp_health_check'] as Record<string, unknown>;
    expect(tcpHc['port']).toBe(80);

    const rule = result.translated.find(
      (r) => r.targetType === 'google_compute_forwarding_rule',
    );
    expect(rule!.attributes['port_range']).toBe('80');
  });

  it('COMPOUND_EXPANSION finding is always present', () => {
    const azureCtx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'application' },
      }),
    });
    const gcpCtx = makeTranslationContext({
      targetProvider: 'gcp' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'network' },
      }),
    });

    expect(hasFinding(translateLb(azureCtx).findings, 'COMPOUND_EXPANSION')).toBe(true);
    expect(hasFinding(translateLb(gcpCtx).findings, 'COMPOUND_EXPANSION')).toBe(true);
  });
});

// ===========================================================================
// translateLb — dispatch and edge cases
// ===========================================================================

describe('translateLb — dispatch and edge cases', () => {
  it('should default to ALB when load_balancer_type is missing', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({ attributes: {} }),
    });
    const result = translateLb(ctx);

    // ALB Azure produces application gateway
    const agw = result.translated.find(
      (r) => r.targetType === 'azurerm_application_gateway',
    );
    expect(agw).toBeDefined();
  });

  it('should dispatch to NLB for network type', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'network' },
      }),
    });
    const result = translateLb(ctx);

    const lb = result.translated.find((r) => r.targetType === 'azurerm_lb');
    expect(lb).toBeDefined();
  });

  it('should include tags when present (ALB Azure)', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        attributes: {
          load_balancer_type: 'application',
          tags: { env: 'prod', team: 'infra' },
        },
      }),
    });
    const result = translateLb(ctx);

    const agw = result.translated.find(
      (r) => r.targetType === 'azurerm_application_gateway',
    );
    expect(agw!.attributes['tags']).toBeDefined();
  });

  it('should include labels when present (ALB GCP)', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp' as CloudProvider,
      resource: makeIrResource({
        attributes: {
          load_balancer_type: 'application',
          tags: { env: 'staging' },
        },
      }),
    });
    const result = translateLb(ctx);

    const backend = result.translated.find(
      (r) => r.targetType === 'google_compute_backend_service',
    );
    expect(backend!.attributes['labels']).toBeDefined();
  });

  it('should emit LB_UNKNOWN_PROTOCOL for unknown protocols (Azure)', () => {
    // Use a protocol not in the ALB protocol maps
    const listener = makeListenerResource({ port: 80, protocol: 'SCTP' });
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'application' },
      }),
      siblingResources: [listener],
    });
    const result = translateLb(ctx);

    expect(hasFinding(result.findings, LB_UNKNOWN_PROTOCOL)).toBe(true);
  });

  it('should emit LB_UNKNOWN_PROTOCOL for unknown protocols (GCP ALB)', () => {
    const listener = makeListenerResource({ port: 80, protocol: 'TCP' });
    const ctx = makeTranslationContext({
      targetProvider: 'gcp' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'application' },
      }),
      siblingResources: [listener],
    });
    const result = translateLb(ctx);

    // TCP is unknown for GCP ALB map
    expect(hasFinding(result.findings, LB_UNKNOWN_PROTOCOL)).toBe(true);
  });

  it('should not emit LB_SSL_CERTIFICATE when no certificate', () => {
    const listener = makeListenerResource({ port: 443, protocol: 'HTTPS' });
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'application' },
      }),
      siblingResources: [listener],
    });
    const result = translateLb(ctx);

    expect(hasFinding(result.findings, LB_SSL_CERTIFICATE)).toBe(false);
  });

  it('should create public IP for non-internal ALB Azure', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'application' },
      }),
    });
    const result = translateLb(ctx);

    const pip = result.translated.find(
      (r) => r.targetType === 'azurerm_public_ip',
    );
    expect(pip).toBeDefined();
    expect(result.translated).toHaveLength(2);
  });

  it('should skip public IP for internal ALB Azure', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'application', internal: true },
      }),
    });
    const result = translateLb(ctx);

    const pip = result.translated.find(
      (r) => r.targetType === 'azurerm_public_ip',
    );
    expect(pip).toBeUndefined();
    expect(result.translated).toHaveLength(1);
  });

  it('should use private IP for internal ALB Azure', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'application', internal: true },
      }),
    });
    const result = translateLb(ctx);

    const agw = result.translated.find(
      (r) => r.targetType === 'azurerm_application_gateway',
    );
    const feIp = agw!.attributes['frontend_ip_configuration'] as Record<string, unknown>;
    expect(feIp['private_ip_address_allocation']).toBe('Dynamic');
    expect(feIp['subnet_id']).toBeDefined();
    expect(feIp['public_ip_address_id']).toBeUndefined();
  });

  it('should combine listener + target group + WAF siblings', () => {
    const listener = makeListenerResource({
      port: 443,
      protocol: 'HTTPS',
      certificate_arn: 'arn:aws:acm:us-east-1:123456:certificate/combo',
    });
    const tg = makeTargetGroupResource({ port: 8080, protocol: 'HTTP' });
    const waf = makeWafResource();

    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'application' },
      }),
      siblingResources: [listener, tg, waf],
    });
    const result = translateLb(ctx);

    // All three findings
    expect(hasFinding(result.findings, LB_SSL_CERTIFICATE)).toBe(true);
    expect(hasFinding(result.findings, LB_WAF_ADVISORY)).toBe(true);
    expect(hasFinding(result.findings, 'COMPOUND_EXPANSION')).toBe(true);

    // Attributes match siblings
    const agw = result.translated.find(
      (r) => r.targetType === 'azurerm_application_gateway',
    );
    const fp = agw!.attributes['frontend_port'] as Record<string, unknown>;
    expect(fp['port']).toBe(443);
    const bhs = agw!.attributes['backend_http_settings'] as Record<string, unknown>;
    expect(bhs['port']).toBe(8080);
  });

  it('should set sourceId on all translated resources', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp' as CloudProvider,
      resource: makeIrResource({ id: 'lb-unique' }),
    });
    const result = translateLb(ctx);

    for (const tr of result.translated) {
      expect(tr.sourceId).toBe('lb-unique');
    }
  });

  it('NLB Azure probe uses target group port when no health check port', () => {
    const tg = makeTargetGroupResource({ port: 5000, protocol: 'TCP' });
    const ctx = makeTranslationContext({
      targetProvider: 'azure' as CloudProvider,
      resource: makeIrResource({
        attributes: { load_balancer_type: 'network' },
      }),
      siblingResources: [tg],
    });
    const result = translateLb(ctx);

    const lb = result.translated.find((r) => r.targetType === 'azurerm_lb');
    const probe = lb!.attributes['probe'] as Record<string, unknown>;
    expect(probe['port']).toBe(5000);
  });
});
