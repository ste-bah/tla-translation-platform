import { z } from 'zod';
import { CloudProvider, MappingType } from '../constants.js';
import { TranslationStatus } from './ir.js';

export const FindingSeverity = z.enum(['blocker', 'warning', 'info']);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export const TranslationItemStatus = z.enum([
  'translated',
  'expanded',
  'partial',
  'blocked',
  'advisory',
]);
export type TranslationItemStatus = z.infer<typeof TranslationItemStatus>;

export const TraceabilityRecordSchema = z.object({
  sourceId: z.string().min(1),
  sourceType: z.string().min(1),
  registryEntryId: z.string().nullable().default(null),
  mappingType: MappingType,
  confidence: z.number().min(0).max(1),
  engineUsed: z.string().min(1),
  translationPath: z.enum(['specialized', 'generic-fallback', 'advisory']).optional().default('specialized'),
});
export type TraceabilityRecord = z.infer<typeof TraceabilityRecordSchema>;

export const TranslatedResourceSchema = z.object({
  targetType: z.string().min(1),
  targetName: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()),
  sourceId: z.string().min(1),
  traceability: TraceabilityRecordSchema,
});
export type TranslatedResource = z.infer<typeof TranslatedResourceSchema>;

export const TranslationFindingSchema = z.object({
  resourceId: z.string().min(1),
  severity: FindingSeverity,
  code: z.string().min(1),
  message: z.string().min(1),
  detail: z.string().optional(),
});
export type TranslationFinding = z.infer<typeof TranslationFindingSchema>;

export const TranslationContractSchema = z.object({
  sourceId: z.string().min(1),
  targetIds: z.array(z.string().min(1)).default([]),
  preserved: z.array(z.string().min(1)).default([]),
  transformed: z.array(z.string().min(1)).default([]),
  degraded: z.array(z.string().min(1)).default([]),
  blockers: z.array(z.string().min(1)).default([]),
  reviewRequired: z.array(z.string().min(1)).default([]),
  confidenceFactors: z.array(z.string().min(1)).default([]),
});
export type TranslationContract = z.infer<typeof TranslationContractSchema>;

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

export const TranslationPlanSchema = z.object({
  items: z.array(TranslationPlanItemSchema),
  blockedCount: z.number().int().nonnegative(),
  groupCount: z.number().int().nonnegative(),
});
export type TranslationPlan = z.infer<typeof TranslationPlanSchema>;

export const ManifestEntrySchema = z.object({
  sourceId: z.string().min(1),
  sourceType: z.string().min(1),
  status: TranslationStatus,
  targetResources: z.array(TranslatedResourceSchema),
  confidence: z.number().min(0).max(1),
  findings: z.array(TranslationFindingSchema),
  contract: TranslationContractSchema.nullable().optional().default(null),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

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

export const CompilerOptionsSchema = z.object({
  targetProvider: CloudProvider,
  registryVersion: z.string().min(1),
  emitComments: z.boolean().default(true),
  sortKeys: z.boolean().default(true),
});
export type CompilerOptions = z.infer<typeof CompilerOptionsSchema>;

export const TranslationResultSchema = z.object({
  target: CloudProvider,
  resources: z.array(TranslatedResourceSchema),
  files: z.record(z.string(), z.string()),
  manifest: TranslationManifestSchema,
  findings: z.array(TranslationFindingSchema),
  stats: TranslationStatsSchema,
});
export type TranslationResult = z.infer<typeof TranslationResultSchema>;
