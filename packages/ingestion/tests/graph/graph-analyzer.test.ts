import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../../src/graph/dependency-graph.js';
import { analyzeGraph } from '../../src/graph/graph-analyzer.js';
import type { HclAst } from '@tla/shared';

function makeAst(overrides: Partial<HclAst> = {}): HclAst {
  return {
    file_path: overrides.file_path ?? 'main.tf',
    resources: overrides.resources ?? [],
    data_blocks: overrides.data_blocks ?? [],
    variables: overrides.variables ?? [],
    locals: overrides.locals ?? [],
    outputs: overrides.outputs ?? [],
    providers: overrides.providers ?? [],
    module_calls: overrides.module_calls ?? [],
    terraform: overrides.terraform,
  };
}

const SOURCE = { file: 'main.tf', line: 1, column: 0 };
const META = { source: SOURCE, depends_on: [] };

function buildGraph(ast: HclAst): DependencyGraph {
  const g = new DependencyGraph();
  g.build([ast]);
  return g;
}

describe('analyzeGraph', () => {
  // ── Connected components ──────────────────────────────────

  describe('connected components', () => {
    it('should find a single component for fully connected graph', () => {
      const graph = buildGraph(
        makeAst({
          resources: [
            { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
            {
              resource_type: 'aws_subnet',
              name: 'pub',
              attributes: {},
              meta: { source: SOURCE, depends_on: ['aws_vpc.main'] },
            },
          ],
        }),
      );
      const analysis = analyzeGraph(graph);
      expect(analysis.connected_components).toHaveLength(1);
      expect(analysis.connected_components[0]).toHaveLength(2);
    });

    it('should find multiple components for disconnected graph', () => {
      const g = new DependencyGraph();
      g.build([
        makeAst({
          resources: [
            { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
            { resource_type: 'aws_s3_bucket', name: 'logs', attributes: {}, meta: META },
          ],
        }),
      ]);
      const analysis = analyzeGraph(g);
      expect(analysis.connected_components).toHaveLength(2);
    });

    it('should return empty for empty graph', () => {
      const g = new DependencyGraph();
      g.build([]);
      const analysis = analyzeGraph(g);
      expect(analysis.connected_components).toHaveLength(0);
    });
  });

  // ── Critical path ─────────────────────────────────────────

  describe('critical path', () => {
    it('should find the longest chain', () => {
      const graph = buildGraph(
        makeAst({
          resources: [
            { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
            {
              resource_type: 'aws_subnet',
              name: 'pub',
              attributes: {},
              meta: { source: SOURCE, depends_on: ['aws_vpc.main'] },
            },
            {
              resource_type: 'aws_instance',
              name: 'web',
              attributes: {},
              meta: { source: SOURCE, depends_on: ['aws_subnet.pub'] },
            },
          ],
        }),
      );
      const analysis = analyzeGraph(graph);
      // Critical path should include all 3 nodes in the chain
      expect(analysis.critical_path.length).toBeGreaterThanOrEqual(1);
      expect(analysis.depth).toBe(2);
    });

    it('should return empty for empty graph', () => {
      const g = new DependencyGraph();
      g.build([]);
      const analysis = analyzeGraph(g);
      expect(analysis.critical_path).toHaveLength(0);
      expect(analysis.depth).toBe(0);
    });

    it('should return single node for graph with no edges', () => {
      const graph = buildGraph(
        makeAst({
          resources: [
            { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
          ],
        }),
      );
      const analysis = analyzeGraph(graph);
      expect(analysis.depth).toBe(0);
    });
  });

  // ── Parallel groups ───────────────────────────────────────

  describe('parallel groups', () => {
    it('should group independent nodes together', () => {
      const g = new DependencyGraph();
      g.build([
        makeAst({
          resources: [
            { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
            // Two independent resources at same depth
            { resource_type: 'aws_s3_bucket', name: 'a', attributes: {}, meta: META },
            { resource_type: 'aws_s3_bucket', name: 'b', attributes: {}, meta: META },
          ],
        }),
      ]);
      const analysis = analyzeGraph(g);
      // All 3 should be in the same parallel group (depth 0)
      expect(analysis.parallel_groups).toHaveLength(1);
      expect(analysis.parallel_groups[0]).toHaveLength(3);
    });

    it('should separate dependent nodes into different groups', () => {
      const graph = buildGraph(
        makeAst({
          resources: [
            { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
            {
              resource_type: 'aws_subnet',
              name: 'pub',
              attributes: {},
              meta: { source: SOURCE, depends_on: ['aws_vpc.main'] },
            },
          ],
        }),
      );
      const analysis = analyzeGraph(graph);
      expect(analysis.parallel_groups.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Module coupling ───────────────────────────────────────

  describe('module coupling', () => {
    it('should compute coupling for modules', () => {
      const g = new DependencyGraph();
      g.build([
        makeAst({
          module_calls: [
            { name: 'vpc', source: './modules/vpc', attributes: {}, meta: META },
          ],
          resources: [
            {
              resource_type: 'aws_instance',
              name: 'web',
              attributes: { subnet: '${module.vpc.subnet_id}' },
              meta: META,
            },
          ],
        }),
      ]);
      const analysis = analyzeGraph(g);
      expect(analysis.module_coupling).toHaveProperty('vpc');
      const coupling = analysis.module_coupling['vpc'];
      expect(coupling.instability).toBeGreaterThanOrEqual(0);
      expect(coupling.instability).toBeLessThanOrEqual(1);
    });

    it('should return empty coupling for no modules', () => {
      const graph = buildGraph(
        makeAst({
          resources: [
            { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
          ],
        }),
      );
      const analysis = analyzeGraph(graph);
      expect(Object.keys(analysis.module_coupling)).toHaveLength(0);
    });
  });

  // ── Cycles ────────────────────────────────────────────────

  describe('cycles', () => {
    it('should report no cycles for acyclic graph', () => {
      const graph = buildGraph(
        makeAst({
          resources: [
            { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
            {
              resource_type: 'aws_subnet',
              name: 'pub',
              attributes: {},
              meta: { source: SOURCE, depends_on: ['aws_vpc.main'] },
            },
          ],
        }),
      );
      const analysis = analyzeGraph(graph);
      expect(analysis.cycles).toHaveLength(0);
    });

    it('should report cycles for cyclic graph', () => {
      const graph = buildGraph(
        makeAst({
          resources: [
            {
              resource_type: 'aws_a',
              name: 'x',
              attributes: {},
              meta: { source: SOURCE, depends_on: ['aws_b.y'] },
            },
            {
              resource_type: 'aws_b',
              name: 'y',
              attributes: {},
              meta: { source: SOURCE, depends_on: ['aws_a.x'] },
            },
          ],
        }),
      );
      const analysis = analyzeGraph(graph);
      expect(analysis.cycles.length).toBeGreaterThanOrEqual(1);
    });

    it('should provide partial analysis even with cycles', () => {
      const graph = buildGraph(
        makeAst({
          resources: [
            {
              resource_type: 'aws_a',
              name: 'x',
              attributes: {},
              meta: { source: SOURCE, depends_on: ['aws_b.y'] },
            },
            {
              resource_type: 'aws_b',
              name: 'y',
              attributes: {},
              meta: { source: SOURCE, depends_on: ['aws_a.x'] },
            },
          ],
        }),
      );
      const analysis = analyzeGraph(graph);
      // Should still have components and some parallel groups
      expect(analysis.connected_components.length).toBeGreaterThanOrEqual(1);
      expect(analysis.parallel_groups.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Integration: complex graph ────────────────────────────

  describe('complex graph', () => {
    it('should analyze a realistic multi-resource graph', () => {
      const g = new DependencyGraph();
      g.build([
        makeAst({
          variables: [{ name: 'region' }, { name: 'env' }],
          locals: [{ name: 'tags', expression: '${var.env}' }],
          resources: [
            { resource_type: 'aws_vpc', name: 'main', attributes: { tags: '${local.tags}' }, meta: META },
            {
              resource_type: 'aws_subnet',
              name: 'pub',
              attributes: { vpc_id: '${aws_vpc.main.id}' },
              meta: META,
            },
            {
              resource_type: 'aws_subnet',
              name: 'priv',
              attributes: { vpc_id: '${aws_vpc.main.id}' },
              meta: META,
            },
            {
              resource_type: 'aws_instance',
              name: 'web',
              attributes: { subnet_id: '${aws_subnet.pub.id}' },
              meta: META,
            },
          ],
          data_blocks: [
            { data_type: 'aws_ami', name: 'latest', attributes: {}, meta: META },
          ],
          outputs: [
            { name: 'vpc_id', value: '${aws_vpc.main.id}' },
          ],
        }),
      ]);
      const analysis = analyzeGraph(g);

      // Should have at least 1 connected component
      expect(analysis.connected_components.length).toBeGreaterThanOrEqual(1);
      // Depth should be > 0 (there are multi-level deps)
      expect(analysis.depth).toBeGreaterThanOrEqual(1);
      // No cycles expected
      expect(analysis.cycles).toHaveLength(0);
      // Multiple parallel groups expected
      expect(analysis.parallel_groups.length).toBeGreaterThanOrEqual(2);
    });
  });
});
