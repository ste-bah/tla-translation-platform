/**
 * Tests for TASK-NET-003: Security Groups to NSG/Firewall Rules.
 *
 * Covers:
 *  - sg-cidr-aggregator: resolveCidrs, hasAnyCidr, isOpenCidr
 *  - sg-rule-comparator: isIcmpProtocol, normalizePortRange, assignAzurePriority,
 *                        assignGcpPriority, makeRuleKey, deduplicateRules
 *  - security-group-mapping: translateSecurityGroup (BLOCKER gate, Azure/GCP translation)
 *
 * @generated for TASK-NET-003 (test-generator)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  resolveCidrs,
  hasAnyCidr,
  isOpenCidr,
} from '../../src/engines/structural/sg-cidr-aggregator.js';
import type { ResolvedCidrs } from '../../src/engines/structural/sg-cidr-aggregator.js';
import {
  isIcmpProtocol,
  normalizePortRange,
  assignAzurePriority,
  assignGcpPriority,
  makeRuleKey,
  deduplicateRules,
} from '../../src/engines/structural/sg-rule-comparator.js';
import { translateSecurityGroup } from '../../src/engines/structural/security-group-mapping.js';
import type { SgRule } from '../../src/engines/structural/security-group-mapping.js';
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
// Factory helpers (mirrored from subnet-translator.test.ts)
// ===========================================================================

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'sg-001',
    sourceType: 'aws_security_group',
    sourceName: 'my_sg',
    sourceModule: null,
    category: 'networking',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: 'SER-NET-SG-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-NET-SG-001',
    aws_service: 'aws_security_group',
    aws_family: 'networking',
    azure_targets: ['azurerm_network_security_group'],
    gcp_targets: ['google_compute_firewall'],
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

// Helper: find a finding by code
function findFinding(findings: { code: string }[], code: string) {
  return findings.find((f) => f.code === code);
}

function hasFinding(findings: { code: string }[], code: string): boolean {
  return findings.some((f) => f.code === code);
}

// ===========================================================================
// sg-cidr-aggregator: resolveCidrs
// ===========================================================================

describe('resolveCidrs', () => {
  it('should return empty arrays for a rule with no CIDR fields', () => {
    const rule: SgRule = { protocol: 'tcp', from_port: 80, to_port: 80 };
    const resolved = resolveCidrs(rule);
    expect(resolved.ipv4).toEqual([]);
    expect(resolved.ipv6).toEqual([]);
    expect(resolved.hasSelf).toBe(false);
    expect(resolved.hasSourceSgRef).toBeNull();
    expect(resolved.prefixListIds).toEqual([]);
  });

  it('should handle undefined cidr_blocks gracefully', () => {
    const rule: SgRule = {};
    const resolved = resolveCidrs(rule);
    expect(resolved.ipv4).toEqual([]);
    expect(resolved.ipv6).toEqual([]);
    expect(resolved.hasIpv6).toBe(false);
  });

  it('should resolve IPv4 CIDRs only', () => {
    const rule: SgRule = { cidr_blocks: ['10.0.0.0/16', '192.168.1.0/24'] };
    const resolved = resolveCidrs(rule);
    expect(resolved.ipv4).toEqual(['10.0.0.0/16', '192.168.1.0/24']);
    expect(resolved.ipv6).toEqual([]);
    expect(resolved.hasIpv6).toBe(false);
  });

  it('should resolve IPv6 CIDRs only', () => {
    const rule: SgRule = { ipv6_cidr_blocks: ['2001:db8::/32', '::/0'] };
    const resolved = resolveCidrs(rule);
    expect(resolved.ipv4).toEqual([]);
    expect(resolved.ipv6).toEqual(['2001:db8::/32', '::/0']);
    expect(resolved.hasIpv6).toBe(true);
  });

  it('should resolve mixed IPv4 and IPv6 CIDRs', () => {
    const rule: SgRule = {
      cidr_blocks: ['10.0.0.0/8'],
      ipv6_cidr_blocks: ['2001:db8::/32'],
    };
    const resolved = resolveCidrs(rule);
    expect(resolved.ipv4).toEqual(['10.0.0.0/8']);
    expect(resolved.ipv6).toEqual(['2001:db8::/32']);
    expect(resolved.hasIpv6).toBe(true);
  });

  it('should detect self:true', () => {
    const rule: SgRule = { self: true, cidr_blocks: ['10.0.0.0/8'] };
    const resolved = resolveCidrs(rule);
    expect(resolved.hasSelf).toBe(true);
  });

  it('should not flag self when self is false or undefined', () => {
    expect(resolveCidrs({ self: false }).hasSelf).toBe(false);
    expect(resolveCidrs({}).hasSelf).toBe(false);
  });

  it('should capture source_security_group_id', () => {
    const rule: SgRule = { source_security_group_id: 'sg-abc123' };
    const resolved = resolveCidrs(rule);
    expect(resolved.hasSourceSgRef).toBe('sg-abc123');
  });

  it('should capture prefix_list_ids', () => {
    const rule: SgRule = { prefix_list_ids: ['pl-111', 'pl-222'] };
    const resolved = resolveCidrs(rule);
    expect(resolved.prefixListIds).toEqual(['pl-111', 'pl-222']);
  });
});

// ===========================================================================
// sg-cidr-aggregator: hasAnyCidr
// ===========================================================================

describe('hasAnyCidr', () => {
  it('should return false for completely empty resolved CIDRs', () => {
    const resolved: ResolvedCidrs = {
      ipv4: [], ipv6: [], hasIpv6: false,
      hasSelf: false, hasSourceSgRef: null, prefixListIds: [],
    };
    expect(hasAnyCidr(resolved)).toBe(false);
  });

  it('should return true when ipv4 is populated', () => {
    const resolved: ResolvedCidrs = {
      ipv4: ['10.0.0.0/8'], ipv6: [], hasIpv6: false,
      hasSelf: false, hasSourceSgRef: null, prefixListIds: [],
    };
    expect(hasAnyCidr(resolved)).toBe(true);
  });

  it('should return true when ipv6 is populated', () => {
    const resolved: ResolvedCidrs = {
      ipv4: [], ipv6: ['::/0'], hasIpv6: true,
      hasSelf: false, hasSourceSgRef: null, prefixListIds: [],
    };
    expect(hasAnyCidr(resolved)).toBe(true);
  });

  it('should return true when hasSelf is true', () => {
    const resolved: ResolvedCidrs = {
      ipv4: [], ipv6: [], hasIpv6: false,
      hasSelf: true, hasSourceSgRef: null, prefixListIds: [],
    };
    expect(hasAnyCidr(resolved)).toBe(true);
  });

  it('should return true when hasSourceSgRef is set', () => {
    const resolved: ResolvedCidrs = {
      ipv4: [], ipv6: [], hasIpv6: false,
      hasSelf: false, hasSourceSgRef: 'sg-ref', prefixListIds: [],
    };
    expect(hasAnyCidr(resolved)).toBe(true);
  });

  it('should return true when prefixListIds is populated', () => {
    const resolved: ResolvedCidrs = {
      ipv4: [], ipv6: [], hasIpv6: false,
      hasSelf: false, hasSourceSgRef: null, prefixListIds: ['pl-1'],
    };
    expect(hasAnyCidr(resolved)).toBe(true);
  });
});

// ===========================================================================
// sg-cidr-aggregator: isOpenCidr
// ===========================================================================

describe('isOpenCidr', () => {
  it('should return true for 0.0.0.0/0', () => {
    const resolved = resolveCidrs({ cidr_blocks: ['0.0.0.0/0'] });
    expect(isOpenCidr(resolved)).toBe(true);
  });

  it('should return true for ::/0', () => {
    const resolved = resolveCidrs({ ipv6_cidr_blocks: ['::/0'] });
    expect(isOpenCidr(resolved)).toBe(true);
  });

  it('should return true when both 0.0.0.0/0 and ::/0 are present', () => {
    const resolved = resolveCidrs({
      cidr_blocks: ['0.0.0.0/0'],
      ipv6_cidr_blocks: ['::/0'],
    });
    expect(isOpenCidr(resolved)).toBe(true);
  });

  it('should return false for non-open CIDRs', () => {
    const resolved = resolveCidrs({ cidr_blocks: ['10.0.0.0/8'] });
    expect(isOpenCidr(resolved)).toBe(false);
  });

  it('should return false for empty resolved CIDRs', () => {
    const resolved = resolveCidrs({});
    expect(isOpenCidr(resolved)).toBe(false);
  });
});

// ===========================================================================
// sg-rule-comparator: isIcmpProtocol
// ===========================================================================

describe('isIcmpProtocol', () => {
  it('should return true for "icmp"', () => {
    expect(isIcmpProtocol('icmp')).toBe(true);
  });

  it('should return true for "ICMP" (case insensitive)', () => {
    expect(isIcmpProtocol('ICMP')).toBe(true);
  });

  it('should return true for "icmpv6"', () => {
    expect(isIcmpProtocol('icmpv6')).toBe(true);
  });

  it('should return true for protocol number "1" (ICMP)', () => {
    expect(isIcmpProtocol('1')).toBe(true);
  });

  it('should return true for protocol number "58" (ICMPv6)', () => {
    expect(isIcmpProtocol('58')).toBe(true);
  });

  it('should return false for "tcp"', () => {
    expect(isIcmpProtocol('tcp')).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isIcmpProtocol(undefined)).toBe(false);
  });

  it('should return false for "-1" (all protocols)', () => {
    expect(isIcmpProtocol('-1')).toBe(false);
  });
});

// ===========================================================================
// sg-rule-comparator: normalizePortRange
// ===========================================================================

describe('normalizePortRange', () => {
  it('should return { -1, -1 } for ICMP protocol', () => {
    const result = normalizePortRange(8, 0, 'icmp');
    expect(result.from).toBe(-1);
    expect(result.to).toBe(-1);
  });

  it('should return { 0, 65535 } for protocol -1 (all)', () => {
    const result = normalizePortRange(undefined, undefined, '-1');
    expect(result.from).toBe(0);
    expect(result.to).toBe(65535);
  });

  it('should swap inverted ports (from > to)', () => {
    const result = normalizePortRange(8080, 80, 'tcp');
    expect(result.from).toBe(80);
    expect(result.to).toBe(8080);
  });

  it('should clamp ports to 0-65535', () => {
    const result = normalizePortRange(-10, 70000, 'tcp');
    expect(result.from).toBe(0);
    expect(result.to).toBe(65535);
  });

  it('should default undefined from to 0 and undefined to to 65535', () => {
    const result = normalizePortRange(undefined, undefined, 'tcp');
    expect(result.from).toBe(0);
    expect(result.to).toBe(65535);
  });

  it('should handle equal from and to', () => {
    const result = normalizePortRange(443, 443, 'tcp');
    expect(result.from).toBe(443);
    expect(result.to).toBe(443);
  });
});

// ===========================================================================
// sg-rule-comparator: assignAzurePriority
// ===========================================================================

describe('assignAzurePriority', () => {
  it('should return priority 100 at index 0', () => {
    const result = assignAzurePriority(0);
    expect(result.priority).toBe(100);
    expect(result.overflow).toBe(false);
  });

  it('should return priority 110 at index 1', () => {
    const result = assignAzurePriority(1);
    expect(result.priority).toBe(110);
    expect(result.overflow).toBe(false);
  });

  it('should return priority 4090 at index 399 (no overflow)', () => {
    const result = assignAzurePriority(399);
    expect(result.priority).toBe(4090);
    expect(result.overflow).toBe(false);
  });

  it('should cap at 4096 and set overflow at index 400', () => {
    const result = assignAzurePriority(400);
    expect(result.priority).toBe(4096);
    expect(result.overflow).toBe(true);
  });

  it('should remain capped at 4096 for very large index', () => {
    const result = assignAzurePriority(10000);
    expect(result.priority).toBe(4096);
    expect(result.overflow).toBe(true);
  });
});

// ===========================================================================
// sg-rule-comparator: assignGcpPriority
// ===========================================================================

describe('assignGcpPriority', () => {
  it('should return priority 1000 at index 0', () => {
    const result = assignGcpPriority(0);
    expect(result.priority).toBe(1000);
    expect(result.overflow).toBe(false);
  });

  it('should return priority 1010 at index 1', () => {
    const result = assignGcpPriority(1);
    expect(result.priority).toBe(1010);
    expect(result.overflow).toBe(false);
  });

  it('should cap at 65534 and set overflow when exceeded', () => {
    // index = 6454: 1000 + 6454*10 = 65540 > 65534
    const result = assignGcpPriority(6454);
    expect(result.priority).toBe(65534);
    expect(result.overflow).toBe(true);
  });

  it('should not overflow at index 6453', () => {
    // 1000 + 6453*10 = 65530 <= 65534
    const result = assignGcpPriority(6453);
    expect(result.priority).toBe(65530);
    expect(result.overflow).toBe(false);
  });
});

// ===========================================================================
// sg-rule-comparator: makeRuleKey
// ===========================================================================

describe('makeRuleKey', () => {
  it('should produce a deterministic key for the same inputs', () => {
    const resolved = resolveCidrs({ cidr_blocks: ['10.0.0.0/8'] });
    const key1 = makeRuleKey('ingress', 'tcp', 80, 80, resolved);
    const key2 = makeRuleKey('ingress', 'tcp', 80, 80, resolved);
    expect(key1).toBe(key2);
  });

  it('should produce different keys for different directions', () => {
    const resolved = resolveCidrs({ cidr_blocks: ['10.0.0.0/8'] });
    const keyIn = makeRuleKey('ingress', 'tcp', 80, 80, resolved);
    const keyOut = makeRuleKey('egress', 'tcp', 80, 80, resolved);
    expect(keyIn).not.toBe(keyOut);
  });

  it('should produce different keys for different protocols', () => {
    const resolved = resolveCidrs({ cidr_blocks: ['10.0.0.0/8'] });
    const keyTcp = makeRuleKey('ingress', 'tcp', 80, 80, resolved);
    const keyUdp = makeRuleKey('ingress', 'udp', 80, 80, resolved);
    expect(keyTcp).not.toBe(keyUdp);
  });

  it('should sort CIDRs for consistent ordering', () => {
    const resolved1 = resolveCidrs({ cidr_blocks: ['10.0.0.0/8', '192.168.0.0/16'] });
    const resolved2 = resolveCidrs({ cidr_blocks: ['192.168.0.0/16', '10.0.0.0/8'] });
    const key1 = makeRuleKey('ingress', 'tcp', 80, 80, resolved1);
    const key2 = makeRuleKey('ingress', 'tcp', 80, 80, resolved2);
    expect(key1).toBe(key2);
  });

  it('should include self and sg references in the key', () => {
    const resolved = resolveCidrs({ self: true, source_security_group_id: 'sg-123' });
    const key = makeRuleKey('ingress', 'tcp', 80, 80, resolved);
    expect(key).toContain('self');
    expect(key).toContain('sg:sg-123');
  });
});

// ===========================================================================
// sg-rule-comparator: deduplicateRules
// ===========================================================================

describe('deduplicateRules', () => {
  it('should return all indices when all rules are unique', () => {
    const rules: SgRule[] = [
      { cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 80, to_port: 80 },
      { cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 443, to_port: 443 },
    ];
    const indices = deduplicateRules(rules, 'ingress', resolveCidrs);
    expect(indices).toEqual([0, 1]);
  });

  it('should remove duplicates and preserve first occurrence', () => {
    const rules: SgRule[] = [
      { cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 80, to_port: 80 },
      { cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 80, to_port: 80 },
      { cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 443, to_port: 443 },
    ];
    const indices = deduplicateRules(rules, 'ingress', resolveCidrs);
    expect(indices).toEqual([0, 2]);
  });

  it('should return empty array for empty rules', () => {
    const indices = deduplicateRules([], 'ingress', resolveCidrs);
    expect(indices).toEqual([]);
  });
});

// ===========================================================================
// BLOCKER gate tests
// ===========================================================================

describe('translateSecurityGroup — BLOCKER gate', () => {
  it('should emit BLOCKER for ingress 0.0.0.0/0 + protocol -1', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({
        attributes: {
          ingress: [{ cidr_blocks: ['0.0.0.0/0'], protocol: '-1' }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    expect(result.translated).toEqual([]);
    expect(hasFinding(result.findings, 'SECURITY_GROUP_RULE_BROADENING')).toBe(true);
    const f = findFinding(result.findings, 'SECURITY_GROUP_RULE_BROADENING');
    expect(f!.severity).toBe('blocker');
  });

  it('should emit BLOCKER for ingress 0.0.0.0/0 + port 0-65535', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({
        attributes: {
          ingress: [{ cidr_blocks: ['0.0.0.0/0'], protocol: 'tcp', from_port: 0, to_port: 65535 }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    expect(result.translated).toEqual([]);
    expect(hasFinding(result.findings, 'SECURITY_GROUP_RULE_BROADENING')).toBe(true);
  });

  it('should emit BLOCKER for ingress ::/0 + protocol -1 (IPv6)', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({
        attributes: {
          ingress: [{ ipv6_cidr_blocks: ['::/0'], protocol: '-1' }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    expect(result.translated).toEqual([]);
    expect(hasFinding(result.findings, 'SECURITY_GROUP_RULE_BROADENING')).toBe(true);
  });

  it('should emit WARNING (not BLOCKER) for overly permissive egress', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({
        attributes: {
          ingress: [{ cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 80, to_port: 80 }],
          egress: [{ cidr_blocks: ['0.0.0.0/0'], protocol: '-1' }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    // Should NOT be blocked
    expect(result.translated.length).toBeGreaterThan(0);
    expect(hasFinding(result.findings, 'SECURITY_GROUP_RULE_BROADENING')).toBe(false);
    expect(hasFinding(result.findings, 'SG_EGRESS_OPEN')).toBe(true);
    const f = findFinding(result.findings, 'SG_EGRESS_OPEN');
    expect(f!.severity).toBe('warning');
  });

  it('should NOT emit BLOCKER for normal ingress rule', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({
        attributes: {
          ingress: [{ cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 443, to_port: 443 }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    expect(result.translated.length).toBeGreaterThan(0);
    expect(hasFinding(result.findings, 'SECURITY_GROUP_RULE_BROADENING')).toBe(false);
  });
});

// ===========================================================================
// Azure translation tests
// ===========================================================================

describe('translateSecurityGroup — Azure', () => {
  it('should produce NSG + 1 ingress rule for basic TCP ingress', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        sourceName: 'web_sg',
        attributes: {
          ingress: [{ cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 443, to_port: 443 }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    // 1 NSG + 1 rule = 2 translated resources
    expect(result.translated).toHaveLength(2);
    expect(result.translated[0]!.targetType).toBe('azurerm_network_security_group');
    expect(result.translated[0]!.targetName).toBe('web_sg');
    expect(result.translated[1]!.targetType).toBe('azurerm_network_security_rule');
  });

  it('should use source_address_prefixes (plural) for multi-CIDR', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        attributes: {
          ingress: [{
            cidr_blocks: ['10.0.0.0/8', '172.16.0.0/12'],
            protocol: 'tcp', from_port: 80, to_port: 80,
          }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    const ruleAttrs = result.translated[1]!.attributes as Record<string, unknown>;
    expect(ruleAttrs['source_address_prefixes']).toEqual(['10.0.0.0/8', '172.16.0.0/12']);
    expect(ruleAttrs['source_address_prefix']).toBeUndefined();
  });

  it('should use source_address_prefix (singular) for single CIDR', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        attributes: {
          ingress: [{
            cidr_blocks: ['10.0.0.0/8'],
            protocol: 'tcp', from_port: 80, to_port: 80,
          }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    const ruleAttrs = result.translated[1]!.attributes as Record<string, unknown>;
    expect(ruleAttrs['source_address_prefix']).toBe('10.0.0.0/8');
    expect(ruleAttrs['source_address_prefixes']).toBeUndefined();
  });

  it('should set destination_port_range to "*" for ICMP', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        attributes: {
          ingress: [{
            cidr_blocks: ['10.0.0.0/8'],
            protocol: 'icmp', from_port: 8, to_port: 0,
          }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    const ruleAttrs = result.translated[1]!.attributes as Record<string, unknown>;
    expect(ruleAttrs['destination_port_range']).toBe('*');
    expect(hasFinding(result.findings, 'SG_ICMP_NORMALIZED')).toBe(true);
  });

  it('should assign priority starting at 100, incrementing by 10', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        attributes: {
          ingress: [
            { cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 80, to_port: 80 },
            { cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 443, to_port: 443 },
            { cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 8080, to_port: 8080 },
          ],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    // translated[0] is NSG, [1..3] are rules
    const rule0 = result.translated[1]!.attributes as Record<string, unknown>;
    const rule1 = result.translated[2]!.attributes as Record<string, unknown>;
    const rule2 = result.translated[3]!.attributes as Record<string, unknown>;
    expect(rule0['priority']).toBe(100);
    expect(rule1['priority']).toBe(110);
    expect(rule2['priority']).toBe(120);
  });

  it('should emit SG_SELF_REFERENCE warning for self:true', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        attributes: {
          ingress: [{ self: true, protocol: 'tcp', from_port: 80, to_port: 80 }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    expect(hasFinding(result.findings, 'SG_SELF_REFERENCE')).toBe(true);
    const f = findFinding(result.findings, 'SG_SELF_REFERENCE');
    expect(f!.severity).toBe('warning');
  });

  it('should emit SG_CROSS_SG_REFERENCE warning for source_security_group_id', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        attributes: {
          ingress: [{
            source_security_group_id: 'sg-other',
            protocol: 'tcp', from_port: 443, to_port: 443,
          }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    expect(hasFinding(result.findings, 'SG_CROSS_SG_REFERENCE')).toBe(true);
    const f = findFinding(result.findings, 'SG_CROSS_SG_REFERENCE');
    expect(f!.severity).toBe('warning');
    expect(f!.message).toContain('sg-other');
  });

  it('should emit STRUCTURAL_TOPOLOGY info finding', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        attributes: {
          ingress: [{ cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 80, to_port: 80 }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    expect(hasFinding(result.findings, 'STRUCTURAL_TOPOLOGY')).toBe(true);
    const f = findFinding(result.findings, 'STRUCTURAL_TOPOLOGY');
    expect(f!.message).toContain('azure');
    expect(f!.message).toContain('NSG');
  });
});

// ===========================================================================
// GCP translation tests
// ===========================================================================

describe('translateSecurityGroup — GCP', () => {
  it('should produce a google_compute_firewall for basic TCP ingress', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({
        sourceName: 'web_sg',
        attributes: {
          ingress: [{ cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 443, to_port: 443 }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_compute_firewall');
    expect(result.translated[0]!.targetName).toBe('web_sg_ingress_0');
  });

  it('should use source_ranges array for multi-CIDR ingress', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({
        attributes: {
          ingress: [{
            cidr_blocks: ['10.0.0.0/8', '172.16.0.0/12'],
            protocol: 'tcp', from_port: 80, to_port: 80,
          }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['source_ranges']).toEqual(['10.0.0.0/8', '172.16.0.0/12']);
  });

  it('should merge IPv4+IPv6 CIDRs into source_ranges', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({
        attributes: {
          ingress: [{
            cidr_blocks: ['10.0.0.0/8'],
            ipv6_cidr_blocks: ['2001:db8::/32'],
            protocol: 'tcp', from_port: 80, to_port: 80,
          }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['source_ranges']).toEqual(['10.0.0.0/8', '2001:db8::/32']);
  });

  it('should omit ports in allow block for ICMP', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({
        attributes: {
          ingress: [{ cidr_blocks: ['10.0.0.0/8'], protocol: 'icmp' }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    const allow = (attrs['allow'] as Record<string, unknown>[])[0]!;
    expect(allow['protocol']).toBe('icmp');
    expect(allow['ports']).toBeUndefined();
    expect(hasFinding(result.findings, 'SG_ICMP_NORMALIZED')).toBe(true);
  });

  it('should set direction to INGRESS for ingress rules', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({
        attributes: {
          ingress: [{ cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 80, to_port: 80 }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['direction']).toBe('INGRESS');
  });

  it('should set direction to EGRESS for egress rules', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({
        attributes: {
          egress: [{ cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 80, to_port: 80 }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['direction']).toBe('EGRESS');
  });

  it('should emit SG_SELF_REFERENCE warning for self:true', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({
        attributes: {
          ingress: [{ self: true, protocol: 'tcp', from_port: 80, to_port: 80 }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    expect(hasFinding(result.findings, 'SG_SELF_REFERENCE')).toBe(true);
  });

  it('should assign GCP priority starting at 1000', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({
        attributes: {
          ingress: [
            { cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 80, to_port: 80 },
            { cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 443, to_port: 443 },
          ],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    const rule0Attrs = result.translated[0]!.attributes as Record<string, unknown>;
    const rule1Attrs = result.translated[1]!.attributes as Record<string, unknown>;
    expect(rule0Attrs['priority']).toBe(1000);
    expect(rule1Attrs['priority']).toBe(1010);
  });

  it('should emit STRUCTURAL_TOPOLOGY info finding', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({
        attributes: {
          ingress: [{ cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 80, to_port: 80 }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    expect(hasFinding(result.findings, 'STRUCTURAL_TOPOLOGY')).toBe(true);
    const f = findFinding(result.findings, 'STRUCTURAL_TOPOLOGY');
    expect(f!.message).toContain('gcp');
  });

  it('should default source_ranges to 0.0.0.0/0 when no CIDRs provided', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({
        attributes: {
          ingress: [{ protocol: 'tcp', from_port: 22, to_port: 22 }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['source_ranges']).toEqual(['0.0.0.0/0']);
  });

  it('should reference VPC network from sibling resources', () => {
    const vpcResource = makeIrResource({
      id: 'vpc-001',
      sourceType: 'aws_vpc',
      sourceName: 'main_vpc',
      attributes: { cidr_block: '10.0.0.0/16' },
    });
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({
        attributes: {
          ingress: [{ cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 80, to_port: 80 }],
          vpc_id: '${aws_vpc.main_vpc.id}',
        },
      }),
      siblingResources: [vpcResource],
    });
    const result = translateSecurityGroup(ctx);
    const attrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(attrs['network']).toContain('main_vpc');
  });
});

// ===========================================================================
// Azure egress rules
// ===========================================================================

describe('translateSecurityGroup — Azure egress', () => {
  it('should produce Outbound direction for egress rules', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        attributes: {
          egress: [{ cidr_blocks: ['0.0.0.0/0'], protocol: 'tcp', from_port: 443, to_port: 443 }],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    // translated[0] = NSG, translated[1] = egress rule
    expect(result.translated).toHaveLength(2);
    const ruleAttrs = result.translated[1]!.attributes as Record<string, unknown>;
    expect(ruleAttrs['direction']).toBe('Outbound');
  });

  it('should continue ingress priority numbering into egress rules', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        attributes: {
          ingress: [
            { cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 80, to_port: 80 },
          ],
          egress: [
            { cidr_blocks: ['0.0.0.0/0'], protocol: 'tcp', from_port: 443, to_port: 443 },
          ],
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    // NSG [0], ingress[1] priority=100, egress[2] priority=110
    const ingressAttrs = result.translated[1]!.attributes as Record<string, unknown>;
    const egressAttrs = result.translated[2]!.attributes as Record<string, unknown>;
    expect(ingressAttrs['priority']).toBe(100);
    expect(egressAttrs['priority']).toBe(110);
  });
});

// ===========================================================================
// Edge cases: empty rules, no rules
// ===========================================================================

describe('translateSecurityGroup — edge cases', () => {
  it('should produce NSG only (no rules) when no ingress/egress defined (Azure)', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ attributes: {} }),
    });
    const result = translateSecurityGroup(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_network_security_group');
  });

  it('should produce zero firewall rules when no ingress/egress defined (GCP)', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ attributes: {} }),
    });
    const result = translateSecurityGroup(ctx);
    expect(result.translated).toHaveLength(0);
  });

  it('should handle tags in Azure NSG', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        attributes: {
          tags: { Env: 'prod', Team: 'infra' },
        },
      }),
    });
    const result = translateSecurityGroup(ctx);
    const nsgAttrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(nsgAttrs['tags']).toBeDefined();
  });

  it('should handle description in Azure NSG', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        attributes: { description: 'Web server SG' },
      }),
    });
    const result = translateSecurityGroup(ctx);
    const nsgAttrs = result.translated[0]!.attributes as Record<string, unknown>;
    expect(nsgAttrs['description']).toBe('Web server SG');
  });
});
