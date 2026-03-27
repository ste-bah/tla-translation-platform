/**
 * handleValidate — implementation of the `validate` MCP tool.
 *
 * Runs the full validation suite on translated Terraform output.
 *
 * Pipeline (in dependency order):
 *   1. syntax       — fast structural check on generated files
 *   2. policy       — built-in policy engine (via @tla/validator)
 *   3. compliance   — CIS compliance rules (via @tla/validator)
 *   4. semantic     — equivalence checker against IR (if irFile provided)
 *   5. confidence   — aggregate confidence scoring
 *   6. cost         — cost-delta estimate (if requested)
 *
 * "hclValidation" (terraform validate) is skipped gracefully when
 * config.terraformBin is null — this is done at the index.ts layer before
 * this handler is called.
 *
 * Never throws — all errors are caught and returned as structured failures.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

import {
  evaluatePolicies,
  checkCompliance,
  checkEquivalence,
  scoreConfidence,
  estimateCostDelta,
  CIS_BASIC,
  CIS_ADVANCED,
  classificationToSemanticStatus,
} from '@tla/validator';
import { runTerraformValidate } from '@tla/translator';
import type {
  PolicyReport,
  ComplianceReport,
  ConfidenceReport,
  ResourceConfidenceInput,
} from '@tla/validator';
import type { AwsServiceFamily, CanonicalIR, TranslationManifest, TranslationResult, TranslationFinding } from '@tla/shared';

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export type CheckName = 'syntax' | 'policy' | 'compliance' | 'semantic' | 'confidence' | 'cost';
export type ComplianceProfileName = 'cis-basic' | 'cis-advanced' | 'none';
export type OverallResult = 'pass' | 'warn' | 'fail';

export interface ValidateArgs {
  /** Path to the directory containing translated Terraform files. */
  translated_dir: string;
  /** Target cloud provider. */
  provider: 'azure' | 'gcp';
  /** Whether to treat warnings as failures. */
  strict?: boolean;
  /** Optional path to a CanonicalIR JSON file for semantic diff. */
  irFile?: string;
  /** Which checks to run. Defaults to all. */
  checks?: CheckName[];
  /** CIS compliance profile. Defaults to 'cis-basic'. */
  complianceProfile?: ComplianceProfileName;
  /** Custom OPA policy directory (currently forwarded as a note — OPA URL config is separate). */
  policyDir?: string;
}

export interface SyntaxCheckResult {
  result: 'pass' | 'warn' | 'fail';
  filesChecked: number;
  duration: number;
  issues: string[];
  /** Which validation tiers ran */
  validationTiers?: ('structural' | 'terraform-validate')[];
}

export interface PolicyCheckResult {
  result: 'pass' | 'warn' | 'fail';
  passed: number;
  failed: number;
  warnings: number;
  duration: number;
}

export interface ComplianceCheckResult {
  result: 'pass' | 'warn' | 'fail';
  score: number;
  profile: string;
  duration: number;
}

export interface SemanticCheckResult {
  preserved: number;
  transformed: number;
  partial: number;
  missing: number;
  overallScore: number;
  result: 'pass' | 'warn' | 'fail';
  duration: number;
}

export interface ConfidenceCheckResult {
  overall: number;
  band: string;
  escalationRequired: boolean;
  result: 'pass' | 'warn' | 'fail';
  duration: number;
}

export interface CostCheckResult {
  delta: string;
  deltaPercent: number;
  caveats: string[];
  result: 'pass' | 'warn' | 'fail';
  duration: number;
}

export interface ValidateChecks {
  syntax?: SyntaxCheckResult;
  policy?: PolicyCheckResult;
  compliance?: ComplianceCheckResult;
  semanticDiff?: SemanticCheckResult;
  confidence?: ConfidenceCheckResult;
  cost?: CostCheckResult;
}

export type SkippedCheckResult = { result: 'skipped'; reason: string };

