/**
 * Tests for the CLI `validate` command (registerValidate).
 *
 * Covers:
 *  - command registration & option wiring
 *  - happy path (all checks pass, JSON/text output)
 *  - strict mode (warnings → failure)
 *  - subset checks (--checks filter)
 *  - exit codes (pass / fail / warn)
 *  - error handling (missing dir, invalid target/profile, IR load failure)
 *  - missing IR (semantic/cost skipped gracefully)
 *  - compliance profile selection (cis-basic, cis-advanced, none)
 *  - syntax check (pass / fail early exit)
 *
 * All external dependencies are mocked so tests run without the file system
 * or real validator engines.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

// ---------------------------------------------------------------------------
// vi.hoisted — declare all mock functions before vi.mock() factories run.
// ---------------------------------------------------------------------------

const {
  mockEvaluatePolicies,
  mockCheckCompliance,
  mockCheckEquivalence,
  mockScoreConfidence,
  mockEstimateCostDelta,
  mockClassificationToSemanticStatus,
  mockCIS_BASIC,
  mockCIS_ADVANCED,
  mockReaddir,
  mockReadFile,
  mockResolve,
  mockJoin,
  mockExtname,
} = vi.hoisted(() => {
  return {
    mockEvaluatePolicies: vi.fn(),
    mockCheckCompliance: vi.fn(),
    mockCheckEquivalence: vi.fn(),
    mockScoreConfidence: vi.fn(),
    mockEstimateCostDelta: vi.fn(),
    mockClassificationToSemanticStatus: vi.fn(),
    mockCIS_BASIC: { name: 'cis-basic', description: 'CIS Basic', rules: [] },
    mockCIS_ADVANCED: { name: 'cis-advanced', description: 'CIS Advanced', rules: [] },
    mockReaddir: vi.fn(),
    mockReadFile: vi.fn(),
    mockResolve: vi.fn((...segments: string[]) => segments.join('/')),
    mockJoin: vi.fn((...segments: string[]) => segments.join('/')),
    mockExtname: vi.fn((f: string) => {
      const dot = f.lastIndexOf('.');
      return dot >= 0 ? f.slice(dot) : '';
    }),
  };
});

// ---- Module mocks ---------------------------------------------------------

vi.mock('@tla/validator', () => ({
  evaluatePolicies: (...args: unknown[]) => mockEvaluatePolicies(...args),
  checkCompliance: (...args: unknown[]) => mockCheckCompliance(...args),
  checkEquivalence: (...args: unknown[]) => mockCheckEquivalence(...args),
  scoreConfidence: (...args: unknown[]) => mockScoreConfidence(...args),
  estimateCostDelta: (...args: unknown[]) => mockEstimateCostDelta(...args),
  classificationToSemanticStatus: (...args: unknown[]) => mockClassificationToSemanticStatus(...args),
  CIS_BASIC: mockCIS_BASIC,
  CIS_ADVANCED: mockCIS_ADVANCED,
}));

vi.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

vi.mock('node:path', () => ({
  resolve: (...args: unknown[]) => mockResolve(...args),
  join: (...args: unknown[]) => mockJoin(...args),
  extname: (...args: unknown[]) => mockExtname(...args),
}));

// ---- Import module under test AFTER mocks are registered ------------------

import { registerValidate } from '../../src/commands/validate.js';

// ---------------------------------------------------------------------------
// Shared mock-return builders
// ---------------------------------------------------------------------------

/** Default policy report: everything passes. */
function makePolicyReport(overrides?: Partial<{ passed: boolean; warnings: number; failed: number }>) {
  const passed = overrides?.passed ?? true;
  return {
    passed,
    results: [] as Array<{ passed: boolean; severity: string; resourceId?: string }>,
    findings: [],
    summary: { total: 0, passed: 0, failed: overrides?.failed ?? 0, errors: 0 },
  };
}

/** Default compliance report: score 100, passed. */
function makeComplianceReport(overrides?: Partial<{ score: number; passed: boolean }>) {
  return {
    score: overrides?.score ?? 100,
    passed: overrides?.passed ?? true,
    results: [],
    findings: [],
    summary: { total: 0, applicable: 0, passed: 0, failed: 0 },
  };
}

/** Default equivalence report: all equivalent. */
function makeEquivalenceReport(overrides?: Partial<{ classification: string; overallScore: number }>) {
  return {
    overallScore: overrides?.overallScore ?? 1.0,
    classification: overrides?.classification ?? 'equivalent',
    records: [],
    summary: { total: 0, equivalent: 0, partial: 0, degraded: 0, missing: 0 },
  };
}

/** Default confidence report: high confidence, no escalation. */
function makeConfidenceReport(overrides?: Partial<{ overall: number; band: string; escalationRequired: boolean }>) {
  return {
    overall: overrides?.overall ?? 0.9,
    overallBand: overrides?.band ?? 'high',
    byResource: new Map(),
    byFamily: new Map(),
    escalationRequired: overrides?.escalationRequired ?? false,
    reviewRequired: [],
    factors: { policyFactor: 1, complianceFactor: 1, semanticFactor: 1 },
  };
}

