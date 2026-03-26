/**
 * IR Emitter — transforms parsed HCL ASTs and dependency graph into Canonical IR.
 *
 * Pipeline:
 *   HclAst[] + DependencyGraph
 *     -> buildHclCorrelationMap
 *     -> filter resource nodes
 *     -> build IrResources (with registry enrichment)
 *     -> map edges to IrRelationships
 *     -> build IrModules
 *     -> detectIntents
 *     -> build IrMetadata
 *     -> validate via CanonicalIRSchema.parse()
 */

import type {
  CanonicalIR,
  GraphEdge,
  HclAst,
  HclResource,
  IrModule,
  IrRelationship,
  IrResource,
  RegistryEntry,
  RelationshipType,
  ResourceCategory,
} from '@tla/shared';
import { CanonicalIRSchema, createComponentLogger } from '@tla/shared';
import type { RegistryApi } from '@tla/registry';
import type { DependencyGraph } from '../graph/dependency-graph.js';
import { detectIntents } from './intent-detector.js';
import { resolveRegistryKey } from './resource-type-registry-map.js';
import { normalizeAttributes } from './attribute-normalizer.js';
import { classifyResource } from './unrecognized-handler.js';
import { AWS_RESOURCE_PREFIX_MAP } from '../discovery/service-identifier.js';

const logger = createComponentLogger('ir-emitter');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Options controlling IR emission.
 */
export interface EmitOptions {
  /** Semver string for the IR version field. Defaults to '1.0.0'. */
  version?: string;
  /** Tool version string for metadata. Defaults to '0.1.0'. */
  toolVersion?: string;
}

/**
 * Result of IR emission.
 */
export interface EmitResult {
  /** The validated Canonical IR. */
  ir: CanonicalIR;
  /** Terraform resource types that had no registry mapping. */
  unmappedTypes: string[];
  /** Graph node IDs that could not be correlated to an HCL resource. */
  uncorrelatedNodes: string[];
}

// ---------------------------------------------------------------------------
// Edge type mapping
// ---------------------------------------------------------------------------

/**
 * Maps graph EdgeType values to IR RelationshipType values.
 */
const EDGE_TYPE_TO_RELATIONSHIP: Record<string, RelationshipType> = {
  explicit_depends_on: 'depends_on',
  attribute_reference: 'references',
  module_output: 'references',
  data_source: 'references',
};

// ---------------------------------------------------------------------------
// IrEmitter class
// ---------------------------------------------------------------------------

/**
 * Transforms HCL ASTs and a dependency graph into a validated Canonical IR.
 *
 * Usage:
 * ```ts
 * const emitter = new IrEmitter(registryApi);
 * const { ir, unmappedTypes, uncorrelatedNodes } = emitter.emit(asts, graph);
 * ```
 */
export class IrEmitter {
  constructor(private readonly registry: RegistryApi) {}

  /**
   * Emit a Canonical IR from parsed ASTs and the dependency graph.
   */
  emit(
    asts: HclAst[],
    graph: DependencyGraph,
    options?: EmitOptions,
  ): EmitResult {
    const version = options?.version ?? '1.0.0';
    const toolVersion = options?.toolVersion ?? '0.1.0';

    logger.info({ astCount: asts.length, version, toolVersion }, 'Starting IR emission');

    // Step 1: Build correlation map — nodeId -> HclResource + filePath
    const correlationMap = this.buildHclCorrelationMap(asts);
    logger.debug({ entries: correlationMap.size }, 'Built HCL correlation map');

    // Step 2: Filter to resource-kind nodes only
    const allNodes = graph.getAllNodes();
    const resourceNodes = allNodes.filter((n) => n.kind === 'resource');

    // Step 3: Build IrResources with registry enrichment
    const unmappedTypes = new Set<string>();
    const uncorrelatedNodes: string[] = [];
    const irResources: IrResource[] = [];
    const resourceIdSet = new Set<string>();

    for (const node of resourceNodes) {
      const hclInfo = correlationMap.get(node.id);
      if (!hclInfo) {
        logger.warn({ nodeId: node.id }, 'Uncorrelated graph node — no HCL resource found');
        uncorrelatedNodes.push(node.id);
        continue;
      }

      const { hclResource, filePath } = hclInfo;
      const resourceType = hclResource.resource_type;

      // Registry lookup
      const registryKey = resolveRegistryKey(resourceType);
      const registryEntry = registryKey !== undefined
        ? this.registry.lookup(registryKey)
        : undefined;

      if (registryEntry === undefined) {
        logger.debug({ resourceType, nodeId: node.id }, 'No registry entry for resource type');
        unmappedTypes.add(resourceType);
      }

      // Normalize attributes
      const normalized = normalizeAttributes(hclResource.attributes);

      // Classify translation status
      const classification = classifyResource(registryEntry, resourceType);

      // Derive category
      const category = this.resolveCategory(registryEntry, resourceType);

      // Derive module path
      const sourceModule = node.metadata.module_path ?? null;

      const irResource: IrResource = {
        id: node.id,
        sourceType: resourceType,
        sourceName: hclResource.name,
        sourceModule,
        category,
        attributes: normalized.attributes,
        sourceAttributes: hclResource.attributes,
        registryEntryId: registryEntry?.registry_entry_id ?? null,
        translationStatus: classification.translationStatus,
        confidence: classification.confidence,
        tags: normalized.tags,
        sourceLocation: {
          file: filePath,
          line: hclResource.meta.source.line,
          column: hclResource.meta.source.column,
        },
      };

      irResources.push(irResource);
      resourceIdSet.add(node.id);
    }

    // Step 4: Map graph edges to IrRelationships (only between emitted resources)
    const allEdges = graph.getAllEdges();
    const irRelationships = this.buildRelationships(allEdges, resourceIdSet);

    // Step 5: Build IrModules from module boundaries
    const irModules = this.buildModules(graph, resourceIdSet);

    // Step 6: Detect intents
    const intents = detectIntents(irResources, irRelationships);

    // Step 7: Build metadata
    const sourceFiles = asts.map((a) => a.file_path);
    const metadata = {
      generatedAt: new Date().toISOString(),
      sourceFiles,
      toolVersion,
      resourceCount: irResources.length,
      relationshipCount: irRelationships.length,
    };

    // Step 8: Validate via Zod schema
    const rawIr = {
      version,
      sourceProvider: 'aws' as const,
      resources: irResources,
      relationships: irRelationships,
      modules: irModules,
      intents,
      metadata,
    };

    const ir = CanonicalIRSchema.parse(rawIr);

    logger.info({
      resources: irResources.length,
      relationships: irRelationships.length,
      modules: irModules.length,
      intents: intents.length,
      unmappedTypes: unmappedTypes.size,
      uncorrelatedNodes: uncorrelatedNodes.length,
    }, 'IR emission complete');

    return {
      ir,
      unmappedTypes: [...unmappedTypes],
      uncorrelatedNodes,
    };
  }

