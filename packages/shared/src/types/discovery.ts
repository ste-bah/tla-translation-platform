import { z } from 'zod';
import { AwsServiceFamily } from '../constants.js';

/**
 * An AWS service identified from terraform resources.
 */
export const IdentifiedServiceSchema = z.object({
  resource_type: z.string().min(1),
  resource_name: z.string().min(1),
  family: AwsServiceFamily,
  service_prefix: z.string().min(1),
  count: z.number().int().positive(),
  file_paths: z.array(z.string()),
});
export type IdentifiedService = z.infer<typeof IdentifiedServiceSchema>;

/**
 * A resource flagged as procedural (null_resource, local-exec, etc.).
 */
export const ProceduralResourceSchema = z.object({
  resource_type: z.string().min(1),
  resource_name: z.string().min(1),
  reason: z.string().min(1),
  file_path: z.string().min(1),
});
export type ProceduralResource = z.infer<typeof ProceduralResourceSchema>;

/**
 * Aggregate inventory of services discovered in the terraform codebase.
 */
export const ServiceInventorySchema = z.object({
  identified_services: z.array(IdentifiedServiceSchema),
  procedural_resources: z.array(ProceduralResourceSchema),
  unknown_providers: z.array(z.object({
    resource_type: z.string().min(1),
    resource_name: z.string().min(1),
    file_path: z.string().min(1),
  })),
  total_resources: z.number().int().nonnegative(),
  total_aws_resources: z.number().int().nonnegative(),
});
export type ServiceInventory = z.infer<typeof ServiceInventorySchema>;

/**
 * Metadata extracted from terraform configurations.
 */
export const InfraMetadataSchema = z.object({
  tags: z.record(z.string(), z.array(z.string())),
  naming_patterns: z.array(z.string()),
  provider_versions: z.record(z.string(), z.string()),
  module_sources: z.array(z.object({
    name: z.string().min(1),
    source: z.string().min(1),
    version: z.string().optional(),
  })),
  backend_type: z.string().optional(),
  terraform_version_constraint: z.string().optional(),
});
export type InfraMetadata = z.infer<typeof InfraMetadataSchema>;
