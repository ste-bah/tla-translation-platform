import type {
  HclAst,
  HclResource,
  HclDataBlock,
  HclModuleCall,
} from '@tla/shared';
import type {
  GraphNode,
  GraphEdge,
  EdgeType,
  ModuleBoundary,
  CycleInfo,
  SerializedGraph,
} from '@tla/shared';
import { IngestionError } from '@tla/shared';

/**
 * Reference pattern: matches Terraform interpolation references such as
 *   aws_s3_bucket.my_bucket.id
 *   data.aws_ami.latest.id
 *   module.vpc.subnet_ids
 *   var.region
 *   local.common_tags
 */
const REFERENCE_RE =
  /(?:(?:(?:data)\.([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*))|(?:module\.([a-zA-Z_][a-zA-Z0-9_]*))|(?:var\.([a-zA-Z_][a-zA-Z0-9_]*))|(?:local\.([a-zA-Z_][a-zA-Z0-9_]*))|(?:([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)))(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*/g;

/**
 * Builds and queries an immutable dependency graph from parsed HCL ASTs.
 *
 * Usage:
 *   const graph = new DependencyGraph();
 *   graph.build(asts);
 *   const sorted = graph.topologicalSort();
 */
export class DependencyGraph {
  private _nodes = new Map<string, GraphNode>();
  private _forward = new Map<string, Map<string, GraphEdge>>();
  private _reverse = new Map<string, Map<string, GraphEdge>>();
  private _frozen = false;

  // ── Construction ──────────────────────────────────────────────

  /**
   * Build the dependency graph from an array of HCL ASTs.
   * May only be called once; subsequent calls throw.
   */
  build(asts: HclAst[]): void {
    if (this._frozen) {
      throw new IngestionError('Graph is already built and frozen', {
        hint: 'Create a new DependencyGraph instance',
      });
    }

    for (const ast of asts) {
      this._indexAst(ast);
    }

    for (const ast of asts) {
      this._extractEdges(ast);
    }

    this._frozen = true;
  }

  // ── Public Queries ────────────────────────────────────────────

  get nodeCount(): number {
    return this._nodes.size;
  }

  get edgeCount(): number {
    let count = 0;
    for (const edges of this._forward.values()) {
      count += edges.size;
    }
    return count;
  }

  getNode(id: string): GraphNode | undefined {
    return this._nodes.get(id);
  }

  getAllNodes(): GraphNode[] {
    return [...this._nodes.values()];
  }

  getAllEdges(): GraphEdge[] {
    const edges: GraphEdge[] = [];
    for (const map of this._forward.values()) {
      for (const edge of map.values()) {
        edges.push(edge);
      }
    }
    return edges;
  }

  /**
   * Direct dependencies of a node (nodes it depends ON).
   */
  getDependencies(nodeId: string): GraphEdge[] {
    const map = this._forward.get(nodeId);
    return map ? [...map.values()] : [];
  }

  /**
   * Direct dependents of a node (nodes that depend on IT).
   */
  getDependents(nodeId: string): GraphEdge[] {
    const map = this._reverse.get(nodeId);
    return map ? [...map.values()] : [];
  }

  /**
   * All transitive dependencies (recursive forward walk).
   */
  getTransitiveDependencies(nodeId: string): Set<string> {
    const visited = new Set<string>();
    const stack = [nodeId];
    while (stack.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length guard above
      const current = stack.pop()!;
      const deps = this._forward.get(current);
      if (!deps) continue;
      for (const edge of deps.values()) {
        if (!visited.has(edge.target)) {
          visited.add(edge.target);
          stack.push(edge.target);
        }
      }
    }
    return visited;
  }

  /**
   * Kahn's algorithm for topological sort.
   * Returns node IDs in dependency order (leaves first).
   * Throws if the graph has cycles.
   */
  topologicalSort(): string[] {
    this._ensureFrozen();

    const inDegree = new Map<string, number>();
    for (const id of this._nodes.keys()) {
      inDegree.set(id, 0);
    }
    for (const map of this._forward.values()) {
      for (const edge of map.values()) {
        inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length guard above
      const node = queue.shift()!;
      sorted.push(node);
      const deps = this._forward.get(node);
      if (deps) {
        for (const edge of deps.values()) {
          const newDeg = (inDegree.get(edge.target) ?? 1) - 1;
          inDegree.set(edge.target, newDeg);
          if (newDeg === 0) queue.push(edge.target);
        }
      }
    }

    if (sorted.length !== this._nodes.size) {
      throw new IngestionError('Dependency graph contains cycles', {
        sorted_count: sorted.length,
        total_count: this._nodes.size,
      });
    }
    return sorted;
  }

  /**
   * Detect cycles using iterative DFS with coloring.
   * WHITE=0 (unvisited), GRAY=1 (in stack), BLACK=2 (done).
   */
  detectCycles(): CycleInfo[] {
    this._ensureFrozen();

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const id of this._nodes.keys()) {
      color.set(id, WHITE);
    }

    const parent = new Map<string, string | null>();
    const cycles: CycleInfo[] = [];

    for (const startId of this._nodes.keys()) {
      if (color.get(startId) !== WHITE) continue;

      const stack: Array<{ id: string; iter: IterableIterator<GraphEdge> }> = [];
      color.set(startId, GRAY);
      parent.set(startId, null);
      const deps = this._forward.get(startId);
      stack.push({
        id: startId,
        iter: deps ? deps.values() : ([][Symbol.iterator]() as IterableIterator<GraphEdge>),
      });

      while (stack.length > 0) {
        // noUncheckedIndexedAccess: last element is guaranteed by length guard
        const top = stack[stack.length - 1] as (typeof stack)[number];
        const next = top.iter.next();

        if (next.done) {
          color.set(top.id, BLACK);
          stack.pop();
          continue;
        }

        const edge = next.value;
        const neighborColor = color.get(edge.target);

        if (neighborColor === WHITE) {
          color.set(edge.target, GRAY);
          parent.set(edge.target, top.id);
          const neighborDeps = this._forward.get(edge.target);
          stack.push({
            id: edge.target,
            iter: neighborDeps
              ? neighborDeps.values()
              : ([][Symbol.iterator]() as IterableIterator<GraphEdge>),
          });
        } else if (neighborColor === GRAY) {
          // Found cycle - trace back
          const cycleNodes: string[] = [edge.target];
          let cur = top.id;
          while (cur !== edge.target) {
            cycleNodes.push(cur);
            cur = parent.get(cur) ?? edge.target;
          }
          cycleNodes.reverse();

          const cycleEdges: GraphEdge[] = [];
          for (let i = 0; i < cycleNodes.length; i++) {
            const from = cycleNodes[i] ?? '';
            const to = cycleNodes[(i + 1) % cycleNodes.length] ?? '';
            const fwdMap = this._forward.get(from);
            if (fwdMap && from && to) {
              const edgeKey = `${from}->${to}`;
              const found = fwdMap.get(edgeKey);
              if (found) cycleEdges.push(found);
            }
          }

          cycles.push({ nodes: cycleNodes, edges: cycleEdges });
        }
      }
    }
    return cycles;
  }

  /**
   * Identify module boundaries: group nodes by module call and find
   * edges crossing module boundaries.
   */
  getModuleBoundaries(): ModuleBoundary[] {
    this._ensureFrozen();

    const moduleNodes = new Map<string, string[]>();
    const moduleSources = new Map<string, string>();

    for (const [id, node] of this._nodes) {
      if (node.kind === 'module') {
        const name = node.label.replace('module.', '');
        if (!moduleNodes.has(name)) {
          moduleNodes.set(name, []);
          moduleSources.set(name, node.metadata.resource_type ?? 'unknown');
        }
        (moduleNodes.get(name) as string[]).push(id);
      }
      if (node.metadata.module_path) {
        const modName = node.metadata.module_path;
        if (!moduleNodes.has(modName)) {
          moduleNodes.set(modName, []);
          moduleSources.set(modName, 'unknown');
        }
        (moduleNodes.get(modName) as string[]).push(id);
      }
    }

    const boundaries: ModuleBoundary[] = [];
    for (const [name, nodeIds] of moduleNodes) {
      const nodeSet = new Set(nodeIds);
      const inputEdges: GraphEdge[] = [];
      const outputEdges: GraphEdge[] = [];

      for (const nid of nodeIds) {
        // Edges coming IN from outside the module
        const revMap = this._reverse.get(nid);
        if (revMap) {
          for (const edge of revMap.values()) {
            if (!nodeSet.has(edge.source)) {
              inputEdges.push(edge);
            }
          }
        }
        // Edges going OUT to outside the module
        const fwdMap = this._forward.get(nid);
        if (fwdMap) {
          for (const edge of fwdMap.values()) {
            if (!nodeSet.has(edge.target)) {
              outputEdges.push(edge);
            }
          }
        }
      }

      boundaries.push({
        module_name: name,
        source: moduleSources.get(name) ?? 'unknown',
        node_ids: nodeIds,
        input_edges: inputEdges,
        output_edges: outputEdges,
      });
    }
    return boundaries;
  }

  /**
   * Extract a subgraph containing only the specified node IDs and
   * edges between them.
   */
  getSubgraph(nodeIds: string[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
    this._ensureFrozen();
    const idSet = new Set(nodeIds);
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const id of nodeIds) {
      const node = this._nodes.get(id);
      if (node) nodes.push(node);
    }

    for (const id of nodeIds) {
      const fwdMap = this._forward.get(id);
      if (!fwdMap) continue;
      for (const edge of fwdMap.values()) {
        if (idSet.has(edge.target)) {
          edges.push(edge);
        }
      }
    }
    return { nodes, edges };
  }

  /**
   * Serialize the graph for storage/transport.
   */
  toJson(): SerializedGraph {
    this._ensureFrozen();
    const cycles = this.detectCycles();
    const moduleBoundaries = this.getModuleBoundaries();
    return {
      nodes: this.getAllNodes(),
      edges: this.getAllEdges(),
      metadata: {
        node_count: this.nodeCount,
        edge_count: this.edgeCount,
        has_cycles: cycles.length > 0,
        module_count: moduleBoundaries.length,
      },
    };
  }

  // ── Private Helpers ───────────────────────────────────────────

  private _ensureFrozen(): void {
    if (!this._frozen) {
      throw new IngestionError('Graph has not been built yet; call build() first');
    }
  }

  private _addNode(node: GraphNode): void {
    this._nodes.set(node.id, node);
    if (!this._forward.has(node.id)) this._forward.set(node.id, new Map());
    if (!this._reverse.has(node.id)) this._reverse.set(node.id, new Map());
  }

  private _addEdge(edge: GraphEdge): void {
    const key = `${edge.source}->${edge.target}`;
    let fwd = this._forward.get(edge.source);
    if (!fwd) {
      fwd = new Map();
      this._forward.set(edge.source, fwd);
    }
    // Don't overwrite: first edge wins (explicit_depends_on > attribute_reference)
    if (!fwd.has(key)) {
      fwd.set(key, edge);
    }

    let rev = this._reverse.get(edge.target);
    if (!rev) {
      rev = new Map();
      this._reverse.set(edge.target, rev);
    }
    if (!rev.has(key)) {
      rev.set(key, edge);
    }
  }

  private _nodeIdForResource(r: HclResource): string {
    return `${r.resource_type}.${r.name}`;
  }

  private _nodeIdForData(d: HclDataBlock): string {
    return `data.${d.data_type}.${d.name}`;
  }

  private _nodeIdForModule(m: HclModuleCall): string {
    return `module.${m.name}`;
  }

  /**
   * Index all blocks in an AST as graph nodes.
   */
  private _indexAst(ast: HclAst): void {
    for (const r of ast.resources) {
      this._addNode({
        id: this._nodeIdForResource(r),
        kind: 'resource',
        label: `${r.resource_type}.${r.name}`,
        metadata: {
          resource_type: r.resource_type,
          provider: r.meta.provider,
          file_path: ast.file_path,
          line: r.meta.source.line,
        },
      });
    }

    for (const d of ast.data_blocks) {
      this._addNode({
        id: this._nodeIdForData(d),
        kind: 'data',
        label: `data.${d.data_type}.${d.name}`,
        metadata: {
          resource_type: d.data_type,
          provider: d.meta.provider,
          file_path: ast.file_path,
          line: d.meta.source.line,
        },
      });
    }

    for (const v of ast.variables) {
      this._addNode({
        id: `var.${v.name}`,
        kind: 'variable',
        label: `var.${v.name}`,
        metadata: { file_path: ast.file_path },
      });
    }

    for (const l of ast.locals) {
      this._addNode({
        id: `local.${l.name}`,
        kind: 'local',
        label: `local.${l.name}`,
        metadata: { file_path: ast.file_path },
      });
    }

    for (const o of ast.outputs) {
      this._addNode({
        id: `output.${o.name}`,
        kind: 'output',
        label: `output.${o.name}`,
        metadata: { file_path: ast.file_path },
      });
    }

    for (const m of ast.module_calls) {
      this._addNode({
        id: this._nodeIdForModule(m),
        kind: 'module',
        label: `module.${m.name}`,
        metadata: {
          resource_type: m.source,
          file_path: ast.file_path,
          line: m.meta.source.line,
        },
      });
    }
  }

  /**
   * Extract edges from an AST: explicit depends_on + attribute references.
   */
  private _extractEdges(ast: HclAst): void {
    // Helper: add explicit depends_on edges
    const addExplicit = (sourceId: string, dependsOn: string[]) => {
      for (const dep of dependsOn) {
        if (this._nodes.has(dep)) {
          this._addEdge({
            source: sourceId,
            target: dep,
            type: 'explicit_depends_on',
          });
        }
      }
    };

    // Helper: scan attributes for references
    const addAttrRefs = (sourceId: string, attributes: Record<string, unknown>) => {
      const json = JSON.stringify(attributes);
      const refs = this._extractReferences(json);
      for (const ref of refs) {
        if (ref !== sourceId && this._nodes.has(ref)) {
          const type: EdgeType = ref.startsWith('data.')
            ? 'data_source'
            : ref.startsWith('module.')
              ? 'module_output'
              : 'attribute_reference';
          this._addEdge({ source: sourceId, target: ref, type, attribute: undefined });
        }
      }
    };

    for (const r of ast.resources) {
      const id = this._nodeIdForResource(r);
      addExplicit(id, r.meta.depends_on);
      addAttrRefs(id, r.attributes);
    }

    for (const d of ast.data_blocks) {
      const id = this._nodeIdForData(d);
      addExplicit(id, d.meta.depends_on);
      addAttrRefs(id, d.attributes);
    }

    for (const m of ast.module_calls) {
      const id = this._nodeIdForModule(m);
      addExplicit(id, m.meta.depends_on);
      addAttrRefs(id, m.attributes);
    }

    for (const l of ast.locals) {
      const id = `local.${l.name}`;
      const json = JSON.stringify(l.expression);
      const refs = this._extractReferences(json);
      for (const ref of refs) {
        if (ref !== id && this._nodes.has(ref)) {
          this._addEdge({
            source: id,
            target: ref,
            type: 'attribute_reference',
          });
        }
      }
    }

    for (const o of ast.outputs) {
      const id = `output.${o.name}`;
      const json = JSON.stringify(o.value);
      const refs = this._extractReferences(json);
      for (const ref of refs) {
        if (ref !== id && this._nodes.has(ref)) {
          this._addEdge({
            source: id,
            target: ref,
            type: 'attribute_reference',
          });
        }
      }
    }
  }

  /**
   * Extract Terraform reference IDs from a stringified JSON blob.
   * Returns canonical node IDs: "aws_s3_bucket.foo", "data.aws_ami.bar",
   * "module.vpc", "var.region", "local.tags".
   */
  private _extractReferences(text: string): string[] {
    const refs: string[] = [];
    let match: RegExpExecArray | null;

    // Reset lastIndex for global regex
    REFERENCE_RE.lastIndex = 0;

    while ((match = REFERENCE_RE.exec(text)) !== null) {
      if (match[1] && match[2]) {
        // data.<type>.<name>
        refs.push(`data.${match[1]}.${match[2]}`);
      } else if (match[3]) {
        // module.<name>
        refs.push(`module.${match[3]}`);
      } else if (match[4]) {
        // var.<name>
        refs.push(`var.${match[4]}`);
      } else if (match[5]) {
        // local.<name>
        refs.push(`local.${match[5]}`);
      } else if (match[6] && match[7]) {
        // <resource_type>.<name>
        refs.push(`${match[6]}.${match[7]}`);
      }
    }

    return [...new Set(refs)];
  }
}
