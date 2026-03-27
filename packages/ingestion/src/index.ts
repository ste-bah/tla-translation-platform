// Parsers
export { parseHclFile, parseHclDirectory } from './parser/hcl-parser.js';
export type { DirectoryParseResult } from './parser/hcl-parser.js';
export { parsePlanJson, extractPlanAddresses } from './parser/plan-parser.js';
export { parseStateJson } from './parser/state-parser.js';

// Discovery
export {
  identifyAwsServices,
  AWS_RESOURCE_PREFIX_MAP,
} from './discovery/service-identifier.js';
export { extractMetadata } from './discovery/metadata-extractor.js';
export {
  classifyProvider,
  classifyResources,
} from './discovery/multi-provider-handler.js';
export type { ProviderClassification } from './discovery/multi-provider-handler.js';

// Graph
export { DependencyGraph } from './graph/dependency-graph.js';
export { analyzeGraph } from './graph/graph-analyzer.js';

// IR
export { validateIr } from './ir/ir-schema.js';
export { detectIntents } from './ir/intent-detector.js';
export { serializeIr, deserializeIr } from './ir/ir-serializer.js';
export { IrEmitter } from './ir/ir-emitter.js';
export type { EmitOptions, EmitResult } from './ir/ir-emitter.js';
export { resolveRegistryKey, RESOURCE_TYPE_REGISTRY_MAP } from './ir/resource-type-registry-map.js';
export { normalizeAttributes } from './ir/attribute-normalizer.js';
export type { NormalizedAttributes } from './ir/attribute-normalizer.js';
export { classifyResource } from './ir/unrecognized-handler.js';
export type { ResourceClassification } from './ir/unrecognized-handler.js';

// Modules
export {
  classifyModuleSource,
  resolveModules,
  flattenModules,
  handleOpaqueModule,
  inferResourceTypes,
} from './modules/index.js';
export type {
  ModuleSourceKind,
  ResolveOptions,
  ModuleNode,
  ModuleResolveStatus,
  ResolvedModuleTree,
  FlattenedResult,
  OpaqueRecord,
} from './modules/index.js';

// Variables
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
  analyzeExpression,
  extractReferencesFromValue,
  REFERENCE_RE,
  extractVariables,
  parseTerraformType,
  resolveValues,
  buildCrossReferences,
} from './variables/index.js';
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
  ValueResolveOptions,
} from './variables/index.js';
