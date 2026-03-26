// ---------------------------------------------------------------------------
// Confidence Scoring System  (TASK-VAL-006)
//
// Computes confidence scores at resource, service-family, and stack level.
// Formula (per resource):
//   score = registry_confidence * validation_factor * semantic_factor * policy_factor
//
// Review-critical domains (security, identity, networking) are weighted 1.5x
// at stack level.
//
// Escalation threshold: any resource < 0.60 → escalationRequired = true.
// ---------------------------------------------------------------------------

import type { AwsServiceFamily, EquivalenceClassification } from '@tla/shared';
import type { PolicyReport } from '../policy/index.js';
import type { ComplianceReport } from '../compliance/index.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Validation status for a single resource (derived from HCL validation output).
 * - 'clean'    → validation_factor = 1.0
 * - 'warnings' → validation_factor = 0.5
 * - 'errors'   → validation_factor = 0.0
 */
export type ResourceValidationStatus = 'clean' | 'warnings' | 'errors';

/**
 * Semantic equivalence status for a single resource.
 * Maps from EquivalenceClassification:
 *   equivalent → 'preserved'  (factor 1.0)
 *   partial    → 'transformed' (factor 0.8)  -- intentional alias: partial = transformed
 *   degraded   → 'partial'    (factor 0.5)
 *   missing    → 'missing'    (factor 0.2)
 */
export type ResourceSemanticStatus = 'preserved' | 'transformed' | 'partial' | 'missing';

/**
 * Per-resource input data required for confidence scoring.
 */
export interface ResourceConfidenceInput {
  /** Unique resource identifier (matches IR resource id). */
  readonly resourceId: string;
  /** AWS service family for grouping. */
  readonly serviceFamily: AwsServiceFamily;
  /** Base confidence from the registry entry (0.0–1.0). 0.5 if unknown. */
  readonly registryConfidence: number;
  /** Validation status derived from HCL validation findings. */
  readonly validationStatus: ResourceValidationStatus;
  /** Semantic status derived from equivalence classification. */
  readonly semanticStatus: ResourceSemanticStatus;
  /** Number of policy warnings (failed policy results with severity 'warning'). */
  readonly policyWarnings: number;
  /** Number of policy failures (failed policy results with severity 'blocker'). */
  readonly policyFailures: number;
  /**
   * Whether this resource belongs to a review-critical domain
   * (security, identity, or networking).
   */
  readonly reviewCritical: boolean;
}

/**
 * Full set of inputs consumed by scoreConfidence().
 */
export interface ConfidenceInputs {
  readonly resources: readonly ResourceConfidenceInput[];
  /** Optional: policy report used only to surface escalation context. */
  readonly policyReport?: PolicyReport;
  /** Optional: compliance report used only to surface escalation context. */
  readonly complianceReport?: ComplianceReport;
}

/**
 * Per-resource confidence result.
 */
export interface ResourceConfidence {
  readonly resourceId: string;
  readonly score: number;
  readonly band: ConfidenceBand;
  readonly serviceFamily: AwsServiceFamily;
  readonly reviewCritical: boolean;
  /** Breakdown of the four multiplicative factors. */
  readonly factors: ResourceConfidenceFactors;
}

/**
 * Factor breakdown for a single resource (for transparency / auditability).
 */
export interface ResourceConfidenceFactors {
  readonly registryConfidence: number;
  readonly validationFactor: number;
  readonly semanticFactor: number;
  readonly policyFactor: number;
}

/** Stack-level factor summary (weighted averages). */
export interface ConfidenceFactors {
  readonly avgRegistryConfidence: number;
  readonly avgValidationFactor: number;
  readonly avgSemanticFactor: number;
  readonly avgPolicyFactor: number;
}

export type ConfidenceBand = 'high' | 'medium' | 'low' | 'very_low';

/**
 * Top-level confidence report produced by scoreConfidence().
 */
export interface ConfidenceReport {
  /** Overall stack confidence score (0.0–1.0). */
  readonly overall: number;
  readonly overallBand: ConfidenceBand;
  /** Per-resource confidence details keyed by resourceId. */
  readonly byResource: Map<string, ResourceConfidence>;
  /** Weighted-average confidence per AWS service family. */
  readonly byFamily: Map<AwsServiceFamily, number>;
  /** True when any resource score is < 0.60 (PRD agent decision boundary). */
  readonly escalationRequired: boolean;
  /** Resource IDs requiring mandatory human review (score < 0.60). */
  readonly reviewRequired: string[];
  /** Stack-level factor summary. */
  readonly factors: ConfidenceFactors;
}

// ---------------------------------------------------------------------------
// Scoring constants
// ---------------------------------------------------------------------------

const VALIDATION_FACTORS: Record<ResourceValidationStatus, number> = {
  clean: 1.0,
  warnings: 0.5,
  errors: 0.0,
};

const SEMANTIC_FACTORS: Record<ResourceSemanticStatus, number> = {
  preserved: 1.0,
  transformed: 0.8,
  partial: 0.5,
  missing: 0.2,
};

/** Weight multiplier applied at stack level for review-critical resources. */
const REVIEW_CRITICAL_WEIGHT = 1.5;

/** Escalation / mandatory-review threshold (PRD Section 17.5). */
const ESCALATION_THRESHOLD = 0.60;

/** Confidence band thresholds. */
const BAND_HIGH = 0.80;
const BAND_MEDIUM = 0.60;
const BAND_LOW = 0.40;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the policy_factor from warning and failure counts.
 *   factor = 0.9^warnings * 0.7^failures
 * Clamped to [0.0, 1.0].
 */