/** Default cost-delta report. */
function makeCostDeltaReport(overrides?: Partial<{ deltaPercent: number; caveats: string[] }>) {
  return {
    sourceEstimate: { total: 100, lineItems: [] },
    targetEstimate: { total: 110, lineItems: [] },
    delta: 10,
    deltaPercent: overrides?.deltaPercent ?? 10,
    perResource: [],
    caveats: overrides?.caveats ?? ['Estimate only'],
    reviewRequired: true as const,
  };
}

/** Fake IR JSON string (used as readFile return for --ir). */
function makeIrFileJson(opts?: { includeTranslationResult?: boolean }) {
  const ir = {
    version: '1.0.0',
    sourceProvider: 'aws',
    metadata: { generatedAt: new Date().toISOString(), sourceFiles: [], toolVersion: '0.1.0', resourceCount: 0, relationshipCount: 0 },
    resources: [],
    relationships: [],
    modules: [],
    intents: [],
  };
  const translationResult = opts?.includeTranslationResult
    ? {
        target: 'azure',
        resources: [],
        files: {},
        manifest: {
          version: '1.0.0',
          registryVersion: '0.0.0',
          target: 'azure',
          counts: { total: 0, translated: 0, expanded: 0, partial: 0, blocked: 0, advisory: 0 },
          entries: [],
          findings: [],
          confidenceOverall: 0.85,
        },
        findings: [],
        stats: { totalResources: 0, translated: 0, expanded: 0, partial: 0, blocked: 0, advisory: 0, durationMs: 5 },
      }
    : undefined;
  return JSON.stringify({ ir, translationResult });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a Commander program, registers the validate command, then
 * executes `program.parseAsync(argv)` while capturing stdout/stderr writes
 * and process.exitCode.
 *
 * Commander normally calls process.exit on errors. We suppress that via
 * `exitOverride`, capture OutputError, and still record the exitCode.
 */
async function runValidate(args: string[]): Promise<{
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
    registerValidate(program);

    // Commander expects argv[0]=node, argv[1]=script
    await program.parseAsync(['node', 'tla', 'validate', ...args]);
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

/**
 * Wires up readdir/readFile to simulate a translated directory with N valid .tf files.
 * Each file has balanced braces and no NUL bytes.
 */
function setupSyntaxPass(fileCount = 2): void {
  const files = Array.from({ length: fileCount }, (_, i) => `file${String(i)}.tf`);
  mockReaddir.mockResolvedValue(files);
  mockReadFile.mockImplementation(async (_path: string) => 'resource "null_resource" "x" {\n}\n');
}

/**
 * Wires up all validator mocks to return passing results for a full run.
 */
function setupAllChecksPass(): void {
  setupSyntaxPass();
  mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
  mockCheckCompliance.mockReturnValue(makeComplianceReport());
  mockCheckEquivalence.mockReturnValue(makeEquivalenceReport());
  mockScoreConfidence.mockReturnValue(makeConfidenceReport());
  mockEstimateCostDelta.mockReturnValue(makeCostDeltaReport());
  mockClassificationToSemanticStatus.mockReturnValue('preserved');
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Reset path mocks to passthrough defaults
  mockResolve.mockImplementation((...segments: string[]) => segments.join('/'));
  mockJoin.mockImplementation((...segments: string[]) => segments.join('/'));
  mockExtname.mockImplementation((f: string) => {
    const dot = (f as string).lastIndexOf('.');
    return dot >= 0 ? (f as string).slice(dot) : '';
  });
});

// ===========================================================================
// TESTS
// ===========================================================================

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

describe('registerValidate — command registration', () => {
  it('attaches a "validate" command to the program', () => {
    const program = new Command();
    registerValidate(program);

    const validateCmd = program.commands.find((c) => c.name() === 'validate');
    expect(validateCmd).toBeDefined();
    expect(validateCmd!.description()).toContain('validation');
  });

  it('has correct options (--target, --strict, --ir, --checks, --compliance-profile, --format)', () => {
    const program = new Command();
    registerValidate(program);

    const validateCmd = program.commands.find((c) => c.name() === 'validate')!;
    const optionNames = validateCmd.options.map((o) => o.long ?? o.short);

    expect(optionNames).toContain('--target');
    expect(optionNames).toContain('--strict');
    expect(optionNames).toContain('--ir');
    expect(optionNames).toContain('--checks');
    expect(optionNames).toContain('--compliance-profile');
    expect(optionNames).toContain('--format');
  });
});

// ---------------------------------------------------------------------------
// Happy Path — All Checks Pass
// ---------------------------------------------------------------------------

describe('registerValidate — happy path (all checks pass)', () => {
  it('runs full validation with all checks passing → exitCode 0', async () => {
    setupAllChecksPass();

    // Provide --ir with valid IR + translationResult so semantic/cost run
    mockReadFile.mockImplementation(async (path: string) => {
      if (String(path).endsWith('.tf')) return 'resource "null_resource" "x" {\n}\n';
      return makeIrFileJson({ includeTranslationResult: true });
    });

    const { exitCode, stdout } = await runValidate(['/tmp/translated', '--ir', '/tmp/ir.json']);

    expect(exitCode).toBeUndefined(); // 0 means no exitCode set
    expect(stdout).toContain('PASS');
  });

  it('--format json → valid JSON with overallResult="pass"', async () => {
    setupAllChecksPass();

    const { exitCode, stdout } = await runValidate(['/tmp/translated', '--format', 'json']);

    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.overallResult).toBe('pass');
    expect(parsed.checks).toBeDefined();
    expect(parsed.checks.syntax).toBeDefined();
  });

  it('--format text → human-readable output with check results', async () => {
    setupAllChecksPass();

    const { exitCode, stdout } = await runValidate(['/tmp/translated', '--format', 'text']);

    expect(exitCode).toBeUndefined();
    expect(stdout).toContain('Validation Report');
    expect(stdout).toContain('Overall: PASS');
    expect(stdout).toContain('Syntax:');
    expect(stdout).toContain('Policy:');
    expect(stdout).toContain('Compliance:');
  });
});

