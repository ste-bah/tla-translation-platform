// ---------------------------------------------------------------------------
// Policy finding codes
// ---------------------------------------------------------------------------

export const POLICY_CODES = {
  ENCRYPTION_REQUIRED: 'POLICY_ENCRYPTION_REQUIRED',
  INGRESS_UNRESTRICTED: 'POLICY_INGRESS_UNRESTRICTED',
  PUBLIC_STORAGE_BLOCKED: 'POLICY_PUBLIC_STORAGE_BLOCKED',
  ENCRYPTION_AT_REST: 'POLICY_ENCRYPTION_AT_REST',
  OPA_VIOLATION: 'POLICY_OPA_VIOLATION',
  OPA_ERROR: 'POLICY_OPA_ERROR',
  ENGINE_ERROR: 'POLICY_ENGINE_ERROR',
} as const;

export type PolicyCode = (typeof POLICY_CODES)[keyof typeof POLICY_CODES];
