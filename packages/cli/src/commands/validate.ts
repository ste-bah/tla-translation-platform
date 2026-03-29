/**
 * validate command — runs the full TLA validation suite from the CLI.
 *
 * Pipeline (dependency order):
 *   1. syntax       — fast structural check on generated .tf files
 *   2. policy       — built-in policy engine (via @tla/validator)
 *   3. compliance   — CIS compliance rules (via @tla/validator)
 *   4. scenario     — scenario-level contract-driven checks
 *   5. semantic     — equivalence checker against discovered IR / translation result
 *   6. confidence   — aggregate confidence scoring
 *   7. cost         — cost-delta estimate when translation result is available
 *
 * Exit codes: 0 — pass (or warn without --strict), 1 — fail (or strict+warn)
 */

import { resolve, join, extname } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import type { Command } from 'commander';
import {
  evaluatePolicies,
  checkCompliance,
  checkEquivalence,
  scoreConfidence,
  estimateCostDelta,
  validateScenarios,
  CIS_BASIC,
  CIS_ADVANCED,
  classificationToSemanticStatus,
} from '@tla/validator';
import { runTerraformValidate } from '@tla/translator';
import type {
  PolicyReport,
  ComplianceReport,
  ComplianceProfile,
  ConfidenceReport,
  ResourceConfidenceInput,
  ScenarioValidationReport,
} from '@tla/validator';
import type {
  AwsServiceFamily,
  CanonicalIR,
  TranslationManifest,
  TranslationResult,
  TranslationFinding,
} from '@tla/shared';

type CheckName = 'syntax' | 'policy' | 'compliance' | 'scenario' | 'semantic' | 'confidence' | 'cost';
type OverallResult = 'pass' | 'warn' | 'fail';
type ComplianceProfileName = 'cis-basic' | 'cis-advanced' | 'none';

interface SyntaxCheckResult {
  result: 'pass' | 'warn' | 'fail';
  filesChecked: number;
  duration: number;
  issues: string[];
  validationTiers?: ('structural' | 'terraform-validate')[];
}
interface PolicyCheckResult { result: 'pass' | 'warn' | 'fail'; passed: number; failed: number; warnings: number; duration: number }
interface ComplianceCheckResult { result: 'pass' | 'warn' | 'fail'; score: number; profile: string; duration: number }
interface ScenarioCheckResult { result: 'pass' | 'warn' | 'fail'; scenarios: number; blockers: number; warnings: number; infos: number; duration: number }
interface SemanticCheckResult { preserved: number; transformed: number; partial: number; missing: number; overallScore: number; result: 'pass' | 'warn' | 'fail'; duration: number }
interface ConfidenceCheckResult { overall: number; band: string; escalationRequired: boolean; result: 'pass' | 'warn' | 'fail'; duration: number }
interface CostCheckResult { delta: string; deltaPercent: number; caveats: string[]; result: 'pass' | 'warn' | 'fail'; duration: number }
interface ValidateChecks { syntax?: SyntaxCheckResult; policy?: PolicyCheckResult; compliance?: ComplianceCheckResult; scenario?: ScenarioCheckResult; semanticDiff?: SemanticCheckResult; confidence?: ConfidenceCheckResult; cost?: CostCheckResult }
interface ValidateResult { success: boolean; overallResult?: OverallResult; checks?: ValidateChecks; findings?: TranslationFinding[]; totalDuration?: number; error?: string; discoveredArtifacts?: string[] }
interface ValidateOptions { target: 'azure' | 'gcp'; strict: boolean; ir?: string; checks?: string[]; complianceProfile: ComplianceProfileName; format: 'text' | 'json' }

interface DiscoveredBundle {
  manifest: TranslationManifest | null;
  ir: CanonicalIR | null;
  translationResult: TranslationResult | null;
  discoveredFrom: string[];
}

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

