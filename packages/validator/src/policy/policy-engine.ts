// ---------------------------------------------------------------------------
// Policy engine — orchestrates built-in + OPA evaluation
// ---------------------------------------------------------------------------

import type { CanonicalIR, TranslationFinding, TranslationManifest } from '@tla/shared';
import type { PolicyEngineOptions, PolicyEvalContext, PolicyReport, PolicyResult } from './types.js';
import type { PolicyCode } from './policy-codes.js';
import { BUILT_IN_POLICIES } from './built-in/index.js';
import { evaluateOpa } from './opa-client.js';
import { createPolicyFinding } from './policy-helpers.js';
import { POLICY_CODES } from './policy-codes.js';

// ---------------------------------------------------------------------------
// Built-in evaluation (never throws)
// ---------------------------------------------------------------------------

function runBuiltIn(ir: CanonicalIR): PolicyResult[] {
  const results: PolicyResult[] = [];

  for (const resource of ir.resources) {
    const ctx: PolicyEvalContext = {
      resourceId: resource.id,
      sourceType: resource.sourceType,
      attributes: resource.attributes,
    };

    for (const policy of BUILT_IN_POLICIES) {
      try {
        const result = policy.evaluate(ctx);
        if (result !== null) {
          results.push(result);
        }
      } catch (_err: unknown) {
        results.push({
          policyId: policy.id,
          resourceId: resource.id,
          passed: false,
          severity: 'warning',
          code: POLICY_CODES.ENGINE_ERROR,
          message: `Built-in policy "${policy.id}" threw for resource ${resource.id}`,
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Convert PolicyResult[] to TranslationFinding[]
// ---------------------------------------------------------------------------

function toFindings(results: readonly PolicyResult[]): TranslationFinding[] {
  const findings: TranslationFinding[] = [];
  for (const r of results) {
    if (!r.passed) {
      findings.push(createPolicyFinding(r.resourceId, r.severity, r.code as PolicyCode, r.message, r.detail));
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Summarise
// ---------------------------------------------------------------------------

function summarise(results: readonly PolicyResult[]) {
  let passed = 0;
  let failed = 0;
  let errors = 0;

  for (const r of results) {
    if (r.code === POLICY_CODES.ENGINE_ERROR || r.code === POLICY_CODES.OPA_ERROR) {
      errors++;
    } else if (r.passed) {
      passed++;
    } else {
      failed++;
    }
  }

  return { total: results.length, passed, failed, errors };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate all policies (built-in + optional OPA) against an IR and manifest.
 *
 * Never throws — errors are captured as ENGINE_ERROR results.
 */
export async function evaluatePolicies(
  ir: CanonicalIR,
  _manifest: TranslationManifest,
  options: PolicyEngineOptions = {},
): Promise<PolicyReport> {
  const allResults: PolicyResult[] = [];

  // --- Built-in policies ---------------------------------------------------
  if (!options.skipBuiltIn) {
    try {
      const builtInResults = runBuiltIn(ir);
      allResults.push(...builtInResults);
    } catch (err: unknown) {
      allResults.push({
        policyId: 'engine',
        resourceId: '*',
        passed: false,
        severity: 'warning',
        code: POLICY_CODES.ENGINE_ERROR,
        message: `Built-in evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // --- OPA policies --------------------------------------------------------
  if (options.opa) {
    try {
      const fetchFn = options.fetch ?? globalThis.fetch;
      const opaResults = await evaluateOpa(ir, options.opa, fetchFn);
      allResults.push(...opaResults);
    } catch (err: unknown) {
      allResults.push({
        policyId: 'opa',
        resourceId: '*',
        passed: false,
        severity: 'warning',
        code: POLICY_CODES.ENGINE_ERROR,
        message: `OPA evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // --- Aggregate -----------------------------------------------------------
  const findings = toFindings(allResults);
  const summary = summarise(allResults);
  const passed = summary.failed === 0 && summary.errors === 0;

  return { passed, results: allResults, findings, summary };
}
