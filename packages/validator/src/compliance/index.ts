// ---------------------------------------------------------------------------
// Compliance engine — public API
// ---------------------------------------------------------------------------

export { checkCompliance } from './compliance-engine.js';

// Rules & profiles
export {
  BUILT_IN_RULES,
  CIS_BASIC,
  CIS_ADVANCED,
  encryptionAtRest,
  encryptionInTransit,
  networkOpenIngress,
  networkSshRestricted,
  networkPublicIp,
  loggingEnabled,
  iamAdminPolicy,
  iamMfaRequired,
} from './rules/index.js';

// Finding helpers
export { createComplianceFinding } from './compliance-helpers.js';
export { COMPLIANCE_CODES } from './compliance-codes.js';
export type { ComplianceCode } from './compliance-codes.js';

// Types
export type {
  ComplianceEvalContext,
  ComplianceRuleDefinition,
  ComplianceResult,
  ComplianceReport,
  ComplianceProfile,
} from './types.js';