async function discoverBundle(translatedDir: string): Promise<DiscoveredBundle> {
  const discoveredFrom: string[] = [];
  let manifest: TranslationManifest | null = null;
  let ir: CanonicalIR | null = null;
  let translationResult: TranslationResult | null = null;

  try {
    const raw = await readFile(join(translatedDir, 'manifest.json'), 'utf-8');
    manifest = JSON.parse(raw) as TranslationManifest;
    discoveredFrom.push('manifest.json');
  } catch { }

  try {
    const raw = await readFile(join(translatedDir, 'canonical-ir.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.ir && Array.isArray((parsed.ir as CanonicalIR).resources)) {
      ir = parsed.ir as CanonicalIR;
      if (parsed.translationResult) translationResult = parsed.translationResult as TranslationResult;
    } else if (Array.isArray((parsed as unknown as CanonicalIR).resources)) {
      ir = parsed as unknown as CanonicalIR;
    }
    if (ir) discoveredFrom.push('canonical-ir.json');
  } catch { }

  if (!translationResult) {
    try {
      const raw = await readFile(join(translatedDir, 'translation-result.json'), 'utf-8');
      translationResult = JSON.parse(raw) as TranslationResult;
      discoveredFrom.push('translation-result.json');
    } catch { }
  }

  return { manifest, ir, translationResult, discoveredFrom };
}

async function loadIrAndResult(path: string, provider: 'azure' | 'gcp') {
  const rawJson = await readFile(resolve(path), 'utf-8');
  const parsed = JSON.parse(rawJson) as Record<string, unknown>;

  let ir: CanonicalIR | null = null;
  let translationResult: TranslationResult | null = null;

  if (parsed.ir && Array.isArray((parsed.ir as CanonicalIR).resources)) {
    ir = parsed.ir as CanonicalIR;
    if (parsed.translationResult) translationResult = parsed.translationResult as TranslationResult;
  } else if (Array.isArray((parsed as unknown as CanonicalIR).resources)) {
    ir = parsed as unknown as CanonicalIR;
  } else if ((parsed as TranslationResult).manifest) {
    translationResult = parsed as unknown as TranslationResult;
  }

  const manifest =
    translationResult?.manifest ??
    ((parsed as Record<string, unknown>).entries ? (parsed as unknown as TranslationManifest) : null);

  return {
    ir: ir ?? emptyIr(provider),
    translationResult,
    manifest: manifest ?? emptyManifest(provider),
  };
}

const HCL_BLOCK_RE = /^(?:resource|variable|provider|terraform|output|data|locals|module)\s/;

function hasUnclosedString(line: string): boolean {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') { i++; continue; }
    if (line[i] === '"') inString = !inString;
  }
  return inString;
}

function checkFileStructure(file: string, content: string, issues: string[]): void {
  if (content.trim().length === 0) {
    issues.push(`${file}: empty .tf file`);
    return;
  }

  const openBraces = (content.match(/\{/g) ?? []).length;
  const closeBraces = (content.match(/\}/g) ?? []).length;
  if (openBraces !== closeBraces) {
    issues.push(`${file}: unbalanced braces (${String(openBraces)} open, ${String(closeBraces)} close)`);
  }
  if (content.includes('\x00')) {
    issues.push(`${file}: file contains NUL bytes (possibly truncated)`);
  }

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('}') || trimmed.includes('=')) continue;
    if (trimmed.includes('{') && !HCL_BLOCK_RE.test(trimmed) && lines[i].length === trimmed.length) {
      issues.push(`${file}:${String(i + 1)}: unrecognised top-level block: ${trimmed.slice(0, 60)}`);
    }
    if (!trimmed.startsWith('#') && !trimmed.startsWith('//') && hasUnclosedString(lines[i])) {
      issues.push(`${file}:${String(i + 1)}: possible unclosed string literal`);
    }
  }
}

interface TerraformTierResult { ran: boolean; hadErrors: boolean }

