import { z } from 'zod';

/**
 * A single resource change from a terraform plan JSON output.
 */
export const ResourceChangeSchema = z.object({
  address: z.string().min(1),
  module_address: z.string().optional(),
  mode: z.enum(['managed', 'data']),
  type: z.string().min(1),
  name: z.string().min(1),
  provider_name: z.string().min(1),
  change: z.object({
    actions: z.array(z.enum(['no-op', 'create', 'read', 'update', 'delete'])).min(1),
    before: z.unknown().nullable(),
    after: z.unknown().nullable(),
    after_unknown: z.unknown().nullable().default(null),
    before_sensitive: z.unknown().nullable().default(null),
    after_sensitive: z.unknown().nullable().default(null),
  }),
});
export type ResourceChange = z.infer<typeof ResourceChangeSchema>;

/**
 * Parsed terraform plan JSON structure.
 */
export const PlanDataSchema = z.object({
  format_version: z.string(),
  terraform_version: z.string(),
  planned_values: z.object({
    root_module: z.object({
      resources: z.array(z.object({
        address: z.string(),
        mode: z.enum(['managed', 'data']),
        type: z.string(),
        name: z.string(),
        provider_name: z.string(),
        schema_version: z.number().optional(),
        values: z.record(z.string(), z.unknown()).default({}),
        sensitive_values: z.record(z.string(), z.unknown()).default({}),
      })).default([]),
      child_modules: z.array(z.unknown()).default([]),
    }),
  }),
  resource_changes: z.array(ResourceChangeSchema).default([]),
  configuration: z.object({
    provider_config: z.record(z.string(), z.object({
      name: z.string(),
      full_name: z.string().optional(),
      version_constraint: z.string().optional(),
      expressions: z.record(z.string(), z.unknown()).default({}),
    })).default({}),
    root_module: z.object({
      resources: z.array(z.unknown()).default([]),
      module_calls: z.record(z.string(), z.unknown()).default({}),
      variables: z.record(z.string(), z.unknown()).default({}),
    }).default({}),
  }).optional(),
});
export type PlanData = z.infer<typeof PlanDataSchema>;
