/**
 * Tests for the `validate` MCP tool handler.
 *
 * Covers:
 *  - Full validation (all checks, with and without IR file)
 *  - Syntax check: pass, warn (no .tf files), fail (unreadable dir)
 *  - Policy check: runs and produces result
 *  - Compliance check: cis-basic, cis-advanced, none profile
 *  - Semantic diff: skipped when no irFile, runs when irFile provided
 *  - Confidence: aggregates policy + compliance results
 *  - Cost: skipped when no irFile
 *  - Strict mode: warnings escalate to fail
 *  - Graceful degradation: IR file load error
 *  - MCP tool wiring via registerTools
 *
 * @tla/validator functions and node:fs/promises are mocked so tests run
 * without touching the file system or running real checks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — all mock functions declared before vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockReaddir,
  mockReadFile,
  mockEvaluatePolicies,
  mockCheckCompliance,
  mockCheckEquivalence,
  mockScoreConfidence,
  mockEstimateCostDelta,
} = vi.hoisted(() => ({
  mockReaddir: vi.fn(),
  mockReadFile: vi.fn(),
  mockEvaluatePolicies: vi.fn(),
  mockCheckCompliance: vi.fn(),
  mockCheckEquivalence: vi.fn(),
  mockScoreConfidence: vi.fn(),
  mockEstimateCostDelta: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

vi.mock('@tla/validator', () => ({
  evaluatePolicies: (...args: unknown[]) => mockEvaluatePolicies(...args),
  checkCompliance: (...args: unknown[]) => mockCheckCompliance(...args),
  checkEquivalence: (...args: unknown[]) => mockCheckEquivalence(...args),
  scoreConfidence: (...args: unknown[]) => mockScoreConfidence(...args),
  estimateCostDelta: (...args: unknown[]) => mockEstimateCostDelta(...args),
  classificationToSemanticStatus: (c: string) => {
    const map: Record<string, string> = {
      equivalent: 'preserved',
      partial: 'transformed',
      degraded: 'partial',
      missing: 'missing',
    };
    return map[c] ?? 'preserved';
  },
  CIS_BASIC: { name: 'cis-basic', description: 'CIS Basic', rules: [] },
  CIS_ADVANCED: { name: 'cis-advanced', description: 'CIS Advanced', rules: [] },
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import { handleValidate } from '../../src/tools/validate.js';
import type { ValidateArgs } from '../../src/tools/validate.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const FAKE_DIR = '/fake/translated';
const FAKE_IR_PATH = '/fake/ir.json';

/** Minimal passing policy report */
const fakePolicyReport = {
  passed: true,
  results: [],
  findings: [],
  summary: { total: 0, passed: 0, failed: 0, errors: 0 },
};

/** Minimal passing compliance report */
const fakeComplianceReport = {
  score: 95,
  passed: true,
  results: [],
  findings: [],
  summary: { total: 0, applicable: 0, passed: 0, failed: 0 },
};

/** Minimal equivalence report — all equivalent */
const fakeEquivReport = {
  overallScore: 0.95,
  classification: 'equivalent',
  records: [],
  summary: { total: 5, equivalent: 5, partial: 0, degraded: 0, missing: 0 },
};

/** Confidence report with no escalation */
const fakeConfidenceReport = {
  overall: 0.85,
  overallBand: 'high',
  byResource: new Map(),
  byFamily: new Map(),
  escalationRequired: false,
  reviewRequired: [],
  factors: {
    avgRegistryConfidence: 0.9,
    avgValidationFactor: 1.0,
    avgSemanticFactor: 1.0,
    avgPolicyFactor: 1.0,
  },
};

/** Minimal cost report */
const fakeCostReport = {
  sourceEstimate: { totalMonthlyUsd: 100, lineItems: [] },
  targetEstimate: { totalMonthlyUsd: 112, lineItems: [] },
  delta: 12,
  deltaPercent: 12,
  perResource: [],
  caveats: ['Based on on-demand/pay-as-you-go pricing'],
  reviewRequired: true as const,
};

