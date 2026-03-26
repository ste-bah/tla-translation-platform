/**
 * Module Resolver — BFS traversal that resolves Terraform module calls.
 *
 * Local modules: resolved via parseHclDirectory on the filesystem.
 * Registry/git/s3/gcs: checked against .terraform/modules/modules.json cache,
 *   falling back to opaque if not found.
 *
 * BFS guarantees breadth-first discovery with explicit queue (no recursion).
 */

import { resolve, join, dirname } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { createComponentLogger, IngestionError } from '@tla/shared';
import type { HclAst, HclModuleCall } from '@tla/shared';
import { parseHclDirectory } from '../parser/hcl-parser.js';
import { handleOpaqueModule } from './opaque-handler.js';
import type {
  ModuleSourceKind,
  ModuleNode,
  ResolvedModuleTree,
  ResolveOptions,
} from './types.js';

const logger = createComponentLogger('modules');

const DEFAULT_MAX_DEPTH = 10;

// ---------------------------------------------------------------------------
// Path traversal guard (VULN-001 / VULN-002)
// ---------------------------------------------------------------------------

/**
 * Assert that `target` is under `root` after resolution.
 * Prevents path-traversal attacks via crafted module sources like
 * `./../../etc/passwd` or symlink escapes.
 *
 * @throws {IngestionError} when the resolved path escapes rootDir
 */
function assertUnderRoot(target: string, root: string, callPath: string): void {
  const normTarget = resolve(target);
  const normRoot = resolve(root);
  if (!normTarget.startsWith(normRoot + '/') && normTarget !== normRoot) {
    throw new IngestionError(
      `Path traversal blocked: resolved path escapes root directory`,
      { callPath, resolvedDir: normTarget, rootDir: normRoot },
    );
  }
}

// ---------------------------------------------------------------------------
// Source classification
// ---------------------------------------------------------------------------

/**
 * Classify a module `source` string into a ModuleSourceKind.
 *
 * Rules:
 *   - Starts with "./" or "../" -> local
 *   - Starts with "git::" or contains "github.com" or "bitbucket.org" -> git
 *   - Starts with "s3::" -> s3
 *   - Starts with "gcs::" -> gcs
 *   - Matches registry pattern "namespace/name/provider" -> registry
 *   - Everything else -> opaque
 */
export function classifyModuleSource(source: string): ModuleSourceKind {
  const trimmed = source.trim();

  // Local paths
  if (trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return 'local';
  }

  // Git sources
  if (
    trimmed.startsWith('git::') ||
    trimmed.includes('github.com') ||
    trimmed.includes('bitbucket.org')
  ) {
    return 'git';
  }

  // S3 sources
  if (trimmed.startsWith('s3::')) {
    return 's3';
  }

  // GCS sources
  if (trimmed.startsWith('gcs::')) {
    return 'gcs';
  }

  // Terraform registry: namespace/name/provider (3-segment slash-delimited)
  // May have optional //subdir or ?ref=... suffix
  const registryPattern = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+/;
  if (registryPattern.test(trimmed)) {
    return 'registry';
  }

  return 'opaque';
}

// ---------------------------------------------------------------------------
// modules.json cache
// ---------------------------------------------------------------------------

interface ModulesJsonEntry {
  Key: string;
  Source: string;
  Dir: string;
}

interface ModulesJsonFile {
  Modules: ModulesJsonEntry[];
}

/**
 * Attempt to load and parse .terraform/modules/modules.json.
 * Returns null if file doesn't exist or is malformed.
 */