function runTerraformTier(translatedDir: string, issues: string[]): TerraformTierResult {
  try {
    const tfResult = runTerraformValidate(translatedDir, { timeoutMs: 30_000 });
    if (tfResult.ok) {
      try {
        const parsed = JSON.parse(tfResult.stdout) as {
          valid?: boolean;
          diagnostics?: Array<{ severity?: string; summary?: string; detail?: string }>;
        };
        if (parsed.valid === false && Array.isArray(parsed.diagnostics)) {
          let hasError = false;
          for (const diag of parsed.diagnostics) {
            const severity = diag.severity === 'error' ? 'error' : 'warning';
            if (severity === 'error') hasError = true;
            issues.push(`[terraform ${severity}] ${diag.summary ?? 'unknown'}: ${diag.detail ?? ''}`);
          }
          return { ran: true, hadErrors: hasError };
        }
      } catch { }
      return { ran: true, hadErrors: false };
    }
    issues.push(`[terraform validate skipped] ${tfResult.message}`);
    return { ran: false, hadErrors: false };
  } catch {
    return { ran: false, hadErrors: false };
  }
}

async function runSyntaxCheck(translatedDir: string): Promise<SyntaxCheckResult> {
  const t0 = Date.now();
  const issues: string[] = [];
  const validationTiers: ('structural' | 'terraform-validate')[] = ['structural'];
  let filesChecked = 0;

  try {
    const entries = await readdir(translatedDir);
    const tfFiles = entries.filter((f) => extname(f) === '.tf');

    if (tfFiles.length === 0) {
      return { result: 'warn', filesChecked: 0, duration: Date.now() - t0, issues: ['No .tf files found in translated directory'], validationTiers };
    }

    for (const file of tfFiles) {
      filesChecked++;
      try {
        const content = await readFile(join(translatedDir, file), 'utf-8');
        checkFileStructure(file, content, issues);
      } catch {
        issues.push(`${file}: cannot read file`);
      }
    }

    const tfTier = runTerraformTier(translatedDir, issues);
    if (tfTier.ran) validationTiers.push('terraform-validate');

    let result: SyntaxCheckResult['result'];
    if (tfTier.hadErrors) result = 'fail';
    else if (issues.length > 0) result = 'warn';
    else result = 'pass';

    return { result, filesChecked, duration: Date.now() - t0, issues, validationTiers };
  } catch {
    return { result: 'fail', filesChecked, duration: Date.now() - t0, issues: ['Cannot read translated directory'], validationTiers };
  }
}

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

function runScenarioCheck(manifest: TranslationManifest): { checkResult: ScenarioCheckResult; report: ScenarioValidationReport } {
  const t0 = Date.now();
  const report = validateScenarios(manifest);
  return {
    checkResult: {
      result: report.result,
      scenarios: report.summary.total,
      blockers: report.summary.blockers,
      warnings: report.summary.warnings,
      infos: report.summary.infos,
      duration: Date.now() - t0,
    },
    report,
  };
}

function runSemanticCheck(ir: CanonicalIR, translationResult: TranslationResult): SemanticCheckResult {
  const t0 = Date.now();
  const equivReport = checkEquivalence(ir, translationResult.manifest);
  const result: SemanticCheckResult['result'] =
    equivReport.classification === 'equivalent' ? 'pass' : equivReport.classification === 'partial' ? 'warn' : 'fail';
  return {
    preserved: equivReport.summary.equivalent,
    transformed: equivReport.summary.partial,
    partial: equivReport.summary.degraded,
    missing: equivReport.summary.missing,
    overallScore: equivReport.overallScore,
    result,
    duration: Date.now() - t0,
  };
}