/** Minimal IR JSON (as stored in irFile) */
const fakeIrFileContent = JSON.stringify({
  ir: {
    version: '1.0.0',
    sourceProvider: 'aws',
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceFiles: [],
      toolVersion: '0.1.0',
      resourceCount: 0,
      relationshipCount: 0,
    },
    resources: [],
    relationships: [],
    modules: [],
    intents: [],
  },
  translationResult: {
    target: 'azure',
    resources: [],
    files: {},
    manifest: {
      version: '1.0.0',
      registryVersion: '2026.03.13',
      target: 'azure',
      counts: { total: 0, translated: 0, expanded: 0, partial: 0, blocked: 0, advisory: 0 },
      entries: [],
      findings: [],
      confidenceOverall: 0.9,
    },
    findings: [],
    stats: {
      totalResources: 0,
      translated: 0,
      expanded: 0,
      partial: 0,
      blocked: 0,
      advisory: 0,
      durationMs: 10,
    },
  },
});

/** Default well-formed args */
const defaultArgs: ValidateArgs = {
  translated_dir: FAKE_DIR,
  provider: 'azure',
};

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default: directory has two .tf files with balanced braces
  mockReaddir.mockResolvedValue(['main.tf', 'variables.tf']);
  mockReadFile.mockImplementation(async (path: string) => {
    if (path === FAKE_IR_PATH) return fakeIrFileContent;
    return 'resource "azurerm_resource_group" "rg" {}\n';
  });

  mockEvaluatePolicies.mockResolvedValue(fakePolicyReport);
  mockCheckCompliance.mockReturnValue(fakeComplianceReport);
  mockCheckEquivalence.mockReturnValue(fakeEquivReport);
  mockScoreConfidence.mockReturnValue(fakeConfidenceReport);
  mockEstimateCostDelta.mockReturnValue(fakeCostReport);
});

// ---------------------------------------------------------------------------
// Syntax check
// ---------------------------------------------------------------------------

