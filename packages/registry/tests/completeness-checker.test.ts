import { describe, it, expect } from 'vitest';
import { checkCompleteness } from '@tla/registry';
import type { CatalogueItem } from '@tla/registry';
import { createTestEntry } from './helpers.js';

describe('checkCompleteness', () => {
  it('returns empty report for empty inputs', () => {
    const report = checkCompleteness([], []);
    expect(report.covered).toEqual([]);
    expect(report.missing).toEqual([]);
    expect(report.unrecognised).toEqual([]);
    expect(report.byFamily).toEqual([]);
  });

  it('identifies all entries as unrecognised when catalogue is empty', () => {
    const entries = [
      createTestEntry({ aws_service: 'ec2' }),
      createTestEntry({ registry_entry_id: 'SER-COM-BBB-001', aws_service: 's3' }),
    ];
    const report = checkCompleteness(entries, []);
    expect(report.covered).toEqual([]);
    expect(report.missing).toEqual([]);
    expect(report.unrecognised).toEqual(['ec2', 's3']);
  });

  it('identifies all catalogue items as missing when no entries', () => {
    const catalogue: CatalogueItem[] = [
      { awsService: 'ec2', family: 'compute' },
      { awsService: 's3', family: 'storage' },
    ];
    const report = checkCompleteness([], catalogue);
    expect(report.covered).toEqual([]);
    expect(report.missing).toEqual(['ec2', 's3']);
    expect(report.unrecognised).toEqual([]);
  });

  it('identifies covered, missing, and unrecognised correctly', () => {
    const entries = [
      createTestEntry({ aws_service: 'ec2' }),
      createTestEntry({ registry_entry_id: 'SER-COM-BBB-001', aws_service: 'lambda' }),
      createTestEntry({ registry_entry_id: 'SER-COM-CCC-001', aws_service: 'custom-svc' }),
    ];
    const catalogue: CatalogueItem[] = [
      { awsService: 'ec2', family: 'compute' },
      { awsService: 'lambda', family: 'serverless' },
      { awsService: 's3', family: 'storage' },
    ];

    const report = checkCompleteness(entries, catalogue);
    expect(report.covered).toEqual(['ec2', 'lambda']);
    expect(report.missing).toEqual(['s3']);
    expect(report.unrecognised).toEqual(['custom-svc']);
  });

  it('produces per-family breakdown', () => {
    const entries = [
      createTestEntry({ aws_service: 'ec2' }),
      createTestEntry({ registry_entry_id: 'SER-COM-BBB-001', aws_service: 'lambda' }),
    ];
    const catalogue: CatalogueItem[] = [
      { awsService: 'ec2', family: 'compute' },
      { awsService: 'ecs', family: 'compute' },
      { awsService: 'lambda', family: 'serverless' },
      { awsService: 'step-functions', family: 'serverless' },
    ];

    const report = checkCompleteness(entries, catalogue);

    expect(report.byFamily).toHaveLength(2);

    const computeFamily = report.byFamily.find((f) => f.family === 'compute');
    expect(computeFamily).toBeDefined();
    expect(computeFamily!.covered).toEqual(['ec2']);
    expect(computeFamily!.missing).toEqual(['ecs']);

    const serverlessFamily = report.byFamily.find((f) => f.family === 'serverless');
    expect(serverlessFamily).toBeDefined();
    expect(serverlessFamily!.covered).toEqual(['lambda']);
    expect(serverlessFamily!.missing).toEqual(['step-functions']);
  });

  it('sorts all output arrays alphabetically', () => {
    const entries = [
      createTestEntry({ aws_service: 'z-service' }),
      createTestEntry({ registry_entry_id: 'SER-COM-BBB-001', aws_service: 'a-service' }),
    ];
    const catalogue: CatalogueItem[] = [
      { awsService: 'z-service', family: 'compute' },
      { awsService: 'a-service', family: 'compute' },
      { awsService: 'm-service', family: 'compute' },
    ];

    const report = checkCompleteness(entries, catalogue);
    expect(report.covered).toEqual(['a-service', 'z-service']);
    expect(report.missing).toEqual(['m-service']);
  });

  it('handles full coverage (no missing, no unrecognised)', () => {
    const entries = [
      createTestEntry({ aws_service: 'ec2' }),
      createTestEntry({ registry_entry_id: 'SER-COM-BBB-001', aws_service: 's3' }),
    ];
    const catalogue: CatalogueItem[] = [
      { awsService: 'ec2', family: 'compute' },
      { awsService: 's3', family: 'storage' },
    ];

    const report = checkCompleteness(entries, catalogue);
    expect(report.covered).toEqual(['ec2', 's3']);
    expect(report.missing).toEqual([]);
    expect(report.unrecognised).toEqual([]);
  });
});