// ---------------------------------------------------------------------------
// Strict Mode
// ---------------------------------------------------------------------------

describe('registerValidate — strict mode', () => {
  it('--strict with warnings → exitCode 1 (rollup returns fail)', async () => {
    setupSyntaxPass();
    // Policy returns warnings → result 'warn'
    const policyReport = makePolicyReport();
    policyReport.results = [{ passed: false, severity: 'warning' }];
    mockEvaluatePolicies.mockResolvedValue(policyReport);
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    const { exitCode, stdout } = await runValidate([
      '/tmp/translated', '--strict', '--format', 'json',
    ]);

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    // With strict, warn → fail
    expect(parsed.overallResult).toBe('fail');
  });

  it('--strict with all pass → exitCode 0', async () => {
    setupAllChecksPass();

    const { exitCode, stdout } = await runValidate([
      '/tmp/translated', '--strict', '--format', 'json',
    ]);

    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdout);
    expect(parsed.overallResult).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// Subset Checks (--checks)
// ---------------------------------------------------------------------------

describe('registerValidate — subset checks', () => {
  it('--checks syntax policy → only those 2 checks run', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());

    const { exitCode, stdout } = await runValidate([
      '/tmp/translated', '--checks', 'syntax', 'policy', '--format', 'json',
    ]);

    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdout);
    expect(parsed.checks.syntax).toBeDefined();
    expect(parsed.checks.policy).toBeDefined();
    // These should not have run
    expect(parsed.checks.compliance).toBeUndefined();
    expect(parsed.checks.semanticDiff).toBeUndefined();
    expect(parsed.checks.confidence).toBeUndefined();
    expect(parsed.checks.cost).toBeUndefined();
    // Validator was called but compliance was not
    expect(mockCheckCompliance).not.toHaveBeenCalled();
  });

  it('--checks syntax → only syntax runs', async () => {
    setupSyntaxPass();

    const { exitCode, stdout } = await runValidate([
      '/tmp/translated', '--checks', 'syntax', '--format', 'json',
    ]);

    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdout);
    expect(parsed.checks.syntax).toBeDefined();
    expect(parsed.checks.policy).toBeUndefined();
    expect(mockEvaluatePolicies).not.toHaveBeenCalled();
    expect(mockCheckCompliance).not.toHaveBeenCalled();
    expect(mockCheckEquivalence).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Exit Codes
// ---------------------------------------------------------------------------

describe('registerValidate — exit codes', () => {
  it('overallResult="pass" → exitCode 0 (undefined)', async () => {
    setupAllChecksPass();

    const { exitCode, stdout } = await runValidate(['/tmp/translated', '--format', 'json']);

    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdout);
    expect(parsed.overallResult).toBe('pass');
  });

  it('overallResult="fail" → exitCode 1', async () => {
    setupSyntaxPass();
    // Policy returns failures → result 'fail'
    const policyReport = makePolicyReport();
    policyReport.results = [{ passed: false, severity: 'error' }];
    mockEvaluatePolicies.mockResolvedValue(policyReport);
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    const { exitCode, stdout } = await runValidate(['/tmp/translated', '--format', 'json']);

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.overallResult).toBe('fail');
  });

  it('overallResult="warn" (no strict) → exitCode 0 (undefined)', async () => {
    setupSyntaxPass();
    // Policy returns warnings only → result 'warn'
    const policyReport = makePolicyReport();
    policyReport.results = [{ passed: false, severity: 'warning' }];
    mockEvaluatePolicies.mockResolvedValue(policyReport);
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    const { exitCode, stdout } = await runValidate(['/tmp/translated', '--format', 'json']);

    // 'warn' without --strict → exitCode remains undefined (i.e. 0)
    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdout);
    expect(parsed.overallResult).toBe('warn');
  });
});

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

