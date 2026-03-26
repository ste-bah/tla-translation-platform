// ---------------------------------------------------------------------------
// OPA REST client
// ---------------------------------------------------------------------------

import type { CanonicalIR } from '@tla/shared';
import type { OpaClientConfig, PolicyResult } from './types.js';
import { POLICY_CODES } from './policy-codes.js';

const DEFAULT_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// OPA response shape (permissive — we only care about `result`)
// ---------------------------------------------------------------------------

interface OpaResponse {
  result?: OpaViolation[] | Record<string, unknown>;
}

interface OpaViolation {
  msg?: string;
  message?: string;
  severity?: string;
  resource_id?: string;
  resourceId?: string;
}

// ---------------------------------------------------------------------------
// Normalise a single OPA violation into a PolicyResult
// ---------------------------------------------------------------------------

function toResult(v: OpaViolation, fallbackResourceId: string): PolicyResult {
  const resourceId = v.resource_id ?? v.resourceId ?? fallbackResourceId;
  const message = v.msg ?? v.message ?? 'OPA policy violation';
  const severity = v.severity === 'blocker' ? 'blocker' : v.severity === 'info' ? 'info' : 'warning';

  return {
    policyId: 'opa',
    resourceId,
    passed: false,
    severity,
    code: POLICY_CODES.OPA_VIOLATION,
    message,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate an IR against an OPA server.
 *
 * Returns an array of PolicyResult. On network / timeout / parse errors the
 * array contains a single ENGINE_ERROR result — never throws.
 */
export async function evaluateOpa(
  ir: CanonicalIR,
  config: OpaClientConfig,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<PolicyResult[]> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/v1/data/${config.path.replace(/^\/+/, '')}`;
  const timeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: ir }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return [
        {
          policyId: 'opa',
          resourceId: '*',
          passed: false,
          severity: 'warning',
          code: POLICY_CODES.OPA_ERROR,
          message: `OPA returned HTTP ${response.status}`,
        },
      ];
    }

    const body = (await response.json()) as OpaResponse;
    const result = body.result;

    if (Array.isArray(result)) {
      return result.map((v) => toResult(v, '*'));
    }

    // No violations
    return [];
  } catch (err: unknown) {
    const message =
      err instanceof DOMException && err.name === 'AbortError'
        ? `OPA request timed out after ${timeout}ms`
        : `OPA request failed: ${err instanceof Error ? err.message : String(err)}`;

    return [
      {
        policyId: 'opa',
        resourceId: '*',
        passed: false,
        severity: 'warning',
        code: POLICY_CODES.OPA_ERROR,
        message,
      },
    ];
  } finally {
    clearTimeout(timer);
  }
}
