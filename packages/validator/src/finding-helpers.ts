import type { TranslationFinding, FindingSeverity } from '@tla/shared';

// ---------------------------------------------------------------------------
// Finding codes used by the equivalence checker
// ---------------------------------------------------------------------------

export const FINDING_CODES = {
  EQUIV_PRESENCE_MISSING: 'EQUIV_PRESENCE_MISSING',
  EQUIV_PRESENCE_ADVISORY: 'EQUIV_PRESENCE_ADVISORY',
  EQUIV_PRESENCE_BLOCKED: 'EQUIV_PRESENCE_BLOCKED',
  EQUIV_ATTRIBUTE_GAP: 'EQUIV_ATTRIBUTE_GAP',
  EQUIV_ATTRIBUTE_EXTRA: 'EQUIV_ATTRIBUTE_EXTRA',
  EQUIV_INTENT_MISSING: 'EQUIV_INTENT_MISSING',
  EQUIV_INTENT_PARTIAL: 'EQUIV_INTENT_PARTIAL',
  EQUIV_REFERENCE_BROKEN: 'EQUIV_REFERENCE_BROKEN',
  EQUIV_REFERENCE_DANGLING: 'EQUIV_REFERENCE_DANGLING',
  EQUIV_ERROR: 'EQUIV_ERROR',
} as const;

export type FindingCode = (typeof FINDING_CODES)[keyof typeof FINDING_CODES];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a TranslationFinding with an equivalence code.
 */
export function createEquivalenceFinding(
  resourceId: string,
  severity: FindingSeverity,
  code: FindingCode,
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
