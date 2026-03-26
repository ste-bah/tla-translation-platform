import type { RegistryEntry } from '@tla/shared';

export function createTestEntry(overrides?: Partial<RegistryEntry>): RegistryEntry {
  return {
    registry_entry_id: 'SER-COM-TEST-001',
    aws_service: 'test-service',
    aws_family: 'compute',
    azure_targets: ['azurerm_test'],
    gcp_targets: ['google_test'],
    mapping_type: 'direct',
    output_mode: 'portable',
    band: 'P1',
    confidence: 0.90,
    portable_provider_candidate: true,
    behavioral_gaps: [],
    manual_review_required: false,
    review_domains: [],
    test_status: 'untested',
    owner: 'test-team',
    registry_version: '2026.03.13',
    last_updated: '2026-03-13T10:00:00Z',
    related_requirements: ['REQ-REG-001'],
    related_edge_cases: ['EC-001'],
    ...overrides,
  };
}
