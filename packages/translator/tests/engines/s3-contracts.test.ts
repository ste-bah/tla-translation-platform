import { describe, it, expect, vi } from 'vitest';
import { translateS3 } from '../../src/engines/direct/s3-mapping.js';

function makeContext(targetProvider, attrs = {}) {
  const resource = {
    id: 'aws_s3_bucket.assets',
    sourceType: 'aws_s3_bucket',
    sourceName: 'assets',
    sourceModule: null,
    category: 'storage',
    attributes: { bucket: 'assets-bucket', ...attrs },
    sourceAttributes: { bucket: 'assets-bucket', ...attrs },
    registryEntryId: 'SER-STORAGE-S3-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
  };

  return {
    targetProvider,
    resource,
    registryEntry: {
      registry_entry_id: 'SER-STORAGE-S3-001',
      aws_service: 'aws_s3_bucket',
      aws_family: 'storage',
      azure_targets: ['azurerm_storage_account', 'azurerm_storage_container'],
      gcp_targets: ['google_storage_bucket'],
      mapping_type: 'direct',
      output_mode: 'native_emit_only',
      band: 'P1',
      confidence: 0.92,
      portable_provider_candidate: false,
      behavioral_gaps: [],
      manual_review_required: false,
      review_domains: [],
      test_status: 'passing',
      owner: 'team-infra',
      registry_version: '2025.03.01',
      last_updated: '2025-03-01T00:00:00Z',
      related_requirements: [],
      related_edge_cases: [],
    },
    relationships: [],
    siblingResources: [],
    ir: {
      version: '1.0.0',
      sourceProvider: 'aws',
      resources: [resource],
      relationships: [],
      modules: [],
      intents: [],
      metadata: { generatedAt: '2025-03-01T00:00:00Z', sourceFiles: ['main.tf'], toolVersion: '0.1.0' },
    },
    registry: { lookup: vi.fn(), lookupMany: vi.fn() },
    options: { targetProvider, registryVersion: '2025.03.01', emitComments: true, sortKeys: true },
  };
}

describe('translateS3 contracts', () => {
  it('emits a contract', () => {
    const result = translateS3(makeContext('azure'));
    expect(result.contracts).toBeDefined();
    expect(result.contracts).toHaveLength(1);
    expect(result.contracts[0].sourceId).toBe('aws_s3_bucket.assets');
  });

  it('captures review items for website and replication', () => {
    const result = translateS3(makeContext('gcp', {
      website: { index_document: 'index.html', error_document: '404.html' },
      replication_configuration: { role: 'replication-role' },
    }));
    const contract = result.contracts[0];
    expect(contract.degraded.join(' ')).toContain('website hosting');
    expect(contract.degraded.join(' ')).toContain('replication');
    expect(contract.reviewRequired.join(' ')).toContain('cross-region replication');
  });
});
