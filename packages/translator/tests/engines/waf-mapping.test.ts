/**
 * Tests for structural/waf-mapping.ts
 *
 * Covers:
 * - Basic Azure translation (1 resource: azurerm_web_application_firewall_policy)
 * - Basic GCP translation (1 resource: google_compute_security_policy)
 * - Default action mapping: allow -> Detection/allow, block -> Prevention/deny(403)
 * - Custom rules translated to target rule objects
 * - Managed rule groups trigger WAF_MANAGED_RULES_ADVISORY
 * - STRUCTURAL_TOPOLOGY info finding
 * - Tags propagated for both providers
 * - aws_wafv2_rule_group maps to the same function (wafMapper)
 *
 * @module tests/engines/waf-mapping
 */

import { describe, it, expect, vi } from 'vitest';
import { translateWaf, wafMapper } from '../../src/engines/structural/waf-mapping.js';
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
    id: 'res-waf-001',
    sourceType: 'aws_wafv2_web_acl',
    sourceName: 'my_waf',
    sourceModule: null,
    category: 'security',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: 'SER-SEC-WAF-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-SEC-WAF-001',
    aws_service: 'aws_wafv2_web_acl',
    aws_family: 'security',
    azure_targets: ['azurerm_web_application_firewall_policy'],
    gcp_targets: ['google_compute_security_policy'],
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

