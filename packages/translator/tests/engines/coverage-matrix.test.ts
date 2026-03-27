import { describe, it, expect } from 'vitest';
import {
  buildCoverageMatrix,
  classifyEntry,
  type CoverageMatrix,
} from '../../src/engines/coverage-matrix.js';
import type { RegistryEntry } from '@tla/shared';

// ---------------------------------------------------------------------------
// Test helper — minimal valid RegistryEntry stub
// ---------------------------------------------------------------------------

function stubEntry(
  overrides: Partial<RegistryEntry> & { aws_service: string; mapping_type: string },
): RegistryEntry {
  return {
    registry_entry_id: 'SER-TEST-TEST-001',
    aws_service: overrides.aws_service,
    aws_family: 'compute',
    azure_targets: [],
    gcp_targets: [],
    mapping_type: overrides.mapping_type as RegistryEntry['mapping_type'],
    output_mode: 'native_emit_only',
    band: 'P1',
    confidence: 0.9,
    portable_provider_candidate: false,
    behavioral_gaps: [],
    manual_review_required: false,
    review_domains: [],
    test_status: 'tested',
    owner: 'test',
    registry_version: '2025.01.01',
    last_updated: '2025-01-01T00:00:00Z',
    related_requirements: [],
    related_edge_cases: [],
    ...overrides,
  } as RegistryEntry;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('coverage-matrix', () => {
  it('classifies specialized handler types correctly', () => {
    const direct = classifyEntry(
      stubEntry({ aws_service: 'aws_s3_bucket', mapping_type: 'direct' }),
    );
    expect(direct.handlerType).toBe('specialized');

    const parametric = classifyEntry(
      stubEntry({ aws_service: 'aws_eks_cluster', mapping_type: 'parametric' }),
    );
    expect(parametric.handlerType).toBe('specialized');

    const compound = classifyEntry(
      stubEntry({ aws_service: 'aws_instance', mapping_type: 'compound' }),
    );
    expect(compound.handlerType).toBe('specialized');

    const structural = classifyEntry(
      stubEntry({ aws_service: 'aws_security_group', mapping_type: 'structural' }),
    );
    expect(structural.handlerType).toBe('specialized');
  });

  it('classifies advisory types correctly', () => {
    // Explicit 'none' mapping_type → advisory
    const noneMapping = classifyEntry(
      stubEntry({ aws_service: 'aws_dynamodb_table', mapping_type: 'none' }),
    );
    expect(noneMapping.handlerType).toBe('advisory');

    // Advisory handler set member even with non-none mapping_type
    const advisorySet = classifyEntry(
      stubEntry({ aws_service: 'aws_iam_role', mapping_type: 'structural' }),
    );
    expect(advisorySet.handlerType).toBe('advisory');

    // Unknown type with mapping_type 'none'
    const unknownNone = classifyEntry(
      stubEntry({ aws_service: 'aws_unknown_service', mapping_type: 'none' }),
    );
    expect(unknownNone.handlerType).toBe('advisory');
  });

  it('classifies unknown types as generic-fallback', () => {
    const unknown = classifyEntry(
      stubEntry({ aws_service: 'aws_some_new_service', mapping_type: 'direct' }),
    );
    expect(unknown.handlerType).toBe('generic-fallback');
    expect(unknown.awsResourceType).toBe('aws_some_new_service');
    expect(unknown.mappingType).toBe('direct');
  });

  it('counts specialized/generic/advisory correctly', () => {
    const entries = [
      stubEntry({ aws_service: 'aws_s3_bucket', mapping_type: 'direct' }),
      stubEntry({ aws_service: 'aws_instance', mapping_type: 'compound' }),
      stubEntry({ aws_service: 'aws_dynamodb_table', mapping_type: 'none' }),
      stubEntry({ aws_service: 'aws_iam_role', mapping_type: 'none' }),
      stubEntry({ aws_service: 'aws_brand_new_thing', mapping_type: 'parametric' }),
    ];

    const matrix: CoverageMatrix = buildCoverageMatrix(entries);

    expect(matrix.specialized).toBe(2);
    expect(matrix.advisory).toBe(2);
    expect(matrix.genericFallback).toBe(1);
    expect(matrix.total).toBe(5);
    expect(matrix.entries).toHaveLength(5);
  });

  it('returns empty matrix for empty registry', () => {
    const matrix = buildCoverageMatrix([]);

    expect(matrix.specialized).toBe(0);
    expect(matrix.genericFallback).toBe(0);
    expect(matrix.advisory).toBe(0);
    expect(matrix.total).toBe(0);
    expect(matrix.entries).toEqual([]);
  });
});
