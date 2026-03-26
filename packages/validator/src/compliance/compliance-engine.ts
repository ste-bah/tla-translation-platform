// ---------------------------------------------------------------------------
// Compliance engine — evaluates rules against a TranslationManifest
// ---------------------------------------------------------------------------

import type { TranslationFinding, TranslationManifest } from '@tla/shared';
import type {
  ComplianceEvalContext,
  ComplianceProfile,
  ComplianceReport,
  ComplianceResult,
} from './types.js';
import type { ComplianceCode } from './compliance-codes.js';
import { createComplianceFinding } from './compliance-helpers.js';
import { COMPLIANCE_CODES } from './compliance-codes.js';

// ---------------------------------------------------------------------------
// Run all rules in a profile against all translated resources in the manifest
// ---------------------------------------------------------------------------

function runRules(manifest: TranslationManifest, profile: ComplianceProfile): ComplianceResult[] {
  const results: ComplianceResult[] = [];

  for (const entry of manifest.entries) {
    for (const resource of entry.targetResources) {
      const ctx: ComplianceEvalContext = {
        resource,
        targetType: resource.targetType,
        targetName: resource.targetName,
        attributes: resource.attributes,
      };

      for (const rule of profile.rules) {
        try {
          const result = rule.evaluate(ctx);
          if (result !== null) {
            results.push(result);
          }
        } catch (_err: unknown) {
          // Never throw — capture as engine error
          results.push({
            ruleId: rule.id,
            resourceId: resource.sourceId,
            targetType: resource.targetType,
            passed: false,
            severity: 'warning',
            code: COMPLIANCE_CODES.ENGINE_ERROR,
            message: `Compliance rule "${rule.id}" threw for resource ${resource.sourceId} (${resource.targetType})`,
          });
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Convert ComplianceResult[] to TranslationFinding[]
// ---------------------------------------------------------------------------

function toFindings(results: readonly ComplianceResult[]): TranslationFinding[] {
  const findings: TranslationFinding[] = [];
  for (const r of results) {
    if (!r.passed) {
      findings.push(
        createComplianceFinding(r.resourceId, r.severity, r.code as ComplianceCode, r.message, r.detail),
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Compute score
// ---------------------------------------------------------------------------

function computeScore(results: readonly ComplianceResult[]): {
  score: number;
  applicable: number;
  passed: number;
  failed: number;
} {
  let passed = 0;
  let failed = 0;

  for (const r of results) {
    if (r.code === COMPLIANCE_CODES.ENGINE_ERROR) {
      failed++;
    } else if (r.passed) {
      passed++;
    } else {
      failed++;
    }
  }

  const applicable = passed + failed;
  const score = applicable === 0 ? 100 : Math.round((passed / applicable) * 100);

  return { score, applicable, passed, failed };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate compliance rules from a profile against a translation manifest.
 *
 * Never throws — per-rule errors are captured as ENGINE_ERROR results.
 */
export function checkCompliance(
  manifest: TranslationManifest,
  profile: ComplianceProfile,
): ComplianceReport {
  try {
    const results = runRules(manifest, profile);
    const findings = toFindings(results);
    const { score, applicable, passed, failed } = computeScore(results);

    return {
      score,
      passed: failed === 0,
      results,
      findings,
      summary: {
        total: results.length,
        applicable,
        passed,
        failed,
      },
    };
  } catch (_err: unknown) {
    // Never-throw: return safe empty report on unexpected errors
    return {
      score: 0,
      passed: false,
      results: [],
      findings: [],
      summary: { total: 0, applicable: 0, passed: 0, failed: 0 },
    };
  }
}