describe('translateWaf — Azure', () => {
  it('produces 1 translated resource', () => {
    const ctx = makeCtx({ targetProvider: 'azure' });
    const result = translateWaf(ctx);

    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_web_application_firewall_policy');
  });

  it('uses sourceName as the policy resource name', () => {
    const resource = makeIrResource({ sourceName: 'edge_waf' });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateWaf(ctx);

    expect(result.translated[0]!.targetName).toBe('edge_waf');
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['name']).toBe('edge_waf');
  });

  it('maps default_action allow -> Detection mode', () => {
    const resource = makeIrResource({ attributes: { default_action: { allow: {} } } });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateWaf(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    const settings = attrs['policy_settings'] as Record<string, unknown>;

    expect(settings['mode']).toBe('Detection');
  });

  it('maps default_action block -> Prevention mode', () => {
    const resource = makeIrResource({ attributes: { default_action: { block: {} } } });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateWaf(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    const settings = attrs['policy_settings'] as Record<string, unknown>;

    expect(settings['mode']).toBe('Prevention');
  });

  it('translates custom block rule to Azure custom_rules entry', () => {
    const resource = makeIrResource({
      attributes: {
        default_action: { allow: {} },
        rule: [
          {
            name: 'BlockBadActors',
            priority: 1,
            action: { block: {} },
            statement: { ip_set_reference_statement: { arn: 'arn:aws:wafv2::set/bad-ips' } },
          },
        ],
      },
    });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateWaf(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    const customRules = attrs['custom_rules'] as Record<string, unknown>[];

    expect(customRules).toBeDefined();
    expect(customRules).toHaveLength(1);
    expect(customRules[0]!['action']).toBe('Block');
    expect(customRules[0]!['name']).toBe('BlockBadActors');
    expect(customRules[0]!['priority']).toBe(1);
  });

  it('translates custom allow rule to Azure custom_rules entry', () => {
    const resource = makeIrResource({
      attributes: {
        default_action: { block: {} },
        rule: [
          {
            name: 'AllowTrusted',
            priority: 5,
            action: { allow: {} },
            statement: { ip_set_reference_statement: { arn: 'arn:aws:wafv2::set/trusted' } },
          },
        ],
      },
    });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateWaf(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    const customRules = attrs['custom_rules'] as Record<string, unknown>[];

    expect(customRules[0]!['action']).toBe('Allow');
  });

  it('does NOT emit WAF_MANAGED_RULES_ADVISORY when no managed rule groups', () => {
    const resource = makeIrResource({ attributes: { default_action: { allow: {} } } });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateWaf(ctx);

    const codes = result.findings.map(f => f.code);
    expect(codes).not.toContain('WAF_MANAGED_RULES_ADVISORY');
  });

  it('emits WAF_MANAGED_RULES_ADVISORY when managed_rule_group_statement present', () => {
    const resource = makeIrResource({
      attributes: {
        default_action: { allow: {} },
        rule: [
          {
            name: 'AWSManagedRulesCommonRuleSet',
            priority: 10,
            action: {},
            statement: {
              managed_rule_group_statement: {
                vendor_name: 'AWS',
                name: 'AWSManagedRulesCommonRuleSet',
              },
            },
          },
        ],
      },
    });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateWaf(ctx);

    const advisory = result.findings.find(f => f.code === 'WAF_MANAGED_RULES_ADVISORY');
    expect(advisory).toBeDefined();
    expect(advisory!.severity).toBe('warning');
  });

  it('excludes managed rule groups from custom_rules list', () => {
    const resource = makeIrResource({
      attributes: {
        default_action: { allow: {} },
        rule: [
          {
            name: 'AWSManagedRulesCommonRuleSet',
            priority: 10,
            action: {},
            statement: {
              managed_rule_group_statement: { vendor_name: 'AWS', name: 'AWSManagedRulesCommonRuleSet' },
            },
          },
          {
            name: 'BlockBadIPs',
            priority: 1,
            action: { block: {} },
            statement: { ip_set_reference_statement: { arn: 'arn:...' } },
          },
        ],
      },
    });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateWaf(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    const customRules = (attrs['custom_rules'] as Record<string, unknown>[] | undefined) ?? [];

    // Only the non-managed rule should appear
    expect(customRules).toHaveLength(1);
    expect(customRules[0]!['name']).toBe('BlockBadIPs');
  });

  it('emits STRUCTURAL_TOPOLOGY info finding', () => {
    const ctx = makeCtx({ targetProvider: 'azure' });
    const result = translateWaf(ctx);

    const topo = result.findings.find(f => f.code === 'STRUCTURAL_TOPOLOGY');
    expect(topo).toBeDefined();
    expect(topo!.severity).toBe('info');
    expect(topo!.message).toContain('azurerm_web_application_firewall_policy');
  });

  it('propagates tags', () => {
    const resource = makeIrResource({ attributes: { tags: { Env: 'staging' } } });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateWaf(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;

    expect(attrs['tags']).toBeDefined();
  });

  it('sets sourceId on translated resource', () => {
    const resource = makeIrResource({ id: 'res-waf-xyz' });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateWaf(ctx);

    expect(result.translated[0]!.sourceId).toBe('res-waf-xyz');
  });

  it('includes resource_group_name and location references', () => {
    const ctx = makeCtx({ targetProvider: 'azure' });
    const result = translateWaf(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;

    expect(attrs['resource_group_name']).toContain('azurerm_resource_group.main.name');
    expect(attrs['location']).toContain('azurerm_resource_group.main.location');
  });
});

// ---------------------------------------------------------------------------
// GCP translation tests
// ---------------------------------------------------------------------------

describe('translateWaf — GCP', () => {
  it('produces 1 translated resource', () => {
    const ctx = makeCtx({ targetProvider: 'gcp' });
    const result = translateWaf(ctx);

    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_compute_security_policy');
  });

  it('uses sourceName as the GCP policy resource name', () => {
    const resource = makeIrResource({ sourceName: 'api_waf' });
    const ctx = makeCtx({ resource, targetProvider: 'gcp' });
    const result = translateWaf(ctx);

    expect(result.translated[0]!.targetName).toBe('api_waf');
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['name']).toBe('api_waf');
  });

  it('default_action allow -> default allow rule at lowest priority', () => {
    const resource = makeIrResource({ attributes: { default_action: { allow: {} } } });
    const ctx = makeCtx({ resource, targetProvider: 'gcp' });
    const result = translateWaf(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    const rules = attrs['rule'] as Record<string, unknown>[];

    // Last rule is the default
    const defaultRule = rules[rules.length - 1]!;
    expect(defaultRule['priority']).toBe(2147483647);
    expect(defaultRule['action']).toBe('allow');
  });

  it('default_action block -> default deny(403) rule at lowest priority', () => {
    const resource = makeIrResource({ attributes: { default_action: { block: {} } } });
    const ctx = makeCtx({ resource, targetProvider: 'gcp' });
    const result = translateWaf(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    const rules = attrs['rule'] as Record<string, unknown>[];

    const defaultRule = rules[rules.length - 1]!;
    expect(defaultRule['action']).toBe('deny(403)');
  });

  it('translates custom block rule to GCP deny(403) rule', () => {
    const resource = makeIrResource({
      attributes: {
        default_action: { allow: {} },
        rule: [
          {
            name: 'BlockBadIPs',
            priority: 100,
            action: { block: {} },
            statement: { ip_set_reference_statement: { arn: 'arn:...' } },
          },
        ],
      },
    });
    const ctx = makeCtx({ resource, targetProvider: 'gcp' });
    const result = translateWaf(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    const rules = attrs['rule'] as Record<string, unknown>[];

    // First rule is the custom block rule, last is the default
    const customRule = rules[0]!;
    expect(customRule['action']).toBe('deny(403)');
    expect(customRule['priority']).toBe(100);
  });

  it('emits WAF_MANAGED_RULES_ADVISORY for managed rule groups (GCP)', () => {
    const resource = makeIrResource({
      attributes: {
        default_action: { allow: {} },
        rule: [
          {
            name: 'AWSManagedRulesKnownBadInputsRuleSet',
            priority: 20,
            action: {},
            statement: {
              managed_rule_group_statement: {
                vendor_name: 'AWS',
                name: 'AWSManagedRulesKnownBadInputsRuleSet',
              },
            },
          },
        ],
      },
    });
    const ctx = makeCtx({ resource, targetProvider: 'gcp' });
    const result = translateWaf(ctx);

    const codes = result.findings.map(f => f.code);
    expect(codes).toContain('WAF_MANAGED_RULES_ADVISORY');
  });

  it('excludes managed rule groups from GCP rule list', () => {
    const resource = makeIrResource({
      attributes: {
        default_action: { allow: {} },
        rule: [
          {
            name: 'AWSManaged',
            priority: 10,
            action: {},
            statement: {
              managed_rule_group_statement: { vendor_name: 'AWS', name: 'AWSManagedRulesCommonRuleSet' },
            },
          },
        ],
      },
    });
    const ctx = makeCtx({ resource, targetProvider: 'gcp' });
    const result = translateWaf(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    const rules = attrs['rule'] as Record<string, unknown>[];

    // Only the default rule should be present (no custom rules from managed group)
    expect(rules).toHaveLength(1);
    expect((rules[0]! as Record<string, unknown>)['priority']).toBe(2147483647);
  });

  it('emits STRUCTURAL_TOPOLOGY info finding', () => {
    const ctx = makeCtx({ targetProvider: 'gcp' });
    const result = translateWaf(ctx);

    const topo = result.findings.find(f => f.code === 'STRUCTURAL_TOPOLOGY');
    expect(topo).toBeDefined();
    expect(topo!.message).toContain('google_compute_security_policy');
  });

  it('propagates tags as labels', () => {
    const resource = makeIrResource({ attributes: { tags: { App: 'web' } } });
    const ctx = makeCtx({ resource, targetProvider: 'gcp' });
    const result = translateWaf(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;

    expect(attrs['labels']).toBeDefined();
  });

  it('sets sourceId on translated resource', () => {
    const resource = makeIrResource({ id: 'res-waf-gcp' });
    const ctx = makeCtx({ resource, targetProvider: 'gcp' });
    const result = translateWaf(ctx);

    expect(result.translated[0]!.sourceId).toBe('res-waf-gcp');
  });

  it('includes project reference', () => {
    const ctx = makeCtx({ targetProvider: 'gcp' });
    const result = translateWaf(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;

    expect(attrs['project']).toContain('project_id');
  });
});

// ---------------------------------------------------------------------------
// Export alias test
// ---------------------------------------------------------------------------

describe('wafMapper export', () => {
  it('is the same function as translateWaf', () => {
    expect(wafMapper).toBe(translateWaf);
  });
});

// ---------------------------------------------------------------------------
// Rule group source type
// ---------------------------------------------------------------------------

describe('translateWaf — aws_wafv2_rule_group', () => {
  it('handles aws_wafv2_rule_group source type on Azure', () => {
    const resource = makeIrResource({
      sourceType: 'aws_wafv2_rule_group',
      sourceName: 'my_rule_group',
      attributes: { default_action: { allow: {} } },
    });
    const ctx = makeCtx({ resource, targetProvider: 'azure' });
    const result = translateWaf(ctx);

    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_web_application_firewall_policy');
  });

  it('handles aws_wafv2_rule_group source type on GCP', () => {
    const resource = makeIrResource({
      sourceType: 'aws_wafv2_rule_group',
      sourceName: 'my_rule_group',
      attributes: { default_action: { allow: {} } },
    });
    const ctx = makeCtx({ resource, targetProvider: 'gcp' });
    const result = translateWaf(ctx);

    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_compute_security_policy');
  });
});
