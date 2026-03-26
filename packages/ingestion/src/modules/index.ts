// Module resolution and flattening
export { classifyModuleSource, resolveModules } from './module-resolver.js';
export { flattenModules } from './module-flattener.js';
export { handleOpaqueModule, inferResourceTypes } from './opaque-handler.js';

// Types
export type {
  ModuleSourceKind,
  ResolveOptions,
  ModuleNode,
  ModuleResolveStatus,
  ResolvedModuleTree,
  FlattenedResult,
  OpaqueRecord,
} from './types.js';
