import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { loadRegistryFromDirectory } from '../src/loader';
import { validateRegistryEntries } from '../src/validator';
import type { RegistryEntry } from '@tla/shared';

const COMPUTE_DATA_DIR = join(__dirname, '..', 'data', 'compute');

describe('Compute Registry Entries', () => {
  let entries: RegistryEntry[];

  beforeAll(async () => {
    const result = await loadRegistryFromDirectory(COMPUTE_DATA_DIR);
    expect(result.errors).toHaveLength(0);
    entries = result.entries;
  });

  describe('Loading', () => {
    it('should load 6 compute entries (1 EC2 + 5 new)', () => {
      expect(entries).toHaveLength(6);
    });

    it('should contain all expected entry IDs', () => {
      const ids = entries.map(e => e.registry_entry_id);
      expect(ids).toContain('SER-COM-EC2-001');
      expect(ids).toContain('SER-COM-LAM-001');
      expect(ids).toContain('SER-COM-ASG-001');
      expect(ids).toContain('SER-CON-ECS-001');
      expect(ids).toContain('SER-CON-EKS-001');
      expect(ids).toContain('SER-CON-FAR-001');
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

  describe('SER-COM-LAM-001 (Lambda)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-COM-LAM-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('lambda');
      expect(entry.aws_family).toBe('compute');
      expect(entry.mapping_type).toBe('parametric');
      expect(entry.output_mode).toBe('native_emit_only');
      expect(entry.band).toBe('N1');
      expect(entry.confidence).toBe(0.70);
      expect(entry.portable_provider_candidate).toBe(false);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_function_app', 'azurerm_linux_function_app']);
      expect(entry.gcp_targets).toEqual(['google_cloudfunctions2_function']);
    });

    it('should have 3 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(3);
      const gapIds = entry.behavioral_gaps.map(g => g.gap_id);
      expect(gapIds).toContain('BGR-COM-LAM-001');
      expect(gapIds).toContain('BGR-COM-LAM-002');
      expect(gapIds).toContain('BGR-COM-LAM-003');
    });
  });

  describe('SER-COM-ASG-001 (ASG)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-COM-ASG-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('asg');
      expect(entry.aws_family).toBe('compute');
      expect(entry.mapping_type).toBe('parametric');
      expect(entry.output_mode).toBe('native_emit_only');
      expect(entry.band).toBe('N1');
      expect(entry.confidence).toBe(0.60);
      expect(entry.portable_provider_candidate).toBe(false);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_linux_virtual_machine_scale_set', 'azurerm_orchestrated_virtual_machine_scale_set']);
      expect(entry.gcp_targets).toEqual(['google_compute_instance_group_manager', 'google_compute_autoscaler']);
    });

    it('should have 3 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(3);
    });
  });

  describe('SER-CON-ECS-001 (ECS)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-CON-ECS-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('ecs');
      expect(entry.aws_family).toBe('containers');
      expect(entry.mapping_type).toBe('structural');
      expect(entry.output_mode).toBe('native_emit_only');
      expect(entry.band).toBe('N1');
      expect(entry.confidence).toBe(0.55);
      expect(entry.portable_provider_candidate).toBe(false);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_container_app', 'azurerm_container_app_environment']);
      expect(entry.gcp_targets).toEqual(['google_cloud_run_v2_service']);
    });

    it('should have 3 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(3);
    });
  });

  describe('SER-CON-EKS-001 (EKS)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-CON-EKS-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('eks');
      expect(entry.aws_family).toBe('containers');
      expect(entry.mapping_type).toBe('direct');
      expect(entry.output_mode).toBe('portable');
      expect(entry.band).toBe('P2');
      expect(entry.confidence).toBe(0.65);
      expect(entry.portable_provider_candidate).toBe(true);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_kubernetes_cluster']);
      expect(entry.gcp_targets).toEqual(['google_container_cluster']);
    });

    it('should have 3 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(3);
    });

    it('should be the only portable candidate among new entries', () => {
      const newEntries = entries.filter(e => e.registry_entry_id !== 'SER-COM-EC2-001');
      const portableCandidates = newEntries.filter(e => e.portable_provider_candidate);
      expect(portableCandidates).toHaveLength(1);
      expect(portableCandidates[0].registry_entry_id).toBe('SER-CON-EKS-001');
    });
  });

  describe('SER-CON-FAR-001 (Fargate)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-CON-FAR-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('fargate');
      expect(entry.aws_family).toBe('containers');
      expect(entry.mapping_type).toBe('parametric');
      expect(entry.output_mode).toBe('native_emit_only');
      expect(entry.band).toBe('N1');
      expect(entry.confidence).toBe(0.50);
      expect(entry.portable_provider_candidate).toBe(false);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_container_group']);
      expect(entry.gcp_targets).toEqual(['google_cloud_run_v2_service']);
    });

    it('should have 3 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(3);
    });
  });

  describe('Common Fields', () => {
    it('all new entries should have test_status untested', () => {
      const newEntries = entries.filter(e => e.registry_entry_id !== 'SER-COM-EC2-001');
      for (const entry of newEntries) {
        expect(entry.test_status).toBe('untested');
      }
    });

    it('all new entries should have owner platform-team', () => {
      const newEntries = entries.filter(e => e.registry_entry_id !== 'SER-COM-EC2-001');
      for (const entry of newEntries) {
        expect(entry.owner).toBe('platform-team');
      }
    });

    it('all new entries should have registry_version 2026.03.14', () => {
      const newEntries = entries.filter(e => e.registry_entry_id !== 'SER-COM-EC2-001');
      for (const entry of newEntries) {
        expect(entry.registry_version).toBe('2026.03.14');
      }
    });

    it('all entries should have non-empty azure_targets and gcp_targets', () => {
      for (const entry of entries) {
        expect(entry.azure_targets.length).toBeGreaterThan(0);
        expect(entry.gcp_targets.length).toBeGreaterThan(0);
      }
    });

    it('all entries should have manual_review_required false', () => {
      const newEntries = entries.filter(e => e.registry_entry_id !== 'SER-COM-EC2-001');
      for (const entry of newEntries) {
        expect(entry.manual_review_required).toBe(false);
        expect(entry.review_domains).toEqual([]);
      }
    });
  });
});
