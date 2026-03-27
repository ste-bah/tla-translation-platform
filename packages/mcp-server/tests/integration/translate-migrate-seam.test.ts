/**
 * Integration test: translate → migrate-state seam.
 *
 * Verifies that the manifest.json written by handleTranslate contains ALL
 * fields that handleMigrateState expects, and that the two tools can be
 * chained without schema mismatches.
 *
 * Both tools are exercised through their real handler functions.  Only
 * external I/O (file system, HCL parsing, registry) is mocked.
 *
 * @module tests/integration/translate-migrate-seam
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — mock functions declared before vi.mock() factories
// ---------------------------------------------------------------------------

const {
  // translate-side mocks
  mockParseHclFile,
  mockDependencyGraphBuild,
  MockDependencyGraph,
  mockIrEmitterEmit,
  MockIrEmitter,
  MockTranslationCompiler,
  mockCompilerTranslate,
  mockBuildTranslationReport,
  // shared fs mocks
  mockReadFile,
  mockWriteFile,
  mockMkdtemp,
  mockMkdir,
  // migrate-state mocks
  mockTransformState,
  mockNormalizeState,
  mockGenerateAzureBackend,
  mockGenerateGcpBackend,
  mockWriteTerraformBlock,
} = vi.hoisted(() => {
  const mockDependencyGraphBuild = vi.fn();
  const mockIrEmitterEmit = vi.fn();
  const mockCompilerTranslate = vi.fn();

  return {
    mockParseHclFile: vi.fn(),
    mockDependencyGraphBuild,
    MockDependencyGraph: vi.fn(() => ({ build: mockDependencyGraphBuild })),
    mockIrEmitterEmit,
    MockIrEmitter: vi.fn(() => ({ emit: mockIrEmitterEmit })),
    MockTranslationCompiler: vi.fn(() => ({ translate: mockCompilerTranslate })),
    mockCompilerTranslate,
    mockBuildTranslationReport: vi.fn().mockReturnValue('# Translation Report'),
    mockReadFile: vi.fn(),
    mockWriteFile: vi.fn().mockResolvedValue(undefined),
    mockMkdtemp: vi.fn(),
    mockMkdir: vi.fn().mockResolvedValue(undefined),
    mockTransformState: vi.fn(),
    mockNormalizeState: vi.fn(),
    mockGenerateAzureBackend: vi.fn(),
    mockGenerateGcpBackend: vi.fn(),
    mockWriteTerraformBlock: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdtemp: (...args: unknown[]) => mockMkdtemp(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

vi.mock('@tla/ingestion', () => ({
  parseHclFile: (...args: unknown[]) => mockParseHclFile(...args),
  parseHclDirectory: vi.fn(),
  DependencyGraph: MockDependencyGraph,
  IrEmitter: MockIrEmitter,
  identifyAwsServices: vi.fn(),
}));

vi.mock('@tla/translator', () => ({
  TranslationCompiler: MockTranslationCompiler,
  buildTranslationReport: (...args: unknown[]) => mockBuildTranslationReport(...args),
  transformState: (...args: unknown[]) => mockTransformState(...args),
  normalizeState: (...args: unknown[]) => mockNormalizeState(...args),
  generateAzureBackend: (...args: unknown[]) => mockGenerateAzureBackend(...args),
  generateGcpBackend: (...args: unknown[]) => mockGenerateGcpBackend(...args),
  writeTerraformBlock: (...args: unknown[]) => mockWriteTerraformBlock(...args),
}));

// ---------------------------------------------------------------------------
// Import modules under test AFTER mocks
// ---------------------------------------------------------------------------

import { handleTranslate } from '../../src/tools/translate.js';
import { handleMigrateState } from '../../src/tools/migrate-state.js';
import type { RegistryManager } from '../../src/registry-manager.js';
import type { RegistryApi } from '@tla/registry';
import type { McpServerConfig } from '../../src/config.js';
import type { TranslationManifest } from '@tla/shared';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const OUTPUT_DIR = '/tmp/tla-seam-test';

const defaultConfig: McpServerConfig = {
  registryDir: '/fake/registry',
  terraformBin: null,
  logLevel: 'silent',
  searchLimit: 50,
  cacheTtlMs: 30_000,
};

function buildFakeRegistryManager(): RegistryManager {
  const fakeApi: Partial<RegistryApi> = {
    search: vi.fn().mockReturnValue([{ registry_version: '2026.03.13' }]),
    lookup: vi.fn().mockReturnValue(undefined),
  };
  return {
    getRegistry: vi.fn(async () => ({ ok: true as const, api: fakeApi as RegistryApi })),
    invalidate: vi.fn(),
  } as unknown as RegistryManager;
}

/** Fake HCL AST returned by the mocked parser. */
const fakeAst = {
  file_path: '/tmp/infra/main.tf',
  resources: [],
  data_blocks: [],
  variables: [],
  locals: [],
  outputs: [],
  providers: [],
  module_calls: [],
  terraform_blocks: [],
};

