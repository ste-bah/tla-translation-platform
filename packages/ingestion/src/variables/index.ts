// Types and schemas
export {
  TerraformTypeSchema,
  ResolutionStatusSchema,
  VariableDefinitionSchema,
  LocalDefinitionSchema,
  OutputDefinitionSchema,
  ResolvedValueSchema,
  ExpressionAnalysisSchema,
  CrossReferenceEntrySchema,
  VariableMapSchema,
} from './types.js';
export type {
  TerraformType,
  ResolutionStatus,
  VariableDefinition,
  LocalDefinition,
  OutputDefinition,
  ResolvedValue,
  ExpressionAnalysis,
  CrossReferenceEntry,
  VariableMap,
} from './types.js';

// Expression analysis
export { analyzeExpression, extractReferencesFromValue, REFERENCE_RE } from './expression-analyzer.js';

// Variable extraction
export { extractVariables, parseTerraformType } from './variable-extractor.js';

// Value resolution
export { resolveValues } from './value-resolver.js';
export type { ValueResolveOptions } from './value-resolver.js';

// Cross-reference building
export { buildCrossReferences } from './cross-ref-builder.js';
