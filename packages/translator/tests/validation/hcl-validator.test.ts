/**
 * Tests for the validation module: terraform-runner, finding-mapper, hcl-validator.
 *
 * @module tests/validation/hcl-validator
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE imports of modules under test
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  mkdtempSync: vi.fn(() => '/tmp/tla-hcl-XXXXXX'),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  tmpdir: vi.fn(() => '/tmp'),
}));

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path');
  return { ...actual };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';

import { runTerraformValidate } from '../../src/validation/terraform-runner.js';
import {
  mapTerraformDiagnostics,
  HCL_VALIDATION_RESOURCE_ID,
} from '../../src/validation/finding-mapper.js';
import { validateHcl } from '../../src/validation/hcl-validator.js';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeFiles(count = 1): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    files[`file${i}.tf`] = `resource "null_resource" "r${i}" {}`;
  }
  return files;
}

function makeDiagnostic(
  overrides: {
    severity?: string;
    summary?: string;
    detail?: string;
  } = {},
) {
  return {
    severity: overrides.severity ?? 'error',
    summary: overrides.summary ?? 'Something went wrong',
    detail: overrides.detail,
  };
}

function makeValidOutput(
  diagnostics: ReturnType<typeof makeDiagnostic>[] = [],
  valid = diagnostics.length === 0,
) {
  return JSON.stringify({
    valid,
    error_count: diagnostics.filter((d) => d.severity === 'error').length,
    warning_count: diagnostics.filter((d) => d.severity === 'warning').length,
    diagnostics,
  });
}

function makeExecError(
  overrides: {
    message?: string;
    status?: number | null;
    stdout?: string;
    stderr?: string;
    code?: string;
    killed?: boolean;
  } = {},
) {
  const err = new Error(overrides.message ?? 'command failed');
  return Object.assign(err, {
    status: overrides.status ?? 1,
    stdout: overrides.stdout ?? '',
    stderr: overrides.stderr ?? '',
    code: overrides.code,
    killed: overrides.killed ?? false,
  });
}

// ===========================================================================
// terraform-runner
// ===========================================================================

describe('terraform-runner :: runTerraformValidate', () => {
  const mockExec = execFileSync as unknown as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok:true with stdout on success', () => {
    const json = makeValidOutput();
    // init succeeds (returns undefined/empty), validate returns JSON
    mockExec.mockReturnValueOnce('').mockReturnValueOnce(json);

    const result = runTerraformValidate('/work');

    expect(result).toEqual({ ok: true, stdout: json });
  });

  it('returns ok:true when non-zero exit but stdout has JSON', () => {
    const json = makeValidOutput([makeDiagnostic()]);
    // init succeeds, validate throws with stdout
    mockExec
      .mockReturnValueOnce('')
      .mockImplementationOnce(() => {
        throw makeExecError({ status: 1, stdout: json });
      });

    const result = runTerraformValidate('/work');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stdout).toBe(json);
    }
  });

  it('returns ok:false HCL_VALIDATION_SKIPPED on ENOENT', () => {
    mockExec.mockImplementationOnce(() => {
      throw makeExecError({ code: 'ENOENT' });
    });

    const result = runTerraformValidate('/work');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('HCL_VALIDATION_SKIPPED');
      expect(result.message).toContain('not found');
    }
  });

  it('returns ok:false HCL_VALIDATION_TIMEOUT when killed', () => {
    mockExec.mockImplementationOnce(() => {
      throw makeExecError({ killed: true });
    });

    const result = runTerraformValidate('/work');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('HCL_VALIDATION_TIMEOUT');
      expect(result.message).toContain('timed out');
    }
  });

  it('returns ok:false HCL_VALIDATION_ERROR on other errors', () => {
    mockExec.mockImplementationOnce(() => {
      throw makeExecError({ message: 'segfault' });
    });

    const result = runTerraformValidate('/work');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('HCL_VALIDATION_ERROR');
      expect(result.message).toContain('segfault');
    }
  });

  it('uses custom terraformBin when provided', () => {
    mockExec.mockReturnValueOnce('').mockReturnValueOnce(makeValidOutput());

    runTerraformValidate('/work', { terraformBin: '/usr/local/bin/tofu' });

    expect(mockExec).toHaveBeenCalledWith(
      '/usr/local/bin/tofu',
      expect.arrayContaining(['init']),
      expect.any(Object),
    );
    expect(mockExec).toHaveBeenCalledWith(
      '/usr/local/bin/tofu',
      expect.arrayContaining(['validate']),
      expect.any(Object),
    );
  });

  it('uses custom timeoutMs when provided', () => {
    mockExec.mockReturnValueOnce('').mockReturnValueOnce(makeValidOutput());

    runTerraformValidate('/work', { timeoutMs: 5_000 });

    expect(mockExec).toHaveBeenCalledWith(
      'terraform',
      expect.any(Array),
      expect.objectContaining({ timeout: 5_000 }),
    );
  });

  it('passes -backend=false to init', () => {
    mockExec.mockReturnValueOnce('').mockReturnValueOnce(makeValidOutput());

    runTerraformValidate('/work');

    const initCall = mockExec.mock.calls[0];
    expect(initCall[1]).toContain('-backend=false');
  });

  it('passes -json to validate', () => {
    mockExec.mockReturnValueOnce('').mockReturnValueOnce(makeValidOutput());

    runTerraformValidate('/work');

    const validateCall = mockExec.mock.calls[1];
    expect(validateCall[1]).toContain('-json');
  });

  it('sets cwd correctly', () => {
    mockExec.mockReturnValueOnce('').mockReturnValueOnce(makeValidOutput());

    runTerraformValidate('/my/project');

    for (const call of mockExec.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ cwd: '/my/project' }));
    }
  });
});

// ===========================================================================
// finding-mapper
// ===========================================================================

describe('finding-mapper :: mapTerraformDiagnostics', () => {
  it('returns empty array for empty diagnostics', () => {
    const stdout = makeValidOutput([]);
    const findings = mapTerraformDiagnostics(stdout);
    expect(findings).toEqual([]);
  });

  it('maps error diagnostic to blocker finding', () => {
    const stdout = makeValidOutput([
      makeDiagnostic({ severity: 'error', summary: 'Missing resource' }),
    ]);

    const findings = mapTerraformDiagnostics(stdout);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('blocker');
    expect(findings[0].code).toBe('HCL_VALIDATE_DIAGNOSTIC');
    expect(findings[0].message).toBe('Missing resource');
    expect(findings[0].resourceId).toBe(HCL_VALIDATION_RESOURCE_ID);
  });

  it('maps warning diagnostic to warning finding', () => {
    const stdout = makeValidOutput([
      makeDiagnostic({ severity: 'warning', summary: 'Deprecated attribute' }),
    ]);

    const findings = mapTerraformDiagnostics(stdout);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toBe('Deprecated attribute');
  });

  it('maps unknown severity to info finding', () => {
    const stdout = makeValidOutput([
      makeDiagnostic({ severity: 'notice', summary: 'FYI' }),
    ]);

    const findings = mapTerraformDiagnostics(stdout);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
  });

  it('handles multiple mixed diagnostics', () => {
    const stdout = makeValidOutput([
      makeDiagnostic({ severity: 'error', summary: 'Error one' }),
      makeDiagnostic({ severity: 'warning', summary: 'Warn one' }),
      makeDiagnostic({ severity: 'error', summary: 'Error two' }),
    ]);

    const findings = mapTerraformDiagnostics(stdout);

    expect(findings).toHaveLength(3);
    expect(findings[0].severity).toBe('blocker');
    expect(findings[1].severity).toBe('warning');
    expect(findings[2].severity).toBe('blocker');
  });

  it('passes detail field through when present', () => {
    const stdout = makeValidOutput([
      makeDiagnostic({
        severity: 'error',
        summary: 'Bad config',
        detail: 'Expected string, got number',
      }),
    ]);

    const findings = mapTerraformDiagnostics(stdout);

    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toBe('Expected string, got number');
  });

  it('omits detail when absent in diagnostic', () => {
    const stdout = makeValidOutput([
      makeDiagnostic({ severity: 'warning', summary: 'No detail here' }),
    ]);

    const findings = mapTerraformDiagnostics(stdout);

    expect(findings).toHaveLength(1);
    expect(findings[0]).not.toHaveProperty('detail');
  });

  it('returns PARSE_ERROR finding for malformed JSON', () => {
    const findings = mapTerraformDiagnostics('this is not json {{{');

    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('HCL_VALIDATE_PARSE_ERROR');
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].resourceId).toBe(HCL_VALIDATION_RESOURCE_ID);
  });

  it('truncates stdout to 500 chars in PARSE_ERROR detail', () => {
    const longStr = 'x'.repeat(1000);
    const findings = mapTerraformDiagnostics(longStr);

    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toHaveLength(500);
  });

  it('returns empty array when diagnostics field is missing', () => {
    const stdout = JSON.stringify({ valid: true, error_count: 0, warning_count: 0 });
    const findings = mapTerraformDiagnostics(stdout);
    expect(findings).toEqual([]);
  });
});

// ===========================================================================
// hcl-validator
// ===========================================================================

describe('hcl-validator :: validateHcl', () => {
  const mockExec = execFileSync as unknown as Mock;
  const mockMkdtemp = mkdtempSync as unknown as Mock;
  const mockWriteFile = writeFileSync as unknown as Mock;
  const mockRm = rmSync as unknown as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdtemp.mockReturnValue('/tmp/tla-hcl-XXXXXX');
  });

  it('returns info SKIPPED finding for empty files', () => {
    const result = validateHcl({});

    expect(result.valid).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].code).toBe('HCL_VALIDATION_SKIPPED');
    expect(result.findings[0].severity).toBe('info');
    // Should NOT invoke terraform or fs
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockMkdtemp).not.toHaveBeenCalled();
  });

  it('creates temp dir, writes files, cleans up on success', () => {
    const json = makeValidOutput();
    mockExec.mockReturnValueOnce('').mockReturnValueOnce(json);

    const files = { 'main.tf': 'resource "a" "b" {}', 'vars.tf': 'variable "x" {}' };
    validateHcl(files);

    // temp dir created
    expect(mockMkdtemp).toHaveBeenCalledTimes(1);
    // both files written
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('main.tf'),
      'resource "a" "b" {}',
      'utf-8',
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('vars.tf'),
      'variable "x" {}',
      'utf-8',
    );
    // cleaned up
    expect(mockRm).toHaveBeenCalledWith('/tmp/tla-hcl-XXXXXX', {
      recursive: true,
      force: true,
    });
  });

  it('returns findings from mapper on success', () => {
    const diags = [
      makeDiagnostic({ severity: 'warning', summary: 'Deprecated' }),
    ];
    const json = makeValidOutput(diags);
    mockExec.mockReturnValueOnce('').mockReturnValueOnce(json);

    const result = validateHcl(makeFiles());

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('warning');
    expect(result.findings[0].message).toBe('Deprecated');
  });

  it('sets valid:false when blocker finding exists', () => {
    const diags = [makeDiagnostic({ severity: 'error', summary: 'Bad' })];
    const json = makeValidOutput(diags, false);
    mockExec.mockReturnValueOnce('').mockReturnValueOnce(json);

    const result = validateHcl(makeFiles());

    expect(result.valid).toBe(false);
    expect(result.findings[0].severity).toBe('blocker');
  });

  it('sets valid:true when only warnings present', () => {
    const diags = [makeDiagnostic({ severity: 'warning', summary: 'Warn' })];
    const json = makeValidOutput(diags);
    mockExec.mockReturnValueOnce('').mockReturnValueOnce(json);

    const result = validateHcl(makeFiles());

    expect(result.valid).toBe(true);
  });

  it('returns single finding on SKIPPED (ENOENT)', () => {
    mockExec.mockImplementationOnce(() => {
      throw makeExecError({ code: 'ENOENT' });
    });

    const result = validateHcl(makeFiles());

    expect(result.valid).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].code).toBe('HCL_VALIDATION_SKIPPED');
    expect(result.findings[0].severity).toBe('info');
  });

  it('returns single finding on TIMEOUT', () => {
    mockExec.mockImplementationOnce(() => {
      throw makeExecError({ killed: true });
    });

    const result = validateHcl(makeFiles());

    expect(result.valid).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].code).toBe('HCL_VALIDATION_TIMEOUT');
    expect(result.findings[0].severity).toBe('warning');
  });

  it('cleans up temp dir even on error', () => {
    // mkdtemp succeeds, but writeFileSync throws
    mockWriteFile.mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    const result = validateHcl(makeFiles());

    // Should still clean up
    expect(mockRm).toHaveBeenCalledWith('/tmp/tla-hcl-XXXXXX', {
      recursive: true,
      force: true,
    });
    // Returns a warning finding (unexpected error path)
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].code).toBe('HCL_VALIDATION_ERROR');
  });

  it('writes all files with correct content', () => {
    const json = makeValidOutput();
    mockExec.mockReturnValueOnce('').mockReturnValueOnce(json);

    const files = {
      'main.tf': 'resource "aws_s3_bucket" "b" { bucket = "my-bucket" }',
      'providers.tf': 'provider "aws" { region = "us-east-1" }',
      'outputs.tf': 'output "id" { value = aws_s3_bucket.b.id }',
    };
    validateHcl(files);

    expect(mockWriteFile).toHaveBeenCalledTimes(3);
    for (const [name, content] of Object.entries(files)) {
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining(name),
        content,
        'utf-8',
      );
    }
  });

  it('forwards runner options to terraform', () => {
    const json = makeValidOutput();
    mockExec.mockReturnValueOnce('').mockReturnValueOnce(json);

    validateHcl(makeFiles(), {
      terraformBin: '/opt/tofu',
      timeoutMs: 10_000,
    });

    // First call is init
    expect(mockExec).toHaveBeenCalledWith(
      '/opt/tofu',
      expect.arrayContaining(['init']),
      expect.objectContaining({ timeout: 10_000 }),
    );
    // Second call is validate
    expect(mockExec).toHaveBeenCalledWith(
      '/opt/tofu',
      expect.arrayContaining(['validate']),
      expect.objectContaining({ timeout: 10_000 }),
    );
  });
});