describe('handleValidate — syntax check', () => {
  it('passes when all .tf files have balanced braces', async () => {
    const result = await handleValidate({ ...defaultArgs, checks: ['syntax'] });

    expect(result.success).toBe(true);
    expect(result.checks?.syntax?.result).toBe('pass');
    expect(result.checks?.syntax?.filesChecked).toBe(2);
    expect(result.checks?.syntax?.issues).toHaveLength(0);
  });

  it('warns when no .tf files are found', async () => {
    mockReaddir.mockResolvedValue([]);
    const result = await handleValidate({ ...defaultArgs, checks: ['syntax'] });

    expect(result.success).toBe(true);
    expect(result.checks?.syntax?.result).toBe('warn');
    expect(result.checks?.syntax?.filesChecked).toBe(0);
    expect(result.checks?.syntax?.issues[0]).toMatch(/No .tf files/);
  });

  it('warns when a file has unbalanced braces', async () => {
    mockReadFile.mockResolvedValue('resource "foo" "bar" {\n  # missing close brace\n');
    const result = await handleValidate({ ...defaultArgs, checks: ['syntax'] });

    expect(result.success).toBe(true);
    expect(result.checks?.syntax?.result).toBe('warn');
    expect(result.checks?.syntax?.issues.some((i) => i.includes('unbalanced braces'))).toBe(true);
  });

  it('fails when translated_dir cannot be read', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT: no such file or directory'));
    const result = await handleValidate({ ...defaultArgs, checks: ['syntax'] });

    expect(result.success).toBe(true);
    expect(result.checks?.syntax?.result).toBe('fail');
    expect(result.overallResult).toBe('fail');
  });

  it('returns early on syntax fail without running other checks', async () => {
    mockReaddir.mockRejectedValue(new Error('EACCES: permission denied'));
    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax', 'policy', 'compliance'],
    });

    expect(result.success).toBe(true);
    expect(result.overallResult).toBe('fail');
    expect(result.checks?.policy).toBeUndefined();
    expect(result.checks?.compliance).toBeUndefined();
    expect(mockEvaluatePolicies).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Policy check
// ---------------------------------------------------------------------------

describe('handleValidate — policy check', () => {
  it('passes when all policies pass', async () => {
    const result = await handleValidate({ ...defaultArgs, checks: ['syntax', 'policy'] });

    expect(result.success).toBe(true);
    expect(result.checks?.policy?.result).toBe('pass');
    expect(result.checks?.policy?.passed).toBe(0);
    expect(result.checks?.policy?.failed).toBe(0);
  });

  it('reports warn when policy has failures', async () => {
    mockEvaluatePolicies.mockResolvedValue({
      passed: false,
      results: [
        {
          policyId: 'POL-001',
          resourceId: 'aws_instance.web',
          passed: false,
          severity: 'warning',
          code: 'POL_OPEN_EGRESS',
          message: 'Open egress rule detected',
        },
      ],
      findings: [
        {
          resourceId: 'aws_instance.web',
          severity: 'warning',
          code: 'POL_OPEN_EGRESS',
          message: 'Open egress rule detected',
        },
      ],
      summary: { total: 1, passed: 0, failed: 0, errors: 0 },
    });

    const result = await handleValidate({ ...defaultArgs, checks: ['syntax', 'policy'] });

    expect(result.checks?.policy?.result).toBe('warn');
    expect(result.checks?.policy?.warnings).toBe(1);
    expect(result.findings?.some((f) => f.code === 'POL_OPEN_EGRESS')).toBe(true);
  });

  it('reports fail when policy has blocker failures', async () => {
    mockEvaluatePolicies.mockResolvedValue({
      passed: false,
      results: [
        {
          policyId: 'POL-002',
          resourceId: 'aws_security_group.sg',
          passed: false,
          severity: 'blocker',
          code: 'POL_OPEN_INGRESS',
          message: 'Unrestricted 0.0.0.0/0 ingress',
        },
      ],
      findings: [],
      summary: { total: 1, passed: 0, failed: 1, errors: 0 },
    });

    const result = await handleValidate({ ...defaultArgs, checks: ['syntax', 'policy'] });

    expect(result.checks?.policy?.result).toBe('fail');
    expect(result.checks?.policy?.failed).toBe(1);
  });

  it('is skipped when not in checks list', async () => {
    const result = await handleValidate({ ...defaultArgs, checks: ['syntax', 'compliance'] });

    expect(result.checks?.policy).toBeUndefined();
    expect(mockEvaluatePolicies).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Compliance check
// ---------------------------------------------------------------------------

describe('handleValidate — compliance check', () => {
  it('passes with cis-basic profile', async () => {
    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax', 'compliance'],
      complianceProfile: 'cis-basic',
    });

    expect(result.success).toBe(true);
    expect(result.checks?.compliance?.result).toBe('pass');
    expect(result.checks?.compliance?.profile).toBe('cis-basic');
  });

  it('passes with cis-advanced profile', async () => {
    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax', 'compliance'],
      complianceProfile: 'cis-advanced',
    });

    expect(result.checks?.compliance?.profile).toBe('cis-advanced');
    expect(mockCheckCompliance).toHaveBeenCalled();
  });

  it('skips with "none" profile and returns 100 score', async () => {
    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax', 'compliance'],
      complianceProfile: 'none',
    });

    expect(result.checks?.compliance?.result).toBe('pass');
    expect(result.checks?.compliance?.score).toBe(100);
    expect(result.checks?.compliance?.profile).toBe('none');
    expect(mockCheckCompliance).not.toHaveBeenCalled();
  });

  it('warns when compliance score is moderate', async () => {
    mockCheckCompliance.mockReturnValue({
      score: 75,
      passed: false,
      results: [],
      findings: [],
      summary: { total: 4, applicable: 4, passed: 3, failed: 1 },
    });

    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax', 'compliance'],
    });

    expect(result.checks?.compliance?.result).toBe('warn');
  });

  it('fails when compliance score is below 50', async () => {
    mockCheckCompliance.mockReturnValue({
      score: 40,
      passed: false,
      results: [],
      findings: [],
      summary: { total: 5, applicable: 5, passed: 2, failed: 3 },
    });

    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax', 'compliance'],
    });

    expect(result.checks?.compliance?.result).toBe('fail');
  });
});

// ---------------------------------------------------------------------------
// Semantic diff
// ---------------------------------------------------------------------------

