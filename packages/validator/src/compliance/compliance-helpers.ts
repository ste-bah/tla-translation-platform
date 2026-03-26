// ---------------------------------------------------------------------------
// Compliance finding factory
// ---------------------------------------------------------------------------

import type { FindingSeverity, TranslationFinding } from '@tla/shared';
import type { ComplianceCode } from './compliance-codes.js';

/**
 * Create a TranslationFinding with a compliance code.
 */
export function createComplianceFinding(
  resourceId: string,
  severity: FindingSeverity,
  code: ComplianceCode,
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
