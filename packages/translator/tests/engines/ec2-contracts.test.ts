import { describe, it, expect, vi } from 'vitest';
import { translateEc2 } from '../../src/engines/compound/ec2-mapping.js';
import type { TranslationContext } from '../../src/engines/mapping-engine.js';
import type { CanonicalIR, CloudProvider, CompilerOptions, IrResource, RegistryEntry } from '@tla/shared';
import type { RegistryApi } from '@tla/registry';

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'aws_instance.web',
    sourceType: 'aws_instance',
    sourceName: 'web',
    sourceModule: null,
    category: 'compute',
    attributes: { instance_type: 't3.micro', ami: 'ami-ubuntu-22.04' },
    sourceAttributes: { instance_type: 't3.micro', ami: 'ami-ubuntu-22.04' },
    registryEntryId: 'SER-COMPUTE-EC2-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(): RegistryEntry {
  return {
    registry_entry_id: 'SER-COMPUTE-EC2-001',
    aws_service: 'aws_instance',
    aws_family: 'compute',
    azure_targets: ['azurerm_linux_virtual_machine'],
    gcp_targets: ['google_compute_instance'],
    mapping_type: 'compound',
    output_mode: 'native_emit_only',
    band: 'P1',
    confidence: 0.9,
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
  };
}

function makeContext(targetProvider: CloudProvider, attrs: Record<string, unknown> = {}): TranslationContext {
  const resource = makeIrResource({ attributes: { instance_type: 't3.micro', ami: 'ami-ubuntu-22.04', ...attrs } });
  return {
    targetProvider,
    resource,
    registryEntry: makeRegistryEntry(),
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
    } as CanonicalIR,
    registry: { lookup: vi.fn(), lookupMany: vi.fn() } as unknown as RegistryApi,
    options: { targetProvider, registryVersion: '2025.03.01', emitComments: true, sortKeys: true } as CompilerOptions,
  };
}

describe('translateEc2 contracts', () => {
  it('emits a contract for a normal translation', () => {
    const result = translateEc2(makeContext('azure'));
    expect(result.contracts).toBeDefined();
    expect(result.contracts).toHaveLength(1);
    expect(result.contracts![0]!.sourceId).toBe('aws_instance.web');
  });

  it('includes target ids when resources are emitted', () => {
    const result = translateEc2(makeContext('azure'));
    expect(result.contracts![0]!.targetIds.length).toBeGreaterThan(0);
  });
});