function runConfidenceCheck(
  ir: CanonicalIR,
  manifest: TranslationManifest | null,
  policyReport: PolicyReport,
  complianceReport: ComplianceReport,
  semanticReport: ReturnType<typeof checkEquivalence> | null,
): { checkResult: ConfidenceCheckResult; report: ConfidenceReport } {
  const t0 = Date.now();
  const manifestBySourceId = new Map((manifest?.entries ?? []).map((e) => [e.sourceId, e]));

  const resources: ResourceConfidenceInput[] = ir.resources.map((r) => {
    const equivRecord = semanticReport?.records.find((rec) => rec.resourceId === r.id);
    const semanticStatus = equivRecord ? classificationToSemanticStatus(equivRecord.classification) : 'preserved';
    const policyWarnings = policyReport.results.filter((pr) => !pr.passed && pr.resourceId === r.id && pr.severity === 'warning').length;
    const policyFailures = policyReport.results.filter((pr) => !pr.passed && pr.resourceId === r.id && pr.severity !== 'warning').length;
    const manifestEntry = manifestBySourceId.get(r.id);
    const registryConfidence = manifestEntry?.confidence ?? 0.5;

    return {
      resourceId: r.id,
      serviceFamily: r.category as AwsServiceFamily,
      registryConfidence,
      validationStatus: 'clean',
      semanticStatus,
      policyWarnings,
      policyFailures,
      reviewCritical: ['security', 'identity', 'networking'].includes(r.category),
    };
  });

  const report = scoreConfidence({ resources, policyReport, complianceReport });
  return {
    checkResult: {
      overall: report.overall,
      band: report.overallBand,
      escalationRequired: report.escalationRequired,
      result: report.escalationRequired ? 'warn' : 'pass',
      duration: Date.now() - t0,
    },
    report,
  };
}

function runCostCheck(ir: CanonicalIR, translationResult: TranslationResult): CostCheckResult {
  const t0 = Date.now();
  const costReport = estimateCostDelta(ir, translationResult);
  const deltaStr = costReport.deltaPercent >= 0 ? `+${costReport.deltaPercent.toFixed(1)}%` : `${costReport.deltaPercent.toFixed(1)}%`;
  return { delta: deltaStr, deltaPercent: costReport.deltaPercent, caveats: costReport.caveats, result: 'warn', duration: Date.now() - t0 };
}

function rollupOverallResult(checks: ValidateChecks, strict: boolean): OverallResult {
  const results = [
    checks.syntax?.result,
    checks.policy?.result,
    checks.compliance?.result,
    checks.scenario?.result,
    checks.semanticDiff?.result,
    checks.confidence?.result,
  ].filter((r): r is 'pass' | 'warn' | 'fail' => r !== undefined);

  if (results.some((r) => r === 'fail')) return 'fail';
  if (strict && results.some((r) => r === 'warn')) return 'fail';
  if (results.some((r) => r === 'warn')) return 'warn';
  return 'pass';
}

function formatValidateText(vr: ValidateResult): string {
  const lines: string[] = [];
  lines.push('Validation Report');
  lines.push('=================');
  lines.push('');

  if (!vr.success) { lines.push(`Error: ${vr.error ?? 'Unknown error'}`); return lines.join('\n'); }

  lines.push(`Overall: ${String(vr.overallResult ?? 'unknown').toUpperCase()}`);
  lines.push(`Duration: ${String(vr.totalDuration ?? 0)}ms`);
  if (vr.discoveredArtifacts && vr.discoveredArtifacts.length > 0) {
    lines.push(`Artifacts: ${vr.discoveredArtifacts.join(', ')}`);
  }
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
  if (c.scenario) {
    lines.push(`Scenario:   ${c.scenario.result.toUpperCase()} (${String(c.scenario.scenarios)} findings, ${String(c.scenario.blockers)} blockers, ${String(c.scenario.warnings)} warnings, ${String(c.scenario.duration)}ms)`);
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

function classifyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('ENOENT')) return 'Translated directory or IR file not found. Check the paths and try again.';
  if (raw.includes('JSON') || raw.includes('parse') || raw.includes('Parse')) return 'Failed to parse IR file. Ensure it contains valid JSON.';
  if (raw.includes('EACCES') || raw.includes('permission')) return 'Permission denied when reading files. Check file permissions.';
  return 'Validation failed unexpectedly. Check inputs and try again.';
}