describe('registerValidate — error handling', () => {
  it('missing translated-dir → exitCode 1, safe error (via Commander)', async () => {
    // Commander should error because <translated_dir> is a required argument
    const { exitCode, stderr } = await runValidate([]);

    // Commander's exitOverride throws, so exitCode may be set
    // The important thing is that we get some form of error signal
    expect(exitCode === 1 || stderr.length > 0).toBe(true);
  });

  it('invalid --target → exitCode 1, safe error', async () => {
    setupSyntaxPass();

    const { exitCode, stderr } = await runValidate([
      '/tmp/translated', '--target', 'aws',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--target must be azure or gcp');
  });

  it('invalid --compliance-profile → exitCode 1, safe error', async () => {
    setupSyntaxPass();

    const { exitCode, stderr } = await runValidate([
      '/tmp/translated', '--compliance-profile', 'soc2',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--compliance-profile must be');
  });

  it('IR file load failure → skip semantic/cost with warning finding', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    // readFile returns valid tf content for syntax pass but throws for IR
    mockReadFile.mockImplementation(async (path: string) => {
      if (String(path).endsWith('.tf')) return 'resource "null_resource" "x" {\n}\n';
      throw new Error('ENOENT: file not found');
    });

    const { exitCode, stdout } = await runValidate([
      '/tmp/translated', '--ir', '/tmp/missing-ir.json', '--format', 'json',
    ]);

    // Should not crash — should still produce output
    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdout);
    expect(parsed.success).toBe(true);
    // Check for IR load warning in findings
    const irWarning = parsed.findings.find(
      (f: { code: string }) => f.code === 'VALIDATE_IR_LOAD',
    );
    expect(irWarning).toBeDefined();
    expect(irWarning.severity).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// Missing IR (semantic / cost gracefully skipped)
// ---------------------------------------------------------------------------

describe('registerValidate — missing IR', () => {
  it('no --ir → semantic/cost skipped gracefully with info findings', async () => {
    setupAllChecksPass();

    const { exitCode, stdout } = await runValidate(['/tmp/translated', '--format', 'json']);

    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdout);
    expect(parsed.success).toBe(true);

    // semantic and cost should be skipped (no translationResult loaded)
    // Look for skip findings
    const semanticSkip = parsed.findings.find(
      (f: { code: string }) => f.code === 'VALIDATE_SEMANTIC_SKIP',
    );
    const costSkip = parsed.findings.find(
      (f: { code: string }) => f.code === 'VALIDATE_COST_SKIP',
    );
    expect(semanticSkip).toBeDefined();
    expect(costSkip).toBeDefined();
    // checkEquivalence should not have been called
    expect(mockCheckEquivalence).not.toHaveBeenCalled();
    expect(mockEstimateCostDelta).not.toHaveBeenCalled();
  });

  it('--ir provided with translationResult → semantic/cost checks run', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockCheckEquivalence.mockReturnValue(makeEquivalenceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());
    mockEstimateCostDelta.mockReturnValue(makeCostDeltaReport());
    mockClassificationToSemanticStatus.mockReturnValue('preserved');

    // readFile: tf files pass syntax, IR file returns valid JSON with translationResult
    mockReadFile.mockImplementation(async (path: string) => {
      if (String(path).endsWith('.tf')) return 'resource "null_resource" "x" {\n}\n';
      return makeIrFileJson({ includeTranslationResult: true });
    });

    const { exitCode, stdout } = await runValidate([
      '/tmp/translated', '--ir', '/tmp/ir.json', '--format', 'json',
    ]);

    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdout);
    expect(parsed.checks.semanticDiff).toBeDefined();
    expect(parsed.checks.cost).toBeDefined();
    expect(mockCheckEquivalence).toHaveBeenCalled();
    expect(mockEstimateCostDelta).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Compliance Profile Selection
// ---------------------------------------------------------------------------

describe('registerValidate — compliance profiles', () => {
  it('--compliance-profile cis-basic → CIS_BASIC used', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    await runValidate([
      '/tmp/translated', '--compliance-profile', 'cis-basic', '--format', 'json',
    ]);

    expect(mockCheckCompliance).toHaveBeenCalledWith(
      expect.anything(), // manifest
      mockCIS_BASIC,
    );
  });

  it('--compliance-profile cis-advanced → CIS_ADVANCED used', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    await runValidate([
      '/tmp/translated', '--compliance-profile', 'cis-advanced', '--format', 'json',
    ]);

    expect(mockCheckCompliance).toHaveBeenCalledWith(
      expect.anything(), // manifest
      mockCIS_ADVANCED,
    );
  });

  it('--compliance-profile none → checkCompliance not called (profile is null)', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    const { exitCode, stdout } = await runValidate([
      '/tmp/translated', '--compliance-profile', 'none', '--format', 'json',
    ]);

    expect(exitCode).toBeUndefined();
    // When profile is 'none', the code returns an empty report without calling checkCompliance
    expect(mockCheckCompliance).not.toHaveBeenCalled();
    const parsed = JSON.parse(stdout);
    expect(parsed.checks.compliance).toBeDefined();
    expect(parsed.checks.compliance.score).toBe(100);
    expect(parsed.checks.compliance.profile).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Syntax Check (pass / fail)
// ---------------------------------------------------------------------------

describe('registerValidate — syntax check', () => {
  it('syntax pass → continues to other checks', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    const { exitCode, stdout } = await runValidate(['/tmp/translated', '--format', 'json']);

    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdout);
    expect(parsed.checks.syntax.result).toBe('pass');
    // Policy should have been called (syntax passed, so pipeline continued)
    expect(mockEvaluatePolicies).toHaveBeenCalled();
  });

  it('syntax fail → early exit with exitCode 1', async () => {
    // readdir throws → runSyntaxCheck catches and returns result 'fail'
    mockReaddir.mockRejectedValue(new Error('ENOENT: no such directory'));

    const { exitCode, stdout } = await runValidate(['/tmp/nonexistent', '--format', 'json']);

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.overallResult).toBe('fail');
    expect(parsed.checks.syntax.result).toBe('fail');
    // Policy should NOT have been called (early exit after syntax fail)
    expect(mockEvaluatePolicies).not.toHaveBeenCalled();
  });

  it('syntax warns on unbalanced braces but continues', async () => {
    mockReaddir.mockResolvedValue(['main.tf']);
    // Unbalanced braces: 2 open, 1 close
    mockReadFile.mockResolvedValue('resource "test" "x" {\n  nested {\n}\n');

    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    const { exitCode, stdout } = await runValidate(['/tmp/translated', '--format', 'json']);

    // Warn, not fail — so pipeline continues
    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdout);
    expect(parsed.checks.syntax.result).toBe('warn');
    expect(parsed.checks.syntax.issues.length).toBeGreaterThan(0);
    expect(parsed.checks.syntax.issues[0]).toContain('unbalanced braces');
    // Pipeline continued
    expect(mockEvaluatePolicies).toHaveBeenCalled();
  });

  it('syntax warns on no .tf files', async () => {
    mockReaddir.mockResolvedValue(['readme.md', 'notes.txt']);

    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    const { exitCode, stdout } = await runValidate(['/tmp/translated', '--format', 'json']);

    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdout);
    expect(parsed.checks.syntax.result).toBe('warn');
    expect(parsed.checks.syntax.filesChecked).toBe(0);
  });

  it('syntax handles file read error gracefully', async () => {
    mockReaddir.mockResolvedValue(['main.tf']);
    mockReadFile.mockRejectedValue(new Error('EACCES: permission denied'));

    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    const { exitCode, stdout } = await runValidate(['/tmp/translated', '--format', 'json']);

    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdout);
    expect(parsed.checks.syntax.result).toBe('warn');
    expect(parsed.checks.syntax.issues[0]).toContain('cannot read file');
  });
});

// ---------------------------------------------------------------------------
// Text Output Format
// ---------------------------------------------------------------------------

describe('registerValidate — text output format', () => {
  it('includes Validation Report header and Overall line', async () => {
    setupAllChecksPass();

    const { stdout } = await runValidate(['/tmp/translated']);

    expect(stdout).toContain('Validation Report');
    expect(stdout).toContain('=================');
    expect(stdout).toContain('Overall: PASS');
  });

  it('includes all check summary lines in text', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    const { stdout } = await runValidate(['/tmp/translated']);

    expect(stdout).toContain('Syntax:');
    expect(stdout).toContain('Policy:');
    expect(stdout).toContain('Compliance:');
    expect(stdout).toContain('Confidence:');
  });

  it('error scenario shows Error: line in text output', async () => {
    // Trigger an unhandled exception in the action handler (after syntax passes)
    // by making evaluatePolicies throw with an ENOENT error
    setupSyntaxPass();
    mockEvaluatePolicies.mockRejectedValue(new Error('ENOENT: no such file'));

    const { exitCode, stderr } = await runValidate([
      '/tmp/translated', '--checks', 'syntax', 'policy',
    ]);

    expect(exitCode).toBe(1);
    // classifyError should produce a safe message for ENOENT
    expect(stderr).toContain('not found');
    // Should NOT echo the raw error message verbatim
    expect(stderr).not.toContain('ENOENT');
  });
});

// ---------------------------------------------------------------------------
// Error Classification
// ---------------------------------------------------------------------------

describe('registerValidate — error classification (safe messages)', () => {
  it('ENOENT errors → safe message about path not found', async () => {
    // Throw inside readdir synchronously to bypass runSyntaxCheck's try/catch
    // and hit the outer catch in the action handler
    setupSyntaxPass();
    mockEvaluatePolicies.mockRejectedValue(new Error('ENOENT: no such file'));

    const { exitCode, stderr } = await runValidate(['/tmp/translated', '--checks', 'syntax', 'policy']);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('not found');
  });

  it('JSON parse errors → safe message about parsing', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockRejectedValue(new Error('JSON parse error'));

    const { exitCode, stderr } = await runValidate(['/tmp/translated', '--checks', 'syntax', 'policy']);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('parse');
  });

  it('permission errors → safe message about permissions', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockRejectedValue(new Error('EACCES: permission denied'));

    const { exitCode, stderr } = await runValidate(['/tmp/translated', '--checks', 'syntax', 'policy']);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Permission denied');
  });

  it('unknown errors → generic safe message', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockRejectedValue(new Error('something unexpected'));

    const { exitCode, stderr } = await runValidate(['/tmp/translated', '--checks', 'syntax', 'policy']);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Validation failed unexpectedly');
  });
});

