import { describe, it, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  RegistryApi,
  loadRegistryFromDirectory,
  validateRegistryEntries,
} from '@tla/registry';
import {
  RegistryError,
  TlaError,
  isTlaError,
  RegistryEntrySchema,
} from '@tla/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VALID_REGISTRY_DIR = join(__dirname, '..', 'fixtures', 'valid-registry');
const INVALID_REGISTRY_DIR = join(__dirname, '..', 'fixtures', 'invalid-registry');
const EMPTY_REGISTRY_DIR = join(__dirname, '..', 'fixtures', 'empty-registry');

describe('Cross-Package Integration: shared <-> registry', () => {
  // ---------------------------------------------------------------
  // 1. Error hierarchy propagation across package boundaries
  // ---------------------------------------------------------------
  describe('Error propagation: RegistryError from @tla/shared via @tla/registry', () => {
    it('throws RegistryError when API methods called before init()', () => {
      const api = new RegistryApi(
        VALID_REGISTRY_DIR,
        loadRegistryFromDirectory,
        validateRegistryEntries,
      );

      expect(() => api.lookup('ec2')).toThrow(RegistryError);
    });

    it('RegistryError is instanceof TlaError (cross-package hierarchy)', () => {
      const api = new RegistryApi(
        VALID_REGISTRY_DIR,
        loadRegistryFromDirectory,
        validateRegistryEntries,
      );

      try {
        api.lookup('ec2');
        expect.fail('Should have thrown');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(RegistryError);
        expect(err).toBeInstanceOf(TlaError);
        expect(err).toBeInstanceOf(Error);
        expect(isTlaError(err)).toBe(true);

        const regErr = err as RegistryError;
        expect(regErr.code).toBe('REGISTRY_ERROR');
        expect(regErr.context).toEqual({ dirPath: VALID_REGISTRY_DIR });
        expect(regErr.name).toBe('RegistryError');
      }
    });

    it('RegistryError.toJSON() produces serializable output', () => {
      const api = new RegistryApi(
        VALID_REGISTRY_DIR,
        loadRegistryFromDirectory,
        validateRegistryEntries,
      );

      try {
        api.search({ family: 'compute' });
        expect.fail('Should have thrown');
      } catch (err: unknown) {
        const regErr = err as RegistryError;
        const json = regErr.toJSON();
        expect(json.name).toBe('RegistryError');
        expect(json.code).toBe('REGISTRY_ERROR');
        expect(typeof json.message).toBe('string');
        // Must be JSON-serializable
        const str = JSON.stringify(json);
        expect(typeof str).toBe('string');
      }
    });

    it('all query methods throw before init()', () => {
      const api = new RegistryApi(
        VALID_REGISTRY_DIR,
        loadRegistryFromDirectory,
        validateRegistryEntries,
      );

      expect(() => api.lookup('ec2')).toThrow(RegistryError);
      expect(() => api.lookupMany(['ec2'])).toThrow(RegistryError);
      expect(() => api.search({})).toThrow(RegistryError);
      expect(() => api.getGaps('SER-COM-EC2-001')).toThrow(RegistryError);
      expect(() => api.getGapsByDomain('networking')).toThrow(RegistryError);
      expect(() => api.getCompleteness()).toThrow(RegistryError);
      expect(() => api.validate()).toThrow(RegistryError);
    });
  });

  // ---------------------------------------------------------------
  // 2. Loader -> Zod schema validation (shared schema in registry loader)
  // ---------------------------------------------------------------
  describe('Loader -> Zod schema integration (invalid YAML content)', () => {
    it('returns schema validation errors for missing required fields', async () => {
      const result = await loadRegistryFromDirectory(INVALID_REGISTRY_DIR);

      // bad-yaml-syntax.yaml should produce a YAML parse error
      const yamlErrors = result.errors.filter((e) =>
        e.message.includes('YAML parse error'),
      );
      expect(yamlErrors.length).toBeGreaterThanOrEqual(1);

      // missing-required-field.yaml is missing aws_service -> schema validation failure
      const schemaErrors = result.errors.filter((e) =>
        e.message.includes('Schema validation failed'),
      );
      expect(schemaErrors.length).toBeGreaterThanOrEqual(1);
      expect(schemaErrors[0]!.issues).toBeDefined();
      expect(schemaErrors[0]!.issues!.length).toBeGreaterThan(0);
    });

    it('returns 0 valid entries from invalid registry', async () => {
      const result = await loadRegistryFromDirectory(INVALID_REGISTRY_DIR);
      expect(result.entries).toHaveLength(0);
    });

    it('accumulates errors without throwing', async () => {
      // The loader should never throw; errors are accumulated
      const result = await loadRegistryFromDirectory(INVALID_REGISTRY_DIR);
      expect(result.errors.length).toBeGreaterThan(0);
      // No exception was thrown - that's the assertion
    });
  });

  // ---------------------------------------------------------------
  // 3. Empty registry: loader -> validator -> API pipeline
  // ---------------------------------------------------------------
  describe('Empty registry pipeline', () => {
    it('loads 0 entries from empty directory', async () => {
      const result = await loadRegistryFromDirectory(EMPTY_REGISTRY_DIR);
      expect(result.entries).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('API initializes successfully with empty registry', async () => {
      const api = new RegistryApi(
        EMPTY_REGISTRY_DIR,
        loadRegistryFromDirectory,
        validateRegistryEntries,
      );
      const result = await api.init();

      expect(result.entries).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('queries return empty results on empty registry', async () => {
      const api = new RegistryApi(
        EMPTY_REGISTRY_DIR,
        loadRegistryFromDirectory,
        validateRegistryEntries,
      );
      await api.init();

      expect(api.lookup('ec2')).toBeUndefined();
      expect(api.lookupMany(['ec2', 's3']).size).toBe(0);
      expect(api.search({})).toHaveLength(0);
      expect(api.search({ family: 'compute' })).toHaveLength(0);
      expect(api.getGaps('SER-COM-EC2-001')).toHaveLength(0);
      expect(api.getGapsByDomain('networking')).toHaveLength(0);
      expect(api.validate()).toHaveLength(0);

      const completeness = api.getCompleteness();
      expect(completeness.totalEntries).toBe(0);
      expect(completeness.averageConfidence).toBe(0);
      expect(completeness.untested).toBe(0);
      expect(completeness.reviewRequired).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  // 4. Non-existent directory: loader error propagation to API
  // ---------------------------------------------------------------
  describe('Non-existent directory error propagation', () => {
    it('loader returns directory read error without throwing', async () => {
      const result = await loadRegistryFromDirectory('/nonexistent/path/to/registry');
      expect(result.entries).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.message).toContain('Failed to read directory');
    });

    it('API init succeeds but surfaces loader errors', async () => {
      const api = new RegistryApi(
        '/nonexistent/path/to/registry',
        loadRegistryFromDirectory,
        validateRegistryEntries,
      );
      const result = await api.init();

      expect(result.entries).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      // API should still be initialized (can query, will find nothing)
      expect(api.lookup('ec2')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // 5. Reload scenario: load -> modify filesystem -> reload -> verify
  // ---------------------------------------------------------------
  describe('Reload: atomic index update after filesystem change', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = join(tmpdir(), `tla-integration-${randomUUID()}`);
      await mkdir(tempDir, { recursive: true });
      // Copy valid registry to temp
      await cp(VALID_REGISTRY_DIR, tempDir, { recursive: true });
    });

    it('reload picks up new entries added to directory', async () => {
      const api = new RegistryApi(
        tempDir,
        loadRegistryFromDirectory,
        validateRegistryEntries,
      );
      const initResult = await api.init();
      expect(initResult.entries).toHaveLength(3);
      expect(api.lookup('lambda')).toBeUndefined();

      // Add a new entry YAML
      const newEntry = `
registry_entry_id: "SER-SLS-LAM-001"
aws_service: "lambda"
aws_family: "serverless"
azure_targets: ["azurerm_function_app"]
gcp_targets: ["google_cloudfunctions_function"]
mapping_type: "parametric"
output_mode: "portable"
band: "P1"
confidence: 0.85
portable_provider_candidate: true
behavioral_gaps: []
manual_review_required: false
review_domains: []
test_status: "unit_tested"
owner: "serverless-team"
registry_version: "2026.03.14"
last_updated: "2026-03-14T12:00:00Z"
related_requirements: ["REQ-SLS-001"]
related_edge_cases: ["EC-020"]
`;
      await mkdir(join(tempDir, 'serverless'), { recursive: true });
      await writeFile(join(tempDir, 'serverless', 'SER-SLS-LAM-001.yaml'), newEntry);

      // Reload
      const reloadResult = await api.reload();
      expect(reloadResult.entries).toHaveLength(4);

      // New entry accessible via lookup
      const lambda = api.lookup('lambda');
      expect(lambda).toBeDefined();
      expect(lambda!.registry_entry_id).toBe('SER-SLS-LAM-001');
      expect(lambda!.aws_family).toBe('serverless');

      // Search by new family
      const serverless = api.search({ family: 'serverless' });
      expect(serverless).toHaveLength(1);

      // Completeness updated
      const completeness = api.getCompleteness();
      expect(completeness.totalEntries).toBe(4);
      expect(completeness.byFamily['serverless']).toBe(1);
    });

    it('reload removes entries deleted from directory', async () => {
      const api = new RegistryApi(
        tempDir,
        loadRegistryFromDirectory,
        validateRegistryEntries,
      );
      await api.init();
      expect(api.lookup('ec2')).toBeDefined();

      // Delete EC2 file
      await rm(join(tempDir, 'compute', 'SER-COM-EC2-001.yaml'));

      // Reload
      const reloadResult = await api.reload();
      expect(reloadResult.entries).toHaveLength(2);

      // EC2 no longer accessible
      expect(api.lookup('ec2')).toBeUndefined();
      expect(api.search({ family: 'compute' })).toHaveLength(0);

      // Completeness updated
      const completeness = api.getCompleteness();
      expect(completeness.totalEntries).toBe(2);
      expect(completeness.byFamily['compute']).toBeUndefined();
    });

    it('reload atomically replaces all indexes', async () => {
      const api = new RegistryApi(
        tempDir,
        loadRegistryFromDirectory,
        validateRegistryEntries,
      );
      await api.init();

      // Verify initial band distribution
      expect(api.search({ band: 'P1' })).toHaveLength(2);
      expect(api.search({ band: 'P2' })).toHaveLength(1);

      // Delete VPC (P2 entry), add new P1 entry
      await rm(join(tempDir, 'networking', 'SER-NET-VPC-001.yaml'));
      const newEntry = `
registry_entry_id: "SER-DB-RDS-001"
aws_service: "rds"
aws_family: "database"
azure_targets: ["azurerm_postgresql_flexible_server"]
gcp_targets: ["google_sql_database_instance"]
mapping_type: "parametric"
output_mode: "portable"
band: "P1"
confidence: 0.90
portable_provider_candidate: true
behavioral_gaps: []
manual_review_required: false
review_domains: []
test_status: "unit_tested"
owner: "database-team"
registry_version: "2026.03.14"
last_updated: "2026-03-14T12:00:00Z"
related_requirements: ["REQ-DB-001"]
related_edge_cases: ["EC-030"]
`;
      await mkdir(join(tempDir, 'database'), { recursive: true });
      await writeFile(join(tempDir, 'database', 'SER-DB-RDS-001.yaml'), newEntry);

      await api.reload();

      // P2 should be gone, P1 should have 3
      expect(api.search({ band: 'P2' })).toHaveLength(0);
      expect(api.search({ band: 'P1' })).toHaveLength(3);

      // VPC gaps should be gone
      expect(api.getGaps('SER-NET-VPC-001')).toHaveLength(0);
      expect(api.getGapsByDomain('networking')).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------
  // 6. Validator cross-entry rules via programmatic loader injection
  // ---------------------------------------------------------------
  describe('Validator cross-entry rules through API.validate()', () => {
    it('detects duplicate IDs when injected via custom loader', async () => {
      // Create a custom loader that returns duplicate entries
      const duplicateLoader = async () => {
        const result = await loadRegistryFromDirectory(VALID_REGISTRY_DIR);
        // Duplicate the first entry
        const entries = [...result.entries, result.entries[0]!];
        return { entries, errors: result.errors };
      };

      const api = new RegistryApi(
        VALID_REGISTRY_DIR,
        duplicateLoader,
        validateRegistryEntries,
      );
      await api.init();

      const validationResults = api.validate();
      const duplicateIdErrors = validationResults.filter(
        (r) => r.rule === 'no-duplicate-ids',
      );
      expect(duplicateIdErrors.length).toBeGreaterThan(0);
    });

    it('detects duplicate aws_service when injected via custom loader', async () => {
      const duplicateServiceLoader = async () => {
        const result = await loadRegistryFromDirectory(VALID_REGISTRY_DIR);
        // Create a modified copy with same aws_service but different id
        const original = result.entries[0]!;
        const duplicate = {
          ...original,
          registry_entry_id: 'SER-COM-DUP-001',
        };
        return {
          entries: [...result.entries, duplicate],
          errors: result.errors,
        };
      };

      const api = new RegistryApi(
        VALID_REGISTRY_DIR,
        duplicateServiceLoader,
        validateRegistryEntries,
      );
      await api.init();

      const validationResults = api.validate();
      const dupServiceErrors = validationResults.filter(
        (r) => r.rule === 'no-duplicate-aws-service',
      );
      expect(dupServiceErrors.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------
  // 7. Advanced search: multi-field AND logic integration
  // ---------------------------------------------------------------
  describe('Search multi-field AND logic across loaded entries', () => {
    let api: RegistryApi;

    beforeEach(async () => {
      api = new RegistryApi(
        VALID_REGISTRY_DIR,
        loadRegistryFromDirectory,
        validateRegistryEntries,
      );
      await api.init();
    });

    it('search with minConfidence filters correctly', () => {
      const highConf = api.search({ minConfidence: 0.90 });
      expect(highConf.every((e) => e.confidence >= 0.90)).toBe(true);
      // EC2 = 0.92, S3 = 0.88, VPC = 0.72 -> only EC2
      expect(highConf).toHaveLength(1);
      expect(highConf[0]!.aws_service).toBe('ec2');
    });

    it('search with maxConfidence filters correctly', () => {
      const lowConf = api.search({ maxConfidence: 0.80 });
      expect(lowConf.every((e) => e.confidence <= 0.80)).toBe(true);
      // Only VPC = 0.72
      expect(lowConf).toHaveLength(1);
      expect(lowConf[0]!.aws_service).toBe('vpc');
    });

    it('search combining family + band returns intersection', () => {
      // compute + P1 -> EC2
      const results = api.search({ family: 'compute', band: 'P1' });
      expect(results).toHaveLength(1);
      expect(results[0]!.aws_service).toBe('ec2');
    });

    it('search combining family + band with no match returns empty', () => {
      // compute + P2 -> nothing
      const results = api.search({ family: 'compute', band: 'P2' });
      expect(results).toHaveLength(0);
    });

    it('search with mappingType filter works', () => {
      const direct = api.search({ mappingType: 'direct' });
      expect(direct).toHaveLength(1);
      expect(direct[0]!.aws_service).toBe('ec2');

      const structural = api.search({ mappingType: 'structural' });
      expect(structural).toHaveLength(1);
      expect(structural[0]!.aws_service).toBe('vpc');
    });

    it('search with reviewRequired filter works', () => {
      const needsReview = api.search({ reviewRequired: true });
      expect(needsReview).toHaveLength(1);
      expect(needsReview[0]!.aws_service).toBe('vpc');

      const noReview = api.search({ reviewRequired: false });
      expect(noReview).toHaveLength(2);
    });

    it('search with portableCandidate filter works', () => {
      const portable = api.search({ portableCandidate: true });
      expect(portable).toHaveLength(2); // EC2 + S3

      const nonPortable = api.search({ portableCandidate: false });
      expect(nonPortable).toHaveLength(1); // VPC
    });

    it('search with testStatus filter works', () => {
      const unitTested = api.search({ testStatus: 'unit_tested' });
      expect(unitTested).toHaveLength(3); // all are unit_tested

      const e2e = api.search({ testStatus: 'e2e_validated' });
      expect(e2e).toHaveLength(0);
    });

    it('search with array filters works (band as array)', () => {
      const results = api.search({ band: ['P1', 'P2'] });
      expect(results).toHaveLength(3); // all entries

      const p1Only = api.search({ band: ['P1'] });
      expect(p1Only).toHaveLength(2);
    });

    it('search with all filters combined returns precise result', () => {
      const results = api.search({
        family: 'storage',
        band: 'P1',
        mappingType: 'parametric',
        minConfidence: 0.80,
        maxConfidence: 0.95,
        reviewRequired: false,
        portableCandidate: true,
        testStatus: 'unit_tested',
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.aws_service).toBe('s3');
    });

    it('empty query returns all entries sorted by id', () => {
      const all = api.search({});
      expect(all).toHaveLength(3);
      // Should be sorted by registry_entry_id
      const ids = all.map((e) => e.registry_entry_id);
      expect(ids).toEqual([...ids].sort());
    });
  });

  // ---------------------------------------------------------------
  // 8. Zod schema validation at loader boundary (shared schema)
  // ---------------------------------------------------------------
  describe('Zod schema boundary: RegistryEntrySchema from @tla/shared', () => {
    it('rejects entry with invalid enum value for aws_family', () => {
      const result = RegistryEntrySchema.safeParse({
        registry_entry_id: 'SER-COM-TST-001',
        aws_service: 'test',
        aws_family: 'invalid_family',
        azure_targets: [],
        gcp_targets: [],
        mapping_type: 'direct',
        output_mode: 'portable',
        band: 'P1',
        confidence: 0.9,
        portable_provider_candidate: false,
        behavioral_gaps: [],
        manual_review_required: false,
        review_domains: [],
        test_status: 'untested',
        owner: 'test-team',
        registry_version: '2026.03.14',
        last_updated: '2026-03-14T00:00:00Z',
        related_requirements: [],
        related_edge_cases: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects entry with confidence outside [0,1]', () => {
      const result = RegistryEntrySchema.safeParse({
        registry_entry_id: 'SER-COM-TST-001',
        aws_service: 'test',
        aws_family: 'compute',
        azure_targets: [],
        gcp_targets: [],
        mapping_type: 'direct',
        output_mode: 'portable',
        band: 'P1',
        confidence: 1.5,
        portable_provider_candidate: false,
        behavioral_gaps: [],
        manual_review_required: false,
        review_domains: [],
        test_status: 'untested',
        owner: 'test-team',
        registry_version: '2026.03.14',
        last_updated: '2026-03-14T00:00:00Z',
        related_requirements: [],
        related_edge_cases: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects entry with invalid registry_entry_id format', () => {
      const result = RegistryEntrySchema.safeParse({
        registry_entry_id: 'INVALID-FORMAT',
        aws_service: 'test',
        aws_family: 'compute',
        azure_targets: [],
        gcp_targets: [],
        mapping_type: 'direct',
        output_mode: 'portable',
        band: 'P1',
        confidence: 0.9,
        portable_provider_candidate: false,
        behavioral_gaps: [],
        manual_review_required: false,
        review_domains: [],
        test_status: 'untested',
        owner: 'test-team',
        registry_version: '2026.03.14',
        last_updated: '2026-03-14T00:00:00Z',
        related_requirements: [],
        related_edge_cases: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects extra fields (strict mode)', () => {
      const result = RegistryEntrySchema.safeParse({
        registry_entry_id: 'SER-COM-TST-001',
        aws_service: 'test',
        aws_family: 'compute',
        azure_targets: [],
        gcp_targets: [],
        mapping_type: 'direct',
        output_mode: 'portable',
        band: 'P1',
        confidence: 0.9,
        portable_provider_candidate: false,
        behavioral_gaps: [],
        manual_review_required: false,
        review_domains: [],
        test_status: 'untested',
        owner: 'test-team',
        registry_version: '2026.03.14',
        last_updated: '2026-03-14T00:00:00Z',
        related_requirements: [],
        related_edge_cases: [],
        extra_field: 'should_be_rejected',
      });
      expect(result.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // 9. Full pipeline: loader errors -> validator -> API init
  // ---------------------------------------------------------------
  describe('Full pipeline with partial errors', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = join(tmpdir(), `tla-partial-${randomUUID()}`);
      await mkdir(tempDir, { recursive: true });
    });

    it('loads valid entries and accumulates errors for invalid ones', async () => {
      // Write one valid and one invalid YAML
      const validYaml = `
registry_entry_id: "SER-COM-TST-001"
aws_service: "test-valid"
aws_family: "compute"
azure_targets: ["azurerm_linux_virtual_machine"]
gcp_targets: ["google_compute_instance"]
mapping_type: "direct"
output_mode: "portable"
band: "P1"
confidence: 0.95
portable_provider_candidate: true
behavioral_gaps: []
manual_review_required: false
review_domains: []
test_status: "unit_tested"
owner: "test-team"
registry_version: "2026.03.14"
last_updated: "2026-03-14T12:00:00Z"
related_requirements: ["REQ-TST-001"]
related_edge_cases: ["EC-099"]
`;
      const invalidYaml = `
registry_entry_id: "INVALID"
aws_service: "test-invalid"
confidence: "not-a-number"
`;
      await writeFile(join(tempDir, 'valid.yaml'), validYaml);
      await writeFile(join(tempDir, 'invalid.yaml'), invalidYaml);

      const api = new RegistryApi(
        tempDir,
        loadRegistryFromDirectory,
        validateRegistryEntries,
      );
      const result = await api.init();

      // Should have loaded the valid entry
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.aws_service).toBe('test-valid');

      // Should have error for the invalid entry
      expect(result.errors.length).toBeGreaterThan(0);

      // API should be functional with the valid entry
      expect(api.lookup('test-valid')).toBeDefined();
      expect(api.lookup('test-invalid')).toBeUndefined();
    });
  });
});
