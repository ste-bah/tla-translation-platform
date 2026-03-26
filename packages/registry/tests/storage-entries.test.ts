import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { loadRegistryFromDirectory } from '../src/loader';
import { validateRegistryEntries } from '../src/validator';
import type { RegistryEntry } from '@tla/shared';

const STORAGE_DATA_DIR = join(__dirname, '..', 'data', 'storage');

describe('Storage Registry Entries', () => {
  let entries: RegistryEntry[];

  beforeAll(async () => {
    const result = await loadRegistryFromDirectory(STORAGE_DATA_DIR);
    expect(result.errors).toHaveLength(0);
    entries = result.entries;
  });

  describe('Loading', () => {
    it('should load 4 storage entries (1 S3 seed + 3 new)', () => {
      expect(entries).toHaveLength(4);
    });

    it('should contain all expected entry IDs', () => {
      const ids = entries.map(e => e.registry_entry_id);
      expect(ids).toContain('SER-STO-S3-001');
      expect(ids).toContain('SER-STO-EBS-001');
      expect(ids).toContain('SER-STO-EFS-001');
      expect(ids).toContain('SER-STO-ECR-001');
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

  describe('SER-STO-EBS-001 (EBS)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-STO-EBS-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('ebs');
      expect(entry.aws_family).toBe('storage');
      expect(entry.mapping_type).toBe('compound');
      expect(entry.output_mode).toBe('native_emit_only');
      expect(entry.band).toBe('N1');
      expect(entry.confidence).toBe(0.65);
      expect(entry.portable_provider_candidate).toBe(false);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_managed_disk', 'azurerm_virtual_machine_data_disk_attachment']);
      expect(entry.gcp_targets).toEqual(['google_compute_disk', 'google_compute_attached_disk']);
    });

    it('should have 3 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(3);
      const gapIds = entry.behavioral_gaps.map(g => g.gap_id);
      expect(gapIds).toContain('BGR-STO-EBS-001');
      expect(gapIds).toContain('BGR-STO-EBS-002');
      expect(gapIds).toContain('BGR-STO-EBS-003');
    });
  });

  describe('SER-STO-EFS-001 (EFS)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-STO-EFS-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('efs');
      expect(entry.aws_family).toBe('storage');
      expect(entry.mapping_type).toBe('structural');
      expect(entry.output_mode).toBe('native_emit_only');
      expect(entry.band).toBe('N1');
      expect(entry.confidence).toBe(0.55);
      expect(entry.portable_provider_candidate).toBe(false);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_storage_account', 'azurerm_storage_share']);
      expect(entry.gcp_targets).toEqual(['google_filestore_instance']);
    });

    it('should have 3 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(3);
      const gapIds = entry.behavioral_gaps.map(g => g.gap_id);
      expect(gapIds).toContain('BGR-STO-EFS-001');
      expect(gapIds).toContain('BGR-STO-EFS-002');
      expect(gapIds).toContain('BGR-STO-EFS-003');
    });
  });

  describe('SER-STO-ECR-001 (ECR)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-STO-ECR-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('ecr');
      expect(entry.aws_family).toBe('storage');
      expect(entry.mapping_type).toBe('direct');
      expect(entry.output_mode).toBe('portable');
      expect(entry.band).toBe('P1');
      expect(entry.confidence).toBe(0.85);
      expect(entry.portable_provider_candidate).toBe(true);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_container_registry']);
      expect(entry.gcp_targets).toEqual(['google_artifact_registry_repository']);
    });

    it('should have 2 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(2);
      const gapIds = entry.behavioral_gaps.map(g => g.gap_id);
      expect(gapIds).toContain('BGR-STO-ECR-001');
      expect(gapIds).toContain('BGR-STO-ECR-002');
    });

    it('should be the only portable candidate among new entries', () => {
      const newEntries = entries.filter(e => e.registry_entry_id !== 'SER-STO-S3-001');
      const portableCandidates = newEntries.filter(e => e.portable_provider_candidate);
      expect(portableCandidates).toHaveLength(1);
      expect(portableCandidates[0].registry_entry_id).toBe('SER-STO-ECR-001');
    });
  });

  describe('Common Fields', () => {
    it('all new entries should have test_status untested', () => {
      const newEntries = entries.filter(e => e.registry_entry_id !== 'SER-STO-S3-001');
      for (const entry of newEntries) {
        expect(entry.test_status).toBe('untested');
      }
    });

    it('all new entries should have owner platform-team', () => {
      const newEntries = entries.filter(e => e.registry_entry_id !== 'SER-STO-S3-001');
      for (const entry of newEntries) {
        expect(entry.owner).toBe('platform-team');
      }
    });

    it('all new entries should have registry_version 2026.03.14', () => {
      const newEntries = entries.filter(e => e.registry_entry_id !== 'SER-STO-S3-001');
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

    it('ECR should be the only portable provider candidate', () => {
      const newEntries = entries.filter(e => e.registry_entry_id !== 'SER-STO-S3-001');
      const portableCandidates = newEntries.filter(e => e.portable_provider_candidate);
      expect(portableCandidates).toHaveLength(1);
      expect(portableCandidates[0].registry_entry_id).toBe('SER-STO-ECR-001');
    });
  });
});
