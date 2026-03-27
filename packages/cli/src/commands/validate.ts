/**
 * validate command — runs the full TLA validation suite from the CLI.
 *
 * Pipeline (dependency order):
 *   1. syntax       — fast structural check on generated .tf files
 *   2. policy       — built-in policy engine (via @tla/validator)
 *   3. compliance   — CIS compliance rules (via @tla/validator)
 *   4. semantic     — equivalence checker against IR (if --ir provided)
 *   5. confidence   — aggregate confidence scoring
 *   6. cost         — cost-delta estimate (if --ir provided)
 *
 * Exit codes: 0 — pass (or warn without --strict), 1 — fail (or strict+warn)
 */

import { resolve, join, extname } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import type { Command } from 'commander';
import {
  evaluatePolicies, checkCompliance, checkEquivalence,
  scoreConfidence, estimateCostDelta,
  CIS_BASIC, CIS_ADVANCED, classificationToSemanticStatus,
} from '@tla/validator';
import { runTerraformValidate } from '@tla/translator';
import type {
  PolicyReport, ComplianceReport, ComplianceProfile,
  ConfidenceReport, ResourceConfidenceInput,
} from '@tla/validator';
import type {
  AwsServiceFamily, CanonicalIR, TranslationManifest,
  TranslationResult, TranslationFinding,
} from '@tla/shared';

// ---------------------------------------------------------------------------
// Types (all local — no re-export from MCP server)
// ---------------------------------------------------------------------------

type CheckName = 'syntax' | 'policy' | 'compliance' | 'semantic' | 'confidence' | 'cost';
type OverallResult = 'pass' | 'warn' | 'fail';
type ComplianceProfileName = 'cis-basic' | 'cis-advanced' | 'none';

interface SyntaxCheckResult { result: 'pass' | 'warn' | 'fail'; filesChecked: number; duration: number; issues: string[] }
interface PolicyCheckResult { result: 'pass' | 'warn' | 'fail'; passed: number; failed: number; warnings: number; duration: number }
interface ComplianceCheckResult { result: 'pass' | 'warn' | 'fail'; score: number; profile: string; duration: number }
interface SemanticCheckResult { preserved: number; transformed: number; partial: number; missing: number; overallScore: number; result: 'pass' | 'warn' | 'fail'; duration: number }
interface ConfidenceCheckResult { overall: number; band: string; escalationRequired: boolean; result: 'pass' | 'warn' | 'fail'; duration: number }
interface CostCheckResult { delta: string; deltaPercent: number; caveats: string[]; result: 'pass' | 'warn' | 'fail'; duration: number }
interface ValidateChecks { syntax?: SyntaxCheckResult; policy?: PolicyCheckResult; compliance?: ComplianceCheckResult; semanticDiff?: SemanticCheckResult; confidence?: ConfidenceCheckResult; cost?: CostCheckResult }
interface ValidateResult { success: boolean; overallResult?: OverallResult; checks?: ValidateChecks; findings?: TranslationFinding[]; totalDuration?: number; error?: string }
interface ValidateOptions { target: 'azure' | 'gcp'; strict: boolean; ir?: string; checks?: string[]; complianceProfile: ComplianceProfileName; format: 'text' | 'json' }

// ---------------------------------------------------------------------------
// Empty fallbacks
// ---------------------------------------------------------------------------

function emptyIr(_provider: 'azure' | 'gcp'): CanonicalIR {
  return {
    version: '1.0.0', sourceProvider: 'aws',
    metadata: { generatedAt: new Date().toISOString(), sourceFiles: [], toolVersion: '0.1.0', resourceCount: 0, relationshipCount: 0 },
    resources: [], relationships: [], modules: [], intents: [],
  };
}

function emptyManifest(provider: 'azure' | 'gcp'): TranslationManifest {
  return {
    version: '1.0.0', registryVersion: '0.0.0', target: provider,
    counts: { total: 0, translated: 0, expanded: 0, partial: 0, blocked: 0, advisory: 0 },
    entries: [], findings: [], confidenceOverall: 0,
  };
}

// ---------------------------------------------------------------------------
// Syntax check (replicated locally — no dependency on MCP server)
// ---------------------------------------------------------------------------