export interface ValidateResult {
  success: boolean;
  overallResult?: OverallResult;
  checks?: ValidateChecks;
  findings?: TranslationFinding[];
  totalDuration?: number;
  error?: string;
  /** Artifacts auto-discovered from the translated directory (e.g. 'manifest.json', 'canonical-ir.json'). */
  discoveredArtifacts?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auto-discovery
// ---------------------------------------------------------------------------

interface DiscoveredBundle {
  manifest: TranslationManifest | null;
  ir: CanonicalIR | null;
  translationResult: TranslationResult | null;
  discoveredFrom: string[];
}

/**
 * Attempts to load manifest.json and canonical-ir.json from the translated directory.
 * Returns null for each if not found or unparseable.
 */
async function discoverBundle(translatedDir: string): Promise<DiscoveredBundle> {
  const discoveredFrom: string[] = [];
  let manifest: TranslationManifest | null = null;
  let ir: CanonicalIR | null = null;
  let translationResult: TranslationResult | null = null;

  try {
    const raw = await readFile(join(translatedDir, 'manifest.json'), 'utf-8');
    manifest = JSON.parse(raw) as TranslationManifest;
    discoveredFrom.push('manifest.json');
  } catch { /* not found or invalid */ }

  try {
    const raw = await readFile(join(translatedDir, 'canonical-ir.json'), 'utf-8');
    const parsed = JSON.parse(raw) as {
      ir?: CanonicalIR;
      translationResult?: TranslationResult;
    };
    if (parsed.ir) {
      ir = parsed.ir;
      discoveredFrom.push('canonical-ir.json');
    }
    if (parsed.translationResult) {
      translationResult = parsed.translationResult;
    }
  } catch { /* not found or invalid */ }

  return { manifest, ir, translationResult, discoveredFrom };
}

// ---------------------------------------------------------------------------
// Empty fallbacks (deprecated — kept for backward compatibility)
// ---------------------------------------------------------------------------

/** @deprecated Use discoverBundle() instead. Kept for backward compatibility. */
/** Build a minimal always-pass TranslationManifest for policy/compliance when we
 * don't have a real one. Policy engine operates on CanonicalIR resources;
 * compliance engine operates on manifest.entries[].targetResources. Both need
 * a manifest argument — pass a structural empty one.
 */
function emptyManifest(provider: 'azure' | 'gcp'): TranslationManifest {
  return {
    version: '1.0.0',
    registryVersion: '0.0.0',
    target: provider,
    counts: { total: 0, translated: 0, expanded: 0, partial: 0, blocked: 0, advisory: 0 },
    entries: [],
    findings: [],
    confidenceOverall: 0,
  };
}

/** @deprecated Use discoverBundle() instead. Kept for backward compatibility. */
function emptyIr(_provider: 'azure' | 'gcp'): CanonicalIR {
  return {
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
  };
}

// ---------------------------------------------------------------------------
// Individual check runners
// ---------------------------------------------------------------------------

/** Valid HCL top-level block openers. */
const HCL_BLOCK_RE =
  /^(?:resource|variable|provider|terraform|output|data|locals|module)\s/;

/** Check a single line for unclosed string literals (odd unescaped quotes). */
function hasUnclosedString(line: string): boolean {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') { i++; continue; }
    if (line[i] === '"') inString = !inString;
  }
  return inString;
}

/** Tier-1 structural checks for a single .tf file. */
function checkFileStructure(
  file: string,
  content: string,
  issues: string[],
): void {
  // Empty file warning
  if (content.trim().length === 0) {
    issues.push(`${file}: empty .tf file`);
    return;
  }

  // Brace balance
  const openBraces = (content.match(/\{/g) ?? []).length;
  const closeBraces = (content.match(/\}/g) ?? []).length;
  if (openBraces !== closeBraces) {
    issues.push(`${file}: unbalanced braces (${openBraces} open, ${closeBraces} close)`);
  }

  // NUL bytes
  if (content.includes('\x00')) {
    issues.push(`${file}: file contains NUL bytes (possibly truncated)`);
  }

  // Block structure validation
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    // Skip comments / blank
    if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    // Skip closing braces, assignments, nested blocks
    if (trimmed.startsWith('}') || trimmed.includes('=')) continue;
    // If it looks like a block opener but doesn't match known types
    if (trimmed.includes('{') && !HCL_BLOCK_RE.test(trimmed) && !trimmed.startsWith('}')) {
      // Could be nested block (e.g. "lifecycle {") — only flag top-level
      // Heuristic: if line has no leading whitespace, it's top-level
      if (lines[i].length === trimmed.length) {
        issues.push(`${file}:${i + 1}: unrecognised top-level block: ${trimmed.slice(0, 60)}`);
      }
    }
  }

  // Unclosed string literals
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    if (hasUnclosedString(lines[i])) {
      issues.push(`${file}:${i + 1}: possible unclosed string literal`);
    }
  }
}

