/**
 * Tests for the `migrate-state` MCP tool handler.
 *
 * Covers:
 *  - Happy path: state file + manifest → full move/import/remove plan
 *  - Manifest-only path: no stateFile → advisory plan with no state commands
 *  - Stack scope filtering: selectedStacks filters resources by module prefix
 *  - Orphan detection: state resources with no manifest entry
 *  - Cross-stack dependency detection
 *  - Backend config generation (azure, gcp)
 *  - Rollback manifest generation
 *  - Error handling: missing manifest, invalid state, unreadable files
 *  - Security: output never contains state attribute values
 *  - MCP tool wiring via registerTools
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — mock functions declared before vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockReadFile,
  mockTransformState,
  mockNormalizeState,
  mockGenerateAzureBackend,
  mockGenerateGcpBackend,
  mockWriteTerraformBlock,
} = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockTransformState: vi.fn(),
  mockNormalizeState: vi.fn(),
  mockGenerateAzureBackend: vi.fn(),
  mockGenerateGcpBackend: vi.fn(),
  mockWriteTerraformBlock: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

vi.mock('@tla/translator', () => ({
  transformState: (...args: unknown[]) => mockTransformState(...args),
  normalizeState: (...args: unknown[]) => mockNormalizeState(...args),
  generateAzureBackend: (...args: unknown[]) => mockGenerateAzureBackend(...args),
  generateGcpBackend: (...args: unknown[]) => mockGenerateGcpBackend(...args),
  writeTerraformBlock: (...args: unknown[]) => mockWriteTerraformBlock(...args),
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import { handleMigrateState } from '../../src/tools/migrate-state.js';
import type { MigrateStateArgs } from '../../src/tools/migrate-state.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const FAKE_TRANSLATED_DIR = '/fake/translated';
const FAKE_STATE_PATH = '/fake/terraform.tfstate';

/** Minimal valid TranslationManifest */
const fakeManifest = {
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
      sourceId: 'aws_s3_bucket.assets',
      sourceType: 'aws_s3_bucket',
      status: 'translated',
      targetResources: [
        {
          targetType: 'azurerm_storage_account',
          targetName: 'assets',
          attributes: {},
          sourceId: 'aws_s3_bucket.assets',
          traceability: {
            sourceId: 'aws_s3_bucket.assets',
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

/** Minimal valid V4 state data */
const fakeStateV4 = {
  version: 4,
  terraform_version: '1.5.0',
  serial: 12,
  lineage: 'abc-123',
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
          // IMPORTANT: attributes intentionally contain sensitive-looking values
          // to confirm they never appear in output
          attributes: { id: 'i-0abc123', ami: 'ami-secret', instance_type: 't3.micro' },
          sensitive_attributes: [],
          private: 'BASE64DATA',
          dependencies: [],
        },
      ],
    },
    {
      mode: 'managed' as const,
      type: 'aws_s3_bucket',
      name: 'assets',
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [
        {
          schema_version: 0,
          attributes: { id: 'my-bucket-12345', bucket: 'my-bucket-12345' },
          sensitive_attributes: [],
          dependencies: [],
        },
      ],
    },
  ],
};

/** State plan returned by transformState mock */
const fakeStatePlan = {
  moves: [
    {
      source: 'aws_instance.web',
      destination: 'azurerm_linux_virtual_machine.web',
      commandString: "terraform state mv 'aws_instance.web' 'azurerm_linux_virtual_machine.web'",
    },
    {
      source: 'aws_s3_bucket.assets',
      destination: 'azurerm_storage_account.assets',
      commandString: "terraform state mv 'aws_s3_bucket.assets' 'azurerm_storage_account.assets'",
    },
  ],
  imports: [],
  removes: [],
  warnings: [],
  rollbackManifest: {
    snapshotRef: 'tfstate-snapshot-2026-03-25T00:00:00.000Z',
    inverseMoves: [
      {
        source: 'azurerm_linux_virtual_machine.web',
        destination: 'aws_instance.web',
        commandString: "terraform state mv 'azurerm_linux_virtual_machine.web' 'aws_instance.web'",
      },
    ],
    inverseImports: [],
    inverseRemoves: [],
    timestamp: '2026-03-25T00:00:00.000Z',
  },
};

/** normalizeState mock output for the fake V4 state */
const fakeNormalizedResources = [
  { address: 'aws_instance.web', type: 'aws_instance', name: 'web', mode: 'managed' },
  { address: 'aws_s3_bucket.assets', type: 'aws_s3_bucket', name: 'assets', mode: 'managed' },
];

