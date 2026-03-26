import { z } from 'zod';
import { SourceLocationSchema } from './hcl.js';
import { AwsServiceFamily, CloudProvider } from '../constants.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Category of an IR resource, matching AWS service family values.
 */
export const ResourceCategory = AwsServiceFamily;
export type ResourceCategory = z.infer<typeof ResourceCategory>;

/**
 * Translation status of an IR resource through the pipeline.
 */
export const TranslationStatus = z.enum([
  'pending',
  'translated',
  'expanded',
  'partial',
  'blocked',
  'advisory',
]);
export type TranslationStatus = z.infer<typeof TranslationStatus>;

/**
 * Relationship type between two IR resources.
 */
export const RelationshipType = z.enum([
  'contains',
  'references',
  'depends_on',
  'secures',
  'routes_to',
  'stores_in',
]);
export type RelationshipType = z.infer<typeof RelationshipType>;

// ---------------------------------------------------------------------------
// Core IR schemas
// ---------------------------------------------------------------------------

/**
 * Bag of arbitrary key-value attributes carried through translation.
 */
export const IrAttributesSchema = z.record(z.string(), z.unknown());
export type IrAttributes = z.infer<typeof IrAttributesSchema>;

/**
 * A single resource in the Canonical IR.
 */
export const IrResourceSchema = z.object({
  id: z.string().min(1),
  sourceType: z.string().min(1),
  sourceName: z.string().min(1),
  sourceModule: z.string().nullable().default(null),
  category: ResourceCategory,
  attributes: IrAttributesSchema,
  sourceAttributes: IrAttributesSchema,
  registryEntryId: z.string().nullable().default(null),
  translationStatus: TranslationStatus.default('pending'),
  confidence: z.number().min(0).max(1).default(0),
  tags: z.record(z.string(), z.string()).default({}),
  sourceLocation: SourceLocationSchema,
});
export type IrResource = z.infer<typeof IrResourceSchema>;

/**
 * A directed relationship between two IR resources.
 */
export const IrRelationshipSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: RelationshipType,
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type IrRelationship = z.infer<typeof IrRelationshipSchema>;

/**
 * A Terraform module grouping.
 */
export const IrModuleSchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  resources: z.array(z.string()),
});
export type IrModule = z.infer<typeof IrModuleSchema>;

/**
 * Metadata about IR generation.
 */
export const IrMetadataSchema = z.object({
  generatedAt: z.string().datetime(),
  sourceFiles: z.array(z.string()),
  toolVersion: z.string().min(1),
  resourceCount: z.number().int().nonnegative(),
  relationshipCount: z.number().int().nonnegative(),
});
export type IrMetadata = z.infer<typeof IrMetadataSchema>;

// ---------------------------------------------------------------------------
// Intent schemas (discriminated union on 'kind')
// ---------------------------------------------------------------------------

export const NetworkingIntentSchema = z.object({
  kind: z.literal('networking'),
  subtype: z.enum(['vpc', 'subnet', 'security_group', 'load_balancer', 'nat', 'route_table', 'peering']),
  resources: z.array(z.string()),
  properties: z.record(z.string(), z.unknown()),
});
export type NetworkingIntent = z.infer<typeof NetworkingIntentSchema>;

export const IdentityIntentSchema = z.object({
  kind: z.literal('identity'),
  subtype: z.enum(['role', 'policy', 'user', 'group', 'service_account']),
  resources: z.array(z.string()),
  properties: z.record(z.string(), z.unknown()),
});
export type IdentityIntent = z.infer<typeof IdentityIntentSchema>;

export const EncryptionIntentSchema = z.object({
  kind: z.literal('encryption'),
  subtype: z.enum(['key_management', 'at_rest', 'in_transit']),
  resources: z.array(z.string()),
  properties: z.record(z.string(), z.unknown()),
});
export type EncryptionIntent = z.infer<typeof EncryptionIntentSchema>;

export const ScalingIntentSchema = z.object({
  kind: z.literal('scaling'),
  subtype: z.enum(['auto_scaling', 'application_scaling', 'scheduled']),
  resources: z.array(z.string()),
  properties: z.record(z.string(), z.unknown()),
});
export type ScalingIntent = z.infer<typeof ScalingIntentSchema>;

export const ResilienceIntentSchema = z.object({
  kind: z.literal('resilience'),
  subtype: z.enum(['multi_az', 'backup', 'replication', 'failover']),
  resources: z.array(z.string()),
  properties: z.record(z.string(), z.unknown()),
});
export type ResilienceIntent = z.infer<typeof ResilienceIntentSchema>;

export const ObservabilityIntentSchema = z.object({
  kind: z.literal('observability'),
  subtype: z.enum(['monitoring', 'logging', 'tracing', 'alerting']),
  resources: z.array(z.string()),
  properties: z.record(z.string(), z.unknown()),
});
export type ObservabilityIntent = z.infer<typeof ObservabilityIntentSchema>;

export const SecretIntentSchema = z.object({
  kind: z.literal('secret'),
  subtype: z.enum(['secret_store', 'parameter_store', 'rotation']),
  resources: z.array(z.string()),
  properties: z.record(z.string(), z.unknown()),
});
export type SecretIntent = z.infer<typeof SecretIntentSchema>;

/**
 * Discriminated union of all infrastructure intent types.
 */
export const InfraIntentSchema = z.discriminatedUnion('kind', [
  NetworkingIntentSchema,
  IdentityIntentSchema,
  EncryptionIntentSchema,
  ScalingIntentSchema,
  ResilienceIntentSchema,
  ObservabilityIntentSchema,
  SecretIntentSchema,
]);
export type InfraIntent = z.infer<typeof InfraIntentSchema>;

// ---------------------------------------------------------------------------
// Top-level Canonical IR
// ---------------------------------------------------------------------------

/**
 * The Canonical Intermediate Representation of an infrastructure configuration.
 */
export const CanonicalIRSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be semver (e.g. 1.0.0)'),
  sourceProvider: CloudProvider,
  resources: z.array(IrResourceSchema),
  relationships: z.array(IrRelationshipSchema),
  modules: z.array(IrModuleSchema),
  intents: z.array(InfraIntentSchema),
  metadata: IrMetadataSchema,
});
export type CanonicalIR = z.infer<typeof CanonicalIRSchema>;
