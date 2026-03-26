import { z } from 'zod';

/**
 * Source location within an HCL file.
 */
export const SourceLocationSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
});
export type SourceLocation = z.infer<typeof SourceLocationSchema>;

/**
 * Metadata common to all HCL blocks (resource, data, variable, etc.).
 */
export const HclResourceMetaSchema = z.object({
  source: SourceLocationSchema,
  provider: z.string().optional(),
  depends_on: z.array(z.string()).default([]),
  count: z.union([z.number(), z.string()]).optional(),
  for_each: z.unknown().optional(),
});
export type HclResourceMeta = z.infer<typeof HclResourceMetaSchema>;

/**
 * An HCL resource block (e.g. resource "aws_s3_bucket" "my_bucket").
 */
export const HclResourceSchema = z.object({
  resource_type: z.string().min(1),
  name: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()),
  meta: HclResourceMetaSchema,
});
export type HclResource = z.infer<typeof HclResourceSchema>;

/**
 * An HCL data block (e.g. data "aws_ami" "latest").
 */
export const HclDataBlockSchema = z.object({
  data_type: z.string().min(1),
  name: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()),
  meta: HclResourceMetaSchema,
});
export type HclDataBlock = z.infer<typeof HclDataBlockSchema>;

/**
 * An HCL variable block.
 */
export const HclVariableSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  default: z.unknown().optional(),
  description: z.string().optional(),
  sensitive: z.boolean().default(false),
  validation: z.array(z.object({
    condition: z.string(),
    error_message: z.string(),
  })).default([]),
});
export type HclVariable = z.infer<typeof HclVariableSchema>;

/**
 * An HCL locals block.
 */
export const HclLocalSchema = z.object({
  name: z.string().min(1),
  expression: z.unknown(),
});
export type HclLocal = z.infer<typeof HclLocalSchema>;

/**
 * An HCL output block.
 */
export const HclOutputSchema = z.object({
  name: z.string().min(1),
  value: z.unknown(),
  description: z.string().optional(),
  sensitive: z.boolean().default(false),
});
export type HclOutput = z.infer<typeof HclOutputSchema>;

/**
 * An HCL provider block.
 */
export const HclProviderSchema = z.object({
  name: z.string().min(1),
  alias: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()),
  version: z.string().optional(),
});
export type HclProvider = z.infer<typeof HclProviderSchema>;

/**
 * An HCL module call block.
 */
export const HclModuleCallSchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  version: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()),
  meta: HclResourceMetaSchema,
});
export type HclModuleCall = z.infer<typeof HclModuleCallSchema>;

/**
 * An HCL backend block nested in the terraform block.
 */
export const HclBackendSchema = z.object({
  type: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()),
});
export type HclBackend = z.infer<typeof HclBackendSchema>;

/**
 * The terraform {} settings block.
 */
export const HclTerraformBlockSchema = z.object({
  required_version: z.string().optional(),
  required_providers: z.record(z.string(), z.object({
    source: z.string().optional(),
    version: z.string().optional(),
  })).default({}),
  backend: HclBackendSchema.optional(),
});
export type HclTerraformBlock = z.infer<typeof HclTerraformBlockSchema>;

/**
 * Full AST representation of a parsed HCL/Terraform configuration.
 */
export const HclAstSchema = z.object({
  file_path: z.string().min(1),
  resources: z.array(HclResourceSchema).default([]),
  data_blocks: z.array(HclDataBlockSchema).default([]),
  variables: z.array(HclVariableSchema).default([]),
  locals: z.array(HclLocalSchema).default([]),
  outputs: z.array(HclOutputSchema).default([]),
  providers: z.array(HclProviderSchema).default([]),
  module_calls: z.array(HclModuleCallSchema).default([]),
  terraform: HclTerraformBlockSchema.optional(),
});
export type HclAst = z.infer<typeof HclAstSchema>;
