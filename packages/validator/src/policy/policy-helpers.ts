// ---------------------------------------------------------------------------
// Policy finding factory
// ---------------------------------------------------------------------------

import type { FindingSeverity, TranslationFinding } from '@tla/shared';
import type { PolicyCode } from './policy-codes.js';

/**
 * Create a TranslationFinding with a policy code.
 */
export function createPolicyFinding(
  resourceId: string,
  severity: FindingSeverity,
  code: PolicyCode,
  message: string,
  detail?: string,
): TranslationFinding {
  const finding: TranslationFinding = {
    resourceId,
    severity,
    code,
    message,
  };
  if (detail !== undefined) {
    finding.detail = detail;
  }
  return finding;
}