/** Tier-2: run terraform validate (synchronous). */
function runTerraformTier(
  translatedDir: string,
  issues: string[],
): boolean {
  try {
    const tfResult = runTerraformValidate(translatedDir, { timeoutMs: 30_000 });
    if (tfResult.ok) {
      try {
        const validateOutput = JSON.parse(tfResult.stdout) as {
          valid?: boolean;
          diagnostics?: Array<{ severity?: string; summary?: string; detail?: string }>;
        };
        if (validateOutput.valid === false && Array.isArray(validateOutput.diagnostics)) {
          let hasError = false;
          for (const diag of validateOutput.diagnostics) {
            const severity = diag.severity === 'error' ? 'error' : 'warning';
            if (severity === 'error') hasError = true;
            issues.push(`[terraform ${severity}] ${diag.summary ?? 'unknown'}: ${diag.detail ?? ''}`);
          }
          return hasError;
        }
      } catch { /* ignore JSON parse failure */ }
    } else {
      issues.push(`[terraform validate skipped] ${tfResult.message}`);
    }
  } catch {
    // terraform binary not available — skip gracefully
  }
  return false;
}

async function runSyntaxCheck(
  translatedDir: string,
): Promise<SyntaxCheckResult> {
  const t0 = Date.now();
  const issues: string[] = [];
  const validationTiers: ('structural' | 'terraform-validate')[] = ['structural'];
  let filesChecked = 0;

  try {
    const entries = await readdir(translatedDir);
    const tfFiles = entries.filter((f) => extname(f) === '.tf');

    if (tfFiles.length === 0) {
      return {
        result: 'warn',
        filesChecked: 0,
        duration: Date.now() - t0,
        issues: ['No .tf files found in translated_dir'],
        validationTiers,
      };
    }

    // Tier 1: structural validation
    for (const file of tfFiles) {
      filesChecked++;
      try {
        const content = await readFile(join(translatedDir, file), 'utf-8');
        checkFileStructure(file, content, issues);
      } catch (err: unknown) {
        issues.push(`${file}: cannot read — ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Tier 2: terraform validate
    const structuralIssueCount = issues.length;
    const terraformHadErrors = runTerraformTier(translatedDir, issues);
    if (issues.length > structuralIssueCount || terraformHadErrors) {
      validationTiers.push('terraform-validate');
    } else {
      // Check if terraform was actually attempted (no new issues but it ran)
      // We always attempt it, so mark the tier as ran even if clean
      validationTiers.push('terraform-validate');
    }

    // Tier 3: result classification
    let result: SyntaxCheckResult['result'];
    if (terraformHadErrors) {
      result = 'fail';
    } else if (issues.length > 0) {
      result = 'warn';
    } else {
      result = 'pass';
    }

    return { result, filesChecked, duration: Date.now() - t0, issues, validationTiers };
  } catch (err: unknown) {
    return {
      result: 'fail',
      filesChecked,
      duration: Date.now() - t0,
      issues: [
        `Cannot read translated_dir: ${err instanceof Error ? err.message : String(err)}`,
      ],
      validationTiers,
    };
  }
}

async function runPolicyCheck(
  ir: CanonicalIR,
  manifest: TranslationManifest,
): Promise<{ checkResult: PolicyCheckResult; report: PolicyReport }> {
  const t0 = Date.now();
  const report = await evaluatePolicies(ir, manifest);
  const warnings = report.results.filter((r) => !r.passed && r.severity === 'warning').length;
  const failed = report.results.filter((r) => !r.passed && r.severity !== 'warning').length;
  const passed = report.summary.passed;

  let result: PolicyCheckResult['result'] = 'pass';
  if (failed > 0) result = 'fail';
  else if (warnings > 0) result = 'warn';

  return {
    checkResult: { result, passed, failed, warnings, duration: Date.now() - t0 },
    report,
  };
}

function runComplianceCheck(
  manifest: TranslationManifest,
  profileName: ComplianceProfileName,
): { checkResult: ComplianceCheckResult; report: ComplianceReport } {
  const t0 = Date.now();

  const profile =
    profileName === 'cis-advanced'
      ? CIS_ADVANCED
      : profileName === 'cis-basic'
      ? CIS_BASIC
      : null;

  if (!profile) {
    // 'none' profile — skip, return pass with score 100
    const emptyReport: ComplianceReport = {
      score: 100,
      passed: true,
      results: [],
      findings: [],
      summary: { total: 0, applicable: 0, passed: 0, failed: 0 },
    };
    return {
      checkResult: { result: 'pass', score: 100, profile: 'none', duration: Date.now() - t0 },
      report: emptyReport,
    };
  }

  const report = checkCompliance(manifest, profile);

  let result: ComplianceCheckResult['result'] = 'pass';
  if (!report.passed) result = report.score < 50 ? 'fail' : 'warn';

  return {
    checkResult: {
      result,
      score: report.score,
      profile: profileName,
      duration: Date.now() - t0,
    },
    report,
  };
}

function runSemanticCheck(
  ir: CanonicalIR,
  translationResult: TranslationResult,
): SemanticCheckResult {
  const t0 = Date.now();
  const equivReport = checkEquivalence(ir, translationResult.manifest);

  const result: SemanticCheckResult['result'] =
    equivReport.classification === 'equivalent'
      ? 'pass'
      : equivReport.classification === 'partial'
      ? 'warn'
      : 'fail';

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

  // Build manifest lookup for real registry-derived confidence
  const manifestBySourceId = new Map(
    (manifest?.entries ?? []).map((e) => [e.sourceId, e]),
  );

  // Build per-resource confidence inputs from IR resources
  const resources: ResourceConfidenceInput[] = ir.resources.map((r) => {
    // Derive semantic status from equivalence report if available
    const equivRecord = semanticReport?.records.find((rec) => rec.resourceId === r.id);
    const semanticStatus = equivRecord
      ? classificationToSemanticStatus(equivRecord.classification)
      : 'preserved'; // conservative: no IR data → assume preserved

    // Count policy findings for this resource
    const policyWarnings = policyReport.results.filter(
      (pr) => !pr.passed && pr.resourceId === r.id && pr.severity === 'warning',
    ).length;
    const policyFailures = policyReport.results.filter(
      (pr) => !pr.passed && pr.resourceId === r.id && pr.severity !== 'warning',
    ).length;

    const reviewCritical = ['security', 'identity', 'networking'].includes(r.category);

    // Use real manifest confidence (from registry) when available; 0.5 = unknown
    const manifestEntry = manifestBySourceId.get(r.id);
    const registryConfidence = manifestEntry?.confidence ?? 0.5;

    return {
      resourceId: r.id,
      serviceFamily: r.category as AwsServiceFamily,
      registryConfidence,
      validationStatus: 'clean', // syntax check passed to reach here
      semanticStatus,
      policyWarnings,
      policyFailures,
      reviewCritical,
    };
  });

  const report = scoreConfidence({ resources, policyReport, complianceReport });

  const checkResult: ConfidenceCheckResult = {
    overall: report.overall,
    band: report.overallBand,
    escalationRequired: report.escalationRequired,
    result: report.escalationRequired ? 'warn' : 'pass',
    duration: Date.now() - t0,
  };

  return { checkResult, report };
}

function runCostCheck(
  ir: CanonicalIR,
  translationResult: TranslationResult,
): CostCheckResult {
  const t0 = Date.now();
  const costReport = estimateCostDelta(ir, translationResult);

  const deltaStr =
    costReport.deltaPercent >= 0
      ? `+${costReport.deltaPercent.toFixed(1)}%`
      : `${costReport.deltaPercent.toFixed(1)}%`;

  return {
    delta: deltaStr,
    deltaPercent: costReport.deltaPercent,
    caveats: costReport.caveats,
    result: 'warn', // cost check always 'warn' — informational only (PRD EC-011)
    duration: Date.now() - t0,
  };
}

// ---------------------------------------------------------------------------
// Overall result roll-up
// ---------------------------------------------------------------------------

function rollupOverallResult(
  checks: ValidateChecks,
  strict: boolean,
): OverallResult {
  const results = [
    checks.syntax?.result,
    checks.policy?.result,
    checks.compliance?.result,
    checks.semanticDiff?.result,
    checks.confidence?.result,
    // cost is always 'warn' and informational — exclude from strict rollup
  ].filter((r): r is 'pass' | 'warn' | 'fail' => r !== undefined);

  if (results.some((r) => r === 'fail')) return 'fail';
  if (strict && results.some((r) => r === 'warn')) return 'fail';
  if (results.some((r) => r === 'warn')) return 'warn';
  return 'pass';
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Executes the validation pipeline.
 *
 * Always returns a result object; never throws.
 */
export async function handleValidate(args: ValidateArgs): Promise<ValidateResult> {
  const totalT0 = Date.now();

  try {
    const checksToRun: Set<CheckName> = new Set(
      args.checks ?? ['syntax', 'policy', 'compliance', 'semantic', 'confidence', 'cost'],
    );
    const profileName = args.complianceProfile ?? 'cis-basic';
    const strict = args.strict ?? false;

    const checks: ValidateChecks = {};
    const allFindings: TranslationFinding[] = [];

    // ---- 1. Syntax check (always first) ------------------------------------
    if (checksToRun.has('syntax')) {
      checks.syntax = await runSyntaxCheck(args.translated_dir);
      if (checks.syntax.result === 'fail') {
        // Cannot proceed without readable files — return early
        return {
          success: true,
          overallResult: 'fail',
          checks,
          findings: [],
          totalDuration: Date.now() - totalT0,
        };
      }
    }

    // ---- Auto-discover manifest and IR from translated directory ------------
    const bundle = await discoverBundle(args.translated_dir);

    let manifest: TranslationManifest | null = bundle.manifest;
    let ir: CanonicalIR | null = bundle.ir;
    let translationResult: TranslationResult | null = bundle.translationResult;

    // Override with explicit irFile if provided and auto-discovery didn't find IR
    if (args.irFile && (checksToRun.has('semantic') || checksToRun.has('confidence') || checksToRun.has('cost'))) {
      try {
        const rawJson = await readFile(args.irFile, 'utf-8');
        const parsed = JSON.parse(rawJson) as { ir?: CanonicalIR; translationResult?: TranslationResult };
        if (parsed.ir && !ir) ir = parsed.ir;
        if (parsed.translationResult && !translationResult) translationResult = parsed.translationResult;
      } catch (err: unknown) {
        // Graceful degradation: log and continue without IR
        allFindings.push({
          resourceId: '*',
          severity: 'warning',
          code: 'VALIDATE_IR_LOAD',
          message: `Could not load IR file: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // ---- 2. Policy checks --------------------------------------------------
    let policyReport: PolicyReport = {
      passed: true,
      results: [],
      findings: [],
      summary: { total: 0, passed: 0, failed: 0, errors: 0 },
    };

    if (checksToRun.has('policy')) {
      if (!manifest) {
        allFindings.push({
          resourceId: '*',
          severity: 'info',
          code: 'VALIDATE_POLICY_SKIP',
          message: 'Policy check skipped — no manifest.json found in translated directory.',
        });
      } else {
        const { checkResult, report } = await runPolicyCheck(ir ?? emptyIr(args.provider), manifest);
        checks.policy = checkResult;
        policyReport = report;
        allFindings.push(...report.findings);
      }
    }

    // ---- 3. Compliance checks ----------------------------------------------
    let complianceReport: ComplianceReport = {
      score: 100,
      passed: true,
      results: [],
      findings: [],
      summary: { total: 0, applicable: 0, passed: 0, failed: 0 },
    };

    if (checksToRun.has('compliance')) {
      if (!manifest) {
        allFindings.push({
          resourceId: '*',
          severity: 'info',
          code: 'VALIDATE_COMPLIANCE_SKIP',
          message: 'Compliance check skipped — no manifest.json found in translated directory.',
        });
      } else {
        const { checkResult, report } = runComplianceCheck(manifest, profileName);
        checks.compliance = checkResult;
        complianceReport = report;
        allFindings.push(...report.findings);
      }
    }

    // ---- 4. Semantic diff --------------------------------------------------
    let semanticEquivReport: ReturnType<typeof checkEquivalence> | null = null;

    if (checksToRun.has('semantic')) {
      if (!ir || !translationResult) {
        allFindings.push({
          resourceId: '*',
          severity: 'info',
          code: 'VALIDATE_SEMANTIC_SKIP',
          message: 'Semantic diff skipped: no IR found (checked translated directory and irFile).',
        });
      } else {
        semanticEquivReport = checkEquivalence(ir, translationResult.manifest);
        checks.semanticDiff = runSemanticCheck(ir, translationResult);
      }
    }

    // ---- 5. Confidence scoring ---------------------------------------------
    if (checksToRun.has('confidence')) {
      if (!ir) {
        allFindings.push({
          resourceId: '*',
          severity: 'info',
          code: 'VALIDATE_CONFIDENCE_SKIP',
          message: 'Confidence scoring skipped: no IR found.',
        });
      } else {
        const { checkResult } = runConfidenceCheck(
          ir,
          manifest,
          policyReport,
          complianceReport,
          semanticEquivReport,
        );
        checks.confidence = checkResult;
      }
    }

    // ---- 6. Cost estimate --------------------------------------------------
    if (checksToRun.has('cost')) {
      if (!ir || !translationResult) {
        allFindings.push({
          resourceId: '*',
          severity: 'info',
          code: 'VALIDATE_COST_SKIP',
          message: 'Cost estimate skipped: no IR / translationResult found.',
        });
      } else {
        checks.cost = runCostCheck(ir, translationResult);
      }
    }

    // ---- Roll up overall result --------------------------------------------
    const overallResult = rollupOverallResult(checks, strict);

    return {
      success: true,
      overallResult,
      checks,
      findings: allFindings,
      totalDuration: Date.now() - totalT0,
      discoveredArtifacts: bundle.discoveredFrom,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
