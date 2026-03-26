import { z } from 'zod';

/**
 * Types of edges in the dependency graph.
 */
export const EdgeType = z.enum([
  'explicit_depends_on',
  'attribute_reference',
  'module_output',
  'data_source',
]);
export type EdgeType = z.infer<typeof EdgeType>;

/**
 * An edge between two nodes in the dependency graph.
 */
export const GraphEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  type: EdgeType,
  attribute: z.string().optional(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

/**
 * Metadata attached to a graph node (resource, data, variable, etc.).
 */
export const NodeMetadataSchema = z.object({
  resource_type: z.string().optional(),
  provider: z.string().optional(),
  file_path: z.string().optional(),
  line: z.number().int().nonnegative().optional(),
  module_path: z.string().optional(),
});
export type NodeMetadata = z.infer<typeof NodeMetadataSchema>;

/**
 * A node in the dependency graph.
 */
export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'resource',
    'data',
    'variable',
    'local',
    'output',
    'module',
    'provider',
  ]),
  label: z.string().min(1),
  metadata: NodeMetadataSchema,
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

/**
 * A module boundary grouping nodes that belong to the same module call.
 */
export const ModuleBoundarySchema = z.object({
  module_name: z.string().min(1),
  source: z.string().min(1),
  node_ids: z.array(z.string()),
  input_edges: z.array(GraphEdgeSchema),
  output_edges: z.array(GraphEdgeSchema),
});
export type ModuleBoundary = z.infer<typeof ModuleBoundarySchema>;

/**
 * Information about a detected cycle in the graph.
 */
export const CycleInfoSchema = z.object({
  nodes: z.array(z.string()).min(1),
  edges: z.array(GraphEdgeSchema),
});
export type CycleInfo = z.infer<typeof CycleInfoSchema>;

/**
 * Serialized representation of the full dependency graph.
 */
export const SerializedGraphSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  metadata: z.object({
    node_count: z.number().int().nonnegative(),
    edge_count: z.number().int().nonnegative(),
    has_cycles: z.boolean(),
    module_count: z.number().int().nonnegative(),
  }),
});
export type SerializedGraph = z.infer<typeof SerializedGraphSchema>;

/**
 * Result of graph analysis: connected components, critical path, etc.
 */
export const GraphAnalysisSchema = z.object({
  connected_components: z.array(z.array(z.string())),
  critical_path: z.array(z.string()),
  parallel_groups: z.array(z.array(z.string())),
  module_coupling: z.record(
    z.string(),
    z.object({
      afferent: z.number().int().nonnegative(),
      efferent: z.number().int().nonnegative(),
      instability: z.number().min(0).max(1),
    }),
  ),
  cycles: z.array(CycleInfoSchema),
  depth: z.number().int().nonnegative(),
});
export type GraphAnalysis = z.infer<typeof GraphAnalysisSchema>;
