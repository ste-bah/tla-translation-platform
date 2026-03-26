import { z } from 'zod';

/**
 * Type of mapping between source and target cloud constructs.
 */
export const MappingType = z.enum([
  'direct',
  'parametric',
  'compound',
  'structural',
  'none',
]);
export type MappingType = z.infer<typeof MappingType>;

/**
 * Translation confidence band.
 * P1 = highest confidence, M1 = manual-only.
 */
export const TranslationBand = z.enum(['P1', 'P2', 'N1', 'M1']);
export type TranslationBand = z.infer<typeof TranslationBand>;

/**
 * Output mode for translated constructs.
 */
export const OutputMode = z.enum([
  'portable',
  'native_emit_only',
  'advisory_manual',
]);
export type OutputMode = z.infer<typeof OutputMode>;

/**
 * AWS service family classification.
 */
export const AwsServiceFamily = z.enum([
  'compute',
  'storage',
  'database',
  'networking',
  'security',
  'serverless',
  'messaging',
  'observability',
  'containers',
  'identity',
]);
export type AwsServiceFamily = z.infer<typeof AwsServiceFamily>;

/**
 * Type of behavioral gap between cloud providers.
 */
export const GapType = z.enum([
  'feature',
  'topology',
  'policy',
  'runtime',
  'data_model',
]);
export type GapType = z.infer<typeof GapType>;

/**
 * Severity level of a behavioral gap.
 */
export const GapSeverity = z.enum([
  'blocker',
  'major',
  'minor',
  'informational',
]);
export type GapSeverity = z.infer<typeof GapSeverity>;

/**
 * Domain requiring manual review.
 */
export const ReviewDomain = z.enum([
  'networking',
  'security',
  'identity',
  'data',
  'compliance',
]);
export type ReviewDomain = z.infer<typeof ReviewDomain>;

/**
 * Testing status of a registry entry.
 */
export const TestStatus = z.enum([
  'untested',
  'unit_tested',
  'integration_validated',
  'e2e_validated',
]);
export type TestStatus = z.infer<typeof TestStatus>;

/**
 * Supported cloud providers.
 */
export const CloudProvider = z.enum(['aws', 'azure', 'gcp']);
export type CloudProvider = z.infer<typeof CloudProvider>;
