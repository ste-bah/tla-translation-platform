import { describe, it, expect } from 'vitest';
import { classifyResource } from '../../src/ir/unrecognized-handler.js';
import type { RegistryEntry } from '@tla/shared';

/**
 * Minimal helper to build a partial RegistryEntry for testing.
 */
function makeEntry(overrides: Partial<RegistryEntry>): RegistryEntry {
  return {
    registry_entry_id: 'SER-STO-S3-001',
    aws_service: 's3',
    aws_family: 'storage',
    azure_targets: ['azurerm_storage_account'],
    gcp_targets: ['google_storage_bucket'],
    mapping_type: 'parametric',
    output_mode: 'portable',
    band: 'P1',
    confidence: 0.88,
    portable_provider_candidate: true,
    behavioral_gaps: [],
    manual_review_required: false,
    review_domains: [],
    test_status: 'unit_tested',
    owner: 'platform-team',
    registry_version: '2026.03.13',
    last_updated: '2026-03-13T10:00:00Z',
    related_requirements: ['REQ-REG-001'],
    related_edge_cases: ['EC-005'],
    ...overrides,
  };
}

describe('classifyResource', () => {
  it('returns blocked with confidence 0 when no registry entry exists', () => {
    const result = classifyResource(undefined, 'aws_unknown_thing');

    expect(result.translationStatus).toBe('blocked');
    expect(result.confidence).toBe(0);
  });

  it('returns blocked for mapping_type "none"', () => {
    const entry = makeEntry({ mapping_type: 'none', confidence: 0.5 });
    const result = classifyResource(entry, 'aws_some_resource');

    expect(result.translationStatus).toBe('blocked');
    expect(result.confidence).toBe(0);
  });

  it('returns blocked for band M1', () => {
    const entry = makeEntry({ band: 'M1', mapping_type: 'direct', confidence: 0.7 });
    const result = classifyResource(entry, 'aws_some_resource');

    expect(result.translationStatus).toBe('blocked');
    expect(result.confidence).toBe(0);
  });

  it('returns advisory for output_mode "advisory_manual"', () => {
    const entry = makeEntry({
      output_mode: 'advisory_manual',
      confidence: 0.65,
    });
    const result = classifyResource(entry, 'aws_some_resource');

    expect(result.translationStatus).toBe('advisory');
    expect(result.confidence).toBe(0.65);
  });

  it('returns pending with registry confidence for standard entries', () => {
    const entry = makeEntry({
      mapping_type: 'direct',
      output_mode: 'portable',
      band: 'P1',
      confidence: 0.92,
    });
    const result = classifyResource(entry, 'aws_instance');

    expect(result.translationStatus).toBe('pending');
    expect(result.confidence).toBe(0.92);
  });

  it('returns pending for parametric mapping type', () => {
    const entry = makeEntry({
      mapping_type: 'parametric',
      confidence: 0.88,
    });
    const result = classifyResource(entry, 'aws_s3_bucket');

    expect(result.translationStatus).toBe('pending');
    expect(result.confidence).toBe(0.88);
  });

  it('returns pending for compound mapping type', () => {
    const entry = makeEntry({
      mapping_type: 'compound',
      confidence: 0.75,
    });
    const result = classifyResource(entry, 'aws_ecs_service');

    expect(result.translationStatus).toBe('pending');
    expect(result.confidence).toBe(0.75);
  });

  it('M1 takes precedence over advisory_manual output mode', () => {
    const entry = makeEntry({
      band: 'M1',
      output_mode: 'advisory_manual',
      confidence: 0.5,
    });
    const result = classifyResource(entry, 'aws_something');

    expect(result.translationStatus).toBe('blocked');
    expect(result.confidence).toBe(0);
  });

  it('"none" mapping_type takes precedence over advisory_manual', () => {
    const entry = makeEntry({
      mapping_type: 'none',
      output_mode: 'advisory_manual',
      confidence: 0.3,
    });
    const result = classifyResource(entry, 'aws_something');

    expect(result.translationStatus).toBe('blocked');
    expect(result.confidence).toBe(0);
  });
});
