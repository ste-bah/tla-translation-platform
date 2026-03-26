import { describe, it, expect, beforeEach } from 'vitest';
import { RegistryApi } from '@tla/registry';
import type { LoadResult, RegistryLoader, RegistryValidator, ValidationResult } from '@tla/registry';
import { RegistryError } from '@tla/shared';
import type { RegistryEntry } from '@tla/shared';
import { createTestEntry } from './helpers.js';

function createFakeLoader(entries: RegistryEntry[]): RegistryLoader {
  return async (_dirPath: string): Promise<LoadResult> => ({
    entries,
    errors: [],
  });
}

function createFakeValidator(results: ValidationResult[] = []): RegistryValidator {
  return (_entries: ReadonlyArray<RegistryEntry>): ValidationResult[] => results;
}

describe('RegistryApi', () => {
  const ec2Entry = createTestEntry({
    registry_entry_id: 'SER-COM-EC2-001',
    aws_service: 'ec2',
    aws_family: 'compute',
    band: 'P1',
    confidence: 0.92,
    behavioral_gaps: [
      {
        gap_id: 'BGR-COM-EC2-001',
        gap_type: 'feature',
        description: 'Placement groups gap',
        severity: 'minor',
        affected_targets: ['azure'],
        workaround: 'Use proximity placement groups',
        requires_manual_review: false,
      },
    ],
    review_domains: [],
  });

  const s3Entry = createTestEntry({
    registry_entry_id: 'SER-STO-S3-001',
    aws_service: 's3',
    aws_family: 'storage',
    band: 'P1',
    confidence: 0.88,
    behavioral_gaps: [],
    review_domains: ['security'],
  });

  const vpcEntry = createTestEntry({
    registry_entry_id: 'SER-NET-VPC-001',
    aws_service: 'vpc',
    aws_family: 'networking',
    band: 'P2',
    confidence: 0.72,
    manual_review_required: true,
    behavioral_gaps: [
      {
        gap_id: 'BGR-NET-VPC-001',
        gap_type: 'topology',
        description: 'VPC topology mismatch',
        severity: 'major',
        affected_targets: ['azure'],
        workaround: null,
        requires_manual_review: true,
      },
    ],
    review_domains: ['networking', 'security'],
  });

  const allEntries = [ec2Entry, s3Entry, vpcEntry];

  describe('before init()', () => {
    it('throws RegistryError for lookup', () => {
      const api = new RegistryApi('/fake', createFakeLoader([]), createFakeValidator());
      expect(() => api.lookup('ec2')).toThrow(RegistryError);
    });

    it('throws RegistryError for search', () => {
      const api = new RegistryApi('/fake', createFakeLoader([]), createFakeValidator());
      expect(() => api.search({})).toThrow(RegistryError);
    });

    it('throws RegistryError for getCompleteness', () => {
      const api = new RegistryApi('/fake', createFakeLoader([]), createFakeValidator());
      expect(() => api.getCompleteness()).toThrow(RegistryError);
    });
  });

  describe('after init()', () => {
    let api: RegistryApi;

    beforeEach(async () => {
      api = new RegistryApi('/fake', createFakeLoader(allEntries), createFakeValidator());
      await api.init();
    });

    describe('lookup', () => {
      it('returns entry by aws_service', () => {
        const result = api.lookup('ec2');
        expect(result).toBeDefined();
        expect(result!.registry_entry_id).toBe('SER-COM-EC2-001');
      });

      it('returns undefined for unknown service', () => {
        const result = api.lookup('dynamodb');
        expect(result).toBeUndefined();
      });
    });

    describe('lookupMany', () => {
      it('returns Map of found entries', () => {
        const result = api.lookupMany(['ec2', 's3', 'nonexistent']);
        expect(result.size).toBe(2);
        expect(result.get('ec2')!.registry_entry_id).toBe('SER-COM-EC2-001');
        expect(result.get('s3')!.registry_entry_id).toBe('SER-STO-S3-001');
        expect(result.has('nonexistent')).toBe(false);
      });
    });

    describe('search', () => {
      it('returns all entries with empty query', () => {
        const results = api.search({});
        expect(results).toHaveLength(3);
      });

      it('filters by family', () => {
        const results = api.search({ family: 'compute' });
        expect(results).toHaveLength(1);
        expect(results[0]!.aws_service).toBe('ec2');
      });

      it('filters by band array', () => {
        const results = api.search({ band: ['P1', 'P2'] });
        expect(results).toHaveLength(3);
      });

      it('filters by single band', () => {
        const results = api.search({ band: 'P2' });
        expect(results).toHaveLength(1);
        expect(results[0]!.aws_service).toBe('vpc');
      });

      it('filters by confidence range', () => {
        const results = api.search({ minConfidence: 0.85, maxConfidence: 0.95 });
        expect(results).toHaveLength(2); // ec2 (0.92) and s3 (0.88)
        const services = results.map((r) => r.aws_service).sort();
        expect(services).toEqual(['ec2', 's3']);
      });

      it('filters by reviewRequired', () => {
        const results = api.search({ reviewRequired: true });
        expect(results).toHaveLength(1);
        expect(results[0]!.aws_service).toBe('vpc');
      });

      it('returns sorted by registry_entry_id', () => {
        const results = api.search({});
        const ids = results.map((r) => r.registry_entry_id);
        const sorted = [...ids].sort();
        expect(ids).toEqual(sorted);
      });
    });

    describe('getGaps', () => {
      it('returns behavioral_gaps array for existing entry', () => {
        const gaps = api.getGaps('SER-COM-EC2-001');
        expect(gaps).toHaveLength(1);
        expect(gaps[0]!.gap_id).toBe('BGR-COM-EC2-001');
      });

      it('returns empty array for entry without gaps', () => {
        const gaps = api.getGaps('SER-STO-S3-001');
        expect(gaps).toHaveLength(0);
      });

      it('returns empty array for non-existent entry', () => {
        const gaps = api.getGaps('SER-XXX-XXX-999');
        expect(gaps).toHaveLength(0);
      });
    });

    describe('getGapsByDomain', () => {
      it('returns gaps from entries matching the domain', () => {
        const gaps = api.getGapsByDomain('networking');
        expect(gaps).toHaveLength(1);
        expect(gaps[0]!.gap_id).toBe('BGR-NET-VPC-001');
      });

      it('returns gaps from multiple entries matching the domain', () => {
        const gaps = api.getGapsByDomain('security');
        // s3Entry has review_domains ['security'] with 0 gaps
        // vpcEntry has review_domains ['networking', 'security'] with 1 gap
        expect(gaps).toHaveLength(1);
      });

      it('returns empty array for domain with no matching entries', () => {
        const gaps = api.getGapsByDomain('compliance');
        expect(gaps).toHaveLength(0);
      });
    });

    describe('getCompleteness', () => {
      it('returns correct total entries', () => {
        const completeness = api.getCompleteness();
        expect(completeness.totalEntries).toBe(3);
      });

      it('returns correct byFamily counts', () => {
        const completeness = api.getCompleteness();
        expect(completeness.byFamily['compute']).toBe(1);
        expect(completeness.byFamily['storage']).toBe(1);
        expect(completeness.byFamily['networking']).toBe(1);
      });

      it('returns correct byBand counts', () => {
        const completeness = api.getCompleteness();
        expect(completeness.byBand['P1']).toBe(2);
        expect(completeness.byBand['P2']).toBe(1);
      });

      it('returns correct averageConfidence', () => {
        const completeness = api.getCompleteness();
        const expected = (0.92 + 0.88 + 0.72) / 3;
        expect(completeness.averageConfidence).toBeCloseTo(expected, 5);
      });

      it('returns 0 averageConfidence when empty', async () => {
        const emptyApi = new RegistryApi(
          '/fake',
          createFakeLoader([]),
          createFakeValidator(),
        );
        await emptyApi.init();

        const completeness = emptyApi.getCompleteness();
        expect(completeness.totalEntries).toBe(0);
        expect(completeness.averageConfidence).toBe(0);
      });

      it('counts untested entries', () => {
        const completeness = api.getCompleteness();
        expect(completeness.untested).toBe(3); // all have test_status 'untested'
      });

      it('counts reviewRequired entries', () => {
        const completeness = api.getCompleteness();
        expect(completeness.reviewRequired).toBe(1); // only vpc
      });
    });

    describe('validate', () => {
      it('calls injected validator with entries', async () => {
        const fakeResults: ValidationResult[] = [
          {
            entryId: 'SER-COM-EC2-001',
            rule: 'test-rule',
            severity: 'warning',
            message: 'test warning',
          },
        ];
        const validatorFn = createFakeValidator(fakeResults);
        const apiWithValidator = new RegistryApi(
          '/fake',
          createFakeLoader(allEntries),
          validatorFn,
        );
        await apiWithValidator.init();

        const results = apiWithValidator.validate();
        expect(results).toEqual(fakeResults);
      });
    });
  });
});