const VALID_TARGETS = new Set(['azure', 'gcp']);
const VALID_FORMATS = new Set(['text', 'json']);
const VALID_PROFILES = new Set(['cis-basic', 'cis-advanced', 'none']);
const VALID_CHECKS = new Set<string>(['syntax', 'policy', 'compliance', 'scenario', 'semantic', 'confidence', 'cost']);

function validateOptions(opts: ValidateOptions): boolean {
  if (!VALID_TARGETS.has(opts.target)) { process.stderr.write('Error: --target must be azure or gcp\n'); process.exitCode = 1; return false; }
  if (!VALID_FORMATS.has(opts.format)) { process.stderr.write('Error: --format must be text or json\n'); process.exitCode = 1; return false; }
  if (!VALID_PROFILES.has(opts.complianceProfile)) { process.stderr.write('Error: --compliance-profile must be cis-basic, cis-advanced, or none\n'); process.exitCode = 1; return false; }
  if (opts.checks) {
    for (const ch of opts.checks) {
      if (!VALID_CHECKS.has(ch)) { process.stderr.write('Error: --checks must only include syntax, policy, compliance, scenario, semantic, confidence, or cost\n'); process.exitCode = 1; return false; }
    }
  }
  return true;
}

export function registerValidate(program: Command): void {
  program
    .command('validate')
    .description('Run validation checks on translated Terraform output')
    .argument('<translated_dir>', 'Path to directory containing translated .tf files')
    .option('-t, --target <provider>', 'Target cloud provider: azure or gcp', 'azure')
    .option('--strict', 'Treat warnings as failures', false)
    .option('--ir <file>', 'Optional path to IR / translation-result JSON file')
    .option('--checks <checks...>', 'Which checks to run (default: all)')
    .option('--compliance-profile <profile>', 'CIS compliance profile: cis-basic, cis-advanced, or none', 'cis-basic')
    .option('-f, --format <format>', 'Output format: text or json', 'text')
    .action(async (translatedDirArg: string, opts: ValidateOptions) => {
      try {
        if (!validateOptions(opts)) return;

        const totalT0 = Date.now();
        const translatedDir = resolve(translatedDirArg);
        const checksToRun: Set<CheckName> = new Set(
          (opts.checks as CheckName[] | undefined) ?? ['syntax', 'policy', 'compliance', 'scenario', 'semantic', 'confidence', 'cost'],
        );
        const strict = opts.strict;
        const checks: ValidateChecks = {};
        const allFindings: TranslationFinding[] = [];

        if (checksToRun.has('syntax')) {
          checks.syntax = await runSyntaxCheck(translatedDir);
          if (checks.syntax.result === 'fail') {
            const earlyResult: ValidateResult = {
              success: true, overallResult: 'fail', checks, findings: [], totalDuration: Date.now() - totalT0,
            };
            process.stdout.write((opts.format === 'json' ? JSON.stringify(earlyResult, null, 2) : formatValidateText(earlyResult)) + '\n');
            process.exitCode = 1;
            return;
          }
        }

        const bundle = await discoverBundle(translatedDir);
        let ir: CanonicalIR | null = bundle.ir;
        let translationResult: TranslationResult | null = bundle.translationResult;
        let manifest: TranslationManifest | null = bundle.manifest;

        if (opts.ir && (checksToRun.has('semantic') || checksToRun.has('confidence') || checksToRun.has('cost'))) {
          try {
            const loaded = await loadIrAndResult(opts.ir, opts.target);
            if (!ir || !bundle.discoveredFrom.includes('canonical-ir.json')) ir = loaded.ir;
            if (!translationResult) translationResult = loaded.translationResult;
            if (!manifest || !bundle.discoveredFrom.includes('manifest.json')) manifest = loaded.manifest;
          } catch {
            allFindings.push({ resourceId: '*', severity: 'warning', code: 'VALIDATE_IR_LOAD', message: 'Could not load IR file.' });
          }
        }

        let policyReport: PolicyReport = { passed: true, results: [], findings: [], summary: { total: 0, passed: 0, failed: 0, errors: 0 } };
        if (checksToRun.has('policy')) {
          if (!manifest) {
            allFindings.push({ resourceId: '*', severity: 'info', code: 'VALIDATE_POLICY_SKIP', message: 'Policy check skipped — no manifest.json found in translated directory.' });
          } else {
            const { checkResult, report } = await runPolicyCheck(ir ?? emptyIr(opts.target), manifest);
            checks.policy = checkResult; policyReport = report; allFindings.push(...report.findings);
          }
        }

        let complianceReport: ComplianceReport = { score: 100, passed: true, results: [], findings: [], summary: { total: 0, applicable: 0, passed: 0, failed: 0 } };
        if (checksToRun.has('compliance')) {
          if (!manifest) {
            allFindings.push({ resourceId: '*', severity: 'info', code: 'VALIDATE_COMPLIANCE_SKIP', message: 'Compliance check skipped — no manifest.json found in translated directory.' });
          } else {
            const { checkResult, report } = runComplianceCheck(manifest, opts.complianceProfile);
            checks.compliance = checkResult; complianceReport = report; allFindings.push(...report.findings);
          }
        }

        if (checksToRun.has('scenario')) {
          if (!manifest) {
            allFindings.push({ resourceId: '*', severity: 'info', code: 'VALIDATE_SCENARIO_SKIP', message: 'Scenario validation skipped — no manifest.json found in translated directory.' });
          } else {
            const { checkResult, report } = runScenarioCheck(manifest);
            checks.scenario = checkResult;
            allFindings.push(...report.findings.map((f) => ({
              resourceId: f.resourceId,
              severity: f.severity,
              code: f.code,
              message: `[${f.scenario}] ${f.message}`,
            })));
          }
        }

        let semanticEquivReport: ReturnType<typeof checkEquivalence> | null = null;
        if (checksToRun.has('semantic')) {
          if (!ir || !translationResult) {
            allFindings.push({ resourceId: '*', severity: 'info', code: 'VALIDATE_SEMANTIC_SKIP', message: 'Semantic diff skipped: no IR / translation result found.' });
          } else {
            semanticEquivReport = checkEquivalence(ir, translationResult.manifest);
            checks.semanticDiff = runSemanticCheck(ir, translationResult);
          }
        }

        if (checksToRun.has('confidence')) {
          if (!ir) {
            allFindings.push({ resourceId: '*', severity: 'info', code: 'VALIDATE_CONFIDENCE_SKIP', message: 'Confidence scoring skipped: no IR found.' });
          } else {
            const { checkResult } = runConfidenceCheck(ir, manifest, policyReport, complianceReport, semanticEquivReport);
            checks.confidence = checkResult;
          }
        }

        if (checksToRun.has('cost')) {
          if (!ir || !translationResult) {
            allFindings.push({ resourceId: '*', severity: 'info', code: 'VALIDATE_COST_SKIP', message: 'Cost estimate skipped: no IR / translation result found.' });
          } else {
            checks.cost = runCostCheck(ir, translationResult);
          }
        }

        const overallResult = rollupOverallResult(checks, strict);
        const result: ValidateResult = {
          success: true,
          overallResult,
          checks,
          findings: allFindings,
          totalDuration: Date.now() - totalT0,
          discoveredArtifacts: bundle.discoveredFrom,
        };
        process.stdout.write((opts.format === 'json' ? JSON.stringify(result, null, 2) : formatValidateText(result)) + '\n');
        if (overallResult === 'fail') process.exitCode = 1;
      } catch (err: unknown) {
        process.stderr.write(`Error: ${classifyError(err)}\n`);
        process.exitCode = 1;
      }
    });
}