// ---------------------------------------------------------------------------
// Default option values
// ---------------------------------------------------------------------------

describe('registerValidate — default options', () => {
  it('defaults to --target azure, --format text, --compliance-profile cis-basic', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    const { stdout } = await runValidate(['/tmp/translated']);

    // Default format is text, so output should contain Validation Report header
    expect(stdout).toContain('Validation Report');
    // Default compliance is cis-basic
    expect(mockCheckCompliance).toHaveBeenCalledWith(expect.anything(), mockCIS_BASIC);
  });

  it('runs all 6 check types by default (when all possible)', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockCheckEquivalence.mockReturnValue(makeEquivalenceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());
    mockEstimateCostDelta.mockReturnValue(makeCostDeltaReport());
    mockClassificationToSemanticStatus.mockReturnValue('preserved');

    mockReadFile.mockImplementation(async (path: string) => {
      if (String(path).endsWith('.tf')) return 'resource "null_resource" "x" {\n}\n';
      return makeIrFileJson({ includeTranslationResult: true });
    });

    const { stdout } = await runValidate(['/tmp/translated', '--ir', '/tmp/ir.json', '--format', 'json']);

    const parsed = JSON.parse(stdout);
    expect(parsed.checks.syntax).toBeDefined();
    expect(parsed.checks.policy).toBeDefined();
    expect(parsed.checks.compliance).toBeDefined();
    expect(parsed.checks.semanticDiff).toBeDefined();
    expect(parsed.checks.confidence).toBeDefined();
    expect(parsed.checks.cost).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Policy check result mapping
// ---------------------------------------------------------------------------

describe('registerValidate — policy check results', () => {
  it('policy with failures → policy result "fail"', async () => {
    setupSyntaxPass();
    const report = makePolicyReport();
    report.results = [
      { passed: false, severity: 'error', resourceId: 'r1' },
      { passed: true, severity: 'info' },
    ];
    mockEvaluatePolicies.mockResolvedValue(report);
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    const { stdout } = await runValidate(['/tmp/translated', '--format', 'json']);

    const parsed = JSON.parse(stdout);
    expect(parsed.checks.policy.result).toBe('fail');
    expect(parsed.checks.policy.failed).toBe(1);
  });

  it('policy with warnings only → policy result "warn"', async () => {
    setupSyntaxPass();
    const report = makePolicyReport();
    report.results = [
      { passed: false, severity: 'warning', resourceId: 'r1' },
    ];
    mockEvaluatePolicies.mockResolvedValue(report);
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    const { stdout } = await runValidate(['/tmp/translated', '--format', 'json']);

    const parsed = JSON.parse(stdout);
    expect(parsed.checks.policy.result).toBe('warn');
    expect(parsed.checks.policy.warnings).toBe(1);
    expect(parsed.checks.policy.failed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Compliance check result mapping
// ---------------------------------------------------------------------------

describe('registerValidate — compliance check results', () => {
  it('compliance failed with score < 50 → result "fail"', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport({ score: 30, passed: false }));
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    const { stdout } = await runValidate(['/tmp/translated', '--format', 'json']);

    const parsed = JSON.parse(stdout);
    expect(parsed.checks.compliance.result).toBe('fail');
    expect(parsed.checks.compliance.score).toBe(30);
  });

  it('compliance failed with score >= 50 → result "warn"', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport({ score: 65, passed: false }));
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    const { stdout } = await runValidate(['/tmp/translated', '--format', 'json']);

    const parsed = JSON.parse(stdout);
    expect(parsed.checks.compliance.result).toBe('warn');
    expect(parsed.checks.compliance.score).toBe(65);
  });
});

// ---------------------------------------------------------------------------
// Confidence check escalation
// ---------------------------------------------------------------------------

describe('registerValidate — confidence check', () => {
  it('escalationRequired true → confidence result "warn"', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport({ escalationRequired: true, overall: 0.45, band: 'low' }));

    const { stdout } = await runValidate(['/tmp/translated', '--format', 'json']);

    const parsed = JSON.parse(stdout);
    expect(parsed.checks.confidence.result).toBe('warn');
    expect(parsed.checks.confidence.escalationRequired).toBe(true);
  });

  it('escalationRequired false → confidence result "pass"', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport({ escalationRequired: false }));

    const { stdout } = await runValidate(['/tmp/translated', '--format', 'json']);

    const parsed = JSON.parse(stdout);
    expect(parsed.checks.confidence.result).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// Semantic check result mapping
// ---------------------------------------------------------------------------

describe('registerValidate — semantic check results', () => {
  it('equivalent classification → semantic result "pass"', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockCheckEquivalence.mockReturnValue(makeEquivalenceReport({ classification: 'equivalent', overallScore: 0.95 }));
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());
    mockClassificationToSemanticStatus.mockReturnValue('preserved');

    mockReadFile.mockImplementation(async (path: string) => {
      if (String(path).endsWith('.tf')) return 'resource "null_resource" "x" {\n}\n';
      return makeIrFileJson({ includeTranslationResult: true });
    });

    const { stdout } = await runValidate([
      '/tmp/translated', '--ir', '/tmp/ir.json', '--format', 'json',
    ]);

    const parsed = JSON.parse(stdout);
    expect(parsed.checks.semanticDiff.result).toBe('pass');
    expect(parsed.checks.semanticDiff.overallScore).toBe(0.95);
  });

  it('partial classification → semantic result "warn"', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockCheckEquivalence.mockReturnValue(makeEquivalenceReport({ classification: 'partial', overallScore: 0.6 }));
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());
    mockClassificationToSemanticStatus.mockReturnValue('transformed');

    mockReadFile.mockImplementation(async (path: string) => {
      if (String(path).endsWith('.tf')) return 'resource "null_resource" "x" {\n}\n';
      return makeIrFileJson({ includeTranslationResult: true });
    });

    const { stdout } = await runValidate([
      '/tmp/translated', '--ir', '/tmp/ir.json', '--format', 'json',
    ]);

    const parsed = JSON.parse(stdout);
    expect(parsed.checks.semanticDiff.result).toBe('warn');
  });

  it('degraded/missing classification → semantic result "fail"', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockCheckEquivalence.mockReturnValue(makeEquivalenceReport({ classification: 'degraded', overallScore: 0.2 }));
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());
    mockClassificationToSemanticStatus.mockReturnValue('partial');

    mockReadFile.mockImplementation(async (path: string) => {
      if (String(path).endsWith('.tf')) return 'resource "null_resource" "x" {\n}\n';
      return makeIrFileJson({ includeTranslationResult: true });
    });

    const { stdout } = await runValidate([
      '/tmp/translated', '--ir', '/tmp/ir.json', '--format', 'json',
    ]);

    const parsed = JSON.parse(stdout);
    expect(parsed.checks.semanticDiff.result).toBe('fail');
  });
});

