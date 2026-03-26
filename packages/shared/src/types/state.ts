import { z } from 'zod';

/**
 * A single resource instance within a terraform state file.
 */
export const StateResourceSchema = z.object({
  mode: z.enum(['managed', 'data']),
  type: z.string().min(1),
  name: z.string().min(1),
  provider: z.string().min(1),
  instances: z.array(z.object({
    schema_version: z.number().default(0),
    attributes: z.record(z.string(), z.unknown()).default({}),
    attributes_flat: z.record(z.string(), z.string()).optional(),
    sensitive_attributes: z.array(z.unknown()).default([]),
    private: z.string().optional(),
    dependencies: z.array(z.string()).default([]),
  })).default([]),
  module: z.string().optional(),
});
export type StateResource = z.infer<typeof StateResourceSchema>;

/**
 * Terraform state file format v3 (Terraform < 0.12).
 */
export const StateDataV3Schema = z.object({
  version: z.literal(3),
  terraform_version: z.string(),
  serial: z.number(),
  lineage: z.string(),
  modules: z.array(z.object({
    path: z.array(z.string()),
    outputs: z.record(z.string(), z.unknown()).default({}),
    resources: z.record(z.string(), z.object({
      type: z.string(),
      depends_on: z.array(z.string()).default([]),
      primary: z.object({
        id: z.string(),
        attributes: z.record(z.string(), z.string()).default({}),
        meta: z.record(z.string(), z.unknown()).default({}),
      }),
      provider: z.string().default(''),
    })).default({}),
  })).default([]),
});
export type StateDataV3 = z.infer<typeof StateDataV3Schema>;

/**
 * Terraform state file format v4 (Terraform >= 0.12).
 */
export const StateDataV4Schema = z.object({
  version: z.literal(4),
  terraform_version: z.string(),
  serial: z.number(),
  lineage: z.string(),
  outputs: z.record(z.string(), z.object({
    value: z.unknown(),
    type: z.unknown(),
    sensitive: z.boolean().default(false),
  })).default({}),
  resources: z.array(StateResourceSchema).default([]),
});
export type StateDataV4 = z.infer<typeof StateDataV4Schema>;

/**
 * Union of supported terraform state versions.
 */
export const StateDataSchema = z.union([StateDataV3Schema, StateDataV4Schema]);
export type StateData = z.infer<typeof StateDataSchema>;
