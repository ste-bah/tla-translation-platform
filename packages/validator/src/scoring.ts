import type {
  DimensionResult,
  DimensionWeights,
  ClassificationThresholds,
  EquivalenceClassification,
} from '@tla/shared';

// ---------------------------------------------------------------------------
// Default weights & thresholds
// ---------------------------------------------------------------------------

export const DEFAULT_WEIGHTS: DimensionWeights = {
  presence: 0.30,
  attributes: 0.30,
  intents: 0.25,
  references: 0.15,
};

export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  equivalent: 0.95,
  partial: 0.70,
  degraded: 0.30,
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Compute a weighted overall score from dimension results.
 *
 * Missing dimensions are treated as score 0 with their weight redistributed
 * proportionally among present dimensions. This ensures the total always
 * sums correctly regardless of which evaluators ran.
 */
export function computeOverallScore(
  dimensions: Partial<Record<'presence' | 'attributes' | 'intents' | 'references', DimensionResult>>,
  weights?: Partial<DimensionWeights>,
): number {
  const w: DimensionWeights = { ...DEFAULT_WEIGHTS, ...weights };
  const dimensionKeys = ['presence', 'attributes', 'intents', 'references'] as const;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const key of dimensionKeys) {
    const dim = dimensions[key];
    if (dim) {
      weightedSum += dim.score * w[key];
      totalWeight += w[key];
    }
  }

  if (totalWeight === 0) return 0;
  return weightedSum / totalWeight;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify an overall score into one of the equivalence buckets.
 *
 * - >= equivalent threshold → 'equivalent'
 * - >= partial threshold → 'partial'
 * - >= degraded threshold → 'degraded'
 * - below degraded → 'missing'
 */
export function classify(
  score: number,
  thresholds?: Partial<ClassificationThresholds>,
): EquivalenceClassification {
  const t: ClassificationThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };

  if (score >= t.equivalent) return 'equivalent';
  if (score >= t.partial) return 'partial';
  if (score >= t.degraded) return 'degraded';
  return 'missing';
}