// ---------------------------------------------------------------------------
// Cost check
// ---------------------------------------------------------------------------

describe('registerValidate — cost check', () => {
  it('cost delta is formatted as percentage string', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockCheckEquivalence.mockReturnValue(makeEquivalenceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());
    mockEstimateCostDelta.mockReturnValue(makeCostDeltaReport({ deltaPercent: 15.5, caveats: ['Compute only'] }));
    mockClassificationToSemanticStatus.mockReturnValue('preserved');

    mockReadFile.mockImplementation(async (path: string) => {
      if (String(path).endsWith('.tf')) return 'resource "null_resource" "x" {\n}\n';
      return makeIrFileJson({ includeTranslationResult: true });
    });

    const { stdout } = await runValidate([
      '/tmp/translated', '--ir', '/tmp/ir.json', '--format', 'json',
    ]);

    const parsed = JSON.parse(stdout);
    expect(parsed.checks.cost).toBeDefined();
    expect(parsed.checks.cost.delta).toBe('+15.5%');
    expect(parsed.checks.cost.caveats).toContain('Compute only');
    // Cost is always informational 'warn'
    expect(parsed.checks.cost.result).toBe('warn');
  });

  it('negative cost delta is formatted with minus sign', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockCheckEquivalence.mockReturnValue(makeEquivalenceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());
    mockEstimateCostDelta.mockReturnValue(makeCostDeltaReport({ deltaPercent: -8.3, caveats: [] }));
    mockClassificationToSemanticStatus.mockReturnValue('preserved');

    mockReadFile.mockImplementation(async (path: string) => {
      if (String(path).endsWith('.tf')) return 'resource "null_resource" "x" {\n}\n';
      return makeIrFileJson({ includeTranslationResult: true });
    });

    const { stdout } = await runValidate([
      '/tmp/translated', '--ir', '/tmp/ir.json', '--format', 'json',
    ]);

    const parsed = JSON.parse(stdout);
    expect(parsed.checks.cost.delta).toBe('-8.3%');
  });
});

