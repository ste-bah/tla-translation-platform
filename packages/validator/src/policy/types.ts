// ---------------------------------------------------------------------------
// Policy engine types
// ---------------------------------------------------------------------------

import type { FindingSeverity, TranslationFinding } from '@tla/shared';

// ---------------------------------------------------------------------------
// OPA client configuration
// ---------------------------------------------------------------------------

export interface OpaClientConfig {
  /** Base URL of the OPA server (e.g. http://localhost:8181). */
  readonly baseUrl: string;
  /** OPA data path to query (e.g. "tla/deny"). */
  readonly path: string;
  /** Request timeout in milliseconds. Defaults to 5000. */
  readonly timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Policy engine options
// ---------------------------------------------------------------------------

export interface PolicyEngineOptions {
  /** When true, skip built-in policy evaluation. */
  readonly skipBuiltIn?: boolean;
  /** OPA configuration. When provided, OPA policies are evaluated. */
  readonly opa?: OpaClientConfig;
  /** Injectable fetch for testing. Defaults to globalThis.fetch. */
  readonly fetch?: typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// Policy evaluation context (passed to built-in checks)
// ---------------------------------------------------------------------------

export interface PolicyEvalContext {
  readonly resourceId: string;
  readonly sourceType: string;
  readonly attributes: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Individual policy result
// ---------------------------------------------------------------------------

export interface PolicyResult {
  readonly policyId: string;
  readonly resourceId: string;
  readonly passed: boolean;
  readonly severity: FindingSeverity;
  readonly code: string;
  readonly message: string;
  readonly detail?: string;
}

// ---------------------------------------------------------------------------
// Aggregate policy report
// ---------------------------------------------------------------------------

export interface PolicyReport {
  readonly passed: boolean;
  readonly results: readonly PolicyResult[];
  readonly findings: readonly TranslationFinding[];
  readonly summary: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly errors: number;
  };
}

// ---------------------------------------------------------------------------
// Built-in policy definition
// ---------------------------------------------------------------------------

export interface PolicyDefinition {
  readonly id: string;
  readonly description: string;
  readonly severity: FindingSeverity;
  /** Evaluate this policy against a single resource. Return null to skip. */
  evaluate(ctx: PolicyEvalContext): PolicyResult | null;
}