describe('handleValidate — semantic diff', () => {
  it('is skipped when no irFile is provided', async () => {
    const result = await handleValidate({ ...defaultArgs, checks: ['syntax', 'semantic'] });

    expect(result.checks?.semanticDiff).toBeUndefined();
    expect(result.findings?.some((f) => f.code === 'VALIDATE_SEMANTIC_SKIP')).toBe(true);
    expect(mockCheckEquivalence).not.toHaveBeenCalled();
  });

  it('runs when irFile is provided', async () => {
    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax', 'semantic'],
      irFile: FAKE_IR_PATH,
    });

    expect(mockCheckEquivalence).toHaveBeenCalled();
    expect(result.checks?.semanticDiff).toBeDefined();
    expect(result.checks?.semanticDiff?.preserved).toBe(5);
    expect(result.checks?.semanticDiff?.missing).toBe(0);
  });

  it('reports pass when all resources are equivalent', async () => {
    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax', 'semantic'],
      irFile: FAKE_IR_PATH,
    });

    expect(result.checks?.semanticDiff?.result).toBe('pass');
  });

  it('reports warn when classification is partial', async () => {
    mockCheckEquivalence.mockReturnValue({
      overallScore: 0.7,
      classification: 'partial',
      records: [],
      summary: { total: 5, equivalent: 3, partial: 2, degraded: 0, missing: 0 },
    });

    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax', 'semantic'],
      irFile: FAKE_IR_PATH,
    });

    expect(result.checks?.semanticDiff?.result).toBe('warn');
  });

  it('reports fail when classification is degraded or missing', async () => {
    mockCheckEquivalence.mockReturnValue({
      overallScore: 0.2,
      classification: 'degraded',
      records: [],
      summary: { total: 5, equivalent: 1, partial: 0, degraded: 4, missing: 0 },
    });

    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax', 'semantic'],
      irFile: FAKE_IR_PATH,
    });

    expect(result.checks?.semanticDiff?.result).toBe('fail');
  });

  it('gracefully handles invalid IR file', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === FAKE_IR_PATH) throw new Error('ENOENT: no such file or directory');
      return 'resource "foo" "bar" {}\n';
    });

    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax', 'semantic'],
      irFile: FAKE_IR_PATH,
    });

    expect(result.success).toBe(true);
    expect(result.checks?.semanticDiff).toBeUndefined();
    expect(result.findings?.some((f) => f.code === 'VALIDATE_IR_LOAD')).toBe(true);
    expect(result.findings?.some((f) => f.severity === 'warning')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Confidence check
// ---------------------------------------------------------------------------

describe('handleValidate — confidence check', () => {
  it('runs scoreConfidence with policy and compliance reports', async () => {
    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax', 'policy', 'compliance', 'confidence'],
    });

    expect(mockScoreConfidence).toHaveBeenCalled();
    expect(result.checks?.confidence).toBeDefined();
    expect(result.checks?.confidence?.overall).toBe(0.85);
    expect(result.checks?.confidence?.band).toBe('high');
    expect(result.checks?.confidence?.escalationRequired).toBe(false);
    expect(result.checks?.confidence?.result).toBe('pass');
  });

  it('returns warn when escalation is required', async () => {
    mockScoreConfidence.mockReturnValue({
      ...fakeConfidenceReport,
      overall: 0.5,
      overallBand: 'low',
      escalationRequired: true,
      reviewRequired: ['aws_instance.web'],
    });

    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax', 'confidence'],
    });

    expect(result.checks?.confidence?.result).toBe('warn');
    expect(result.checks?.confidence?.escalationRequired).toBe(true);
  });

  it('is skipped when not in checks list', async () => {
    const result = await handleValidate({ ...defaultArgs, checks: ['syntax', 'policy'] });

    expect(result.checks?.confidence).toBeUndefined();
    expect(mockScoreConfidence).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cost check
// ---------------------------------------------------------------------------

describe('handleValidate — cost check', () => {
  it('is skipped when no irFile is provided', async () => {
    const result = await handleValidate({ ...defaultArgs, checks: ['syntax', 'cost'] });

    expect(result.checks?.cost).toBeUndefined();
    expect(result.findings?.some((f) => f.code === 'VALIDATE_COST_SKIP')).toBe(true);
    expect(mockEstimateCostDelta).not.toHaveBeenCalled();
  });

  it('runs when irFile is provided and always returns warn', async () => {
    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax', 'cost'],
      irFile: FAKE_IR_PATH,
    });

    expect(mockEstimateCostDelta).toHaveBeenCalled();
    expect(result.checks?.cost?.result).toBe('warn'); // always informational
    expect(result.checks?.cost?.delta).toBe('+12.0%');
    expect(result.checks?.cost?.caveats).toHaveLength(1);
  });

  it('reports negative delta correctly', async () => {
    mockEstimateCostDelta.mockReturnValue({ ...fakeCostReport, deltaPercent: -5.5 });

    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax', 'cost'],
      irFile: FAKE_IR_PATH,
    });

    expect(result.checks?.cost?.delta).toBe('-5.5%');
    expect(result.checks?.cost?.deltaPercent).toBe(-5.5);
  });
});

// ---------------------------------------------------------------------------
// Overall result roll-up
// ---------------------------------------------------------------------------

