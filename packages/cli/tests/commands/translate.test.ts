/**
 * Tests for the CLI `translate` command (registerTranslate).
 *
 * Covers:
 *  - command registration & option wiring
 *  - file-based full translation (azure / gcp)
 *  - directory-based full translation
 *  - custom --output directory
 *  - --format json output
 *  - assessment mode (--assess and --scope assessment)
 *  - selected scope filtering
 *  - error handling (missing source, empty dir, invalid target/scope)
 *  - exit codes (no blockers, blockers, exception)
 *  - registry path resolution
 *
 * All external dependencies are mocked so tests run without the file system,
 * HCL parsers, or real registry data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// ---------------------------------------------------------------------------
// vi.hoisted -- declare all mock functions before vi.mock() factories run.
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
  MockRegistryApi,
  mockRegistryInit,
  mockRegistrySearch,
  mockLoadRegistryFromDirectory,
  mockValidateRegistryEntries,
  mockStat,
  mockMkdir,
  mockWriteFile,
  mockBuildTranslationReport,
  mockBuildAuditEntry,
  mockAppendAuditEntry,
  mockBuildConfidenceReport,
  mockGenerateRemediationPack,
  mockBuildMigrationPack,
} = vi.hoisted(() => {
  const mockDependencyGraphBuild = vi.fn();
  const mockIrEmitterEmit = vi.fn();
  const mockCompilerTranslate = vi.fn();
  const mockRegistryInit = vi.fn().mockResolvedValue({ entries: [], errors: [] });
  const mockRegistrySearch = vi.fn().mockReturnValue([{ registry_version: '2026.03.13' }]);

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
    MockRegistryApi: vi.fn(() => ({
      init: mockRegistryInit,
      search: mockRegistrySearch,
    })),
    mockRegistryInit,
    mockRegistrySearch,
    mockLoadRegistryFromDirectory: vi.fn(),
    mockValidateRegistryEntries: vi.fn(),
    mockStat: vi.fn(),
    mockMkdir: vi.fn().mockResolvedValue(undefined),
    mockWriteFile: vi.fn().mockResolvedValue(undefined),
    mockBuildTranslationReport: vi.fn().mockReturnValue('# Translation Report'),
    mockBuildAuditEntry: vi.fn().mockReturnValue({ timestamp: '2026-01-01', runId: 'test' }),
    mockAppendAuditEntry: vi.fn().mockResolvedValue(undefined),
    mockBuildConfidenceReport: vi.fn().mockReturnValue({ confidenceOverall: 0.88 }),
    mockGenerateRemediationPack: vi.fn().mockReturnValue({ tasks: [], summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }, estimatedTotalEffort: '0 hours' }),
    mockBuildMigrationPack: vi.fn().mockReturnValue(null),
  };
});

// ---- Module mocks ---------------------------------------------------------

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

vi.mock('@tla/registry', () => ({
  RegistryApi: MockRegistryApi,
  loadRegistryFromDirectory: (...args: unknown[]) => mockLoadRegistryFromDirectory(...args),
  validateRegistryEntries: (...args: unknown[]) => mockValidateRegistryEntries(...args),
}));

vi.mock('node:fs/promises', () => ({
  stat: (...args: unknown[]) => mockStat(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

// ---- Import module under test AFTER mocks are registered ------------------

import { registerTranslate } from '../../src/commands/translate.js';
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
  findings: [] as Array<{ resourceId: string; severity: string; code: string; message: string }>,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a Commander program, registers the translate command, then
 * executes `program.parseAsync(argv)` while capturing stdout/stderr writes
 * and process.exitCode.
 *
 * Commander normally calls process.exit on errors. We suppress that via
 * `exitOverride`, capture OutputError, and still record the exitCode.
 */
