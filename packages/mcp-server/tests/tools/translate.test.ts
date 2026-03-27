/**
 * Tests for the `translate` MCP tool handler.
 *
 * Covers:
 *  - file-based translation (scope: full)
 *  - directory-based translation (scope: full)
 *  - inline HCL translation (scope: full)
 *  - assessment-only mode (scope: assessment)
 *  - scoped translation (scope: selected)
 *  - registry failure → success: false
 *  - parse failure → success: false
 *  - empty directory (no .tf files) → success: false
 *
 * @tla/ingestion and @tla/translator are mocked so tests run without
 * hitting the file system or real HCL parsers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — declare all mock functions before vi.mock() factories run.
// vi.mock() factories are hoisted to the top of the file; any variables they
// reference must be declared with vi.hoisted() to ensure they are initialised
// before the factory executes.
// ---------------------------------------------------------------------------

const {
  mockParseHclFile,
  mockParseHclDirectory,
  mockDependencyGraphBuild,
  MockDependencyGraph,
  mockIrEmitterEmit,
  MockIrEmitter,
  mockIdentifyAwsServices,
  MockTranslationCompiler,
  mockCompilerTranslate,
  mockBuildTranslationReport,
  mockBuildAuditEntry,
  mockAppendAuditEntry,
  mockBuildConfidenceReport,
  mockGenerateRemediationPack,
  mockBuildMigrationPack,
  mockWriteFile,
  mockMkdtemp,
  mockMkdir,
} = vi.hoisted(() => {
  const mockDependencyGraphBuild = vi.fn();
  const mockIrEmitterEmit = vi.fn();
  const mockCompilerTranslate = vi.fn();
  const mockWriteFile = vi.fn().mockResolvedValue(undefined);
  const mockMkdtemp = vi.fn();
  const mockMkdir = vi.fn().mockResolvedValue(undefined);

  return {
    mockParseHclFile: vi.fn(),
    mockParseHclDirectory: vi.fn(),
    mockDependencyGraphBuild,
    MockDependencyGraph: vi.fn(() => ({ build: mockDependencyGraphBuild })),
    mockIrEmitterEmit,
    MockIrEmitter: vi.fn(() => ({ emit: mockIrEmitterEmit })),
    mockIdentifyAwsServices: vi.fn(),
    MockTranslationCompiler: vi.fn(() => ({ translate: mockCompilerTranslate })),
    mockCompilerTranslate,
    mockBuildTranslationReport: vi.fn().mockReturnValue('# Report'),
    mockBuildAuditEntry: vi.fn().mockReturnValue({ ts: '2026-01-01T00:00:00Z', action: 'translate' }),
    mockAppendAuditEntry: vi.fn().mockResolvedValue(undefined),
    mockBuildConfidenceReport: vi.fn().mockReturnValue({ overall: 0.88 }),
    mockGenerateRemediationPack: vi.fn().mockReturnValue({ items: [] }),
    mockBuildMigrationPack: vi.fn().mockReturnValue(null),
    mockWriteFile,
    mockMkdtemp,
    mockMkdir,
  };
});

// ---- Module mocks ----------------------------------------------------------

vi.mock('@tla/ingestion', () => ({
  parseHclFile: (...args: unknown[]) => mockParseHclFile(...args),
  parseHclDirectory: (...args: unknown[]) => mockParseHclDirectory(...args),
  DependencyGraph: MockDependencyGraph,
  IrEmitter: MockIrEmitter,
  identifyAwsServices: (...args: unknown[]) => mockIdentifyAwsServices(...args),
}));

vi.mock('@tla/translator', () => ({
  TranslationCompiler: MockTranslationCompiler,
  buildTranslationReport: (...args: unknown[]) => mockBuildTranslationReport(...args),
  buildAuditEntry: (...args: unknown[]) => mockBuildAuditEntry(...args),
  appendAuditEntry: (...args: unknown[]) => mockAppendAuditEntry(...args),
  buildConfidenceReport: (...args: unknown[]) => mockBuildConfidenceReport(...args),
  generateRemediationPack: (...args: unknown[]) => mockGenerateRemediationPack(...args),
  buildMigrationPack: (...args: unknown[]) => mockBuildMigrationPack(...args),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdtemp: (...args: unknown[]) => mockMkdtemp(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

// ---- Import module under test AFTER mocks are registered ------------------

import { handleTranslate } from '../../src/tools/translate.js';
import type { RegistryManager } from '../../src/registry-manager.js';
import type { RegistryApi } from '@tla/registry';
import type { McpServerConfig } from '../../src/config.js';
import type { HclAst, CanonicalIR } from '@tla/shared';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const fakeAst: HclAst = {
  file_path: '/tmp/main.tf',
  resources: [],
  data_blocks: [],
  variables: [],
  locals: [],
  outputs: [],
  providers: [],
  module_calls: [],
  terraform_blocks: [],
};

const fakeIr: CanonicalIR = {
  version: '1.0.0',
  metadata: {
    source_files: ['/tmp/main.tf'],
    total_resources: 0,
    aws_resources: 0,
    generated_at: new Date().toISOString(),
    tool_version: '0.1.0',
  },
  resources: [],
  relationships: [],
  modules: [],
};

const fakeTranslationResult = {
  target: 'azure' as const,
  resources: [],
  files: {
    'main.tf': '# main',
    'variables.tf': '# vars',
    'outputs.tf': '# outputs',
    'providers.tf': '# providers',
    'terraform.tf': '# terraform',
  },
  manifest: {
    version: '1.0.0',
    registryVersion: '2026.03.13',
    target: 'azure' as const,
    counts: { total: 0, translated: 2, expanded: 1, partial: 0, blocked: 0, advisory: 0 },
    entries: [],
    findings: [],
    confidenceOverall: 0.88,
  },
  findings: [],
  stats: {
    totalResources: 0,
    translated: 2,
    expanded: 1,
    partial: 0,
    blocked: 0,
    advisory: 0,
    durationMs: 12,
  },
};

const fakeInventory = {
  identified_services: [
    {
      resource_type: 'aws_s3_bucket',
      resource_name: 'data',
      family: 'storage',
      service_prefix: 'aws_s3',
      count: 2,
      file_paths: ['/tmp/main.tf'],
    },
  ],
  procedural_resources: [],
  unknown_providers: [],
  total_resources: 2,
  total_aws_resources: 2,
};

const defaultConfig: McpServerConfig = {
  registryDir: '/fake/registry',
  terraformBin: null,
  logLevel: 'silent',
  searchLimit: 50,
  cacheTtlMs: 30_000,
};

function buildFakeRegistryManager(fail?: string): RegistryManager {
  const fakeApi: Partial<RegistryApi> = {
    search: vi.fn().mockReturnValue([{ registry_version: '2026.03.13' }]),
    lookup: vi.fn().mockReturnValue(undefined),
  };

  return {
    getRegistry: vi.fn(async () => {
      if (fail !== undefined) return { ok: false as const, error: fail };
      return { ok: true as const, api: fakeApi as RegistryApi };
    }),
    invalidate: vi.fn(),
  } as unknown as RegistryManager;
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdtemp.mockResolvedValue('/tmp/tla-output-azure-xxx');
  mockWriteFile.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// File-based translation (scope: full)
// ---------------------------------------------------------------------------

describe('handleTranslate — file mode (scope: full)', () => {
  beforeEach(() => {
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIrEmitterEmit.mockReturnValue({ ir: fakeIr, unmappedTypes: [], uncorrelatedNodes: [] });
    mockCompilerTranslate.mockReturnValue(fakeTranslationResult);
  });

  it('returns success:true with files and manifest', async () => {
    const result = await handleTranslate(
      { source: '/tmp/main.tf', sourceType: 'file', target: 'azure', scope: 'full' },
      defaultConfig,
      buildFakeRegistryManager(),
    );

    expect(result.success).toBe(true);
    expect(result.target).toBe('azure');
    expect(result.files).toEqual([
      'main.tf', 'variables.tf', 'outputs.tf', 'providers.tf', 'terraform.tf',
      'manifest.json', 'translation-report.md',
      'audit-log.jsonl', 'confidence-report.json',
    ]);
    expect(result.manifest).toEqual({ translated: 2, expanded: 1, partial: 0, blocked: 0, advisory: 0 });
    expect(result.confidence).toBe(0.88);
    expect(result.findings).toEqual([]);
  });

  it('calls parseHclFile with the source path', async () => {
    await handleTranslate(
      { source: '/tmp/main.tf', sourceType: 'file', target: 'azure', scope: 'full' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(mockParseHclFile).toHaveBeenCalledWith('/tmp/main.tf');
  });

  it('calls DependencyGraph.build with the parsed ASTs', async () => {
    await handleTranslate(
      { source: '/tmp/main.tf', sourceType: 'file', target: 'azure', scope: 'full' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(mockDependencyGraphBuild).toHaveBeenCalledWith([fakeAst]);
  });

  it('calls TranslationCompiler.translate with correct target', async () => {
    await handleTranslate(
      { source: '/tmp/main.tf', sourceType: 'file', target: 'azure', scope: 'full' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(mockCompilerTranslate).toHaveBeenCalledWith(
      fakeIr,
      expect.objectContaining({ targetProvider: 'azure' }),
    );
  });

  it('uses provided outputDir instead of temp dir', async () => {
    const result = await handleTranslate(
      {
        source: '/tmp/main.tf',
        sourceType: 'file',
        target: 'azure',
        scope: 'full',
        outputDir: '/custom/out',
      },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(result.outputDir).toBe('/custom/out');
    expect(mockMkdtemp).not.toHaveBeenCalled();
  });

  it('writes each translated file to outputDir', async () => {
    await handleTranslate(
      {
        source: '/tmp/main.tf',
        sourceType: 'file',
        target: 'azure',
        scope: 'full',
        outputDir: '/custom/out',
      },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('main.tf'),
      '# main',
      'utf-8',
    );
  });

  it('creates a temp output dir when outputDir is not provided', async () => {
    mockMkdtemp.mockResolvedValue('/tmp/tla-output-azure-zzz');
    const result = await handleTranslate(
      { source: '/tmp/main.tf', sourceType: 'file', target: 'azure', scope: 'full' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(result.success).toBe(true);
    expect(result.outputDir).toBe('/tmp/tla-output-azure-zzz');
  });

  it('translates to gcp when target is gcp', async () => {
    const gcpResult = { ...fakeTranslationResult, target: 'gcp' as const };
    mockCompilerTranslate.mockReturnValue(gcpResult);

    const result = await handleTranslate(
      { source: '/tmp/main.tf', sourceType: 'file', target: 'gcp', scope: 'full' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(result.success).toBe(true);
    expect(result.target).toBe('gcp');
  });
});

// ---------------------------------------------------------------------------
// Directory-based translation (scope: full)
// ---------------------------------------------------------------------------

describe('handleTranslate — directory mode (scope: full)', () => {
  beforeEach(() => {
    mockParseHclDirectory.mockResolvedValue({ asts: [fakeAst], errors: [] });
    mockIrEmitterEmit.mockReturnValue({ ir: fakeIr, unmappedTypes: [], uncorrelatedNodes: [] });
    mockCompilerTranslate.mockReturnValue(fakeTranslationResult);
  });

  it('returns success:true for a directory source', async () => {
    const result = await handleTranslate(
      { source: '/tmp/mymodule', sourceType: 'directory', target: 'azure', scope: 'full' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(result.success).toBe(true);
    expect(mockParseHclDirectory).toHaveBeenCalledWith('/tmp/mymodule');
  });

  it('returns success:false when directory has no .tf files', async () => {
    mockParseHclDirectory.mockResolvedValue({ asts: [], errors: [] });

    const result = await handleTranslate(
      { source: '/tmp/empty', sourceType: 'directory', target: 'azure', scope: 'full' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No \.tf files/);
  });

  it('translates all files in the directory', async () => {
    const result = await handleTranslate(
      {
        source: '/tmp/mymodule',
        sourceType: 'directory',
        target: 'azure',
        scope: 'full',
        outputDir: '/out',
      },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(result.success).toBe(true);
    expect(result.files).toHaveLength(9);
  });
});

// ---------------------------------------------------------------------------
// Inline HCL translation (scope: full)
// ---------------------------------------------------------------------------

describe('handleTranslate — inline mode (scope: full)', () => {
  const inlineHcl = 'resource "aws_s3_bucket" "b" { bucket = "test" }';

  beforeEach(() => {
    mockMkdtemp
      .mockResolvedValueOnce('/tmp/tla-inline-xxx')  // inline temp dir
      .mockResolvedValueOnce('/tmp/tla-output-azure-yyy'); // output temp dir
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIrEmitterEmit.mockReturnValue({ ir: fakeIr, unmappedTypes: [], uncorrelatedNodes: [] });
    mockCompilerTranslate.mockReturnValue(fakeTranslationResult);
  });

  it('writes inline HCL to a temp file before parsing', async () => {
    await handleTranslate(
      { source: inlineHcl, sourceType: 'inline', target: 'azure', scope: 'full' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('inline.tf'),
      inlineHcl,
      'utf-8',
    );
  });

  it('calls parseHclFile on the temp inline file', async () => {
    await handleTranslate(
      { source: inlineHcl, sourceType: 'inline', target: 'azure', scope: 'full' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(mockParseHclFile).toHaveBeenCalledWith(expect.stringContaining('inline.tf'));
  });

  it('returns success:true with files', async () => {
    const result = await handleTranslate(
      { source: inlineHcl, sourceType: 'inline', target: 'azure', scope: 'full' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(result.success).toBe(true);
    expect(result.files).toHaveLength(9);
  });
});

// ---------------------------------------------------------------------------
// Assessment-only mode (scope: assessment)
// ---------------------------------------------------------------------------

describe('handleTranslate — assessment mode', () => {
  beforeEach(() => {
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIdentifyAwsServices.mockReturnValue(fakeInventory);
  });

  it('returns an inventory without running translation', async () => {
    const result = await handleTranslate(
      { source: '/tmp/main.tf', sourceType: 'file', target: 'azure', scope: 'assessment' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(result.success).toBe(true);
    expect(result.target).toBe('azure');
    expect(result.inventory).toBeDefined();
    expect(result.files).toBeUndefined();
    expect(result.manifest).toBeUndefined();
  });

  it('does not call TranslationCompiler in assessment mode', async () => {
    await handleTranslate(
      { source: '/tmp/main.tf', sourceType: 'file', target: 'azure', scope: 'assessment' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(mockCompilerTranslate).not.toHaveBeenCalled();
  });

  it('returns correct inventory totals', async () => {
    const result = await handleTranslate(
      { source: '/tmp/main.tf', sourceType: 'file', target: 'azure', scope: 'assessment' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(result.inventory?.totalResources).toBe(2);
    expect(result.inventory?.totalAwsResources).toBe(2);
    expect(result.inventory?.byFamily).toEqual({ storage: 2 });
    expect(result.inventory?.procedural).toBe(0);
    expect(result.inventory?.unknown).toBe(0);
  });

  it('includes byResourceType detail', async () => {
    const result = await handleTranslate(
      { source: '/tmp/main.tf', sourceType: 'file', target: 'azure', scope: 'assessment' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(result.inventory?.byResourceType).toHaveLength(1);
    expect(result.inventory?.byResourceType[0]).toEqual({
      resourceType: 'aws_s3_bucket',
      count: 2,
      family: 'storage',
    });
  });

  it('does not build a DependencyGraph in assessment mode', async () => {
    await handleTranslate(
      { source: '/tmp/main.tf', sourceType: 'file', target: 'azure', scope: 'assessment' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(mockDependencyGraphBuild).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Scoped translation (scope: selected)
// ---------------------------------------------------------------------------

describe('handleTranslate — selected scope', () => {
  const irWithResources: CanonicalIR = {
    ...fakeIr,
    resources: [
      {
        id: 'aws_s3_bucket.data',
        sourceType: 'aws_s3_bucket',
        logicalName: 'data',
        attributes: {},
        dependencies: [],
        filePath: '/tmp/main.tf',
        registryKey: 'aws_s3_bucket',
        intents: [],
        category: 'infrastructure',
      },
      {
        id: 'aws_instance.web',
        sourceType: 'aws_instance',
        logicalName: 'web',
        attributes: {},
        dependencies: [],
        filePath: '/tmp/main.tf',
        registryKey: 'aws_instance',
        intents: [],
        category: 'infrastructure',
      },
    ],
  };

  beforeEach(() => {
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIrEmitterEmit.mockReturnValue({
      ir: irWithResources,
      unmappedTypes: [],
      uncorrelatedNodes: [],
    });
    mockCompilerTranslate.mockReturnValue(fakeTranslationResult);
  });

  it('filters IR to only selected resources before translating', async () => {
    await handleTranslate(
      {
        source: '/tmp/main.tf',
        sourceType: 'file',
        target: 'azure',
        scope: 'selected',
        selectedResources: ['aws_s3_bucket.data'],
        outputDir: '/out',
      },
      defaultConfig,
      buildFakeRegistryManager(),
    );

    const irPassedToCompiler = mockCompilerTranslate.mock.calls[0]?.[0] as CanonicalIR;
    expect(irPassedToCompiler.resources).toHaveLength(1);
    expect(irPassedToCompiler.resources[0]?.id).toBe('aws_s3_bucket.data');
  });

  it('translates all resources when selectedResources is empty', async () => {
    await handleTranslate(
      {
        source: '/tmp/main.tf',
        sourceType: 'file',
        target: 'azure',
        scope: 'selected',
        selectedResources: [],
        outputDir: '/out',
      },
      defaultConfig,
      buildFakeRegistryManager(),
    );

    const irPassedToCompiler = mockCompilerTranslate.mock.calls[0]?.[0] as CanonicalIR;
    expect(irPassedToCompiler.resources).toHaveLength(2);
  });

  it('translates all resources when selectedResources is undefined', async () => {
    await handleTranslate(
      {
        source: '/tmp/main.tf',
        sourceType: 'file',
        target: 'azure',
        scope: 'selected',
        outputDir: '/out',
      },
      defaultConfig,
      buildFakeRegistryManager(),
    );

    const irPassedToCompiler = mockCompilerTranslate.mock.calls[0]?.[0] as CanonicalIR;
    expect(irPassedToCompiler.resources).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('handleTranslate — error paths', () => {
  it('returns success:false when registry is unavailable', async () => {
    mockParseHclFile.mockResolvedValue(fakeAst);

    const result = await handleTranslate(
      { source: '/tmp/main.tf', sourceType: 'file', target: 'azure', scope: 'full' },
      defaultConfig,
      buildFakeRegistryManager('Registry not configured'),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Registry unavailable');
  });

  it('returns success:false when parseHclFile throws', async () => {
    mockParseHclFile.mockRejectedValue(new Error('HCL parse error'));

    const result = await handleTranslate(
      { source: '/tmp/bad.tf', sourceType: 'file', target: 'azure', scope: 'full' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('HCL parse error');
  });

  it('returns success:false when parseHclDirectory throws', async () => {
    mockParseHclDirectory.mockRejectedValue(new Error('Cannot read directory'));

    const result = await handleTranslate(
      { source: '/tmp/bad-dir', sourceType: 'directory', target: 'azure', scope: 'full' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot read directory');
  });

  it('returns success:false when TranslationCompiler throws', async () => {
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIrEmitterEmit.mockReturnValue({ ir: fakeIr, unmappedTypes: [], uncorrelatedNodes: [] });
    mockCompilerTranslate.mockImplementation(() => {
      throw new Error('Compiler exploded');
    });

    const result = await handleTranslate(
      { source: '/tmp/main.tf', sourceType: 'file', target: 'azure', scope: 'full', outputDir: '/out' },
      defaultConfig,
      buildFakeRegistryManager(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Compiler exploded');
  });

  it('never throws — always resolves to a result object', async () => {
    mockParseHclFile.mockRejectedValue(new Error('Unexpected'));

    await expect(
      handleTranslate(
        { source: '/tmp/main.tf', sourceType: 'file', target: 'azure', scope: 'full' },
        defaultConfig,
        buildFakeRegistryManager(),
      ),
    ).resolves.toMatchObject({ success: false });
  });
});

// ---------------------------------------------------------------------------
// MCP tool wiring: translate tool registered in registerTools
// ---------------------------------------------------------------------------

describe('translate tool registered in registerTools', () => {
  it('is wired and returns success shape for a valid inline call', async () => {
    // Arrange additional mock returns for the inline + output temp dirs
    mockMkdtemp
      .mockResolvedValueOnce('/tmp/tla-inline-aaa')
      .mockResolvedValueOnce('/tmp/tla-output-azure-bbb');
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIrEmitterEmit.mockReturnValue({ ir: fakeIr, unmappedTypes: [], uncorrelatedNodes: [] });
    mockCompilerTranslate.mockReturnValue(fakeTranslationResult);

    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { registerTools } = await import('../../src/tools/index.js');
    const { RegistryManager } = await import('../../src/registry-manager.js');

    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const manager = new RegistryManager(defaultConfig);
    (manager as { getRegistry: unknown }).getRegistry = vi.fn(async () => ({
      ok: true as const,
      api: {
        search: vi.fn().mockReturnValue([{ registry_version: '2026.03.13' }]),
        lookup: vi.fn().mockReturnValue(undefined),
      },
    }));

    registerTools(server, manager, defaultConfig);

    type ToolRecord = { handler: (args: Record<string, unknown>, extra: unknown) => Promise<{ content: Array<{ text: string }> }> };
    const tools = (server as unknown as { _registeredTools: Record<string, ToolRecord> })._registeredTools;
    const translateTool = tools['translate'];
    expect(translateTool).toBeDefined();

    const result = await translateTool!.handler(
      {
        source: 'resource "aws_s3_bucket" "b" {}',
        sourceType: 'inline',
        target: 'azure',
        scope: 'full',
      },
      {},
    );
    const body = JSON.parse(result.content[0]!.text) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it('returns isError when translate handler returns success:false', async () => {
    mockParseHclFile.mockRejectedValue(new Error('parse fail'));

    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { registerTools } = await import('../../src/tools/index.js');
    const { RegistryManager } = await import('../../src/registry-manager.js');

    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const manager = new RegistryManager(defaultConfig);
    (manager as { getRegistry: unknown }).getRegistry = vi.fn(async () => ({
      ok: true as const,
      api: {
        search: vi.fn().mockReturnValue([{ registry_version: '2026.03.13' }]),
        lookup: vi.fn().mockReturnValue(undefined),
      },
    }));

    registerTools(server, manager, defaultConfig);

    type ToolRecord = { handler: (args: Record<string, unknown>, extra: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> };
    const tools = (server as unknown as { _registeredTools: Record<string, ToolRecord> })._registeredTools;
    const result = await tools['translate']!.handler(
      { source: '/bad.tf', sourceType: 'file', target: 'azure', scope: 'full' },
      {},
    );
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0]!.text) as { success: boolean };
    expect(body.success).toBe(false);
  });
});
