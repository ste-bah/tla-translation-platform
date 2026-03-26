import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RegistryApi, loadRegistryFromDirectory, validateRegistryEntries } from '@tla/registry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VALID_REGISTRY_DIR = join(__dirname, '..', 'fixtures', 'valid-registry');

describe('Registry E2E Integration', () => {
  let api: RegistryApi;

  beforeAll(async () => {
    api = new RegistryApi(VALID_REGISTRY_DIR, loadRegistryFromDirectory, validateRegistryEntries);
    const result = await api.init();

    // Sanity: init itself should succeed with 0 errors
    expect(result.errors).toHaveLength(0);
  });

  it('loads 3 entries from the valid-registry fixture directory', () => {
    const completeness = api.getCompleteness();
    expect(completeness.totalEntries).toBe(3);
  });

  it('lookup("ec2") returns the EC2 entry', () => {
    const entry = api.lookup('ec2');
    expect(entry).toBeDefined();
    expect(entry!.registry_entry_id).toBe('SER-COM-EC2-001');
    expect(entry!.aws_family).toBe('compute');
    expect(entry!.confidence).toBe(0.92);
  });

  it('search({ family: "compute" }) returns 1 entry', () => {
    const results = api.search({ family: 'compute' });
    expect(results).toHaveLength(1);
    expect(results[0]!.aws_service).toBe('ec2');
  });

  it('search({ band: "P1" }) returns 2 entries', () => {
    const results = api.search({ band: 'P1' });
    expect(results).toHaveLength(2);
    const services = results.map((r) => r.aws_service).sort();
    expect(services).toEqual(['ec2', 's3']);
  });

  it('validate() returns empty array for valid fixtures', () => {
    const results = api.validate();
    expect(results).toEqual([]);
  });

  it('getCompleteness() returns correct totals', () => {
    const completeness = api.getCompleteness();

    expect(completeness.totalEntries).toBe(3);
    expect(completeness.byFamily['compute']).toBe(1);
    expect(completeness.byFamily['storage']).toBe(1);
    expect(completeness.byFamily['networking']).toBe(1);
    expect(completeness.byBand['P1']).toBe(2);
    expect(completeness.byBand['P2']).toBe(1);
    expect(completeness.averageConfidence).toBeCloseTo((0.92 + 0.88 + 0.72) / 3, 5);
  });

  it('getGaps returns behavioral gaps for EC2', () => {
    const gaps = api.getGaps('SER-COM-EC2-001');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.gap_id).toBe('BGR-COM-EC2-001');
    expect(gaps[0]!.gap_type).toBe('feature');
  });

  it('getGaps returns 2 gaps for VPC', () => {
    const gaps = api.getGaps('SER-NET-VPC-001');
    expect(gaps).toHaveLength(2);
  });

  it('getGapsByDomain("networking") returns gaps from VPC entry', () => {
    const gaps = api.getGapsByDomain('networking');
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.some((g) => g.gap_id === 'BGR-NET-VPC-001')).toBe(true);
  });

  it('lookupMany returns Map with found entries', () => {
    const map = api.lookupMany(['ec2', 's3', 'lambda']);
    expect(map.size).toBe(2);
    expect(map.has('ec2')).toBe(true);
    expect(map.has('s3')).toBe(true);
    expect(map.has('lambda')).toBe(false);
  });
});