/** Default MigrateStateArgs for most tests */
const defaultArgs: MigrateStateArgs = {
  stateFile: FAKE_STATE_PATH,
  translationResultDir: FAKE_TRANSLATED_DIR,
  target: 'azure',
  scope: 'full',
  generateBackend: false,
  generateRollback: false,
};

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default: manifest.json reads as valid manifest
  mockReadFile.mockImplementation(async (path: string) => {
    if (path === `${FAKE_TRANSLATED_DIR}/manifest.json`) {
      return JSON.stringify(fakeManifest);
    }
    if (path === FAKE_STATE_PATH) {
      return JSON.stringify(fakeStateV4);
    }
    throw new Error(`Unexpected readFile call: ${path}`);
  });

  mockTransformState.mockReturnValue(fakeStatePlan);
  mockNormalizeState.mockReturnValue(fakeNormalizedResources);
  mockGenerateAzureBackend.mockReturnValue({ key: 'backend "azurerm"', value: {} });
  mockGenerateGcpBackend.mockReturnValue({ key: 'backend "gcs"', value: {} });
  mockWriteTerraformBlock.mockReturnValue('terraform {\n  backend "azurerm" {}\n}\n');
});

// ---------------------------------------------------------------------------
// Happy path — full state migration
// ---------------------------------------------------------------------------

