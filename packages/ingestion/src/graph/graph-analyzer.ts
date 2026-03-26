import type { GraphAnalysis, CycleInfo } from '@tla/shared';
import type { DependencyGraph } from './dependency-graph.js';

/**
 * Analyze a frozen DependencyGraph and produce metrics:
 * - Connected components (undirected)
 * - Critical path (longest weighted path via topological order)
 * - Parallel groups (nodes at same topological depth)
 * - Module coupling (afferent/efferent/instability)
 * - Cycles
 * - Maximum depth
 */
export function analyzeGraph(graph: DependencyGraph): GraphAnalysis {
  const cycles = graph.detectCycles();
  const components = findConnectedComponents(graph);
  const { criticalPath, parallelGroups, depth } = computeLayers(graph, cycles);
  const moduleCoupling = computeModuleCoupling(graph);

  return {
    connected_components: components,
    critical_path: criticalPath,
    parallel_groups: parallelGroups,
    module_coupling: moduleCoupling,
    cycles,
    depth,
  };
}

/**
 * BFS-based undirected connected components.
 */
function findConnectedComponents(graph: DependencyGraph): string[][] {
  const allNodes = graph.getAllNodes();
  const visited = new Set<string>();
  const components: string[][] = [];

  // Build undirected adjacency
  const adj = new Map<string, Set<string>>();
  for (const node of allNodes) {
    adj.set(node.id, new Set());
  }
  for (const edge of graph.getAllEdges()) {
    adj.get(edge.source)?.add(edge.target);
    adj.get(edge.target)?.add(edge.source);
  }

  for (const node of allNodes) {
    if (visited.has(node.id)) continue;
    const component: string[] = [];
    const queue = [node.id];
    visited.add(node.id);

    while (queue.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length guard above
      const current = queue.shift()!;
      component.push(current);
      const neighbors = adj.get(current);
      if (neighbors) {
        for (const n of neighbors) {
          if (!visited.has(n)) {
            visited.add(n);
            queue.push(n);
          }
        }
      }
    }
    components.push(component);
  }

  return components;
}

/**
 * Compute topological layers, critical path, and parallel groups.
 * If graph has cycles, returns partial results based on available ordering.
 */
function computeLayers(
  graph: DependencyGraph,
  _cycles: CycleInfo[],
): { criticalPath: string[]; parallelGroups: string[][]; depth: number } {
  let sorted: string[];
  try {
    sorted = graph.topologicalSort();
  } catch {
    // Graph has cycles — work with non-cyclic subset
    if (graph.nodeCount === 0) {
      return { criticalPath: [], parallelGroups: [], depth: 0 };
    }
    // Return partial: each node is its own group
    const allIds = graph.getAllNodes().map((n) => n.id);
    return {
      criticalPath: allIds.slice(0, 1),
      parallelGroups: [allIds],
      depth: 1,
    };
  }

  if (sorted.length === 0) {
    return { criticalPath: [], parallelGroups: [], depth: 0 };
  }

  // Compute depth (longest path ending at each node)
  const depthMap = new Map<string, number>();
  for (const id of sorted) {
    depthMap.set(id, 0);
  }

  for (const id of sorted) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- all sorted ids were set above
    const currentDepth = depthMap.get(id)!;
    const deps = graph.getDependencies(id);
    for (const edge of deps) {
      const targetDepth = depthMap.get(edge.target) ?? 0;
      const newDepth = currentDepth + 1;
      if (newDepth > targetDepth) {
        depthMap.set(edge.target, newDepth);
      }
    }
  }

  // Find maximum depth
  let maxDepth = 0;
  for (const d of depthMap.values()) {
    if (d > maxDepth) maxDepth = d;
  }

  // Group nodes by their depth layer for parallel execution
  const layers = new Map<number, string[]>();
  for (const [id, d] of depthMap) {
    if (!layers.has(d)) layers.set(d, []);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- set in the line above
    layers.get(d)!.push(id);
  }

  const parallelGroups: string[][] = [];
  for (let i = 0; i <= maxDepth; i++) {
    const group = layers.get(i);
    if (group && group.length > 0) {
      parallelGroups.push(group);
    }
  }

  // Critical path: trace from deepest node back through longest chain
  const criticalPath = traceCriticalPath(graph, depthMap, maxDepth);

  return { criticalPath, parallelGroups, depth: maxDepth };
}

/**
 * Trace the critical (longest) path from a leaf back to a root.
 */
function traceCriticalPath(
  graph: DependencyGraph,
  depthMap: Map<string, number>,
  maxDepth: number,
): string[] {
  if (maxDepth === 0) {
    // Return any node at depth 0
    for (const [id, d] of depthMap) {
      if (d === 0) return [id];
    }
    return [];
  }

  // Start at the deepest node
  let deepest: string | undefined;
  for (const [id, d] of depthMap) {
    if (d === maxDepth) {
      deepest = id;
      break;
    }
  }
  if (!deepest) return [];

  const path: string[] = [deepest];
  let current = deepest;

  // Walk backward through dependents to find the chain
  // Returns next node in the critical path, or undefined to stop.
  const nextNode = (node: string): string | undefined => {
    const dependents = graph.getDependents(node);
    if (dependents.length === 0) return undefined;
    let best: string | undefined;
    let bestDepth = -1;
    for (const edge of dependents) {
      const d = depthMap.get(edge.source) ?? -1;
      if (d > bestDepth) {
        bestDepth = d;
        best = edge.source;
      }
    }
    if (!best || bestDepth <= (depthMap.get(node) ?? 0)) return undefined;
    if (path.includes(best)) return undefined;
    return best;
  };
  let next = nextNode(current);
  while (next !== undefined) {
    path.push(next);
    current = next;
    next = nextNode(current);
  }

  return path.reverse();
}

/**
 * Compute coupling metrics for each module boundary.
 */
function computeModuleCoupling(
  graph: DependencyGraph,
): Record<string, { afferent: number; efferent: number; instability: number }> {
  const boundaries = graph.getModuleBoundaries();
  const coupling: Record<
    string,
    { afferent: number; efferent: number; instability: number }
  > = {};

  for (const boundary of boundaries) {
    const afferent = boundary.input_edges.length;
    const efferent = boundary.output_edges.length;
    const total = afferent + efferent;
    const instability = total === 0 ? 0 : efferent / total;

    coupling[boundary.module_name] = {
      afferent,
      efferent,
      instability: Math.round(instability * 1000) / 1000,
    };
  }

  return coupling;
}