async function runSyntaxCheck(translatedDir: string): Promise<SyntaxCheckResult> {
  const t0 = Date.now();
  const issues: string[] = [];
  let filesChecked = 0;

  try {
    const entries = await readdir(translatedDir);
    const tfFiles = entries.filter((f) => extname(f) === '.tf');

    if (tfFiles.length === 0) {
      return { result: 'warn', filesChecked: 0, duration: Date.now() - t0, issues: ['No .tf files found in translated directory'] };
    }

    for (const file of tfFiles) {
      filesChecked++;
      try {
        const content = await readFile(join(translatedDir, file), 'utf-8');
        const openBraces = (content.match(/\{/g) ?? []).length;
        const closeBraces = (content.match(/\}/g) ?? []).length;
        if (openBraces !== closeBraces) {
          issues.push(`${file}: unbalanced braces (${String(openBraces)} open, ${String(closeBraces)} close)`);
        }
        if (content.includes('\x00')) {
          issues.push(`${file}: file contains NUL bytes (possibly truncated)`);
        }
      } catch (_readErr: unknown) {
        issues.push(`${file}: cannot read file`);
      }
    }

    // If structural checks found issues, skip terraform validate and return early
    if (issues.length > 0) {
      return { result: 'warn', filesChecked, duration: Date.now() - t0, issues };
    }

    // Attempt `terraform validate` when the binary is available
    const tfResult = runTerraformValidate(translatedDir, { timeoutMs: 30_000 });

    if (!tfResult.ok) {
      if (tfResult.code === 'HCL_VALIDATION_SKIPPED') {
        // terraform binary not found — silently skip, note in issues
        issues.push('info: terraform binary not found on PATH — terraform validate skipped');
        return { result: 'pass', filesChecked, duration: Date.now() - t0, issues };
      }
      if (tfResult.code === 'HCL_VALIDATION_TIMEOUT') {
        issues.push(`warning: ${tfResult.message}`);
        return { result: 'warn', filesChecked, duration: Date.now() - t0, issues };
      }
      // HCL_VALIDATION_ERROR — parse the message as a warning
      issues.push(`warning: ${tfResult.message}`);
      return { result: 'warn', filesChecked, duration: Date.now() - t0, issues };
    }

    // terraform validate succeeded — try to parse the JSON output for diagnostics
    try {
      const parsed = JSON.parse(tfResult.stdout) as {
        valid?: boolean;
        error_count?: number;
        warning_count?: number;
        diagnostics?: Array<{ severity?: string; summary?: string; detail?: string }>;
      };

      if (parsed.valid === false) {
        // Add each diagnostic as a warning issue
        for (const diag of parsed.diagnostics ?? []) {
          issues.push(`warning: terraform validate: ${diag.summary ?? 'unknown issue'}${diag.detail ? ` — ${diag.detail}` : ''}`);
        }
        return { result: 'warn', filesChecked, duration: Date.now() - t0, issues };
      }

      // Fully valid
      issues.push('info: terraform validate passed');
    } catch (_parseErr: unknown) {
      // Could not parse JSON — still treat as pass since terraform exited 0
      issues.push('info: terraform validate passed (non-JSON output)');
    }

    return { result: issues.length === 0 || issues.every((i) => i.startsWith('info:')) ? 'pass' : 'warn', filesChecked, duration: Date.now() - t0, issues };
  } catch (_dirErr: unknown) {
    return { result: 'fail', filesChecked, duration: Date.now() - t0, issues: ['Cannot read translated directory'] };
  }
}

// ---------------------------------------------------------------------------
// Load IR / TranslationResult from JSON file
// ---------------------------------------------------------------------------

async function loadIrAndResult(irPath: string, provider: 'azure' | 'gcp') {
  const rawJson = await readFile(resolve(irPath), 'utf-8');
  const parsed = JSON.parse(rawJson) as { ir?: CanonicalIR; translationResult?: TranslationResult };
  const ir = parsed.ir ?? emptyIr(provider);
  const translationResult = parsed.translationResult ?? null;
  const manifest = translationResult?.manifest ?? emptyManifest(provider);
  return { ir, translationResult, manifest };
}

// ---------------------------------------------------------------------------
// Individual check runners
// ---------------------------------------------------------------------------

async function runPolicyCheck(ir: CanonicalIR, manifest: TranslationManifest) {
  const t0 = Date.now();
  const report = await evaluatePolicies(ir, manifest);
  const warnings = report.results.filter((r) => !r.passed && r.severity === 'warning').length;
  const failed = report.results.filter((r) => !r.passed && r.severity !== 'warning').length;
  let result: PolicyCheckResult['result'] = 'pass';
  if (failed > 0) result = 'fail';
  else if (warnings > 0) result = 'warn';
  return { checkResult: { result, passed: report.summary.passed, failed, warnings, duration: Date.now() - t0 } as PolicyCheckResult, report };
}

