// Compiler
export { TranslationCompiler } from './compiler/translation-compiler.js';
export { buildTranslationPlan } from './compiler/translation-planner.js';
export { assembleFiles } from './compiler/file-assembler.js';
export { buildTranslationReport } from './compiler/report-writer.js';
export { buildConfidenceReport } from './compiler/confidence-report.js';
export type { ConfidenceReport, ResourceConfidence } from './compiler/confidence-report.js';

// Engines
export { engineRegistry, getEngine } from './engines/index.js';

// Engine types
export type {
  MappingEngine,
  TranslationContext,
  EngineResult,
  PlannerInput,
  PlannerResult,
  AssemblyInput,
} from './engines/index.js';

// Code generation
export { AzureCodeGenerator, convertValue } from './codegen/index.js';
export type { AzureGenOptions, GeneratedFiles } from './codegen/index.js';
export {
  literal, expr, hclMap, block, list,
  writeHclValue, writeResourceBlock, writeProviderBlock,
  writeTerraformBlock, writeVariableBlock, writeOutputBlock,
  resolveAzureRegion, azToAzureZone, sanitizeAzureName,
  AWS_TO_AZURE_REGION, AZURE_NAME_LIMITS,
} from './codegen/index.js';
export type {
  HclValue, HclLiteral, HclExpr, HclMap, HclBlock, HclList,
  HclBlocks, HclMapEntry, BlockWriteOptions, AzureNameConstraint,
} from './codegen/index.js';

// GCP code generation
export { GcpCodeGenerator, convertGcpValue } from './codegen/index.js';
export type { GcpGenOptions, LabelTransformResult } from './codegen/index.js';
export {
  resolveGcpRegion, awsAzToGcpZone, sanitizeGcpName,
  transformLabels, AWS_TO_GCP_REGION,
} from './codegen/index.js';

// Expression translation
export {
  translateExpression,
  rewriteReference,
  buildReferenceMap,
  mapDataSource,
  mapFunction,
} from './expressions/index.js';
export type {
  ReferenceMap,
  ExpressionContext,
  TranslatedExpression,
} from './expressions/index.js';

// State migration
export {
  transformState,
  normalizeState,
  normalizeV3,
  normalizeV4,
  buildAddressMap,
  classifyByMappingType,
  generateMoveCommand,
  generateImportCommand,
  generateRemoveCommand,
} from './state/state-transformer.js';
export type {
  StateTransformPlan,
  StateMoveCommand,
  StateImportCommand,
  StateRemoveCommand,
} from './state/state-transformer.js';

export { generateRollback } from './state/rollback-generator.js';
export type {
  RollbackManifest,
  InverseMoveCommand,
  InverseImportCommand,
} from './state/rollback-generator.js';

export { generateAzureBackend } from './state/azure-backend.js';
export type { AzureBackendOptions } from './state/azure-backend.js';

export { generateGcpBackend } from './state/gcp-backend.js';
export type { GcpBackendOptions } from './state/gcp-backend.js';

export { migrateBackend } from './state/backend-migrator.js';
export type { BackendMigrationOptions, BackendMigrationResult } from './state/backend-migrator.js';

export { detectS3Backend } from './state/s3-detector.js';
export type { S3BackendAttributes, S3DetectionResult } from './state/s3-detector.js';

// Portable provider compiler
export { compilePortableResource } from './provider/portable-compiler.js';
export type { PortableCompileResult } from './provider/portable-compiler.js';

// Exit-path HCL generator
export { emitNativeEquivalent } from './provider/exit-path.js';

// Plan preview mode
export { previewTranslation } from './preview/plan-previewer.js';
export type {
  ResourcePreviewItem,
  PreviewSummary,
  TranslationPreview,
} from './preview/plan-previewer.js';

// Remediation pack generator
export { generateRemediationPack, buildMigrationPack } from './remediation/index.js';
export type {
  RemediationTask,
  RemediationTaskType,
  RemediationPriority,
  RemediationPack,
  RemediationSummary,
} from './remediation/index.js';

// Style profiles
export { applyStyle, toSnakeCase, toKebabCase, toCamelCase } from './style/index.js';
export type { StyleProfile, NamingRules, ModuleRules, FormattingRules } from './style/index.js';
export { DEFAULT_PROFILE, ENTERPRISE_PROFILE, MINIMAL_PROFILE } from './style/index.js';

// Validation / Terraform runner
export { runTerraformValidate } from './validation/index.js';
export type {
  TerraformRunOptions,
  TerraformRunResult,
  TerraformRunSuccess,
  TerraformRunFailure,
} from './validation/index.js';

// Audit trail
export { buildAuditEntry, appendAuditEntry } from './audit/index.js';
export type { AuditEntry } from './audit/index.js';