/** Fake Canonical IR emitted by the mocked IrEmitter. */
const fakeIr = {
  version: '1.0.0',
  metadata: {
    source_files: ['/tmp/infra/main.tf'],
    total_resources: 2,
    aws_resources: 2,
    generated_at: new Date().toISOString(),
    tool_version: '0.1.0',
  },
  resources: [
    {
      id: 'aws_instance.web',
      sourceType: 'aws_instance',
      sourceName: 'web',
      attributes: { instance_type: 't3.micro' },
      intents: [],
      tags: {},
    },
    {
      id: 'aws_s3_bucket.data',
      sourceType: 'aws_s3_bucket',
      sourceName: 'data',
      attributes: { bucket: 'my-data-bucket' },
      intents: [],
      tags: {},
    },
  ],
  relationships: [],
  modules: [],
};

/**
 * The manifest that the TranslationCompiler would produce.
 * This is the CONTRACT object: translate writes it, migrate-state reads it.
 */
const fakeManifest: TranslationManifest = {
  version: '1.0.0',
  registryVersion: '2026.03.13',
  target: 'azure',
  counts: { total: 2, translated: 2, expanded: 0, partial: 0, blocked: 0, advisory: 0 },
  entries: [
    {
      sourceId: 'aws_instance.web',
      sourceType: 'aws_instance',
      status: 'translated',
      targetResources: [
        {
          targetType: 'azurerm_linux_virtual_machine',
          targetName: 'web',
          attributes: {},
          sourceId: 'aws_instance.web',
          traceability: {
            sourceId: 'aws_instance.web',
            sourceType: 'aws_instance',
            registryEntryId: 'SER-COM-001',
            mappingType: 'parametric',
            confidence: 0.85,
            engineUsed: 'parametric-engine',
          },
        },
      ],
      confidence: 0.85,
      findings: [],
    },
    {
      sourceId: 'aws_s3_bucket.data',
      sourceType: 'aws_s3_bucket',
      status: 'translated',
      targetResources: [
        {
          targetType: 'azurerm_storage_account',
          targetName: 'data',
          attributes: {},
          sourceId: 'aws_s3_bucket.data',
          traceability: {
            sourceId: 'aws_s3_bucket.data',
            sourceType: 'aws_s3_bucket',
            registryEntryId: 'SER-STR-001',
            mappingType: 'direct',
            confidence: 0.92,
            engineUsed: 'direct-engine',
          },
        },
      ],
      confidence: 0.92,
      findings: [],
    },
  ],
  findings: [],
  confidenceOverall: 0.885,
};

/** The full translation result returned by the mocked TranslationCompiler. */
const fakeTranslationResult = {
  target: 'azure' as const,
  resources: [],
  files: { 'main.tf': '# main', 'variables.tf': '# vars' },
  manifest: fakeManifest,
  findings: [],
  stats: {
    totalResources: 2,
    translated: 2,
    expanded: 0,
    partial: 0,
    blocked: 0,
    advisory: 0,
    durationMs: 10,
  },
};