async function runTranslate(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
}> {
  const chunks: { stream: 'out' | 'err'; text: string }[] = [];
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalExitCode = process.exitCode;

  process.exitCode = undefined;

  // Capture stdout
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push({ stream: 'out', text: String(chunk) });
    return true;
  }) as typeof process.stdout.write;

  // Capture stderr
  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push({ stream: 'err', text: String(chunk) });
    return true;
  }) as typeof process.stderr.write;

  try {
    const program = new Command();
    program.exitOverride(); // Throw instead of process.exit
    registerTranslate(program);

    // Commander expects argv[0]=node, argv[1]=script
    await program.parseAsync(['node', 'tla', 'translate', ...args]);
  } catch {
    // Commander's exitOverride throws on --help, version, unknown opts, etc.
    // Our action handler sets process.exitCode directly (does not throw).
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  const exitCode = process.exitCode;
  process.exitCode = originalExitCode;

  return {
    stdout: chunks.filter((c) => c.stream === 'out').map((c) => c.text).join(''),
    stderr: chunks.filter((c) => c.stream === 'err').map((c) => c.text).join(''),
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// Default mock setup: stat resolves as a file
// ---------------------------------------------------------------------------

function setupStatAsFile(): void {
  mockStat.mockResolvedValue({ isDirectory: () => false });
}

function setupStatAsDirectory(): void {
  mockStat.mockResolvedValue({ isDirectory: () => true });
}

function setupFullPipeline(): void {
  mockParseHclFile.mockResolvedValue(fakeAst);
  mockIrEmitterEmit.mockReturnValue({ ir: fakeIr, unmappedTypes: [], uncorrelatedNodes: [] });
  mockCompilerTranslate.mockReturnValue(fakeTranslationResult);
}

function setupDirectoryPipeline(): void {
  mockParseHclDirectory.mockResolvedValue({ asts: [fakeAst], errors: [] });
  mockIrEmitterEmit.mockReturnValue({ ir: fakeIr, unmappedTypes: [], uncorrelatedNodes: [] });
  mockCompilerTranslate.mockReturnValue(fakeTranslationResult);
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockRegistryInit.mockResolvedValue({ entries: [], errors: [] });
  mockRegistrySearch.mockReturnValue([{ registry_version: '2026.03.13' }]);
});

// ===========================================================================
// TESTS
// ===========================================================================

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

describe('registerTranslate — command registration', () => {
  it('attaches a "translate" command to the program', () => {
    const program = new Command();
    registerTranslate(program);

    const translateCmd = program.commands.find((c) => c.name() === 'translate');
    expect(translateCmd).toBeDefined();
    expect(translateCmd!.description()).toContain('Translate');
  });

  it('has correct options: target, output, scope, selected, format, registry, assess', () => {
    const program = new Command();
    registerTranslate(program);

    const translateCmd = program.commands.find((c) => c.name() === 'translate')!;
    const optionNames = translateCmd.options.map((o) => o.long?.replace('--', ''));

    expect(optionNames).toContain('target');
    expect(optionNames).toContain('output');
    expect(optionNames).toContain('scope');
    expect(optionNames).toContain('selected');
    expect(optionNames).toContain('format');
    expect(optionNames).toContain('registry');
    expect(optionNames).toContain('assess');
  });
});

// ---------------------------------------------------------------------------
// Happy Path — Full Translation
// ---------------------------------------------------------------------------

describe('registerTranslate — file input + azure target', () => {
  beforeEach(() => {
    setupStatAsFile();
    setupFullPipeline();
  });

  it('writes .tf files to output dir', async () => {
    const { stdout, exitCode } = await runTranslate([
      '/tmp/main.tf',
      '--target', 'azure',
      '--output', '/tmp/test-out',
    ]);

    expect(exitCode).toBeUndefined();
    expect(stdout).toContain('Translation Complete');
    expect(mockWriteFile).toHaveBeenCalledTimes(10);
    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining('test-out'),
      { recursive: true },
    );
  });
});

describe('registerTranslate — directory input + gcp target', () => {
  beforeEach(() => {
    setupStatAsDirectory();
    setupDirectoryPipeline();
    const gcpResult = {
      ...fakeTranslationResult,
      target: 'gcp' as const,
      manifest: { ...fakeTranslationResult.manifest, target: 'gcp' as const },
    };
    mockCompilerTranslate.mockReturnValue(gcpResult);
  });

  it('writes .tf files using parseHclDirectory', async () => {
    const { stdout, exitCode } = await runTranslate([
      '/tmp/mymodule',
      '--target', 'gcp',
      '--output', '/tmp/gcp-out',
    ]);

    expect(exitCode).toBeUndefined();
    expect(stdout).toContain('Translation Complete');
    expect(mockParseHclDirectory).toHaveBeenCalled();
    expect(mockParseHclFile).not.toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledTimes(10);
  });
});

describe('registerTranslate — custom --output dir', () => {
  beforeEach(() => {
    setupStatAsFile();
    setupFullPipeline();
  });

  it('writes to the specified output path', async () => {
    const { stdout } = await runTranslate([
      '/tmp/main.tf',
      '--output', '/custom/target/dir',
    ]);

    expect(stdout).toContain('/custom/target/dir');
    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining('/custom/target/dir'),
      { recursive: true },
    );
  });
});