export function computePolicyFactor(warnings: number, failures: number): number {
  const raw = Math.pow(0.9, warnings) * Math.pow(0.7, failures);
  return Math.min(1.0, Math.max(0.0, raw));
}

/**
 * Map an EquivalenceClassification to a ResourceSemanticStatus.
 * Caller convenience; may also be used directly.
 */
export function classificationToSemanticStatus(
  classification: EquivalenceClassification,
): ResourceSemanticStatus {
  switch (classification) {
    case 'equivalent': return 'preserved';
    case 'partial':    return 'transformed';
    case 'degraded':   return 'partial';
    case 'missing':    return 'missing';
  }
}

/**
 * Assign a ConfidenceBand from a numeric score.
 */
export function scoreToBand(score: number): ConfidenceBand {
  if (score >= BAND_HIGH)   return 'high';
  if (score >= BAND_MEDIUM) return 'medium';
  if (score >= BAND_LOW)    return 'low';
  return 'very_low';
}

/**
 * Compute per-resource confidence score.
 * score = registryConfidence * validationFactor * semanticFactor * policyFactor
 */
function scoreResource(input: ResourceConfidenceInput): ResourceConfidence {
  const validationFactor = VALIDATION_FACTORS[input.validationStatus];
  const semanticFactor   = SEMANTIC_FACTORS[input.semanticStatus];
  const policyFactor     = computePolicyFactor(input.policyWarnings, input.policyFailures);

  const score = input.registryConfidence * validationFactor * semanticFactor * policyFactor;
  const clampedScore = Math.min(1.0, Math.max(0.0, score));

  return {
    resourceId: input.resourceId,
    score: clampedScore,
    band: scoreToBand(clampedScore),
    serviceFamily: input.serviceFamily,
    reviewCritical: input.reviewCritical,
    factors: {
      registryConfidence: input.registryConfidence,
      validationFactor,
      semanticFactor,
      policyFactor,
    },
  };
}

/**
 * Compute per-service-family confidence as unweighted average of resource scores.
 */
function computeFamilyScores(
  resourceScores: ResourceConfidence[],
): Map<AwsServiceFamily, number> {
  const familyGroups = new Map<AwsServiceFamily, number[]>();

  for (const rc of resourceScores) {
    const existing = familyGroups.get(rc.serviceFamily) ?? [];
    existing.push(rc.score);
    familyGroups.set(rc.serviceFamily, existing);
  }

  const familyScores = new Map<AwsServiceFamily, number>();
  for (const [family, scores] of familyGroups) {
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    familyScores.set(family, avg);
  }

  return familyScores;
}

/**
 * Compute overall stack confidence with 1.5x weighting for review-critical resources.
 */
function computeStackScore(resourceScores: ResourceConfidence[]): number {
  if (resourceScores.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const rc of resourceScores) {
    const weight = rc.reviewCritical ? REVIEW_CRITICAL_WEIGHT : 1.0;
    weightedSum += rc.score * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * Compute stack-level factor averages (unweighted, for transparency).
 */
function computeStackFactors(resourceScores: ResourceConfidence[]): ConfidenceFactors {
  if (resourceScores.length === 0) {
    return {
      avgRegistryConfidence: 0,
      avgValidationFactor: 0,
      avgSemanticFactor: 0,
      avgPolicyFactor: 0,
    };
  }

  const n = resourceScores.length;
  let totalRegistry = 0;
  let totalValidation = 0;
  let totalSemantic = 0;
  let totalPolicy = 0;

  for (const rc of resourceScores) {
    totalRegistry   += rc.factors.registryConfidence;
    totalValidation += rc.factors.validationFactor;
    totalSemantic   += rc.factors.semanticFactor;
    totalPolicy     += rc.factors.policyFactor;
  }

  return {
    avgRegistryConfidence: totalRegistry / n,
    avgValidationFactor:   totalValidation / n,
    avgSemanticFactor:     totalSemantic / n,
    avgPolicyFactor:       totalPolicy / n,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute confidence scores at resource, service-family, and stack level.
 *
 * Scoring is deterministic: same inputs always produce the same scores.
 * The formula is intentionally transparent — each factor is independently
 * observable in the output.
 *
 * Never throws — returns a zero-score report if inputs are empty/invalid.
 */
export function scoreConfidence(inputs: ConfidenceInputs): ConfidenceReport {
  try {
    const resourceScores: ResourceConfidence[] = inputs.resources.map(scoreResource);

    const byResource = new Map<string, ResourceConfidence>();
    for (const rc of resourceScores) {
      byResource.set(rc.resourceId, rc);
    }

    const byFamily = computeFamilyScores(resourceScores);
    const overall  = computeStackScore(resourceScores);
    const factors  = computeStackFactors(resourceScores);

    const escalationRequired = resourceScores.some(rc => rc.score < ESCALATION_THRESHOLD);
    const reviewRequired = resourceScores
      .filter(rc => rc.score < ESCALATION_THRESHOLD)
      .map(rc => rc.resourceId);

    return {
      overall,
      overallBand: scoreToBand(overall),
      byResource,
      byFamily,
      escalationRequired,
      reviewRequired,
      factors,
    };
  } catch (_err: unknown) {
    // Never-throw: return a fully-degraded report on unexpected errors.
    return {
      overall: 0,
      overallBand: 'very_low',
      byResource: new Map(),
      byFamily: new Map(),
      escalationRequired: true,
      reviewRequired: [],
      factors: {
        avgRegistryConfidence: 0,
        avgValidationFactor: 0,
        avgSemanticFactor: 0,
        avgPolicyFactor: 0,
      },
    };
  }
}