function runComplianceCheck(manifest: TranslationManifest, profileName: ComplianceProfileName) {
  const t0 = Date.now();
  const profile: ComplianceProfile | null =
    profileName === 'cis-advanced' ? CIS_ADVANCED : profileName === 'cis-basic' ? CIS_BASIC : null;

  if (!profile) {
    const emptyReport: ComplianceReport = { score: 100, passed: true, results: [], findings: [], summary: { total: 0, applicable: 0, passed: 0, failed: 0 } };
    return { checkResult: { result: 'pass' as const, score: 100, profile: 'none', duration: Date.now() - t0 }, report: emptyReport };
  }
  const report = checkCompliance(manifest, profile);
  let result: ComplianceCheckResult['result'] = 'pass';
  if (!report.passed) result = report.score < 50 ? 'fail' : 'warn';
  return { checkResult: { result, score: report.score, profile: profileName, duration: Date.now() - t0 }, report };
}

function runSemanticCheck(ir: CanonicalIR, translationResult: TranslationResult): SemanticCheckResult {
  const t0 = Date.now();
  const equivReport = checkEquivalence(ir, translationResult.manifest);
  const result: SemanticCheckResult['result'] =
    equivReport.classification === 'equivalent' ? 'pass' : equivReport.classification === 'partial' ? 'warn' : 'fail';
  return {
    preserved: equivReport.summary.equivalent, transformed: equivReport.summary.partial,
    partial: equivReport.summary.degraded, missing: equivReport.summary.missing,
    overallScore: equivReport.overallScore, result, duration: Date.now() - t0,
  };
}

function runConfidenceCheck(
  ir: CanonicalIR, policyReport: PolicyReport,
  complianceReport: ComplianceReport,
  semanticReport: ReturnType<typeof checkEquivalence> | null,
): { checkResult: ConfidenceCheckResult; report: ConfidenceReport } {
  const t0 = Date.now();
  const resources: ResourceConfidenceInput[] = ir.resources.map((r) => {
    const equivRecord = semanticReport?.records.find((rec) => rec.resourceId === r.id);
    const semanticStatus = equivRecord ? classificationToSemanticStatus(equivRecord.classification) : 'preserved';
    const policyWarnings = policyReport.results.filter((pr) => !pr.passed && pr.resourceId === r.id && pr.severity === 'warning').length;
    const policyFailures = policyReport.results.filter((pr) => !pr.passed && pr.resourceId === r.id && pr.severity !== 'warning').length;
    return {
      resourceId: r.id, serviceFamily: r.category as AwsServiceFamily,
      registryConfidence: 0.8, validationStatus: 'clean' as const, semanticStatus,
      policyWarnings, policyFailures, reviewCritical: ['security', 'identity', 'networking'].includes(r.category),
    };
  });
  const report = scoreConfidence({ resources, policyReport, complianceReport });
  return {
    checkResult: { overall: report.overall, band: report.overallBand, escalationRequired: report.escalationRequired, result: report.escalationRequired ? 'warn' : 'pass', duration: Date.now() - t0 },
    report,
  };
}

function runCostCheck(ir: CanonicalIR, translationResult: TranslationResult): CostCheckResult {
  const t0 = Date.now();
  const costReport = estimateCostDelta(ir, translationResult);
  const deltaStr = costReport.deltaPercent >= 0 ? `+${costReport.deltaPercent.toFixed(1)}%` : `${costReport.deltaPercent.toFixed(1)}%`;
  return { delta: deltaStr, deltaPercent: costReport.deltaPercent, caveats: costReport.caveats, result: 'warn', duration: Date.now() - t0 };
}

// ---------------------------------------------------------------------------
// Overall result roll-up (excludes cost — informational only)
// ---------------------------------------------------------------------------

function rollupOverallResult(checks: ValidateChecks, strict: boolean): OverallResult {
  const results = [
    checks.syntax?.result, checks.policy?.result, checks.compliance?.result,
    checks.semanticDiff?.result, checks.confidence?.result,
  ].filter((r): r is 'pass' | 'warn' | 'fail' => r !== undefined);

  if (results.some((r) => r === 'fail')) return 'fail';
  if (strict && results.some((r) => r === 'warn')) return 'fail';
  if (results.some((r) => r === 'warn')) return 'warn';
  return 'pass';
}

// ---------------------------------------------------------------------------
// Text formatter
// ---------------------------------------------------------------------------