// ---------------------------------------------------------------------------
// GCP target
// ---------------------------------------------------------------------------

describe('registerValidate — GCP target', () => {
  it('--target gcp validates and runs successfully', async () => {
    setupAllChecksPass();

    const { exitCode, stdout } = await runValidate([
      '/tmp/translated', '--target', 'gcp', '--format', 'json',
    ]);

    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdout);
    expect(parsed.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Invalid --format
// ---------------------------------------------------------------------------

describe('registerValidate — invalid format', () => {
  it('invalid --format → exitCode 1, safe error', async () => {
    setupSyntaxPass();

    const { exitCode, stderr } = await runValidate([
      '/tmp/translated', '--format', 'xml',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--format must be text or json');
  });
});

// ---------------------------------------------------------------------------
// Invalid --checks values
// ---------------------------------------------------------------------------

describe('registerValidate — invalid checks', () => {
  it('invalid check name → exitCode 1, safe error', async () => {
    setupSyntaxPass();

    const { exitCode, stderr } = await runValidate([
      '/tmp/translated', '--checks', 'syntax', 'foobar',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--checks must only include');
  });
});

// ---------------------------------------------------------------------------
// Rollup logic (cost excluded)
// ---------------------------------------------------------------------------

describe('registerValidate — rollup excludes cost from overall result', () => {
  it('cost "warn" does not affect overall "pass" result', async () => {
    setupSyntaxPass();
    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockCheckEquivalence.mockReturnValue(makeEquivalenceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());
    // Cost returns 'warn', but cost is excluded from rollup
    mockEstimateCostDelta.mockReturnValue(makeCostDeltaReport());
    mockClassificationToSemanticStatus.mockReturnValue('preserved');

    mockReadFile.mockImplementation(async (path: string) => {
      if (String(path).endsWith('.tf')) return 'resource "null_resource" "x" {\n}\n';
      return makeIrFileJson({ includeTranslationResult: true });
    });

    const { exitCode, stdout } = await runValidate([
      '/tmp/translated', '--ir', '/tmp/ir.json', '--format', 'json',
    ]);

    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdout);
    // Cost is 'warn' but overall should still be 'pass' since cost is excluded from rollup
    expect(parsed.checks.cost.result).toBe('warn');
    expect(parsed.overallResult).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// Findings aggregation
// ---------------------------------------------------------------------------

describe('registerValidate — findings aggregation', () => {
  it('aggregates findings from policy and compliance reports', async () => {
    setupSyntaxPass();
    const policyReport = makePolicyReport();
    policyReport.findings = [
      { resourceId: 'r1', severity: 'warning', code: 'POL_001', message: 'policy finding' },
    ];
    mockEvaluatePolicies.mockResolvedValue(policyReport);

    const complianceReport = makeComplianceReport();
    complianceReport.findings = [
      { resourceId: 'r2', severity: 'info', code: 'CIS_001', message: 'compliance finding' },
    ];
    mockCheckCompliance.mockReturnValue(complianceReport);
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    const { stdout } = await runValidate(['/tmp/translated', '--format', 'json']);

    const parsed = JSON.parse(stdout);
    expect(parsed.findings.length).toBeGreaterThanOrEqual(2);
    const codes = parsed.findings.map((f: { code: string }) => f.code);
    expect(codes).toContain('POL_001');
    expect(codes).toContain('CIS_001');
  });

  it('text format renders findings with severity and code', async () => {
    setupSyntaxPass();
    const policyReport = makePolicyReport();
    policyReport.findings = [
      { resourceId: 'res-1', severity: 'warning', code: 'POL_X', message: 'test finding msg' },
    ];
    mockEvaluatePolicies.mockResolvedValue(policyReport);
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    const { stdout } = await runValidate(['/tmp/translated', '--format', 'text']);

    expect(stdout).toContain('Findings');
    expect(stdout).toContain('WARNING');
    expect(stdout).toContain('POL_X');
    expect(stdout).toContain('test finding msg');
  });
});

// ---------------------------------------------------------------------------
// NUL byte detection in syntax check
// ---------------------------------------------------------------------------

describe('registerValidate — syntax NUL byte detection', () => {
  it('files with NUL bytes get syntax warning', async () => {
    mockReaddir.mockResolvedValue(['main.tf']);
    mockReadFile.mockResolvedValue('resource "test" "x" {\n}\n\x00trailing');

    mockEvaluatePolicies.mockResolvedValue(makePolicyReport());
    mockCheckCompliance.mockReturnValue(makeComplianceReport());
    mockScoreConfidence.mockReturnValue(makeConfidenceReport());

    const { stdout } = await runValidate(['/tmp/translated', '--format', 'json']);

    const parsed = JSON.parse(stdout);
    expect(parsed.checks.syntax.result).toBe('warn');
    expect(parsed.checks.syntax.issues.some((i: string) => i.includes('NUL bytes'))).toBe(true);
  });
});