describe('handleValidate — overall result roll-up', () => {
  it('returns pass when all checks pass', async () => {
    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax', 'policy', 'compliance'],
    });

    expect(result.overallResult).toBe('pass');
  });

  it('returns warn when a check warns but strict is false', async () => {
    mockReaddir.mockResolvedValue(['main.tf']);
    mockReadFile.mockResolvedValue('resource "foo" "bar" {\n'); // unbalanced

    const result = await handleValidate({ ...defaultArgs, checks: ['syntax'] });

    expect(result.overallResult).toBe('warn');
  });

  it('returns fail in strict mode when any check warns', async () => {
    mockReaddir.mockResolvedValue(['main.tf']);
    mockReadFile.mockResolvedValue('resource "foo" "bar" {\n'); // unbalanced → syntax warn

    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax'],
      strict: true,
    });

    expect(result.overallResult).toBe('fail');
  });

  it('returns fail when any check fails regardless of strict', async () => {
    mockEvaluatePolicies.mockResolvedValue({
      passed: false,
      results: [
        {
          policyId: 'POL-002',
          resourceId: 'r.id',
          passed: false,
          severity: 'blocker',
          code: 'POL_FAIL',
          message: 'failed',
        },
      ],
      findings: [],
      summary: { total: 1, passed: 0, failed: 1, errors: 0 },
    });

    const result = await handleValidate({ ...defaultArgs, checks: ['syntax', 'policy'] });

    expect(result.overallResult).toBe('fail');
  });

  it('excludes cost from overall roll-up (cost is always warn)', async () => {
    // Cost is warn but should not influence overallResult
    const result = await handleValidate({
      ...defaultArgs,
      checks: ['syntax', 'cost'],
      irFile: FAKE_IR_PATH,
      strict: true,
    });

    // cost runs and is 'warn', but strict should not make overall fail due to cost
    expect(result.checks?.cost?.result).toBe('warn');
    // overall should be 'pass' since syntax passed and cost is excluded from rollup
    expect(result.overallResult).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe('handleValidate — defaults', () => {
  it('runs all 6 checks by default', async () => {
    const result = await handleValidate(defaultArgs);

    expect(result.checks?.syntax).toBeDefined();
    expect(result.checks?.policy).toBeDefined();
    expect(result.checks?.compliance).toBeDefined();
    // semantic and cost are skipped without irFile — but they are attempted
    expect(result.findings?.some((f) => f.code === 'VALIDATE_SEMANTIC_SKIP')).toBe(true);
    expect(result.findings?.some((f) => f.code === 'VALIDATE_COST_SKIP')).toBe(true);
    expect(result.checks?.confidence).toBeDefined();
  });

  it('uses cis-basic compliance profile by default', async () => {
    await handleValidate({ ...defaultArgs, checks: ['compliance'] });

    // CIS_BASIC is the { name: 'cis-basic', ... } mock — checkCompliance is called with it
    expect(mockCheckCompliance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'cis-basic' }),
    );
  });

  it('includes totalDuration in result', async () => {
    const result = await handleValidate({ ...defaultArgs, checks: ['syntax'] });

    expect(typeof result.totalDuration).toBe('number');
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// MCP tool wiring (registerTools integration)
// ---------------------------------------------------------------------------

describe('validate tool wiring via registerTools', () => {
  it('wires up the validate tool and calls handleValidate', async () => {
    const { registerTools } = await import('../../src/tools/index.js');
    const { buildFakeRegistryManager, defaultConfig } = await import('../helpers.js');

    const registry = await buildFakeRegistryManager([]);

    // Build a minimal MCP server mock
    const toolHandlers = new Map<string, (args: unknown) => Promise<unknown>>();
    const mockServer = {
      tool: (name: string, _desc: string, _schema: unknown, handler: (args: unknown) => Promise<unknown>) => {
        toolHandlers.set(name, handler);
      },
    };

    registerTools(mockServer as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer, registry, defaultConfig);

    expect(toolHandlers.has('validate')).toBe(true);

    const handler = toolHandlers.get('validate')!;
    const response = await handler({
      translated_dir: FAKE_DIR,
      provider: 'azure',
      strict: false,
      checks: ['syntax'],
    });

    expect(response).toHaveProperty('content');
    const content = (response as { content: Array<{ type: string; text: string }> }).content;
    expect(content[0].type).toBe('text');

    const body = JSON.parse(content[0].text) as { success: boolean };
    expect(body.success).toBe(true);
  });
});