function formatValidateText(vr: ValidateResult): string {
  const lines: string[] = [];
  lines.push('Validation Report');
  lines.push('=================');
  lines.push('');

  if (!vr.success) { lines.push(`Error: ${vr.error ?? 'Unknown error'}`); return lines.join('\n'); }

  lines.push(`Overall: ${String(vr.overallResult ?? 'unknown').toUpperCase()}`);
  lines.push(`Duration: ${String(vr.totalDuration ?? 0)}ms`);
  lines.push('');

  const c = vr.checks;
  if (!c) return lines.join('\n');

  if (c.syntax) {
    lines.push(`Syntax:     ${c.syntax.result.toUpperCase()} (${String(c.syntax.filesChecked)} files, ${String(c.syntax.duration)}ms)`);
    for (const issue of c.syntax.issues) lines.push(`  - ${issue}`);
  }
  if (c.policy) {
    lines.push(`Policy:     ${c.policy.result.toUpperCase()} (${String(c.policy.passed)} passed, ${String(c.policy.failed)} failed, ${String(c.policy.warnings)} warnings, ${String(c.policy.duration)}ms)`);
  }
  if (c.compliance) {
    lines.push(`Compliance: ${c.compliance.result.toUpperCase()} (score ${String(c.compliance.score)}, profile ${c.compliance.profile}, ${String(c.compliance.duration)}ms)`);
  }
  if (c.semanticDiff) {
    const sd = c.semanticDiff;
    lines.push(`Semantic:   ${sd.result.toUpperCase()} (score ${sd.overallScore.toFixed(2)}, preserved ${String(sd.preserved)}, transformed ${String(sd.transformed)}, partial ${String(sd.partial)}, missing ${String(sd.missing)}, ${String(sd.duration)}ms)`);
  }
  if (c.confidence) {
    const cn = c.confidence;
    lines.push(`Confidence: ${cn.result.toUpperCase()} (${(cn.overall * 100).toFixed(1)}% [${cn.band}]${cn.escalationRequired ? ', escalation required' : ''}, ${String(cn.duration)}ms)`);
  }
  if (c.cost) {
    lines.push(`Cost:       ${c.cost.result.toUpperCase()} (delta ${c.cost.delta}, ${String(c.cost.duration)}ms)`);
    for (const caveat of c.cost.caveats) lines.push(`  - ${caveat}`);
  }

  const findings = vr.findings ?? [];
  if (findings.length > 0) {
    lines.push('');
    lines.push(`Findings (${String(findings.length)}):`);
    for (const f of findings) lines.push(`  ${f.severity.toUpperCase()} [${f.code}] ${f.resourceId}: ${f.message}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Error classification (safe — never echoes user input)
// ---------------------------------------------------------------------------

function classifyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('ENOENT')) return 'Translated directory or IR file not found. Check the paths and try again.';
  if (raw.includes('JSON') || raw.includes('parse') || raw.includes('Parse')) return 'Failed to parse IR file. Ensure it contains valid JSON.';
  if (raw.includes('EACCES') || raw.includes('permission')) return 'Permission denied when reading files. Check file permissions.';
  return 'Validation failed unexpectedly. Check inputs and try again.';
}

// ---------------------------------------------------------------------------
// Option validation
// ---------------------------------------------------------------------------

const VALID_TARGETS = new Set(['azure', 'gcp']);
const VALID_FORMATS = new Set(['text', 'json']);
const VALID_PROFILES = new Set(['cis-basic', 'cis-advanced', 'none']);
const VALID_CHECKS = new Set<string>(['syntax', 'policy', 'compliance', 'semantic', 'confidence', 'cost']);

function validateOptions(opts: ValidateOptions): boolean {
  if (!VALID_TARGETS.has(opts.target)) { process.stderr.write('Error: --target must be azure or gcp\n'); process.exitCode = 1; return false; }
  if (!VALID_FORMATS.has(opts.format)) { process.stderr.write('Error: --format must be text or json\n'); process.exitCode = 1; return false; }
  if (!VALID_PROFILES.has(opts.complianceProfile)) { process.stderr.write('Error: --compliance-profile must be cis-basic, cis-advanced, or none\n'); process.exitCode = 1; return false; }
  if (opts.checks) {
    for (const ch of opts.checks) {
      if (!VALID_CHECKS.has(ch)) { process.stderr.write('Error: --checks must only include syntax, policy, compliance, semantic, confidence, or cost\n'); process.exitCode = 1; return false; }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerValidate(program: Command): void {
  program
    .command('validate')
    .description('Run validation checks on translated Terraform output')
    .argument('<translated_dir>', 'Path to directory containing translated .tf files')
    .option('-t, --target <provider>', 'Target cloud provider: azure or gcp', 'azure')
    .option('--strict', 'Treat warnings as failures', false)
    .option('--ir <file>', 'Path to IR JSON file for semantic/confidence/cost checks')
    .option('--checks <checks...>', 'Which checks to run (default: all)')
    .option('--compliance-profile <profile>', 'CIS compliance profile: cis-basic, cis-advanced, or none', 'cis-basic')
    .option('-f, --format <format>', 'Output format: text or json', 'text')
    .action(async (translatedDirArg: string, opts: ValidateOptions) => {
      try {
        if (!validateOptions(opts)) return;

        const totalT0 = Date.now();
        const translatedDir = resolve(translatedDirArg);
        const checksToRun: Set<CheckName> = new Set(
          (opts.checks as CheckName[] | undefined) ?? ['syntax', 'policy', 'compliance', 'semantic', 'confidence', 'cost'],
        );
        const strict = opts.strict;
        const checks: ValidateChecks = {};
        const allFindings: TranslationFinding[] = [];

        // 1. Syntax check (always first)
        if (checksToRun.has('syntax')) {
          checks.syntax = await runSyntaxCheck(translatedDir);
          if (checks.syntax.result === 'fail') {
            const earlyResult: ValidateResult = { success: true, overallResult: 'fail', checks, findings: [], totalDuration: Date.now() - totalT0 };
            process.stdout.write((opts.format === 'json' ? JSON.stringify(earlyResult, null, 2) : formatValidateText(earlyResult)) + '\n');
            process.exitCode = 1;
            return;
          }
        }

        // Load IR if provided
        let ir: CanonicalIR = emptyIr(opts.target);
        let translationResult: TranslationResult | null = null;
        let manifest: TranslationManifest = emptyManifest(opts.target);

        if (opts.ir && (checksToRun.has('semantic') || checksToRun.has('confidence') || checksToRun.has('cost'))) {
          try {
            const loaded = await loadIrAndResult(opts.ir, opts.target);
            ir = loaded.ir; translationResult = loaded.translationResult; manifest = loaded.manifest;
          } catch (_loadErr: unknown) {
            allFindings.push({ resourceId: '*', severity: 'warning', code: 'VALIDATE_IR_LOAD', message: 'Could not load IR file (semantic/confidence/cost checks will use empty IR).' });
          }
        }

        // 2. Policy checks
        let policyReport: PolicyReport = { passed: true, results: [], findings: [], summary: { total: 0, passed: 0, failed: 0, errors: 0 } };
        if (checksToRun.has('policy')) {
          const { checkResult, report } = await runPolicyCheck(ir, manifest);
          checks.policy = checkResult; policyReport = report; allFindings.push(...report.findings);
        }

        // 3. Compliance checks
        let complianceReport: ComplianceReport = { score: 100, passed: true, results: [], findings: [], summary: { total: 0, applicable: 0, passed: 0, failed: 0 } };
        if (checksToRun.has('compliance')) {
          const { checkResult, report } = runComplianceCheck(manifest, opts.complianceProfile);
          checks.compliance = checkResult; complianceReport = report; allFindings.push(...report.findings);
        }

        // 4. Semantic diff
        let semanticEquivReport: ReturnType<typeof checkEquivalence> | null = null;
        if (checksToRun.has('semantic')) {
          if (!translationResult) {
            allFindings.push({ resourceId: '*', severity: 'info', code: 'VALIDATE_SEMANTIC_SKIP', message: 'Semantic diff skipped: no --ir provided or IR file could not be loaded.' });
          } else {
            semanticEquivReport = checkEquivalence(ir, translationResult.manifest);
            checks.semanticDiff = runSemanticCheck(ir, translationResult);
          }
        }

        // 5. Confidence scoring
        if (checksToRun.has('confidence')) {
          const { checkResult } = runConfidenceCheck(ir, policyReport, complianceReport, semanticEquivReport);
          checks.confidence = checkResult;
        }

        // 6. Cost estimate
        if (checksToRun.has('cost')) {
          if (!translationResult) {
            allFindings.push({ resourceId: '*', severity: 'info', code: 'VALIDATE_COST_SKIP', message: 'Cost estimate skipped: no --ir / translationResult provided.' });
          } else {
            checks.cost = runCostCheck(ir, translationResult);
          }
        }

        // Roll up overall result
        const overallResult = rollupOverallResult(checks, strict);
        const result: ValidateResult = { success: true, overallResult, checks, findings: allFindings, totalDuration: Date.now() - totalT0 };
        process.stdout.write((opts.format === 'json' ? JSON.stringify(result, null, 2) : formatValidateText(result)) + '\n');

        // Exit code: fail -> 1, strict+warn -> 1, warn -> 0, pass -> 0
        if (overallResult === 'fail') process.exitCode = 1;
      } catch (err: unknown) {
        process.stderr.write(`Error: ${classifyError(err)}\n`);
        process.exitCode = 1;
      }
    });
}
