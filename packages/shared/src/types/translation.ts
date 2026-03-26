import { z } from 'zod';
import { CloudProvider, MappingType } from '../constants.js';
import { TranslationStatus } from './ir.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Severity of a translation finding.
 */
export const FindingSeverity = z.enum(['blocker', 'warning', 'info']);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

/**
 * Status of an individual translation plan item.
 */
export const TranslationItemStatus = z.enum([
  'translated',
  'expanded',
  'partial',
  'blocked',
  'advisory',
]);
export type TranslationItemStatus = z.infer<typeof TranslationItemStatus>;

// ---------------------------------------------------------------------------
// Core translation schemas
// ---------------------------------------------------------------------------

/**
 * Records the provenance of a single translated resource.
 */
export const TraceabilityRecordSchema = z.object({
  sourceId: z.string().min(1),
  sourceType: z.string().min(1),
  registryEntryId: z.string().nullable().default(null),
  mappingType: MappingType,
  confidence: z.number().min(0).max(1),
  engineUsed: z.string().min(1),
});
export type TraceabilityRecord = z.infer<typeof TraceabilityRecordSchema>;

/**
 * A single resource produced by the translation engine.
 */
export const TranslatedResourceSchema = z.object({
  targetType: z.string().min(1),
  targetName: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()),
  sourceId: z.string().min(1),
  traceability: TraceabilityRecordSchema,
});
export type TranslatedResource = z.infer<typeof TranslatedResourceSchema>;

/**
 * A finding (warning, blocker, info) produced during translation.
 */
export const TranslationFindingSchema = z.object({
  resourceId: z.string().min(1),
  severity: FindingSeverity,
  code: z.string().min(1),
  message: z.string().min(1),
  detail: z.string().optional(),
});
export type TranslationFinding = z.infer<typeof TranslationFindingSchema>;

// ---------------------------------------------------------------------------
// Translation plan
// ---------------------------------------------------------------------------

/**
 * A single item in the translation plan.
 */
export const TranslationPlanItemSchema = z.object({
  resourceId: z.string().min(1),
  registryEntryId: z.string().nullable().default(null),
  mappingType: MappingType,
  order: z.number().int().nonnegative(),
  groupId: z.string().nullable().default(null),
  status: TranslationItemStatus,
  blockerReason: z.string().nullable().default(null),
});
export type TranslationPlanItem = z.infer<typeof TranslationPlanItemSchema>;

/**
 * The ordered translation plan for an IR.
 */
export const TranslationPlanSchema = z.object({
  items: z.array(TranslationPlanItemSchema),
  blockedCount: z.number().int().nonnegative(),
  groupCount: z.number().int().nonnegative(),
});
export type TranslationPlan = z.infer<typeof TranslationPlanSchema>;

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/**
 * A single entry in the translation manifest.
 */
export const ManifestEntrySchema = z.object({
  sourceId: z.string().min(1),
  sourceType: z.string().min(1),
  status: TranslationStatus,
  targetResources: z.array(TranslatedResourceSchema),
  confidence: z.number().min(0).max(1),
  findings: z.array(TranslationFindingSchema),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

/**
 * Full translation manifest attached to every result.
 */
export const TranslationManifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be semver'),
  registryVersion: z.string().min(1),
  target: CloudProvider,
  counts: z.object({
    total: z.number().int().nonnegative(),
    translated: z.number().int().nonnegative(),
    expanded: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    advisory: z.number().int().nonnegative(),
  }),
  entries: z.array(ManifestEntrySchema),
  findings: z.array(TranslationFindingSchema),
  confidenceOverall: z.number().min(0).max(1),
});
export type TranslationManifest = z.infer<typeof TranslationManifestSchema>;

// ---------------------------------------------------------------------------
// Stats, options, result
// ---------------------------------------------------------------------------

/**
 * Translation statistics.
 */
export const TranslationStatsSchema = z.object({
  totalResources: z.number().int().nonnegative(),
  translated: z.number().int().nonnegative(),
  expanded: z.number().int().nonnegative(),
  partial: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  advisory: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
});
export type TranslationStats = z.infer<typeof TranslationStatsSchema>;

/**
 * Options passed to the translation compiler.
 */
export const CompilerOptionsSchema = z.object({
  targetProvider: CloudProvider,
  registryVersion: z.string().min(1),
  emitComments: z.boolean().default(true),
  sortKeys: z.boolean().default(true),
});
export type CompilerOptions = z.infer<typeof CompilerOptionsSchema>;

/**
 * Complete result of a translation run.
 */
export const TranslationResultSchema = z.object({
  target: CloudProvider,
  resources: z.array(TranslatedResourceSchema),
  files: z.record(z.string(), z.string()),
  manifest: TranslationManifestSchema,
  findings: z.array(TranslationFindingSchema),
  stats: TranslationStatsSchema,
});
export type TranslationResult = z.infer<typeof TranslationResultSchema>;