describe('registerTranslate — --format json', () => {
  beforeEach(() => {
    setupStatAsFile();
    setupFullPipeline();
  });

  it('outputs valid JSON with success=true', async () => {
    const { stdout, exitCode } = await runTranslate([
      '/tmp/main.tf',
      '--format', 'json',
      '--output', '/tmp/json-out',
    ]);

    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.target).toBe('azure');
    expect(parsed.files).toEqual(expect.arrayContaining(['main.tf', 'variables.tf']));
    expect(parsed.manifest).toMatchObject({
      translated: 2,
      expanded: 1,
      partial: 0,
      blocked: 0,
      advisory: 0,
    });
    expect(typeof parsed.confidence).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Assessment Mode
// ---------------------------------------------------------------------------

describe('registerTranslate — assessment mode', () => {
  beforeEach(() => {
    setupStatAsFile();
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIdentifyAwsServices.mockReturnValue(fakeInventory);
  });

  it('--assess flag prints inventory without translation', async () => {
    const { stdout, exitCode } = await runTranslate([
      '/tmp/main.tf',
      '--assess',
    ]);

    expect(exitCode).toBeUndefined();
    expect(stdout).toContain('Assessment Inventory');
    expect(stdout).toContain('Total resources: 2');
    expect(stdout).toContain('AWS resources:   2');
    expect(mockCompilerTranslate).not.toHaveBeenCalled();
  });

  it('--scope assessment prints inventory', async () => {
    const { stdout, exitCode } = await runTranslate([
      '/tmp/main.tf',
      '--scope', 'assessment',
    ]);

    expect(exitCode).toBeUndefined();
    expect(stdout).toContain('Assessment Inventory');
    expect(mockCompilerTranslate).not.toHaveBeenCalled();
  });

  it('assessment JSON format returns valid JSON with inventory', async () => {
    const { stdout } = await runTranslate([
      '/tmp/main.tf',
      '--assess',
      '--format', 'json',
    ]);

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.inventory).toBeDefined();
    expect(parsed.inventory.totalResources).toBe(2);
    expect(parsed.inventory.totalAwsResources).toBe(2);
    expect(parsed.inventory.byFamily).toEqual({ storage: 2 });
  });
});

// ---------------------------------------------------------------------------
// Selected Scope
// ---------------------------------------------------------------------------

describe('registerTranslate — selected scope', () => {
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
    relationships: [
      { from: 'aws_s3_bucket.data', to: 'aws_instance.web', type: 'depends_on' },
    ],
  };

  beforeEach(() => {
    setupStatAsFile();
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIrEmitterEmit.mockReturnValue({
      ir: irWithResources,
      unmappedTypes: [],
      uncorrelatedNodes: [],
    });
    mockCompilerTranslate.mockReturnValue(fakeTranslationResult);
  });

  it('--scope selected --selected aws_s3_bucket.data filters IR to selected resources', async () => {
    await runTranslate([
      '/tmp/main.tf',
      '--scope', 'selected',
      '--selected', 'aws_s3_bucket.data',
      '--output', '/tmp/sel-out',
    ]);

    expect(mockCompilerTranslate).toHaveBeenCalledTimes(1);
    const irPassedToCompiler = mockCompilerTranslate.mock.calls[0]?.[0] as CanonicalIR;
    expect(irPassedToCompiler.resources).toHaveLength(1);
    expect(irPassedToCompiler.resources[0]?.id).toBe('aws_s3_bucket.data');
    // Relationship should be removed since aws_instance.web is filtered out
    expect(irPassedToCompiler.relationships).toHaveLength(0);
  });

  it('--scope selected with no --selected processes all resources', async () => {
    await runTranslate([
      '/tmp/main.tf',
      '--scope', 'selected',
      '--output', '/tmp/sel-out',
    ]);

    expect(mockCompilerTranslate).toHaveBeenCalledTimes(1);
    const irPassedToCompiler = mockCompilerTranslate.mock.calls[0]?.[0] as CanonicalIR;
    expect(irPassedToCompiler.resources).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

describe('registerTranslate — error handling', () => {
  it('missing source path (stat throws) sets exitCode 1 with stderr message', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT: no such file or directory'));

    const { stderr, exitCode } = await runTranslate([
      '/tmp/nonexistent.tf',
      '--output', '/tmp/out',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('not found');
  });

  it('empty directory (no .tf files) sets exitCode 1 with stderr message', async () => {
    setupStatAsDirectory();
    mockParseHclDirectory.mockResolvedValue({ asts: [], errors: [] });

    const { stderr, exitCode } = await runTranslate([
      '/tmp/empty-dir',
      '--output', '/tmp/out',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('No .tf files');
  });

  it('invalid --target value sets exitCode 1 with stderr message', async () => {
    setupStatAsFile();
    mockParseHclFile.mockResolvedValue(fakeAst);

    const { stderr, exitCode } = await runTranslate([
      '/tmp/main.tf',
      '--target', 'aws',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--target must be azure or gcp');
  });

  it('invalid --scope value sets exitCode 1 with stderr message', async () => {
    setupStatAsFile();
    mockParseHclFile.mockResolvedValue(fakeAst);

    const { stderr, exitCode } = await runTranslate([
      '/tmp/main.tf',
      '--scope', 'invalid',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--scope must be full, assessment, selected, stack, or module');
  });
});

// ---------------------------------------------------------------------------
// Exit Codes
// ---------------------------------------------------------------------------

describe('registerTranslate — exit codes', () => {
  it('no blockers: exitCode is undefined (0)', async () => {
    setupStatAsFile();
    setupFullPipeline();

    const { exitCode } = await runTranslate([
      '/tmp/main.tf',
      '--output', '/tmp/out',
    ]);

    expect(exitCode).toBeUndefined();
  });

  it('blocker findings present: exitCode is 1', async () => {
    setupStatAsFile();
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIrEmitterEmit.mockReturnValue({ ir: fakeIr, unmappedTypes: [], uncorrelatedNodes: [] });

    const resultWithBlocker = {
      ...fakeTranslationResult,
      findings: [
        {
          resourceId: 'aws_security_group.open',
          severity: 'blocker',
          code: 'EC-007',
          message: 'Ingress rule too broad',
        },
      ],
    };
    mockCompilerTranslate.mockReturnValue(resultWithBlocker);

    const { exitCode, stdout } = await runTranslate([
      '/tmp/main.tf',
      '--output', '/tmp/out',
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toContain('BLOCKER');
    expect(stdout).toContain('EC-007');
  });

  it('pipeline exception sets exitCode 1 with stderr message', async () => {
    setupStatAsFile();
    mockParseHclFile.mockRejectedValue(new Error('Unexpected HCL parse failure'));

    const { stderr, exitCode } = await runTranslate([
      '/tmp/main.tf',
      '--output', '/tmp/out',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Failed to parse HCL source');
  });
});

// ---------------------------------------------------------------------------
// Registry path resolution
// ---------------------------------------------------------------------------

describe('registerTranslate — registry', () => {
  beforeEach(() => {
    setupStatAsFile();
    setupFullPipeline();
  });

  it('custom --registry path is used in RegistryApi constructor', async () => {
    await runTranslate([
      '/tmp/main.tf',
      '--registry', '/custom/registry/path',
      '--output', '/tmp/out',
    ]);

    expect(MockRegistryApi).toHaveBeenCalledWith(
      expect.stringContaining('/custom/registry/path'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('default registry path uses ./data/registry (or TLA_REGISTRY_DIR)', async () => {
    await runTranslate([
      '/tmp/main.tf',
      '--output', '/tmp/out',
    ]);

    // RegistryApi should have been constructed — the first arg is the resolved
    // registry directory path. When no --registry flag is given, Commander uses
    // the default which is process.env.TLA_REGISTRY_DIR ?? './data/registry'.
    expect(MockRegistryApi).toHaveBeenCalledTimes(1);
    const registryPathArg = MockRegistryApi.mock.calls[0]?.[0] as string;
    // It should end with 'data/registry' (the resolved default)
    expect(registryPathArg).toMatch(/data\/registry$/);
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases
// ---------------------------------------------------------------------------

describe('registerTranslate — text output formatting', () => {
  beforeEach(() => {
    setupStatAsFile();
    setupFullPipeline();
  });

  it('text output includes target, confidence, manifest summary, and file list', async () => {
    const { stdout } = await runTranslate([
      '/tmp/main.tf',
      '--output', '/tmp/out',
    ]);

    expect(stdout).toContain('Translation Complete');
    expect(stdout).toContain('Target:     azure');
    expect(stdout).toContain('Confidence: 88%');
    expect(stdout).toContain('Translated: 2');
    expect(stdout).toContain('Expanded:   1');
    expect(stdout).toContain('main.tf');
    expect(stdout).toContain('providers.tf');
  });

  it('text output shows warnings alongside blockers', async () => {
    setupStatAsFile();
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIrEmitterEmit.mockReturnValue({ ir: fakeIr, unmappedTypes: [], uncorrelatedNodes: [] });

    const resultWithFindings = {
      ...fakeTranslationResult,
      findings: [
        {
          resourceId: 'aws_sg.open',
          severity: 'blocker',
          code: 'EC-007',
          message: 'Rule too broad',
        },
        {
          resourceId: 'aws_kms.key',
          severity: 'warning',
          code: 'KMS-001',
          message: 'Policy not translated',
        },
      ],
    };
    mockCompilerTranslate.mockReturnValue(resultWithFindings);

    const { stdout } = await runTranslate([
      '/tmp/main.tf',
      '--output', '/tmp/out',
    ]);

    expect(stdout).toContain('1 blocker(s), 1 warning(s)');
    expect(stdout).toContain('BLOCKER [EC-007]');
    expect(stdout).toContain('WARNING [KMS-001]');
  });
});

describe('registerTranslate — assessment text formatting', () => {
  beforeEach(() => {
    setupStatAsFile();
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIdentifyAwsServices.mockReturnValue(fakeInventory);
  });

  it('text assessment includes family and resource type breakdown', async () => {
    const { stdout } = await runTranslate([
      '/tmp/main.tf',
      '--assess',
    ]);

    expect(stdout).toContain('By family:');
    expect(stdout).toContain('storage: 2');
    expect(stdout).toContain('By resource type:');
    expect(stdout).toContain('aws_s3_bucket: 2 (storage)');
  });
});

describe('registerTranslate — pipeline wiring', () => {
  it('calls DependencyGraph.build and IrEmitter.emit in full translation', async () => {
    setupStatAsFile();
    setupFullPipeline();

    await runTranslate([
      '/tmp/main.tf',
      '--output', '/tmp/out',
    ]);

    expect(MockDependencyGraph).toHaveBeenCalledTimes(1);
    expect(mockDependencyGraphBuild).toHaveBeenCalledWith([fakeAst]);
    expect(MockIrEmitter).toHaveBeenCalledTimes(1);
    expect(mockIrEmitterEmit).toHaveBeenCalledWith(
      [fakeAst],
      expect.anything(), // the graph instance
    );
  });

  it('passes correct compiler options (targetProvider, registryVersion, emitComments, sortKeys)', async () => {
    setupStatAsFile();
    setupFullPipeline();

    await runTranslate([
      '/tmp/main.tf',
      '--target', 'gcp',
      '--output', '/tmp/out',
    ]);

    expect(mockCompilerTranslate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        targetProvider: 'gcp',
        registryVersion: '2026.03.13',
        emitComments: true,
        sortKeys: true,
      }),
    );
  });

  it('writes each translated file with utf-8 encoding', async () => {
    setupStatAsFile();
    setupFullPipeline();

    await runTranslate([
      '/tmp/main.tf',
      '--output', '/tmp/out',
    ]);

    expect(mockWriteFile).toHaveBeenCalledTimes(10);
    for (const call of mockWriteFile.mock.calls) {
      expect(call[2]).toBe('utf-8');
    }
    // Verify specific file contents
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('main.tf'),
      '# main',
      'utf-8',
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('variables.tf'),
      '# vars',
      'utf-8',
    );
  });
});

describe('registerTranslate — json output for full translation', () => {
  it('json output includes findings array when present', async () => {
    setupStatAsFile();
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIrEmitterEmit.mockReturnValue({ ir: fakeIr, unmappedTypes: [], uncorrelatedNodes: [] });

    const resultWithFindings = {
      ...fakeTranslationResult,
      findings: [
        {
          resourceId: 'aws_sg.open',
          severity: 'blocker',
          code: 'EC-007',
          message: 'Rule too broad',
        },
      ],
    };
    mockCompilerTranslate.mockReturnValue(resultWithFindings);

    const { stdout } = await runTranslate([
      '/tmp/main.tf',
      '--format', 'json',
      '--output', '/tmp/out',
    ]);

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.success).toBe(true);
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].code).toBe('EC-007');
    expect(parsed.findings[0].severity).toBe('blocker');
  });
});

describe('registerTranslate — default output directory', () => {
  it('creates tla-output-<target> when no --output specified', async () => {
    setupStatAsFile();
    setupFullPipeline();

    const { stdout } = await runTranslate(['/tmp/main.tf', '--target', 'gcp']);

    // The mkdir call should include 'tla-output-gcp'
    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining('tla-output-gcp'),
      { recursive: true },
    );
  });
});

describe('registerTranslate — TranslationCompiler throws', () => {
  it('catches compiler exceptions and sets exitCode 1', async () => {
    setupStatAsFile();
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIrEmitterEmit.mockReturnValue({ ir: fakeIr, unmappedTypes: [], uncorrelatedNodes: [] });
    mockCompilerTranslate.mockImplementation(() => {
      throw new Error('Compiler internal error');
    });

    const { stderr, exitCode } = await runTranslate([
      '/tmp/main.tf',
      '--output', '/tmp/out',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Translation failed unexpectedly');
  });
});
