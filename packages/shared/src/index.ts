// Constants (Zod enum schemas + inferred types)
export {
  MappingType,
  TranslationBand,
  OutputMode,
  AwsServiceFamily,
  GapType,
  GapSeverity,
  ReviewDomain,
  TestStatus,
  CloudProvider,
} from './constants.js';

export {
  BehavioralGapSchema,
  RegistryEntrySchema,
} from './types/registry.js';
export type {
  BehavioralGap,
  RegistryEntry,
} from './types/registry.js';

export {
  TlaError,
  RegistryError,
  IngestionError,
  TranslationError,
  ValidationError,
  isTlaError,
} from './errors.js';

export {
  SourceLocationSchema,
  HclResourceMetaSchema,
  HclResourceSchema,
  HclDataBlockSchema,
  HclVariableSchema,
  HclLocalSchema,
  HclOutputSchema,
  HclProviderSchema,
  HclModuleCallSchema,
  HclBackendSchema,
  HclTerraformBlockSchema,
  HclAstSchema,
} from './types/hcl.js';
export type {
  SourceLocation,
  HclResourceMeta,
  HclResource,
  HclDataBlock,
  HclVariable,
  HclLocal,
  HclOutput,
  HclProvider,
  HclModuleCall,
  HclBackend,
  HclTerraformBlock,
  HclAst,
} from './types/hcl.js';

export {
  ResourceChangeSchema,
  PlanDataSchema,
} from './types/plan.js';
export type {
  ResourceChange,
  PlanData,
} from './types/plan.js';

export {
  StateResourceSchema,
  StateDataV3Schema,
  StateDataV4Schema,
  StateDataSchema,
} from './types/state.js';
export type {
  StateResource,
  StateDataV3,
  StateDataV4,
  StateData,
} from './types/state.js';

export {
  IdentifiedServiceSchema,
  ProceduralResourceSchema,
  ServiceInventorySchema,
  InfraMetadataSchema,
} from './types/discovery.js';
export type {
  IdentifiedService,
  ProceduralResource,
  ServiceInventory,
  InfraMetadata,
} from './types/discovery.js';

export {
  EdgeType,
  GraphEdgeSchema,
  NodeMetadataSchema,
  GraphNodeSchema,
  ModuleBoundarySchema,
  CycleInfoSchema,
  SerializedGraphSchema,
  GraphAnalysisSchema,
} from './types/graph.js';
export type {
  GraphEdge,
  NodeMetadata,
  GraphNode,
  ModuleBoundary,
  CycleInfo,
  SerializedGraph,
  GraphAnalysis,
} from './types/graph.js';

export {
  ResourceCategory,
  TranslationStatus,
  RelationshipType,
  IrAttributesSchema,
  IrResourceSchema,
  IrRelationshipSchema,
  IrModuleSchema,
  IrMetadataSchema,
  NetworkingIntentSchema,
  IdentityIntentSchema,
  EncryptionIntentSchema,
  ScalingIntentSchema,
  ResilienceIntentSchema,
  ObservabilityIntentSchema,
  SecretIntentSchema,
  InfraIntentSchema,
  CanonicalIRSchema,
} from './types/ir.js';
export type {
  IrAttributes,
  IrResource,
  IrRelationship,
  IrModule,
  IrMetadata,
  NetworkingIntent,
  IdentityIntent,
  EncryptionIntent,
  ScalingIntent,
  ResilienceIntent,
  ObservabilityIntent,
  SecretIntent,
  InfraIntent,
  CanonicalIR,
} from './types/ir.js';

export {
  FindingSeverity,
  TranslationItemStatus,
  TraceabilityRecordSchema,
  TranslatedResourceSchema,
  TranslationFindingSchema,
  TranslationContractSchema,
  TranslationPlanItemSchema,
  TranslationPlanSchema,
  ManifestEntrySchema,
  TranslationManifestSchema,
  TranslationStatsSchema,
  CompilerOptionsSchema,
  TranslationResultSchema,
} from './types/translation.js';
export type {
  TraceabilityRecord,
  TranslatedResource,
  TranslationFinding,
  TranslationContract,
  TranslationPlanItem,
  TranslationPlan,
  ManifestEntry,
  TranslationManifest,
  TranslationStats,
  CompilerOptions,
  TranslationResult,
} from './types/translation.js';

export {
  EquivalenceClassification,
  DimensionResultSchema,
  ResourceEquivalenceRecordSchema,
  DimensionWeightsSchema,
  ClassificationThresholdsSchema,
  EquivalenceOptionsSchema,
  EquivalenceReportSchema,
} from './types/equivalence.js';
export type {
  DimensionResult,
  ResourceEquivalenceRecord,
  DimensionWeights,
  ClassificationThresholds,
  EquivalenceOptions,
  EquivalenceReport,
} from './types/equivalence.js';

export {
  PortableEncryptionSchema,
  CloudObjectStorageSchema,
  CloudContainerRegistrySchema,
  RedisCacheSizeSchema,
  CloudCacheRedisSchema,
  PortableResourceSchema,
} from './types/portable-provider.js';
export type {
  PortableEncryption,
  CloudObjectStorage,
  CloudContainerRegistry,
  RedisCacheSize,
  CloudCacheRedis,
  PortableResource,
} from './types/portable-provider.js';

export { resolveRegistryKey, RESOURCE_TYPE_REGISTRY_MAP } from './registry-key-resolver.js';
export { createComponentLogger } from './utils/logger.js';

export { AuditLogger } from './audit/audit-logger.js';
export {
  AuditEventKind,
  AuditEventSchema,
  ChainVerificationResultSchema,
  AuditLoggerOptionsSchema,
} from './audit/audit-types.js';
export type {
  AuditEvent,
  ChainVerificationResult,
  AuditLoggerOptions,
} from './audit/audit-types.js';
