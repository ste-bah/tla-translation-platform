import { z } from 'zod';
import {
  AwsServiceFamily,
  CloudProvider,
  GapSeverity,
  GapType,
  MappingType,
  OutputMode,
  ReviewDomain,
  TestStatus,
  TranslationBand,
} from '../constants.js';

/**
 * Schema for a behavioral gap between cloud providers.
 * Identifies a specific divergence in behavior that may require manual attention.
 */
export const BehavioralGapSchema = z.object({
  gap_id: z.string().regex(/^BGR-[A-Z]+-[A-Z0-9]+-\d{3}$/),
  gap_type: GapType,
  description: z.string().min(1),
  severity: GapSeverity,
  affected_targets: z.array(CloudProvider).min(1),
  workaround: z.string().nullable(),
  requires_manual_review: z.boolean(),
}).strict();

export type BehavioralGap = z.infer<typeof BehavioralGapSchema>;

/**
 * Schema for a single registry entry describing an AWS service mapping.
 * Each entry defines how an AWS service translates to Azure/GCP equivalents.
 */
export const RegistryEntrySchema = z.object({
  registry_entry_id: z.string().regex(/^SER-[A-Z]+-[A-Z0-9]+-\d{3}$/),
  aws_service: z.string().min(1),
  aws_family: AwsServiceFamily,
  azure_targets: z.array(z.string()),
  gcp_targets: z.array(z.string()),
  mapping_type: MappingType,
  output_mode: OutputMode,
  band: TranslationBand,
  confidence: z.number().min(0).max(1),
  portable_provider_candidate: z.boolean(),
  behavioral_gaps: z.array(BehavioralGapSchema),
  manual_review_required: z.boolean(),
  review_domains: z.array(ReviewDomain),
  test_status: TestStatus,
  owner: z.string().min(1),
  registry_version: z.string().regex(/^\d{4}\.\d{2}\.\d{2}$/),
  last_updated: z.string().datetime(),
  related_requirements: z.array(z.string().regex(/^REQ-[A-Z]+-\d{3}$/)),
  related_edge_cases: z.array(z.string().regex(/^EC-\d{3}$/)),
}).strict();

export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;
