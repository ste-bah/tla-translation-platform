import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { loadRegistryFromDirectory } from '../src/loader';
import { validateRegistryEntries } from '../src/validator';
import type { RegistryEntry } from '@tla/shared';

const DATABASE_DATA_DIR = join(__dirname, '..', 'data', 'database');

describe('Database Registry Entries', () => {
  let entries: RegistryEntry[];

  beforeAll(async () => {
    const result = await loadRegistryFromDirectory(DATABASE_DATA_DIR);
    expect(result.errors).toHaveLength(0);
    entries = result.entries;
  });

  describe('Loading', () => {
    it('should load 3 database entries', () => {
      expect(entries).toHaveLength(3);
    });

    it('should contain all expected entry IDs', () => {
      const ids = entries.map(e => e.registry_entry_id);
      expect(ids).toContain('SER-DAT-RDS-001');
      expect(ids).toContain('SER-DAT-DDB-001');
      expect(ids).toContain('SER-DAT-ELC-001');
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

  describe('SER-DAT-RDS-001 (RDS)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-DAT-RDS-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('rds');
      expect(entry.aws_family).toBe('database');
      expect(entry.mapping_type).toBe('compound');
      expect(entry.output_mode).toBe('native_emit_only');
      expect(entry.band).toBe('P2');
      expect(entry.confidence).toBe(0.70);
      expect(entry.portable_provider_candidate).toBe(false);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_mysql_flexible_server', 'azurerm_postgresql_flexible_server', 'azurerm_mssql_server']);
      expect(entry.gcp_targets).toEqual(['google_sql_database_instance']);
    });

    it('should have 3 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(3);
      const gapIds = entry.behavioral_gaps.map(g => g.gap_id);
      expect(gapIds).toContain('BGR-DAT-RDS-001');
      expect(gapIds).toContain('BGR-DAT-RDS-002');
      expect(gapIds).toContain('BGR-DAT-RDS-003');
    });
  });

  describe('SER-DAT-DDB-001 (DynamoDB)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-DAT-DDB-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('dynamodb');
      expect(entry.aws_family).toBe('database');
      expect(entry.mapping_type).toBe('none');
      expect(entry.output_mode).toBe('advisory_manual');
      expect(entry.band).toBe('M1');
      expect(entry.confidence).toBe(0.25);
      expect(entry.portable_provider_candidate).toBe(false);
    });

    it('should have empty targets (M1 manual-only)', () => {
      expect(entry.azure_targets).toEqual([]);
      expect(entry.gcp_targets).toEqual([]);
    });

    it('should require manual review', () => {
      expect(entry.manual_review_required).toBe(true);
      expect(entry.review_domains).toEqual(['data']);
    });

    it('should have 2 blocker behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(2);
      const gapIds = entry.behavioral_gaps.map(g => g.gap_id);
      expect(gapIds).toContain('BGR-DAT-DDB-001');
      expect(gapIds).toContain('BGR-DAT-DDB-002');
      for (const gap of entry.behavioral_gaps) {
        expect(gap.severity).toBe('blocker');
        expect(gap.workaround).toBeNull();
        expect(gap.requires_manual_review).toBe(true);
      }
    });
  });

  describe('SER-DAT-ELC-001 (ElastiCache Redis)', () => {
    let entry: RegistryEntry;
    beforeAll(() => {
      entry = entries.find(e => e.registry_entry_id === 'SER-DAT-ELC-001')!;
    });

    it('should have correct core fields', () => {
      expect(entry.aws_service).toBe('elasticache_redis');
      expect(entry.aws_family).toBe('database');
      expect(entry.mapping_type).toBe('direct');
      expect(entry.output_mode).toBe('portable');
      expect(entry.band).toBe('P1');
      expect(entry.confidence).toBe(0.82);
      expect(entry.portable_provider_candidate).toBe(true);
    });

    it('should have correct targets', () => {
      expect(entry.azure_targets).toEqual(['azurerm_redis_cache']);
      expect(entry.gcp_targets).toEqual(['google_redis_instance']);
    });

    it('should have 2 behavioral gaps', () => {
      expect(entry.behavioral_gaps).toHaveLength(2);
      const gapIds = entry.behavioral_gaps.map(g => g.gap_id);
      expect(gapIds).toContain('BGR-DAT-ELC-001');
      expect(gapIds).toContain('BGR-DAT-ELC-002');
    });

    it('should be the only portable candidate', () => {
      const portableCandidates = entries.filter(e => e.portable_provider_candidate);
      expect(portableCandidates).toHaveLength(1);
      expect(portableCandidates[0].registry_entry_id).toBe('SER-DAT-ELC-001');
    });
  });

  describe('Common Fields', () => {
    it('all entries should have test_status untested', () => {
      for (const entry of entries) {
        expect(entry.test_status).toBe('untested');
      }
    });

    it('all entries should have owner platform-team', () => {
      for (const entry of entries) {
        expect(entry.owner).toBe('platform-team');
      }
    });

    it('all entries should have registry_version 2026.03.14', () => {
      for (const entry of entries) {
        expect(entry.registry_version).toBe('2026.03.14');
      }
    });

    it('non-M1 entries should have non-empty targets', () => {
      const nonM1 = entries.filter(e => e.band !== 'M1');
      for (const entry of nonM1) {
        expect(entry.azure_targets.length).toBeGreaterThan(0);
        expect(entry.gcp_targets.length).toBeGreaterThan(0);
      }
    });

    it('DynamoDB should have manual_review true, review_domains ["data"], and empty targets', () => {
      const ddb = entries.find(e => e.registry_entry_id === 'SER-DAT-DDB-001')!;
      expect(ddb.manual_review_required).toBe(true);
      expect(ddb.review_domains).toEqual(['data']);
      expect(ddb.azure_targets).toEqual([]);
      expect(ddb.gcp_targets).toEqual([]);
    });

    it('ElastiCache should be the only portable provider candidate', () => {
      const portableCandidates = entries.filter(e => e.portable_provider_candidate);
      expect(portableCandidates).toHaveLength(1);
      expect(portableCandidates[0].registry_entry_id).toBe('SER-DAT-ELC-001');
    });
  });
});