  // ── Private helpers ──────────────────────────────────────────

  /**
   * Build a map from graph node ID to HclResource + filePath.
   * Graph node IDs for resources are `{resource_type}.{name}`.
   */
  private buildHclCorrelationMap(
    asts: HclAst[],
  ): Map<string, { hclResource: HclResource; filePath: string }> {
    const map = new Map<string, { hclResource: HclResource; filePath: string }>();
    for (const ast of asts) {
      for (const resource of ast.resources) {
        const nodeId = `${resource.resource_type}.${resource.name}`;
        if (map.has(nodeId)) {
          // Duplicate node IDs can occur when two AST files declare the same
          // resource type + name. The second entry wins. This should not happen
          // in valid Terraform configurations, but we log it for diagnostics.
          logger.warn({
            nodeId,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by map.has() above
            existing: map.get(nodeId)!.filePath,
            replacement: ast.file_path,
          }, 'Duplicate HCL resource node ID — later entry wins');
        }
        map.set(nodeId, { hclResource: resource, filePath: ast.file_path });
      }
    }
    return map;
  }

  /**
   * Resolve the ResourceCategory for a resource.
   * Prefers the registry entry's aws_family; falls back to the prefix map.
   */
  private resolveCategory(
    entry: RegistryEntry | undefined,
    resourceType: string,
  ): ResourceCategory {
    if (entry !== undefined) {
      return entry.aws_family;
    }
    return resolveCategoryFallback(resourceType);
  }

  /**
   * Map graph edges to IrRelationships, filtering to edges between emitted resources.
   * GraphEdge uses source/target; IrRelationship uses from/to.
   */
  private buildRelationships(
    edges: GraphEdge[],
    resourceIdSet: Set<string>,
  ): IrRelationship[] {
    const relationships: IrRelationship[] = [];
    for (const edge of edges) {
      if (!resourceIdSet.has(edge.source) || !resourceIdSet.has(edge.target)) {
        continue;
      }
      const relType = mapEdgeType(edge.type);
      relationships.push({
        from: edge.source,
        to: edge.target,
        type: relType,
        metadata: edge.attribute !== undefined
          ? { attribute: edge.attribute }
          : undefined,
      });
    }
    return relationships;
  }

  /**
   * Build IrModules from the dependency graph's module boundaries.
   * Only include resource IDs that were emitted.
   */
  private buildModules(
    graph: DependencyGraph,
    resourceIdSet: Set<string>,
  ): IrModule[] {
    const boundaries = graph.getModuleBoundaries();
    const modules: IrModule[] = [];
    for (const boundary of boundaries) {
      const resourceIds = boundary.node_ids.filter((id) => resourceIdSet.has(id));
      if (resourceIds.length === 0) {
        continue;
      }
      modules.push({
        name: boundary.module_name,
        source: boundary.source,
        resources: resourceIds,
      });
    }
    return modules;
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

/**
 * Map a graph EdgeType to an IR RelationshipType.
 */
function mapEdgeType(edgeType: string): RelationshipType {
  return EDGE_TYPE_TO_RELATIONSHIP[edgeType] ?? 'references';
}

/**
 * Fallback category resolution using the AWS_RESOURCE_PREFIX_MAP.
 * Returns 'compute' as the ultimate default if no prefix matches.
 */
function resolveCategoryFallback(resourceType: string): ResourceCategory {
  for (const [prefix, family] of AWS_RESOURCE_PREFIX_MAP) {
    if (resourceType === prefix || resourceType.startsWith(prefix + '_')) {
      return family;
    }
  }
  return 'compute';
}
