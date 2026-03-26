// ---------------------------------------------------------------------------
// Built-in compliance rules — barrel + profiles
// ---------------------------------------------------------------------------

import type { ComplianceRuleDefinition, ComplianceProfile } from '../types.js';

import { encryptionAtRest } from './encryption-at-rest.js';
import { encryptionInTransit } from './encryption-in-transit.js';
import { networkOpenIngress } from './network-open-ingress.js';
import { networkSshRestricted } from './network-ssh-restricted.js';
import { networkPublicIp } from './network-public-ip.js';
import { loggingEnabled } from './logging-enabled.js';
import { iamAdminPolicy } from './iam-admin-policy.js';
import { iamMfaRequired } from './iam-mfa-required.js';

// ---------------------------------------------------------------------------
// All built-in rules
// ---------------------------------------------------------------------------

export const BUILT_IN_RULES: readonly ComplianceRuleDefinition[] = [
  encryptionAtRest,
  encryptionInTransit,
  networkOpenIngress,
  networkSshRestricted,
  networkPublicIp,
  loggingEnabled,
  iamAdminPolicy,
  iamMfaRequired,
];

// ---------------------------------------------------------------------------
// CIS Basic profile — essential security checks
// ---------------------------------------------------------------------------

const CIS_BASIC_RULES: readonly ComplianceRuleDefinition[] = [
  encryptionAtRest,
  encryptionInTransit,
  networkOpenIngress,
  networkSshRestricted,
  networkPublicIp,
];

export const CIS_BASIC: ComplianceProfile = {
  name: 'cis-basic',
  description: 'CIS Basic — encryption, network ingress, public IP controls',
  rules: CIS_BASIC_RULES,
};

// ---------------------------------------------------------------------------
// CIS Advanced profile — all rules
// ---------------------------------------------------------------------------

export const CIS_ADVANCED: ComplianceProfile = {
  name: 'cis-advanced',
  description: 'CIS Advanced — all compliance rules including logging and IAM',
  rules: BUILT_IN_RULES,
};

// Re-export individual rules for direct usage
export {
  encryptionAtRest,
  encryptionInTransit,
  networkOpenIngress,
  networkSshRestricted,
  networkPublicIp,
  loggingEnabled,
  iamAdminPolicy,
  iamMfaRequired,
};
