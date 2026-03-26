import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { loadRegistryFromDirectory } from '../src/loader';
import { validateRegistryEntries } from '../src/validator';
import type { RegistryEntry } from '@tla/shared';

const NETWORKING_DATA_DIR = join(__dirname, '..', 'data', 'networking');

describe('Networking Registry Entries', () => {
  let entries: RegistryEntry[];

  beforeAll(async () => {
    const result = await loadRegistryFromDirectory(NETWORKING_DATA_DIR);
    expect(result.errors).toHaveLength(0);
    entries = result.entries;
  });

  describe('Loading', () => {
    it('should load 9 networking entries', () => {
      expect(entries).toHaveLength(9);
    });

    it('should contain all expected entry IDs', () => {
      const ids = entries.map(e => e.registry_entry_id);
      expect(ids).toContain('SER-NET-VPC-001');
      expect(ids).toContain('SER-NET-SUB-001');
      expect(ids).toContain('SER-NET-SG-001');
      expect(ids).toContain('SER-NET-ALB-001');
      expect(ids).toContain('SER-NET-NLB-001');
      expect(ids).toContain('SER-NET-R53-001');
      expect(ids).toContain('SER-NET-CF-001');
      expect(ids).toContain('SER-NET-NAT-001');
      expect(ids).toContain('SER-NET-PEER-001');
    });
  });

  describe('Uniqueness', () => {
    it('should have unique registry_entry_ids', () => {
      const ids = entries.map(e => e.registry_entry_id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should have unique aws_service values', () => {
      const services = entries.map(e => e.aws_service);
      expect(new Set(services).size).toBe(services.length);
    });
  });

  describe('Validation Rules', () => {
    it('should pass all 9 business rules with zero errors', () => {
      const results = validateRegistryEntries(entries);
      const errors = results.filter(r => r.severity === 'error');
      expect(errors).toHaveLength(0);
    });

    it('should produce zero warnings', () => {
      const results = validateRegistryEntries(entries);
      const warnings = results.filter(r => r.severity === 'warning');
      expect(warnings).toHaveLength(0);
    });
  });

  describe('SER-NET-VPC-001 (VPC) - Updated', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-NET-VPC-001')!;
    });

    it('should have updated mapping_type to parametric', () => {
      expect(entry.mapping_type).toBe('parametric');
    });

    it('should have updated confidence to 0.75', () => {
      expect(entry.confidence).toBe(0.75);
    });

    it('should retain existing fields unchanged', () => {
      expect(entry.aws_service).toBe('vpc');
      expect(entry.aws_family).toBe('networking');
      expect(entry.band).toBe('P2');
      expect(entry.output_mode).toBe('native_emit_only');
      expect(entry.portable_provider_candidate).toBe(false);
      expect(entry.manual_review_required).toBe(true);
      expect(entry.review_domains).toEqual(['networking', 'security']);
    });

    it('should have 2 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(2);
      const gapIds = entry.behavioral_gaps.map(g => g.gap_id);
      expect(gapIds).toContain('BGR-NET-VPC-001');
      expect(gapIds).toContain('BGR-NET-VPC-002');
    });
  });

  describe('SER-NET-SUB-001 (Subnet)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-NET-SUB-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('subnet');
      expect(entry.aws_family).toBe('networking');
      expect(entry.mapping_type).toBe('parametric');
      expect(entry.output_mode).toBe('native_emit_only');
      expect(entry.band).toBe('P2');
      expect(entry.confidence).toBe(0.72);
      expect(entry.portable_provider_candidate).toBe(false);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_subnet']);
      expect(entry.gcp_targets).toEqual(['google_compute_subnetwork']);
    });

    it('should have 2 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(2);
      const gapIds = entry.behavioral_gaps.map(g => g.gap_id);
      expect(gapIds).toContain('BGR-NET-SUB-001');
      expect(gapIds).toContain('BGR-NET-SUB-002');
    });
  });

  describe('SER-NET-SG-001 (Security Group)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-NET-SG-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('security_group');
      expect(entry.aws_family).toBe('networking');
      expect(entry.mapping_type).toBe('structural');
      expect(entry.output_mode).toBe('native_emit_only');
      expect(entry.band).toBe('N1');
      expect(entry.confidence).toBe(0.55);
      expect(entry.portable_provider_candidate).toBe(false);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_network_security_group', 'azurerm_network_security_rule']);
      expect(entry.gcp_targets).toEqual(['google_compute_firewall']);
    });

    it('should have 3 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(3);
      const gapIds = entry.behavioral_gaps.map(g => g.gap_id);
      expect(gapIds).toContain('BGR-NET-SG-001');
      expect(gapIds).toContain('BGR-NET-SG-002');
      expect(gapIds).toContain('BGR-NET-SG-003');
    });

    it('should require manual review with networking and security domains', () => {
      expect(entry.manual_review_required).toBe(true);
      expect(entry.review_domains).toEqual(['networking', 'security']);
    });
  });

  describe('SER-NET-ALB-001 (ALB)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-NET-ALB-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('alb');
      expect(entry.aws_family).toBe('networking');
      expect(entry.mapping_type).toBe('compound');
      expect(entry.output_mode).toBe('native_emit_only');
      expect(entry.band).toBe('N1');
      expect(entry.confidence).toBe(0.48);
      expect(entry.portable_provider_candidate).toBe(false);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_application_gateway']);
      expect(entry.gcp_targets).toEqual(['google_compute_url_map', 'google_compute_backend_service']);
    });

    it('should have 3 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(3);
      const gapIds = entry.behavioral_gaps.map(g => g.gap_id);
      expect(gapIds).toContain('BGR-NET-ALB-001');
      expect(gapIds).toContain('BGR-NET-ALB-002');
      expect(gapIds).toContain('BGR-NET-ALB-003');
    });
  });

  describe('SER-NET-NLB-001 (NLB)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-NET-NLB-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('nlb');
      expect(entry.aws_family).toBe('networking');
      expect(entry.mapping_type).toBe('compound');
      expect(entry.output_mode).toBe('native_emit_only');
      expect(entry.band).toBe('N1');
      expect(entry.confidence).toBe(0.52);
      expect(entry.portable_provider_candidate).toBe(false);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_lb']);
      expect(entry.gcp_targets).toEqual(['google_compute_forwarding_rule']);
    });

    it('should have 3 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(3);
      const gapIds = entry.behavioral_gaps.map(g => g.gap_id);
      expect(gapIds).toContain('BGR-NET-NLB-001');
      expect(gapIds).toContain('BGR-NET-NLB-002');
      expect(gapIds).toContain('BGR-NET-NLB-003');
    });
  });

  describe('SER-NET-R53-001 (Route53)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-NET-R53-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('route53');
      expect(entry.aws_family).toBe('networking');
      expect(entry.mapping_type).toBe('direct');
      expect(entry.output_mode).toBe('native_emit_only');
      expect(entry.band).toBe('P2');
      expect(entry.confidence).toBe(0.78);
      expect(entry.portable_provider_candidate).toBe(false);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_dns_zone', 'azurerm_dns_a_record', 'azurerm_dns_cname_record']);
      expect(entry.gcp_targets).toEqual(['google_dns_managed_zone', 'google_dns_record_set']);
    });

    it('should have 3 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(3);
      const gapIds = entry.behavioral_gaps.map(g => g.gap_id);
      expect(gapIds).toContain('BGR-NET-R53-001');
      expect(gapIds).toContain('BGR-NET-R53-002');
      expect(gapIds).toContain('BGR-NET-R53-003');
    });
  });

  describe('SER-NET-CF-001 (CloudFront)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-NET-CF-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('cloudfront');
      expect(entry.aws_family).toBe('networking');
      expect(entry.mapping_type).toBe('compound');
      expect(entry.output_mode).toBe('native_emit_only');
      expect(entry.band).toBe('N1');
      expect(entry.confidence).toBe(0.42);
      expect(entry.portable_provider_candidate).toBe(false);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_cdn_frontdoor_profile', 'azurerm_cdn_frontdoor_endpoint', 'azurerm_cdn_frontdoor_route']);
      expect(entry.gcp_targets).toEqual(['google_compute_url_map', 'google_compute_backend_bucket']);
    });

    it('should have 4 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(4);
      const gapIds = entry.behavioral_gaps.map(g => g.gap_id);
      expect(gapIds).toContain('BGR-NET-CF-001');
      expect(gapIds).toContain('BGR-NET-CF-002');
      expect(gapIds).toContain('BGR-NET-CF-003');
      expect(gapIds).toContain('BGR-NET-CF-004');
    });

    it('should have Lambda@Edge gap as blocker with null workaround', () => {
      const lambdaEdgeGap = entry.behavioral_gaps.find(g => g.gap_id === 'BGR-NET-CF-003')!;
      expect(lambdaEdgeGap.severity).toBe('blocker');
      expect(lambdaEdgeGap.workaround).toBeNull();
      expect(lambdaEdgeGap.requires_manual_review).toBe(true);
    });
  });

  describe('SER-NET-NAT-001 (NAT Gateway)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-NET-NAT-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('nat_gateway');
      expect(entry.aws_family).toBe('networking');
      expect(entry.mapping_type).toBe('parametric');
      expect(entry.output_mode).toBe('native_emit_only');
      expect(entry.band).toBe('N1');
      expect(entry.confidence).toBe(0.68);
      expect(entry.portable_provider_candidate).toBe(false);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_nat_gateway', 'azurerm_nat_gateway_public_ip_association']);
      expect(entry.gcp_targets).toEqual(['google_compute_router_nat', 'google_compute_router']);
    });

    it('should have 2 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(2);
      const gapIds = entry.behavioral_gaps.map(g => g.gap_id);
      expect(gapIds).toContain('BGR-NET-NAT-001');
      expect(gapIds).toContain('BGR-NET-NAT-002');
    });
  });

  describe('SER-NET-PEER-001 (VPC Peering)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-NET-PEER-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('vpc_peering');
      expect(entry.aws_family).toBe('networking');
      expect(entry.mapping_type).toBe('direct');
      expect(entry.output_mode).toBe('native_emit_only');
      expect(entry.band).toBe('P2');
      expect(entry.confidence).toBe(0.72);
      expect(entry.portable_provider_candidate).toBe(false);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_virtual_network_peering']);
      expect(entry.gcp_targets).toEqual(['google_compute_network_peering']);
    });

    it('should have 3 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(3);
      const gapIds = entry.behavioral_gaps.map(g => g.gap_id);
      expect(gapIds).toContain('BGR-NET-PEER-001');
      expect(gapIds).toContain('BGR-NET-PEER-002');
      expect(gapIds).toContain('BGR-NET-PEER-003');
    });
  });

  describe('Common Fields', () => {
    it('all new entries should have test_status untested', () => {
      const newEntries = entries.filter(e => e.registry_entry_id !== 'SER-NET-VPC-001');
      for (const entry of newEntries) {
        expect(entry.test_status).toBe('untested');
      }
    });

    it('all new entries should have owner platform-team', () => {
      const newEntries = entries.filter(e => e.registry_entry_id !== 'SER-NET-VPC-001');
      for (const entry of newEntries) {
        expect(entry.owner).toBe('platform-team');
      }
    });

    it('all new entries should have registry_version 2026.03.14', () => {
      const newEntries = entries.filter(e => e.registry_entry_id !== 'SER-NET-VPC-001');
      for (const entry of newEntries) {
        expect(entry.registry_version).toBe('2026.03.14');
      }
    });

    it('all entries should have output_mode native_emit_only', () => {
      for (const entry of entries) {
        expect(entry.output_mode).toBe('native_emit_only');
      }
    });

    it('all entries should have portable_provider_candidate false', () => {
      for (const entry of entries) {
        expect(entry.portable_provider_candidate).toBe(false);
      }
    });

    it('all entries should have non-empty azure_targets and gcp_targets', () => {
      for (const entry of entries) {
        expect(entry.azure_targets.length).toBeGreaterThan(0);
        expect(entry.gcp_targets.length).toBeGreaterThan(0);
      }
    });

    it('only SG and VPC should have manual_review_required true', () => {
      const manualReviewEntries = entries.filter(e => e.manual_review_required);
      expect(manualReviewEntries).toHaveLength(2);
      const ids = manualReviewEntries.map(e => e.registry_entry_id).sort();
      expect(ids).toEqual(['SER-NET-SG-001', 'SER-NET-VPC-001']);
    });

    it('should have correct band distribution: 4 P2 + 5 N1', () => {
      const p2Entries = entries.filter(e => e.band === 'P2');
      const n1Entries = entries.filter(e => e.band === 'N1');
      expect(p2Entries).toHaveLength(4);
      expect(n1Entries).toHaveLength(5);
    });
  });
});
