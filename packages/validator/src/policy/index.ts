// ---------------------------------------------------------------------------
// Policy engine — public API
// ---------------------------------------------------------------------------

export { evaluatePolicies } from './policy-engine.js';

// OPA client
export { evaluateOpa } from './opa-client.js';

// Built-in policies
export { BUILT_IN_POLICIES } from './built-in/index.js';

// Finding helpers
export { createPolicyFinding } from './policy-helpers.js';
export { POLICY_CODES } from './policy-codes.js';
export type { PolicyCode } from './policy-codes.js';

// Types
export type {
  PolicyResult,
  PolicyReport,
  PolicyDefinition,
  OpaClientConfig,
  PolicyEngineOptions,
  PolicyEvalContext,
} from './types.js';
