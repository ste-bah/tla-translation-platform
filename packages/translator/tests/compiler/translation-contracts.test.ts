import { describe, it, expect, vi } from 'vitest';
import { TranslationCompiler } from '../../src/compiler/translation-compiler.js';
import type { CanonicalIR, CompilerOptions, IrResource, RegistryEntry } from '@tla/shared';
import { TranslationManifestSchema, resolveRegistryKey } from '@tla/shared';
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
    registryEntryId: null,
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeCanonicalIR(resources: IrResource[]): CanonicalIR {
  return {
    version: '1.0.0',
    sourceProvider: 'aws',
    resources,
    relationships: [],
    modules: [],
    intents: [],
    metadata: { generatedAt: '2025-03-01T00:00:00Z', sourceFiles: ['main.tf'], toolVersion: '0.1.0' },
  } as CanonicalIR;
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

function makeMockRegistry(entry: RegistryEntry): RegistryApi {
  const shortKey = resolveRegistryKey('aws_instance');
  return {
    lookup: vi.fn((key: string) => {
      if (key === 'aws_instance' || key === shortKey) return entry;
      return undefined;
    }),
    lookupMany: vi.fn(),
  } as unknown as RegistryApi;
}

function makeOptions(): CompilerOptions {
  return { targetProvider: 'azure', registryVersion: '2025.03.01', emitComments: true, sortKeys: true };
}

describe('translation contract plumbing', () => {
  it('parses legacy manifest entries without contract', () => {
    const parsed = TranslationManifestSchema.parse({
      version: '1.0.0',
      registryVersion: '2025.03.01',
      target: 'azure',
      counts: { total: 1, translated: 1, expanded: 0, partial: 0, blocked: 0, advisory: 0 },
      entries: [{
        sourceId: 'aws_instance.web',
        sourceType: 'aws_instance',
        status: 'translated',
        targetResources: [],
        confidence: 0.9,
        findings: [],
      }],
      findings: [],
      confidenceOverall: 0.9,
    });

    expect(parsed.entries[0]!.contract).toBeNull();
  });

  it('persists emitted contracts onto manifest entries', () => {
    const compiler = new TranslationCompiler(makeMockRegistry(makeRegistryEntry()));
    const result = compiler.translate(makeCanonicalIR([makeIrResource()]), makeOptions());

    expect(result.manifest.entries).toHaveLength(1);
    expect(result.manifest.entries[0]!.contract).not.toBeNull();
    expect(result.manifest.entries[0]!.contract!.sourceId).toBe('aws_instance.web');
  });
});
