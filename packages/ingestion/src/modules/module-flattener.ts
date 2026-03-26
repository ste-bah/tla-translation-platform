/**
 * Module Flattener — transforms a ResolvedModuleTree into augmented HCL ASTs
 * by inlining resolved module resources with prefixed names.
 *
 * Uses iterative BFS (explicit queue, no recursion) to walk the ModuleNode tree.
 *
 * Resource naming convention:
 *   module.{callPath}.{originalResourceName}
 *
 * Input wiring:
 *   var.NAME references in child modules are substituted with the parent's
 *   call attribute value for NAME.
 */

import { createComponentLogger } from '@tla/shared';
import type { HclAst, HclResource, HclDataBlock } from '@tla/shared';
import type {
  ModuleNode,
  ResolvedModuleTree,
  FlattenedResult,
  OpaqueRecord,
} from './types.js';

const logger = createComponentLogger('modules');

// ---------------------------------------------------------------------------
// BFS work item
// ---------------------------------------------------------------------------

interface FlattenItem {
  node: ModuleNode;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Flatten a resolved module tree into augmented ASTs.
 *
 * @param tree - The resolved module tree from resolveModules()
 * @param rootAsts - The original root-level ASTs
 * @returns FlattenedResult with augmented ASTs, opaque records, and module paths
 */
export function flattenModules(
  tree: ResolvedModuleTree,
  rootAsts: HclAst[],
): FlattenedResult {
  const augmentedAsts: HclAst[] = [...rootAsts];
  const opaqueRecords: OpaqueRecord[] = [];
  const modulePaths = new Map<string, string>();

  // BFS queue
  const queue: FlattenItem[] = [];
  for (const root of tree.roots) {
    queue.push({ node: root });
  }

  while (queue.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length guard above
    const { node } = queue.shift()!;

    // Collect opaque records regardless of status
    if (node.opaque) {
      opaqueRecords.push(node.opaque);
    }

    // Only process resolved modules with ASTs
    if (node.status === 'resolved' && node.asts.length > 0) {
      for (const ast of node.asts) {
        const syntheticAst = createSyntheticAst(ast, node);

        // Track module paths for each resource
        for (const resource of syntheticAst.resources) {
          const nodeId = `${resource.resource_type}.${resource.name}`;
          modulePaths.set(nodeId, node.callPath);
        }
        for (const dataBlock of syntheticAst.data_blocks) {
          const nodeId = `data.${dataBlock.data_type}.${dataBlock.name}`;
          modulePaths.set(nodeId, node.callPath);
        }

        augmentedAsts.push(syntheticAst);
      }
    }

    // Enqueue children
    for (const child of node.children) {
      queue.push({ node: child });
    }
  }

  logger.info(
    {
      totalAsts: augmentedAsts.length,
      opaqueCount: opaqueRecords.length,
      modulePathCount: modulePaths.size,
    },
    'Module flattening complete',
  );

  return { augmentedAsts, opaqueRecords, modulePaths };
}

// ---------------------------------------------------------------------------
// Synthetic AST creation
// ---------------------------------------------------------------------------

/**
 * Create a synthetic HCL AST from a child module's AST with prefixed names
 * and input-wired attributes.
 */
function createSyntheticAst(ast: HclAst, node: ModuleNode): HclAst {
  const callPath = node.callPath;
  const callAttributes = node.call.attributes;

  const prefixedResources = ast.resources.map((r) =>
    prefixResource(r, callPath, callAttributes),
  );

  const prefixedDataBlocks = ast.data_blocks.map((d) =>
    prefixDataBlock(d, callPath, callAttributes),
  );

  return {
    file_path: `synthetic://module.${callPath}/${ast.file_path}`,
    resources: prefixedResources,
    data_blocks: prefixedDataBlocks,
    // Variables, locals, outputs are internal to the module — do not promote
    variables: [],
    locals: [],
    outputs: [],
    providers: [],
    module_calls: [], // Child module calls are handled via BFS children
  };
}

/**
 * Prefix a resource name with the module call path and wire inputs.
 */
function prefixResource(
  resource: HclResource,
  callPath: string,
  callAttributes: Record<string, unknown>,
): HclResource {
  const prefixed = callPath.replace(/\./g, '__');
  const wiredAttributes = wireInputs(resource.attributes, callAttributes);

  return {
    ...resource,
    name: `${prefixed}__${resource.name}`,
    attributes: wiredAttributes,
    meta: {
      ...resource.meta,
      source: {
        ...resource.meta.source,
        file: `synthetic://module.${callPath}/${resource.meta.source.file}`,
      },
    },
  };
}

/**
 * Prefix a data block name with the module call path and wire inputs.
 */
function prefixDataBlock(
  dataBlock: HclDataBlock,
  callPath: string,
  callAttributes: Record<string, unknown>,
): HclDataBlock {
  const prefixed = callPath.replace(/\./g, '__');
  const wiredAttributes = wireInputs(dataBlock.attributes, callAttributes);

  return {
    ...dataBlock,
    name: `${prefixed}__${dataBlock.name}`,
    attributes: wiredAttributes,
    meta: {
      ...dataBlock.meta,
      source: {
        ...dataBlock.meta.source,
        file: `synthetic://module.${callPath}/${dataBlock.meta.source.file}`,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Input wiring
// ---------------------------------------------------------------------------

/**
 * Substitute `var.NAME` references in attribute values with the corresponding
 * parent call attribute value.
 *
 * Handles string values with `${var.name}` interpolation and direct `var.name`
 * string references.
 */
function wireInputs(
  attributes: Record<string, unknown>,
  callAttributes: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(attributes)) {
    result[key] = wireValue(value, callAttributes);
  }

  return result;
}

/**
 * Recursively wire var references in a single attribute value.
 */
function wireValue(
  value: unknown,
  callAttributes: Record<string, unknown>,
): unknown {
  if (typeof value === 'string') {
    return wireStringValue(value, callAttributes);
  }

  if (Array.isArray(value)) {
    return value.map((item) => wireValue(item, callAttributes));
  }

  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = wireValue(v, callAttributes);
    }
    return result;
  }

  return value;
}

/**
 * Replace var.NAME references in a string with call attribute values.
 *
 * Handles:
 *   - Exact match: "var.vpc_cidr" -> callAttributes.vpc_cidr
 *   - Interpolation: "${var.vpc_cidr}" -> callAttributes.vpc_cidr value
 */
function wireStringValue(
  str: string,
  callAttributes: Record<string, unknown>,
): unknown {
  // Exact match: entire string is "var.NAME"
  const exactMatch = /^var\.([a-zA-Z_][a-zA-Z0-9_]*)$/.exec(str);
  if (exactMatch) {
    const varName = exactMatch[1] ?? '';
    if (varName && varName in callAttributes) {
      return callAttributes[varName];
    }
    return str;
  }

  // Interpolation: replace ${var.NAME} occurrences within a larger string
  const interpolated = str.replace(
    /\$\{var\.([a-zA-Z_][a-zA-Z0-9_]*)\}/g,
    (_match, varName: string) => {
      if (varName in callAttributes) {
        return String(callAttributes[varName]);
      }
      return _match;
    },
  );

  return interpolated;
}
