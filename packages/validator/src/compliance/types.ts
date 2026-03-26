// ---------------------------------------------------------------------------
// Compliance engine types
// ---------------------------------------------------------------------------

import type { FindingSeverity, TranslationFinding, TranslatedResource } from '@tla/shared';

// ---------------------------------------------------------------------------
// Evaluation context (passed to each compliance rule)
// ---------------------------------------------------------------------------

export interface ComplianceEvalContext {
  /** The translated resource under evaluation. */
  readonly resource: TranslatedResource;
  /** Target resource type (e.g. "azurerm_storage_account", "google_sql_database_instance"). */
  readonly targetType: string;
  /** Target resource name. */
  readonly targetName: string;
  /** Translated attributes map. */
  readonly attributes: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Individual compliance result
// ---------------------------------------------------------------------------

export interface ComplianceResult {
  readonly ruleId: string;
  readonly resourceId: string;
  readonly targetType: string;
  readonly passed: boolean;
  readonly severity: FindingSeverity;
  readonly code: string;
  readonly message: string;
  readonly detail?: string;
}

// ---------------------------------------------------------------------------
// Compliance rule definition
// ---------------------------------------------------------------------------

export interface ComplianceRuleDefinition {
  readonly id: string;
  readonly description: string;
  readonly severity: FindingSeverity;
  /** Evaluate this rule against a single translated resource. Return null to skip. */
  evaluate(ctx: ComplianceEvalContext): ComplianceResult | null;
}

// ---------------------------------------------------------------------------
// Compliance profile (subset of rules to apply)
// ---------------------------------------------------------------------------

export interface ComplianceProfile {
  readonly name: string;
  readonly description: string;
  readonly rules: readonly ComplianceRuleDefinition[];
}

// ---------------------------------------------------------------------------
// Aggregate compliance report
// ---------------------------------------------------------------------------

export interface ComplianceReport {
  readonly score: number;
  readonly passed: boolean;
  readonly results: readonly ComplianceResult[];
  readonly findings: readonly TranslationFinding[];
  readonly summary: {
    readonly total: number;
    readonly applicable: number;
    readonly passed: number;
    readonly failed: number;
  };
}
