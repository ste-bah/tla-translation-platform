import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Classification of semantic equivalence between source and translated resources.
 */
export const EquivalenceClassification = z.enum([
  'equivalent',
  'partial',
  'degraded',
  'missing',
]);
export type EquivalenceClassification = z.infer<typeof EquivalenceClassification>;

// ---------------------------------------------------------------------------
// Dimension result
// ---------------------------------------------------------------------------

/**
 * Result of a single evaluation dimension (presence, attributes, intents, references).
 */
export const DimensionResultSchema = z.object({
  dimension: z.enum(['presence', 'attributes', 'intents', 'references']),
  score: z.number().min(0).max(1),
  maxScore: z.number().min(0).max(1),
  details: z.array(z.string()),
});
export type DimensionResult = z.infer<typeof DimensionResultSchema>;

// ---------------------------------------------------------------------------
// Resource equivalence record
// ---------------------------------------------------------------------------

/**
 * Equivalence evaluation for a single source resource.
 */
export const ResourceEquivalenceRecordSchema = z.object({
  resourceId: z.string().min(1),
  sourceType: z.string().min(1),
  classification: EquivalenceClassification,
  overallScore: z.number().min(0).max(1),
  dimensions: z.object({
    presence: DimensionResultSchema.optional(),
    attributes: DimensionResultSchema.optional(),
    intents: DimensionResultSchema.optional(),
    references: DimensionResultSchema.optional(),
  }),
  preClassification: z.enum(['advisory', 'blocked']).nullable().default(null),
});
export type ResourceEquivalenceRecord = z.infer<typeof ResourceEquivalenceRecordSchema>;

// ---------------------------------------------------------------------------
// Options & thresholds
// ---------------------------------------------------------------------------

/**
 * Weight configuration for the four evaluation dimensions.
 */
export const DimensionWeightsSchema = z.object({
  presence: z.number().min(0).max(1).default(0.30),
  attributes: z.number().min(0).max(1).default(0.30),
  intents: z.number().min(0).max(1).default(0.25),
  references: z.number().min(0).max(1).default(0.15),
});
export type DimensionWeights = z.infer<typeof DimensionWeightsSchema>;

/**
 * Thresholds for classification buckets.
 */
export const ClassificationThresholdsSchema = z.object({
  equivalent: z.number().min(0).max(1).default(0.95),
  partial: z.number().min(0).max(1).default(0.70),
  degraded: z.number().min(0).max(1).default(0.30),
});
export type ClassificationThresholds = z.infer<typeof ClassificationThresholdsSchema>;

/**
 * Options for the equivalence checker.
 */
export const EquivalenceOptionsSchema = z.object({
  weights: DimensionWeightsSchema.optional(),
  thresholds: ClassificationThresholdsSchema.optional(),
}).optional();
export type EquivalenceOptions = z.infer<typeof EquivalenceOptionsSchema>;

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * Full equivalence report for an IR ↔ manifest comparison.
 */
export const EquivalenceReportSchema = z.object({
  overallScore: z.number().min(0).max(1),
  classification: EquivalenceClassification,
  records: z.array(ResourceEquivalenceRecordSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    equivalent: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    degraded: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
  }),
});
export type EquivalenceReport = z.infer<typeof EquivalenceReportSchema>;
