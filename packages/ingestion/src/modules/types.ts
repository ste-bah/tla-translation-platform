/**
 * Types for module resolution and flattening.
 *
 * Terminology:
 *   - ModuleSourceKind: classification of the `source` string in a module call
 *   - ModuleNode: intermediate tree node produced during BFS resolution
 *   - FlattenedResult: final output of flattening the module tree into augmented ASTs
 *   - OpaqueRecord: record for modules we cannot resolve (registry, git, etc.)
 */

import type { HclAst, HclModuleCall } from '@tla/shared';

// ---------------------------------------------------------------------------
// Source classification
// ---------------------------------------------------------------------------

/** How the module source string is classified. */
export type ModuleSourceKind = 'local' | 'registry' | 'git' | 's3' | 'gcs' | 'opaque';

// ---------------------------------------------------------------------------
// Resolution options
// ---------------------------------------------------------------------------

/** Options controlling module resolution. */
export interface ResolveOptions {
  /** Absolute path to the Terraform root directory. */
  rootDir: string;
  /** Maximum depth of nested module resolution. Default 10. */
  maxDepth?: number;
  /** Path to .terraform/modules/modules.json for cached lookups. */
  modulesJsonPath?: string;
}

// ---------------------------------------------------------------------------
// Resolution tree
// ---------------------------------------------------------------------------

/** Status of an individual module resolution attempt. */
export type ModuleResolveStatus = 'resolved' | 'opaque' | 'circular' | 'depth_exceeded';

/** A node in the resolved module tree. */
export interface ModuleNode {
  /** The original module call from the parent AST. */
  call: HclModuleCall;
  /** Dot-delimited call path, e.g. "vpc" or "vpc.public_subnets". */
  callPath: string;
  /** Classified source kind. */
  sourceKind: ModuleSourceKind;
  /** Resolution status. */
  status: ModuleResolveStatus;
  /** Parsed ASTs if resolution succeeded. Empty for opaque/circular/depth. */
  asts: HclAst[];
  /** Child module nodes (from module_calls inside resolved ASTs). */
  children: ModuleNode[];
  /** Opaque record when status is not 'resolved'. */
  opaque?: OpaqueRecord;
}

/** Result of resolving all modules from root ASTs. */
export interface ResolvedModuleTree {
  /** Top-level module nodes. */
  roots: ModuleNode[];
  /** Aggregate stats. */
  stats: {
    resolved: number;
    opaque: number;
    circular: number;
    depthExceeded: number;
    totalModuleCalls: number;
  };
}

// ---------------------------------------------------------------------------
// Flattened output
// ---------------------------------------------------------------------------

/** Result of flattening a resolved module tree. */
export interface FlattenedResult {
  /** Original root ASTs plus synthetic ASTs from resolved modules. */
  augmentedAsts: HclAst[];
  /** Records for modules that could not be resolved. */
  opaqueRecords: OpaqueRecord[];
  /** Map from resource node ID to its module call path (for DependencyGraph metadata). */
  modulePaths: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Opaque records
// ---------------------------------------------------------------------------

/** Record for a module that cannot be resolved locally. */
export interface OpaqueRecord {
  /** Human-readable module name from the call block. */
  moduleName: string;
  /** Dot-delimited call path. */
  callPath: string;
  /** Raw source string from the module call. */
  source: string;
  /** Classified source kind. */
  sourceKind: ModuleSourceKind;
  /** Why the module could not be resolved. */
  reason: string;
  /** Always true — opaque modules require human review. */
  reviewRequired: true;
  /** Best-effort inferred resource types based on module name heuristics. */
  inferredResourceTypes: string[];
}