async function loadModulesJson(
  modulesJsonPath: string,
): Promise<ModulesJsonFile | null> {
  try {
    await access(modulesJsonPath);
    const raw = await readFile(modulesJsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as ModulesJsonFile;
    if (!Array.isArray(parsed.Modules)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Look up a module key in the modules.json cache.
 * Returns the resolved directory or null.
 */
function lookupModulesJsonCache(
  cache: ModulesJsonFile,
  callPath: string,
  rootDir: string,
): string | null {
  for (const entry of cache.Modules) {
    if (entry.Key === callPath && entry.Dir) {
      // Dir is relative to the root
      const resolved = resolve(rootDir, entry.Dir);
      assertUnderRoot(resolved, rootDir, callPath);
      return resolved;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// BFS work item
// ---------------------------------------------------------------------------

interface BfsItem {
  call: HclModuleCall;
  callPath: string;
  /** Absolute directory of the parent that declared this module call. */
  parentDir: string;
  depth: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve all module calls found in the given ASTs using BFS.
 *
 * @param asts - Parsed ASTs from the root Terraform configuration
 * @param options - Resolution options (rootDir, maxDepth, modulesJsonPath)
 * @returns A ResolvedModuleTree with all roots and stats
 */
export async function resolveModules(
  asts: HclAst[],
  options: ResolveOptions,
): Promise<ResolvedModuleTree> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const rootDir = resolve(options.rootDir);
  const modulesJsonPath = options.modulesJsonPath ??
    join(rootDir, '.terraform', 'modules', 'modules.json');

  logger.info({ rootDir, maxDepth }, 'Starting module resolution');

  // Load modules.json cache (best-effort)
  const modulesJsonCache = await loadModulesJson(modulesJsonPath);

  // Track visited call paths to detect circular references
  const visited = new Set<string>();

  // Stats
  const stats = {
    resolved: 0,
    opaque: 0,
    circular: 0,
    depthExceeded: 0,
    totalModuleCalls: 0,
  };

  // Collect top-level module calls
  const queue: BfsItem[] = [];
  const rootNodes: ModuleNode[] = [];
  // Map callPath -> ModuleNode for parent lookup
  const nodeMap = new Map<string, ModuleNode>();

  for (const ast of asts) {
    const parentDir = dirname(resolve(ast.file_path));
    for (const call of ast.module_calls) {
      const callPath = call.name;
      stats.totalModuleCalls++;
      queue.push({ call, callPath, parentDir, depth: 0 });
    }
  }

  // BFS
  while (queue.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length guard above
    const item = queue.shift()!;
    const { call, callPath, parentDir, depth } = item;

    const sourceKind = classifyModuleSource(call.source);

    // Circular detection
    if (visited.has(callPath)) {
      const node: ModuleNode = {
        call,
        callPath,
        sourceKind,
        status: 'circular',
        asts: [],
        children: [],
        opaque: handleOpaqueModule(call, callPath, sourceKind, 'Circular module reference detected'),
      };
      stats.circular++;
      attachNode(node, callPath, rootNodes, nodeMap);
      continue;
    }

    // Depth guard
    if (depth >= maxDepth) {
      const node: ModuleNode = {
        call,
        callPath,
        sourceKind,
        status: 'depth_exceeded',
        asts: [],
        children: [],
        opaque: handleOpaqueModule(call, callPath, sourceKind, `Max depth ${String(maxDepth)} exceeded`),
      };
      stats.depthExceeded++;
      attachNode(node, callPath, rootNodes, nodeMap);
      continue;
    }

    visited.add(callPath);

    // Attempt resolution based on source kind
    let resolvedDir: string | null = null;

    if (sourceKind === 'local') {
      try {
        resolvedDir = resolve(parentDir, call.source);
        assertUnderRoot(resolvedDir, rootDir, callPath);
      } catch (traversalErr) {
        // Path traversal blocked — mark opaque instead of crashing
        const reason = traversalErr instanceof Error ? traversalErr.message : String(traversalErr);
        const node: ModuleNode = {
          call,
          callPath,
          sourceKind,
          status: 'opaque',
          asts: [],
          children: [],
          opaque: handleOpaqueModule(call, callPath, sourceKind, reason),
        };
        stats.opaque++;
        attachNode(node, callPath, rootNodes, nodeMap);
        continue;
      }
    } else {
      // Try modules.json cache for non-local sources
      if (modulesJsonCache) {
        try {
          resolvedDir = lookupModulesJsonCache(modulesJsonCache, callPath, rootDir);
        } catch (traversalErr) {
          const reason = traversalErr instanceof Error ? traversalErr.message : String(traversalErr);
          const node: ModuleNode = {
            call,
            callPath,
            sourceKind,
            status: 'opaque',
            asts: [],
            children: [],
            opaque: handleOpaqueModule(call, callPath, sourceKind, reason),
          };
          stats.opaque++;
          attachNode(node, callPath, rootNodes, nodeMap);
          continue;
        }
      }
    }

    if (resolvedDir !== null) {
      // Attempt to parse the resolved directory
      try {
        const parseResult = await parseHclDirectory(resolvedDir);
        if (parseResult.asts.length === 0 && parseResult.errors.length > 0) {
          throw new IngestionError(
            `All files in module directory failed to parse: ${resolvedDir}`,
            { callPath, errors: parseResult.errors.length },
          );
        }

        const node: ModuleNode = {
          call,
          callPath,
          sourceKind,
          status: 'resolved',
          asts: parseResult.asts,
          children: [],
        };
        stats.resolved++;
        attachNode(node, callPath, rootNodes, nodeMap);

        // Enqueue child module calls
        for (const childAst of parseResult.asts) {
          for (const childCall of childAst.module_calls) {
            const childCallPath = `${callPath}.${childCall.name}`;
            stats.totalModuleCalls++;
            queue.push({
              call: childCall,
              callPath: childCallPath,
              parentDir: dirname(resolve(childAst.file_path)),
              depth: depth + 1,
            });
          }
        }
      } catch (err) {
        // Parse failed — mark opaque
        const reason = err instanceof Error ? err.message : String(err);
        const node: ModuleNode = {
          call,
          callPath,
          sourceKind,
          status: 'opaque',
          asts: [],
          children: [],
          opaque: handleOpaqueModule(call, callPath, sourceKind, `Parse failed: ${reason}`),
        };
        stats.opaque++;
        attachNode(node, callPath, rootNodes, nodeMap);
      }
    } else {
      // Cannot resolve — opaque
      const reason = sourceKind === 'local'
        ? `Local module directory not found`
        : `No cached download for ${sourceKind} module`;
      const node: ModuleNode = {
        call,
        callPath,
        sourceKind,
        status: 'opaque',
        asts: [],
        children: [],
        opaque: handleOpaqueModule(call, callPath, sourceKind, reason),
      };
      stats.opaque++;
      attachNode(node, callPath, rootNodes, nodeMap);
    }
  }

  logger.info(stats, 'Module resolution complete');

  return { roots: rootNodes, stats };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Attach a ModuleNode to its parent (if nested) or to the roots array.
 */
function attachNode(
  node: ModuleNode,
  callPath: string,
  roots: ModuleNode[],
  nodeMap: Map<string, ModuleNode>,
): void {
  nodeMap.set(callPath, node);

  const dotIndex = callPath.lastIndexOf('.');
  if (dotIndex === -1) {
    // Top-level module
    roots.push(node);
  } else {
    const parentPath = callPath.substring(0, dotIndex);
    const parent = nodeMap.get(parentPath);
    if (parent) {
      parent.children.push(node);
    } else {
      // Orphan (shouldn't happen in correct BFS), attach to roots
      roots.push(node);
    }
  }
}