describe('handleMigrateState — happy path', () => {
  it('returns success with moves, imports, removes when state file is provided', async () => {
    const result = await handleMigrateState(defaultArgs);

    expect(result.success).toBe(true);
    expect(result.target).toBe('azure');
    expect(result.scope).toBe('full');
    expect(result.moves).toHaveLength(2);
    expect(result.imports).toHaveLength(0);
    expect(result.removes).toHaveLength(0);
  });

  it('calls transformState with parsed state and manifest', async () => {
    await handleMigrateState(defaultArgs);

    expect(mockTransformState).toHaveBeenCalledWith(
      expect.objectContaining({ version: 4 }),
      expect.objectContaining({ entries: expect.any(Array) }),
    );
  });

  it('includes commandStrings in moves', async () => {
    const result = await handleMigrateState(defaultArgs);

    expect(result.moves![0].commandString).toContain('terraform state mv');
    expect(result.moves![0].source).toBe('aws_instance.web');
    expect(result.moves![0].destination).toBe('azurerm_linux_virtual_machine.web');
  });

  it('includes summary counts', async () => {
    const result = await handleMigrateState(defaultArgs);

    expect(result.summary).toBeDefined();
    expect(result.summary!.moves).toBe(2);
    expect(result.summary!.imports).toBe(0);
    expect(result.summary!.removes).toBe(0);
  });

  it('includes totalDuration-equivalent summary fields', async () => {
    const result = await handleMigrateState(defaultArgs);

    // All summary fields must be numeric
    expect(typeof result.summary!.moves).toBe('number');
    expect(typeof result.summary!.imports).toBe('number');
    expect(typeof result.summary!.removes).toBe('number');
    expect(typeof result.summary!.orphans).toBe('number');
    expect(typeof result.summary!.warnings).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Security: no state attribute values in output
// ---------------------------------------------------------------------------

describe('handleMigrateState — security', () => {
  it('does NOT include state attribute values (e.g., AMI IDs, bucket names) in output', async () => {
    const result = await handleMigrateState(defaultArgs);
    const serialized = JSON.stringify(result);

    // These values exist in fakeStateV4.resources[0].instances[0].attributes
    expect(serialized).not.toContain('i-0abc123');
    expect(serialized).not.toContain('ami-secret');
    expect(serialized).not.toContain('my-bucket-12345');
    expect(serialized).not.toContain('BASE64DATA');
  });

  it('move commands contain only resource addresses, not attribute data', async () => {
    const result = await handleMigrateState(defaultArgs);

    for (const move of result.moves ?? []) {
      // commandString should only contain terraform state mv + addresses
      expect(move.commandString).toMatch(/^terraform state mv/);
      // No raw attribute values
      expect(move.commandString).not.toContain('ami-secret');
      expect(move.commandString).not.toContain('my-bucket-12345');
    }
  });
});

// ---------------------------------------------------------------------------
// Manifest-only path (no stateFile)
// ---------------------------------------------------------------------------

describe('handleMigrateState — manifest-only (no stateFile)', () => {
  it('returns success with empty arrays when no stateFile provided', async () => {
    const result = await handleMigrateState({
      ...defaultArgs,
      stateFile: undefined,
    });

    expect(result.success).toBe(true);
    expect(result.moves).toHaveLength(0);
    expect(result.imports).toHaveLength(0);
    expect(result.removes).toHaveLength(0);
    expect(mockTransformState).not.toHaveBeenCalled();
  });

  it('includes MIGRATE_STATE_NO_STATE_FILE finding', async () => {
    const result = await handleMigrateState({
      ...defaultArgs,
      stateFile: undefined,
    });

    expect(result.findings?.some((f) => f.code === 'MIGRATE_STATE_NO_STATE_FILE')).toBe(true);
  });

  it('skips rollback when no stateFile provided', async () => {
    const result = await handleMigrateState({
      ...defaultArgs,
      stateFile: undefined,
      generateRollback: true,
    });

    expect(result.rollbackManifest).toBeUndefined();
    expect(result.findings?.some((f) => f.code === 'MIGRATE_STATE_ROLLBACK_SKIP')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stack scope filtering
// ---------------------------------------------------------------------------

describe('handleMigrateState — stack scope', () => {
  it('passes scope and selectedStacks through to result', async () => {
    // normalizeState must return module-prefixed resources for stack filter
    mockNormalizeState.mockReturnValue([
      { address: 'module.networking.aws_instance.web', type: 'aws_instance', name: 'web', mode: 'managed' },
    ]);

    const result = await handleMigrateState({
      ...defaultArgs,
      scope: 'stack',
      selectedStacks: ['networking'],
    });

    expect(result.scope).toBe('stack');
    expect(result.selectedStacks).toEqual(['networking']);
  });

  it('warns when scope is "stack" but no selectedStacks provided', async () => {
    const result = await handleMigrateState({
      ...defaultArgs,
      scope: 'stack',
      selectedStacks: [],
    });

    expect(result.findings?.some((f) => f.code === 'MIGRATE_STATE_SCOPE_EMPTY')).toBe(true);
  });

  it('does not emit selectedStacks in result when scope is "full"', async () => {
    const result = await handleMigrateState({
      ...defaultArgs,
      scope: 'full',
    });

    expect(result.selectedStacks).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Orphan detection
// ---------------------------------------------------------------------------

describe('handleMigrateState — orphan detection', () => {
  it('detects state resources not in manifest as orphans', async () => {
    // Add an orphaned resource to the normalized output
    mockNormalizeState.mockReturnValue([
      ...fakeNormalizedResources,
      { address: 'aws_iam_role.lambda', type: 'aws_iam_role', name: 'lambda', mode: 'managed' },
    ]);

    const result = await handleMigrateState(defaultArgs);

    expect(result.orphans).toHaveLength(1);
    expect(result.orphans![0].address).toBe('aws_iam_role.lambda');
    expect(result.orphans![0].resourceType).toBe('aws_iam_role');
    expect(result.summary!.orphans).toBe(1);
  });

  it('emits MIGRATE_STATE_ORPHANS finding when orphans are detected', async () => {
    mockNormalizeState.mockReturnValue([
      ...fakeNormalizedResources,
      { address: 'aws_iam_role.lambda', type: 'aws_iam_role', name: 'lambda', mode: 'managed' },
    ]);

    const result = await handleMigrateState(defaultArgs);

    expect(result.findings?.some((f) => f.code === 'MIGRATE_STATE_ORPHANS')).toBe(true);
  });

  it('returns empty orphans list when all state resources have manifest entries', async () => {
    const result = await handleMigrateState(defaultArgs);

    expect(result.orphans).toHaveLength(0);
    expect(result.summary!.orphans).toBe(0);
  });

  it('does not flag non-aws resources as orphans', async () => {
    // Add a data source that leaked through (should not be flagged)
    mockNormalizeState.mockReturnValue([
      ...fakeNormalizedResources,
      { address: 'random_id.suffix', type: 'random_id', name: 'suffix', mode: 'managed' },
    ]);

    const result = await handleMigrateState(defaultArgs);

    // random_id does not start with aws_ so it should not be an orphan
    expect(result.orphans?.some((o) => o.resourceType === 'random_id')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-stack dependency detection
// ---------------------------------------------------------------------------

describe('handleMigrateState — cross-stack dependencies', () => {
  it('detects cross-stack dependencies when scope is stack', async () => {
    // Provide a state with a cross-stack dependency
    const stateWithDeps = {
      ...fakeStateV4,
      resources: [
        {
          mode: 'managed' as const,
          type: 'aws_instance',
          name: 'web',
          provider: 'provider["registry.terraform.io/hashicorp/aws"]',
          module: 'module.app',
          instances: [
            {
              schema_version: 1,
              attributes: {},
              sensitive_attributes: [],
              dependencies: ['module.networking.aws_vpc.main'],
            },
          ],
        },
      ],
    };

    mockReadFile.mockImplementation(async (path: string) => {
      if (path === `${FAKE_TRANSLATED_DIR}/manifest.json`) return JSON.stringify(fakeManifest);
      if (path === FAKE_STATE_PATH) return JSON.stringify(stateWithDeps);
      throw new Error(`Unexpected: ${path}`);
    });

    mockNormalizeState.mockReturnValue([
      { address: 'module.app.aws_instance.web', type: 'aws_instance', name: 'web', mode: 'managed' },
    ]);

    const result = await handleMigrateState({
      ...defaultArgs,
      scope: 'stack',
      selectedStacks: ['app'],
    });

    expect(result.crossStackWarnings).toHaveLength(1);
    expect(result.crossStackWarnings![0].sourceAddress).toBe('module.app.aws_instance.web');
    expect(result.crossStackWarnings![0].dependsOnAddress).toBe('module.networking.aws_vpc.main');
    expect(result.findings?.some((f) => f.code === 'MIGRATE_STATE_CROSS_STACK')).toBe(true);
  });

  it('does not emit cross-stack warnings for full scope', async () => {
    const result = await handleMigrateState({
      ...defaultArgs,
      scope: 'full',
    });

    expect(result.crossStackWarnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Backend config generation
// ---------------------------------------------------------------------------

describe('handleMigrateState — generateBackend', () => {
  it('includes backendConfig when generateBackend is true (azure)', async () => {
    const result = await handleMigrateState({
      ...defaultArgs,
      target: 'azure',
      generateBackend: true,
    });

    expect(result.backendConfig).toBeDefined();
    expect(result.backendConfig!.provider).toBe('azure');
    expect(mockGenerateAzureBackend).toHaveBeenCalled();
    expect(mockWriteTerraformBlock).toHaveBeenCalled();
  });

  it('includes backendConfig when generateBackend is true (gcp)', async () => {
    mockWriteTerraformBlock.mockReturnValue('terraform {\n  backend "gcs" {}\n}\n');

    const result = await handleMigrateState({
      ...defaultArgs,
      target: 'gcp',
      generateBackend: true,
    });

    expect(result.backendConfig).toBeDefined();
    expect(result.backendConfig!.provider).toBe('gcp');
    expect(mockGenerateGcpBackend).toHaveBeenCalled();
  });

  it('omits backendConfig when generateBackend is false', async () => {
    const result = await handleMigrateState({
      ...defaultArgs,
      generateBackend: false,
    });

    expect(result.backendConfig).toBeUndefined();
    expect(mockGenerateAzureBackend).not.toHaveBeenCalled();
    expect(mockGenerateGcpBackend).not.toHaveBeenCalled();
  });

  it('backendConfig hclSnippet is a non-empty string', async () => {
    const result = await handleMigrateState({
      ...defaultArgs,
      generateBackend: true,
    });

    expect(typeof result.backendConfig!.hclSnippet).toBe('string');
    expect(result.backendConfig!.hclSnippet.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Rollback manifest generation
// ---------------------------------------------------------------------------

describe('handleMigrateState — generateRollback', () => {
  it('includes rollbackManifest when generateRollback is true', async () => {
    const result = await handleMigrateState({
      ...defaultArgs,
      generateRollback: true,
    });

    expect(result.rollbackManifest).toBeDefined();
    expect(result.rollbackManifest!.snapshotRef).toContain('tfstate-snapshot-');
    expect(result.rollbackManifest!.inverseMoves).toHaveLength(1);
  });

  it('omits rollbackManifest when generateRollback is false', async () => {
    const result = await handleMigrateState({
      ...defaultArgs,
      generateRollback: false,
    });

    expect(result.rollbackManifest).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('handleMigrateState — error handling', () => {
  it('returns structured failure when manifest.json cannot be read', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === `${FAKE_TRANSLATED_DIR}/manifest.json`) {
        throw new Error('ENOENT: no such file or directory');
      }
      return JSON.stringify(fakeStateV4);
    });

    const result = await handleMigrateState(defaultArgs);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to load manifest');
    expect(result.error).toContain('ENOENT');
  });

  it('returns structured failure when manifest.json is malformed JSON', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === `${FAKE_TRANSLATED_DIR}/manifest.json`) return 'NOT JSON {{{';
      return JSON.stringify(fakeStateV4);
    });

    const result = await handleMigrateState(defaultArgs);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to load manifest');
  });

  it('returns structured failure when manifest.json is missing entries array', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === `${FAKE_TRANSLATED_DIR}/manifest.json`) {
        return JSON.stringify({ version: '1.0.0', target: 'azure' }); // missing entries
      }
      return JSON.stringify(fakeStateV4);
    });

    const result = await handleMigrateState(defaultArgs);

    expect(result.success).toBe(false);
    expect(result.error).toContain('manifest');
  });

  it('returns structured failure when state file cannot be read', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === `${FAKE_TRANSLATED_DIR}/manifest.json`) return JSON.stringify(fakeManifest);
      throw new Error('EACCES: permission denied');
    });

    const result = await handleMigrateState(defaultArgs);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to parse state file');
    expect(result.error).toContain('EACCES');
  });

  it('returns structured failure when state file has invalid version', async () => {
    const badState = { version: 99, terraform_version: '0.11.0', serial: 1, lineage: 'x' };
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === `${FAKE_TRANSLATED_DIR}/manifest.json`) return JSON.stringify(fakeManifest);
      return JSON.stringify(badState);
    });

    const result = await handleMigrateState(defaultArgs);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to parse state file');
  });

  it('never throws — unexpected errors are caught and returned', async () => {
    mockReadFile.mockImplementation(() => {
      throw new TypeError('Unexpected internal error');
    });

    const result = await handleMigrateState(defaultArgs);

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// MCP tool wiring (registerTools integration)
// ---------------------------------------------------------------------------

describe('migrate-state tool wiring via registerTools', () => {
  it('wires up the migrate-state tool and calls handleMigrateState', async () => {
    const { registerTools } = await import('../../src/tools/index.js');
    const { buildFakeRegistryManager, defaultConfig } = await import('../helpers.js');

    const registry = await buildFakeRegistryManager([]);

    const toolHandlers = new Map<string, (args: unknown) => Promise<unknown>>();
    const mockServer = {
      tool: (name: string, _desc: string, _schema: unknown, handler: (args: unknown) => Promise<unknown>) => {
        toolHandlers.set(name, handler);
      },
    };

    registerTools(
      mockServer as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
      registry,
      defaultConfig,
    );

    expect(toolHandlers.has('migrate-state')).toBe(true);

    const handler = toolHandlers.get('migrate-state')!;
    const response = await handler({
      stateFile: FAKE_STATE_PATH,
      translationResultDir: FAKE_TRANSLATED_DIR,
      target: 'azure',
      scope: 'full',
      generateBackend: false,
      generateRollback: false,
    });

    expect(response).toHaveProperty('content');
    const content = (response as { content: Array<{ type: string; text: string }> }).content;
    expect(content[0].type).toBe('text');

    const body = JSON.parse(content[0].text) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it('returns isError:true when migration fails', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === `${FAKE_TRANSLATED_DIR}/manifest.json`) {
        throw new Error('ENOENT: manifest not found');
      }
      return '';
    });

    const { registerTools } = await import('../../src/tools/index.js');
    const { buildFakeRegistryManager, defaultConfig } = await import('../helpers.js');

    const registry = await buildFakeRegistryManager([]);
    const toolHandlers = new Map<string, (args: unknown) => Promise<unknown>>();
    const mockServer = {
      tool: (name: string, _desc: string, _schema: unknown, handler: (args: unknown) => Promise<unknown>) => {
        toolHandlers.set(name, handler);
      },
    };

    registerTools(
      mockServer as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
      registry,
      defaultConfig,
    );

    const handler = toolHandlers.get('migrate-state')!;
    const response = await handler({
      stateFile: FAKE_STATE_PATH,
      translationResultDir: FAKE_TRANSLATED_DIR,
      target: 'azure',
      scope: 'full',
      generateBackend: false,
      generateRollback: false,
    });

    const resp = response as { isError?: true; content: Array<{ text: string }> };
    expect(resp.isError).toBe(true);
    const body = JSON.parse(resp.content[0].text) as { success: boolean };
    expect(body.success).toBe(false);
  });
});