/** Fake V4 state file with resources matching the manifest. */
const fakeStateV4 = {
  version: 4 as const,
  terraform_version: '1.5.0',
  serial: 5,
  lineage: 'seam-test-lineage',
  outputs: {},
  resources: [
    {
      mode: 'managed' as const,
      type: 'aws_instance',
      name: 'web',
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [
        {
          schema_version: 1,
          attributes: { id: 'i-abc123', instance_type: 't3.micro' },
          sensitive_attributes: [],
          private: 'BASE64',
          dependencies: [],
        },
      ],
    },
    {
      mode: 'managed' as const,
      type: 'aws_s3_bucket',
      name: 'data',
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [
        {
          schema_version: 0,
          attributes: { id: 'my-data-bucket', bucket: 'my-data-bucket' },
          sensitive_attributes: [],
          dependencies: [],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // translate-side defaults
  mockParseHclFile.mockResolvedValue(fakeAst);
  mockIrEmitterEmit.mockReturnValue({ ir: fakeIr });
  mockCompilerTranslate.mockReturnValue(fakeTranslationResult);
  mockMkdtemp.mockResolvedValue(OUTPUT_DIR);
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);

  // migrate-state-side: normalizeState returns flat resource list from state
  mockNormalizeState.mockReturnValue([
    { address: 'aws_instance.web', type: 'aws_instance', name: 'web', mode: 'managed' },
    { address: 'aws_s3_bucket.data', type: 'aws_s3_bucket', name: 'data', mode: 'managed' },
  ]);

  // transformState returns a minimal plan with moves for both resources
  mockTransformState.mockReturnValue({
    moves: [
      {
        source: 'aws_instance.web',
        destination: 'azurerm_linux_virtual_machine.web',
        commandString: 'terraform state mv aws_instance.web azurerm_linux_virtual_machine.web',
      },
      {
        source: 'aws_s3_bucket.data',
        destination: 'azurerm_storage_account.data',
        commandString: 'terraform state mv aws_s3_bucket.data azurerm_storage_account.data',
      },
    ],
    imports: [],
    removes: [],
    warnings: [],
    rollbackManifest: {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      commands: [],
    },
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('translate → migrate-state seam', () => {
  /**
   * Capture the manifest.json content written by handleTranslate so we can
   * feed it to handleMigrateState via the mocked readFile.
   */
  function captureWrittenManifest(): string | null {
    for (const call of mockWriteFile.mock.calls) {
      const filePath = call[0] as string;
      if (filePath.endsWith('manifest.json')) {
        return call[1] as string;
      }
    }
    return null;
  }

  it('should produce a manifest.json from translate that migrate-state can load', async () => {
    // ---- Step 1: Run translate ----
    const translateResult = await handleTranslate(
      {
        source: '/tmp/infra/main.tf',
        sourceType: 'file',
        target: 'azure',
        scope: 'full',
        outputDir: OUTPUT_DIR,
      },
      defaultConfig,
      buildFakeRegistryManager(),
    );

    expect(translateResult.success).toBe(true);
    expect(translateResult.outputDir).toBe(OUTPUT_DIR);

    // ---- Step 2: Capture the manifest.json that was written ----
    const manifestJson = captureWrittenManifest();
    expect(manifestJson).not.toBeNull();

    // ---- Step 3: Parse and validate the manifest has required fields ----
    const manifest = JSON.parse(manifestJson!);
    expect(manifest).toHaveProperty('entries');
    expect(Array.isArray(manifest.entries)).toBe(true);
    expect(manifest.entries.length).toBeGreaterThan(0);

    // Verify all ManifestEntry fields that migrate-state relies on
    for (const entry of manifest.entries) {
      expect(entry).toHaveProperty('sourceId');
      expect(entry).toHaveProperty('sourceType');
      expect(entry).toHaveProperty('status');
      expect(entry).toHaveProperty('targetResources');
      expect(entry).toHaveProperty('confidence');
      expect(Array.isArray(entry.targetResources)).toBe(true);
    }

    // Verify top-level manifest fields
    expect(manifest).toHaveProperty('version');
    expect(manifest).toHaveProperty('registryVersion');
    expect(manifest).toHaveProperty('target');
    expect(manifest).toHaveProperty('counts');
    expect(manifest).toHaveProperty('confidenceOverall');

    // ---- Step 4: Wire manifest.json into migrate-state's readFile ----
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith('manifest.json')) return manifestJson!;
      if (path.endsWith('.tfstate')) return JSON.stringify(fakeStateV4);
      throw new Error(`Unexpected readFile: ${path}`);
    });

    // ---- Step 5: Run migrate-state with the same output dir ----
    const migrateResult = await handleMigrateState({
      stateFile: '/tmp/terraform.tfstate',
      translationResultDir: OUTPUT_DIR,
      target: 'azure',
      scope: 'full',
      generateBackend: false,
      generateRollback: false,
    });

    expect(migrateResult.success).toBe(true);
    expect(migrateResult.error).toBeUndefined();
    expect(migrateResult.target).toBe('azure');
  });

  it('should produce migration commands when state resources match manifest entries', async () => {
    // Run translate
    await handleTranslate(
      {
        source: '/tmp/infra/main.tf',
        sourceType: 'file',
        target: 'azure',
        scope: 'full',
        outputDir: OUTPUT_DIR,
      },
      defaultConfig,
      buildFakeRegistryManager(),
    );

    const manifestJson = captureWrittenManifest()!;

    // Wire readFile for migrate-state
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith('manifest.json')) return manifestJson;
      if (path.endsWith('.tfstate')) return JSON.stringify(fakeStateV4);
      throw new Error(`Unexpected readFile: ${path}`);
    });

    const migrateResult = await handleMigrateState({
      stateFile: '/tmp/terraform.tfstate',
      translationResultDir: OUTPUT_DIR,
      target: 'azure',
      scope: 'full',
      generateBackend: false,
      generateRollback: false,
    });

    expect(migrateResult.success).toBe(true);
    expect(migrateResult.summary).toBeDefined();
    expect(migrateResult.summary!.moves).toBe(2);
    expect(migrateResult.moves).toHaveLength(2);
    expect(migrateResult.moves![0]).toHaveProperty('source');
    expect(migrateResult.moves![0]).toHaveProperty('destination');
    expect(migrateResult.moves![0]).toHaveProperty('commandString');
  });

  it('should detect zero orphans when state resources fully match the manifest', async () => {
    await handleTranslate(
      {
        source: '/tmp/infra/main.tf',
        sourceType: 'file',
        target: 'azure',
        scope: 'full',
        outputDir: OUTPUT_DIR,
      },
      defaultConfig,
      buildFakeRegistryManager(),
    );

    const manifestJson = captureWrittenManifest()!;

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith('manifest.json')) return manifestJson;
      if (path.endsWith('.tfstate')) return JSON.stringify(fakeStateV4);
      throw new Error(`Unexpected readFile: ${path}`);
    });

    const migrateResult = await handleMigrateState({
      stateFile: '/tmp/terraform.tfstate',
      translationResultDir: OUTPUT_DIR,
      target: 'azure',
      scope: 'full',
      generateBackend: false,
      generateRollback: false,
    });

    expect(migrateResult.success).toBe(true);
    expect(migrateResult.orphans).toHaveLength(0);
    expect(migrateResult.summary!.orphans).toBe(0);
  });

  it('should work without a state file (manifest-only advisory plan)', async () => {
    await handleTranslate(
      {
        source: '/tmp/infra/main.tf',
        sourceType: 'file',
        target: 'azure',
        scope: 'full',
        outputDir: OUTPUT_DIR,
      },
      defaultConfig,
      buildFakeRegistryManager(),
    );

    const manifestJson = captureWrittenManifest()!;

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith('manifest.json')) return manifestJson;
      throw new Error(`Unexpected readFile: ${path}`);
    });

    const migrateResult = await handleMigrateState({
      translationResultDir: OUTPUT_DIR,
      target: 'azure',
      scope: 'full',
      generateBackend: false,
      generateRollback: false,
    });

    expect(migrateResult.success).toBe(true);
    expect(migrateResult.summary!.moves).toBe(0);
    expect(migrateResult.summary!.imports).toBe(0);
    expect(migrateResult.summary!.removes).toBe(0);

    // Should have the NO_STATE_FILE advisory finding
    const noStateFinding = migrateResult.findings?.find(
      (f) => f.code === 'MIGRATE_STATE_NO_STATE_FILE',
    );
    expect(noStateFinding).toBeDefined();
    expect(noStateFinding!.severity).toBe('info');
  });

  it('should detect orphans when state has resources NOT in the manifest', async () => {
    // Add an extra resource to the state that is NOT in the manifest
    const stateWithOrphan = {
      ...fakeStateV4,
      resources: [
        ...fakeStateV4.resources,
        {
          mode: 'managed' as const,
          type: 'aws_iam_role',
          name: 'orphan_role',
          provider: 'provider["registry.terraform.io/hashicorp/aws"]',
          instances: [
            {
              schema_version: 0,
              attributes: { id: 'role-orphan' },
              sensitive_attributes: [],
              dependencies: [],
            },
          ],
        },
      ],
    };

    // normalizeState must include the orphan resource
    mockNormalizeState.mockReturnValue([
      { address: 'aws_instance.web', type: 'aws_instance', name: 'web', mode: 'managed' },
      { address: 'aws_s3_bucket.data', type: 'aws_s3_bucket', name: 'data', mode: 'managed' },
      { address: 'aws_iam_role.orphan_role', type: 'aws_iam_role', name: 'orphan_role', mode: 'managed' },
    ]);

    await handleTranslate(
      {
        source: '/tmp/infra/main.tf',
        sourceType: 'file',
        target: 'azure',
        scope: 'full',
        outputDir: OUTPUT_DIR,
      },
      defaultConfig,
      buildFakeRegistryManager(),
    );

    const manifestJson = captureWrittenManifest()!;

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith('manifest.json')) return manifestJson;
      if (path.endsWith('.tfstate')) return JSON.stringify(stateWithOrphan);
      throw new Error(`Unexpected readFile: ${path}`);
    });

    const migrateResult = await handleMigrateState({
      stateFile: '/tmp/terraform.tfstate',
      translationResultDir: OUTPUT_DIR,
      target: 'azure',
      scope: 'full',
      generateBackend: false,
      generateRollback: false,
    });

    expect(migrateResult.success).toBe(true);
    expect(migrateResult.orphans).toHaveLength(1);
    expect(migrateResult.orphans![0].resourceType).toBe('aws_iam_role');
    expect(migrateResult.orphans![0].address).toBe('aws_iam_role.orphan_role');
  });

  it('should preserve manifest entry sourceId format across the seam', async () => {
    await handleTranslate(
      {
        source: '/tmp/infra/main.tf',
        sourceType: 'file',
        target: 'azure',
        scope: 'full',
        outputDir: OUTPUT_DIR,
      },
      defaultConfig,
      buildFakeRegistryManager(),
    );

    const manifestJson = captureWrittenManifest()!;
    const manifest = JSON.parse(manifestJson);

    // sourceId format must be "type.name" — this is what migrate-state uses
    // to correlate with state resources via buildAddressMap
    for (const entry of manifest.entries) {
      expect(entry.sourceId).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }

    // Verify transformState was called with the manifest that has entries
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith('manifest.json')) return manifestJson;
      if (path.endsWith('.tfstate')) return JSON.stringify(fakeStateV4);
      throw new Error(`Unexpected readFile: ${path}`);
    });

    await handleMigrateState({
      stateFile: '/tmp/terraform.tfstate',
      translationResultDir: OUTPUT_DIR,
      target: 'azure',
      scope: 'full',
      generateBackend: false,
      generateRollback: false,
    });

    // transformState should have been called with a manifest containing entries
    expect(mockTransformState).toHaveBeenCalledTimes(1);
    const [, passedManifest] = mockTransformState.mock.calls[0];
    expect(passedManifest.entries).toHaveLength(2);
    expect(passedManifest.entries[0].sourceId).toBe('aws_instance.web');
    expect(passedManifest.entries[1].sourceId).toBe('aws_s3_bucket.data');
  });

  it('should work with GCP target across the seam', async () => {
    // Override compiler to return GCP manifest
    const gcpManifest: TranslationManifest = {
      ...fakeManifest,
      target: 'gcp',
      entries: [
        {
          sourceId: 'aws_instance.web',
          sourceType: 'aws_instance',
          status: 'translated',
          targetResources: [
            {
              targetType: 'google_compute_instance',
              targetName: 'web',
              attributes: {},
              sourceId: 'aws_instance.web',
              traceability: {
                sourceId: 'aws_instance.web',
                sourceType: 'aws_instance',
                registryEntryId: 'SER-COM-001',
                mappingType: 'parametric',
                confidence: 0.80,
                engineUsed: 'parametric-engine',
              },
            },
          ],
          confidence: 0.80,
          findings: [],
        },
      ],
    };

    mockCompilerTranslate.mockReturnValue({
      ...fakeTranslationResult,
      target: 'gcp',
      manifest: gcpManifest,
    });

    mockTransformState.mockReturnValue({
      moves: [
        {
          source: 'aws_instance.web',
          destination: 'google_compute_instance.web',
          commandString: 'terraform state mv aws_instance.web google_compute_instance.web',
        },
      ],
      imports: [],
      removes: [],
      warnings: [],
      rollbackManifest: { version: '1.0.0', createdAt: new Date().toISOString(), commands: [] },
    });

    await handleTranslate(
      {
        source: '/tmp/infra/main.tf',
        sourceType: 'file',
        target: 'gcp',
        scope: 'full',
        outputDir: OUTPUT_DIR,
      },
      defaultConfig,
      buildFakeRegistryManager(),
    );

    const manifestJson = captureWrittenManifest()!;
    const manifest = JSON.parse(manifestJson);
    expect(manifest.target).toBe('gcp');

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith('manifest.json')) return manifestJson;
      if (path.endsWith('.tfstate')) return JSON.stringify(fakeStateV4);
      throw new Error(`Unexpected readFile: ${path}`);
    });

    const migrateResult = await handleMigrateState({
      stateFile: '/tmp/terraform.tfstate',
      translationResultDir: OUTPUT_DIR,
      target: 'gcp',
      scope: 'full',
      generateBackend: false,
      generateRollback: false,
    });

    expect(migrateResult.success).toBe(true);
    expect(migrateResult.target).toBe('gcp');
    expect(migrateResult.moves).toHaveLength(1);
    expect(migrateResult.moves![0].destination).toContain('google_compute_instance');
  });

  it('should never leak state attribute values in migrate-state output', async () => {
    await handleTranslate(
      {
        source: '/tmp/infra/main.tf',
        sourceType: 'file',
        target: 'azure',
        scope: 'full',
        outputDir: OUTPUT_DIR,
      },
      defaultConfig,
      buildFakeRegistryManager(),
    );

    const manifestJson = captureWrittenManifest()!;

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith('manifest.json')) return manifestJson;
      if (path.endsWith('.tfstate')) return JSON.stringify(fakeStateV4);
      throw new Error(`Unexpected readFile: ${path}`);
    });

    const migrateResult = await handleMigrateState({
      stateFile: '/tmp/terraform.tfstate',
      translationResultDir: OUTPUT_DIR,
      target: 'azure',
      scope: 'full',
      generateBackend: false,
      generateRollback: false,
    });

    // Serialize the entire result and ensure no state attribute values leaked
    const resultJson = JSON.stringify(migrateResult);
    expect(resultJson).not.toContain('i-abc123');
    expect(resultJson).not.toContain('my-data-bucket');
    expect(resultJson).not.toContain('BASE64');
  });
});
