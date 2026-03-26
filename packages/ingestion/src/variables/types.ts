import { z } from 'zod';
import { SourceLocationSchema } from '@tla/shared';

/**
 * Terraform type representation: either a primitive or complex type.
 */
export const TerraformTypeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('primitive'),
    value: z.enum(['string', 'number', 'bool', 'any']),
  }),
  z.object({
    kind: z.literal('complex'),
    raw: z.string().min(1),
  }),
]);
export type TerraformType = z.infer<typeof TerraformTypeSchema>;

/**
 * Resolution status for a variable/local/output value.
 */
export const ResolutionStatusSchema = z.enum([
  'resolved',
  'unresolved',
  'circular',
  'sensitive',
]);
export type ResolutionStatus = z.infer<typeof ResolutionStatusSchema>;

/**
 * Extracted variable definition from HCL AST.
 */
export const VariableDefinitionSchema = z.object({
  name: z.string().min(1),
  type: TerraformTypeSchema.optional(),
  defaultValue: z.unknown().optional(),
  description: z.string().optional(),
  sensitive: z.boolean(),
  validation: z.array(z.object({
    condition: z.string(),
    error_message: z.string(),
  })),
  sourceLocation: SourceLocationSchema,
});
export type VariableDefinition = z.infer<typeof VariableDefinitionSchema>;

/**
 * Extracted local definition from HCL AST.
 */
export const LocalDefinitionSchema = z.object({
  name: z.string().min(1),
  expression: z.unknown(),
  sourceLocation: SourceLocationSchema,
});
export type LocalDefinition = z.infer<typeof LocalDefinitionSchema>;

/**
 * Extracted output definition from HCL AST.
 */
export const OutputDefinitionSchema = z.object({
  name: z.string().min(1),
  value: z.unknown(),
  description: z.string().optional(),
  sensitive: z.boolean(),
  sourceLocation: SourceLocationSchema,
});
export type OutputDefinition = z.infer<typeof OutputDefinitionSchema>;

/**
 * Result of attempting to resolve a variable/local/output value.
 */
export const ResolvedValueSchema = z.object({
  name: z.string().min(1),
  status: ResolutionStatusSchema,
  value: z.unknown().optional(),
  source: z.enum(['default', 'override', 'expression', 'none']),
});
export type ResolvedValue = z.infer<typeof ResolvedValueSchema>;

/**
 * Analysis result for a Terraform expression.
 */
export const ExpressionAnalysisSchema = z.object({
  references: z.array(z.string()),
  complexity: z.enum(['literal', 'simple_ref', 'interpolation', 'complex']),
  hasFunctions: z.boolean(),
});
export type ExpressionAnalysis = z.infer<typeof ExpressionAnalysisSchema>;

/**
 * Cross-reference entry tracking consumers of a variable/local/output.
 */
export const CrossReferenceEntrySchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['variable', 'local', 'output']),
  consumers: z.array(z.string()),
  referenceCount: z.number().int().nonnegative(),
});
export type CrossReferenceEntry = z.infer<typeof CrossReferenceEntrySchema>;

/**
 * Complete map of all variables, locals, and outputs extracted from ASTs.
 */
export const VariableMapSchema = z.object({
  variables: z.map(z.string(), VariableDefinitionSchema),
  locals: z.map(z.string(), LocalDefinitionSchema),
  outputs: z.map(z.string(), OutputDefinitionSchema),
});
export type VariableMap = z.infer<typeof VariableMapSchema>;
