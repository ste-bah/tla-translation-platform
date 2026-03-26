// ---------------------------------------------------------------------------
// Equivalence checker — public API
// ---------------------------------------------------------------------------

export { checkEquivalence } from './equivalence-checker.js';

// Evaluators (for advanced / direct usage)
export { evaluatePresence } from './presence-evaluator.js';
export type { PresenceEvaluation } from './presence-evaluator.js';
export { evaluateAttributes } from './attribute-evaluator.js';
export { evaluateIntents } from './intent-matcher.js';
export { evaluateReferences } from './reference-evaluator.js';

// Scoring utilities
export { computeOverallScore, classify, DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } from './scoring.js';

// Finding helpers
export { createEquivalenceFinding, FINDING_CODES } from './finding-helpers.js';
export type { FindingCode } from './finding-helpers.js';

// Policy engine
export { evaluatePolicies, evaluateOpa, BUILT_IN_POLICIES, createPolicyFinding, POLICY_CODES } from './policy/index.js';
export type {
  PolicyResult,
  PolicyReport,
  PolicyDefinition,
  OpaClientConfig,
  PolicyEngineOptions,
  PolicyEvalContext,
  PolicyCode,
} from './policy/index.js';

// Cost-delta estimator (TASK-VAL-004)
export { estimateCostDelta, collectStaleCaveats, STANDARD_CAVEATS } from './cost/cost-estimator.js';
export type {
  CostLineItem,
  CostEstimate,
  ResourceCostComparison,
  CostDeltaReport,
} from './cost/cost-estimator.js';

// Confidence scoring system (TASK-VAL-006)
export {
  scoreConfidence,
  computePolicyFactor,
  classificationToSemanticStatus,
  scoreToBand,
} from './confidence/confidence-scorer.js';
export type {
  ResourceValidationStatus,
  ResourceSemanticStatus,
  ResourceConfidenceInput,
  ConfidenceInputs,
  ResourceConfidence,
  ResourceConfidenceFactors,
  ConfidenceFactors,
  ConfidenceBand,
  ConfidenceReport,
} from './confidence/confidence-scorer.js';

export { generateConfidenceReport } from './confidence/confidence-report-generator.js';
export type { GenerateReportOptions } from './confidence/confidence-report-generator.js';

// Translation Report Generator (TASK-GAP-005)
export { generateTranslationReport } from './report/index.js';
export type { ReportInputs } from './report/index.js';

// Drift detection (TASK-GAP-007)
export { detectDrift, saveSnapshot, loadSnapshot } from './drift/index.js';
export type {
  DriftEntry,
  AttributeChange,
  DriftModification,
  DriftSummary,
  DriftReport,
} from './drift/index.js';

// Compliance engine (TASK-VAL-005)
export {
  checkCompliance,
  BUILT_IN_RULES,
  CIS_BASIC,
  CIS_ADVANCED,
  createComplianceFinding,
  COMPLIANCE_CODES,
  encryptionAtRest,
  encryptionInTransit,
  networkOpenIngress,
  networkSshRestricted,
  networkPublicIp,
  loggingEnabled,
  iamAdminPolicy,
  iamMfaRequired,
} from './compliance/index.js';
export type {
  ComplianceEvalContext,
  ComplianceRuleDefinition,
  ComplianceResult,
  ComplianceReport,
  ComplianceProfile,
  ComplianceCode,
} from './compliance/index.js';
