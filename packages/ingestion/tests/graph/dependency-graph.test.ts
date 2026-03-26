import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyGraph } from '../../src/graph/dependency-graph.js';
import type { HclAst } from '@tla/shared';

/**
 * Factory: minimal valid HclAst.
 */
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

describe('DependencyGraph', () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  // ── build() ─────────────────────────────────────────────────

  describe('build()', () => {
    it('should index resources as nodes', () => {
      graph.build([
        makeAst({
          resources: [
            { resource_type: 'aws_s3_bucket', name: 'data', attributes: {}, meta: META },
          ],
        }),
      ]);
      expect(graph.nodeCount).toBe(1);
      expect(graph.getNode('aws_s3_bucket.data')).toBeDefined();
      expect(graph.getNode('aws_s3_bucket.data')!.kind).toBe('resource');
    });

    it('should index data blocks', () => {
      graph.build([
        makeAst({
          data_blocks: [
            { data_type: 'aws_ami', name: 'latest', attributes: {}, meta: META },
          ],
        }),
      ]);
      expect(graph.getNode('data.aws_ami.latest')).toBeDefined();
      expect(graph.getNode('data.aws_ami.latest')!.kind).toBe('data');
    });

    it('should index variables, locals, outputs', () => {
      graph.build([
        makeAst({
          variables: [{ name: 'region' }],
          locals: [{ name: 'tags', expression: {} }],
          outputs: [{ name: 'bucket_arn', value: '' }],
        }),
      ]);
      expect(graph.getNode('var.region')).toBeDefined();
      expect(graph.getNode('local.tags')).toBeDefined();
      expect(graph.getNode('output.bucket_arn')).toBeDefined();
    });

    it('should index module calls', () => {
      graph.build([
        makeAst({
          module_calls: [
            { name: 'vpc', source: './modules/vpc', attributes: {}, meta: META },
          ],
        }),
      ]);
      expect(graph.getNode('module.vpc')).toBeDefined();
      expect(graph.getNode('module.vpc')!.kind).toBe('module');
    });

    it('should throw if build() is called twice', () => {
      graph.build([makeAst()]);
      expect(() => graph.build([makeAst()])).toThrow('already built');
    });

    it('should handle empty AST array', () => {
      graph.build([]);
      expect(graph.nodeCount).toBe(0);
      expect(graph.edgeCount).toBe(0);
    });

    it('should handle multiple ASTs', () => {
      graph.build([
        makeAst({
          resources: [
            { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
          ],
        }),
        makeAst({
          file_path: 'subnets.tf',
          resources: [
            { resource_type: 'aws_subnet', name: 'pub', attributes: {}, meta: META },
          ],
        }),
      ]);
      expect(graph.nodeCount).toBe(2);
    });
  });

  // ── Edge extraction ─────────────────────────────────────────

  describe('edge extraction', () => {
    it('should create explicit_depends_on edges', () => {
      graph.build([
        makeAst({
          resources: [
            {
              resource_type: 'aws_vpc',
              name: 'main',
              attributes: {},
              meta: { ...META },
            },
            {
              resource_type: 'aws_subnet',
              name: 'pub',
              attributes: {},
              meta: { source: SOURCE, depends_on: ['aws_vpc.main'] },
            },
          ],
        }),
      ]);
      const deps = graph.getDependencies('aws_subnet.pub');
      expect(deps).toHaveLength(1);
      expect(deps[0].target).toBe('aws_vpc.main');
      expect(deps[0].type).toBe('explicit_depends_on');
    });

    it('should create attribute_reference edges from interpolations', () => {
      graph.build([
        makeAst({
          resources: [
            {
              resource_type: 'aws_vpc',
              name: 'main',
              attributes: { cidr_block: '10.0.0.0/16' },
              meta: META,
            },
            {
              resource_type: 'aws_subnet',
              name: 'pub',
              attributes: { vpc_id: '${aws_vpc.main.id}' },
              meta: META,
            },
          ],
        }),
      ]);
      const deps = graph.getDependencies('aws_subnet.pub');
      expect(deps.some((e) => e.target === 'aws_vpc.main' && e.type === 'attribute_reference')).toBe(true);
    });

    it('should create data_source edges', () => {
      graph.build([
        makeAst({
          data_blocks: [
            { data_type: 'aws_ami', name: 'latest', attributes: {}, meta: META },
          ],
          resources: [
            {
              resource_type: 'aws_instance',
              name: 'web',
              attributes: { ami: '${data.aws_ami.latest.id}' },
              meta: META,
            },
          ],
        }),
      ]);
      const deps = graph.getDependencies('aws_instance.web');
      expect(deps.some((e) => e.target === 'data.aws_ami.latest' && e.type === 'data_source')).toBe(true);
    });

    it('should create module_output edges', () => {
      graph.build([
        makeAst({
          module_calls: [
            { name: 'vpc', source: './modules/vpc', attributes: {}, meta: META },
          ],
          resources: [
            {
              resource_type: 'aws_instance',
              name: 'web',
              attributes: { subnet_id: '${module.vpc.subnet_id}' },
              meta: META,
            },
          ],
        }),
      ]);
      const deps = graph.getDependencies('aws_instance.web');
      expect(deps.some((e) => e.target === 'module.vpc' && e.type === 'module_output')).toBe(true);
    });

    it('should extract variable references', () => {
      graph.build([
        makeAst({
          variables: [{ name: 'region' }],
          resources: [
            {
              resource_type: 'aws_instance',
              name: 'web',
              attributes: { region: '${var.region}' },
              meta: META,
            },
          ],
        }),
      ]);
      const deps = graph.getDependencies('aws_instance.web');
      expect(deps.some((e) => e.target === 'var.region')).toBe(true);
    });

    it('should extract local references', () => {
      graph.build([
        makeAst({
          locals: [{ name: 'tags', expression: { env: 'prod' } }],
          resources: [
            {
              resource_type: 'aws_instance',
              name: 'web',
              attributes: { tags: '${local.tags}' },
              meta: META,
            },
          ],
        }),
      ]);
      const deps = graph.getDependencies('aws_instance.web');
      expect(deps.some((e) => e.target === 'local.tags')).toBe(true);
    });

    it('should skip self-references', () => {
      graph.build([
        makeAst({
          resources: [
            {
              resource_type: 'aws_instance',
              name: 'web',
              attributes: { self: 'aws_instance.web' },
              meta: META,
            },
          ],
        }),
      ]);
      expect(graph.getDependencies('aws_instance.web')).toHaveLength(0);
    });

    it('should skip references to non-existent nodes', () => {
      graph.build([
        makeAst({
          resources: [
            {
              resource_type: 'aws_instance',
              name: 'web',
              attributes: { vpc_id: '${aws_vpc.nonexistent.id}' },
              meta: META,
            },
          ],
        }),
      ]);
      expect(graph.getDependencies('aws_instance.web')).toHaveLength(0);
    });

    it('should extract references from outputs', () => {
      graph.build([
        makeAst({
          resources: [
            { resource_type: 'aws_s3_bucket', name: 'data', attributes: {}, meta: META },
          ],
          outputs: [
            { name: 'bucket_arn', value: '${aws_s3_bucket.data.arn}' },
          ],
        }),
      ]);
      const deps = graph.getDependencies('output.bucket_arn');
      expect(deps.some((e) => e.target === 'aws_s3_bucket.data')).toBe(true);
    });

    it('should extract references from locals', () => {
      graph.build([
        makeAst({
          variables: [{ name: 'env' }],
          locals: [{ name: 'prefix', expression: '${var.env}-app' }],
        }),
      ]);
      const deps = graph.getDependencies('local.prefix');
      expect(deps.some((e) => e.target === 'var.env')).toBe(true);
    });
  });

  // ── getDependencies / getDependents ─────────────────────────

  describe('getDependencies / getDependents', () => {
    it('should return empty for nodes with no edges', () => {
      graph.build([
        makeAst({
          resources: [
            { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
          ],
        }),
      ]);
      expect(graph.getDependencies('aws_vpc.main')).toHaveLength(0);
      expect(graph.getDependents('aws_vpc.main')).toHaveLength(0);
    });

    it('should return empty for unknown node IDs', () => {
      graph.build([makeAst()]);
      expect(graph.getDependencies('does.not.exist')).toHaveLength(0);
      expect(graph.getDependents('does.not.exist')).toHaveLength(0);
    });

    it('should correctly report dependents (reverse edges)', () => {
      graph.build([
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
      ]);
      const dependents = graph.getDependents('aws_vpc.main');
      expect(dependents).toHaveLength(1);
      expect(dependents[0].source).toBe('aws_subnet.pub');
    });
  });

  // ── getTransitiveDependencies ───────────────────────────────

  describe('getTransitiveDependencies', () => {
    it('should return all transitive deps in a chain', () => {
      graph.build([
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
      ]);
      const transitive = graph.getTransitiveDependencies('aws_instance.web');
      expect(transitive.has('aws_subnet.pub')).toBe(true);
      expect(transitive.has('aws_vpc.main')).toBe(true);
    });

    it('should return empty set for leaf nodes', () => {
      graph.build([
        makeAst({
          resources: [
            { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
          ],
        }),
      ]);
      expect(graph.getTransitiveDependencies('aws_vpc.main').size).toBe(0);
    });

    it('should return empty set for unknown nodes', () => {
      graph.build([makeAst()]);
      expect(graph.getTransitiveDependencies('unknown.node').size).toBe(0);
    });
  });

  // ── topologicalSort ─────────────────────────────────────────

  describe('topologicalSort', () => {
    it('should return nodes in dependency order', () => {
      graph.build([
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
      ]);
      const sorted = graph.topologicalSort();
      const vpcIdx = sorted.indexOf('aws_vpc.main');
      const subnetIdx = sorted.indexOf('aws_subnet.pub');
      const instanceIdx = sorted.indexOf('aws_instance.web');
      // instance depends on subnet depends on vpc
      // In Kahn's, sources come first — instance should come before subnet before vpc
      // because instance has no incoming edges in the forward graph
      expect(instanceIdx).toBeLessThan(subnetIdx);
      expect(subnetIdx).toBeLessThan(vpcIdx);
    });

    it('should return empty array for empty graph', () => {
      graph.build([]);
      expect(graph.topologicalSort()).toEqual([]);
    });

    it('should throw on cyclic graph', () => {
      graph.build([
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
      ]);
      expect(() => graph.topologicalSort()).toThrow('cycles');
    });

    it('should throw if graph is not yet built', () => {
      expect(() => graph.topologicalSort()).toThrow('not been built');
    });
  });

  // ── detectCycles ────────────────────────────────────────────

  describe('detectCycles', () => {
    it('should return empty array for acyclic graph', () => {
      graph.build([
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
      ]);
      expect(graph.detectCycles()).toHaveLength(0);
    });

    it('should detect a simple 2-node cycle', () => {
      graph.build([
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
      ]);
      const cycles = graph.detectCycles();
      expect(cycles.length).toBeGreaterThanOrEqual(1);
      const allCycleNodes = cycles.flatMap((c) => c.nodes);
      expect(allCycleNodes).toContain('aws_a.x');
      expect(allCycleNodes).toContain('aws_b.y');
    });

    it('should detect a 3-node cycle', () => {
      graph.build([
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
              meta: { source: SOURCE, depends_on: ['aws_c.z'] },
            },
            {
              resource_type: 'aws_c',
              name: 'z',
              attributes: {},
              meta: { source: SOURCE, depends_on: ['aws_a.x'] },
            },
          ],
        }),
      ]);
      const cycles = graph.detectCycles();
      expect(cycles.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty for empty graph', () => {
      graph.build([]);
      expect(graph.detectCycles()).toHaveLength(0);
    });
  });

  // ── getModuleBoundaries ─────────────────────────────────────

  describe('getModuleBoundaries', () => {
    it('should identify module boundaries', () => {
      graph.build([
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
      const boundaries = graph.getModuleBoundaries();
      expect(boundaries.length).toBeGreaterThanOrEqual(1);
      expect(boundaries[0].module_name).toBe('vpc');
    });

    it('should return empty for graphs with no modules', () => {
      graph.build([
        makeAst({
          resources: [
            { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
          ],
        }),
      ]);
      expect(graph.getModuleBoundaries()).toHaveLength(0);
    });
  });

  // ── getSubgraph ─────────────────────────────────────────────

  describe('getSubgraph', () => {
    it('should return only specified nodes and their inter-edges', () => {
      graph.build([
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
      ]);
      const sub = graph.getSubgraph(['aws_vpc.main', 'aws_subnet.pub']);
      expect(sub.nodes).toHaveLength(2);
      expect(sub.edges).toHaveLength(1);
      expect(sub.edges[0].source).toBe('aws_subnet.pub');
      expect(sub.edges[0].target).toBe('aws_vpc.main');
    });

    it('should return empty for empty ID list', () => {
      graph.build([
        makeAst({
          resources: [
            { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
          ],
        }),
      ]);
      const sub = graph.getSubgraph([]);
      expect(sub.nodes).toHaveLength(0);
      expect(sub.edges).toHaveLength(0);
    });

    it('should skip unknown IDs gracefully', () => {
      graph.build([
        makeAst({
          resources: [
            { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
          ],
        }),
      ]);
      const sub = graph.getSubgraph(['aws_vpc.main', 'does.not.exist']);
      expect(sub.nodes).toHaveLength(1);
    });
  });

  // ── toJson ──────────────────────────────────────────────────

  describe('toJson', () => {
    it('should produce valid serialized graph', () => {
      graph.build([
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
      ]);
      const json = graph.toJson();
      expect(json.nodes).toHaveLength(2);
      expect(json.edges).toHaveLength(1);
      expect(json.metadata.node_count).toBe(2);
      expect(json.metadata.edge_count).toBe(1);
      expect(json.metadata.has_cycles).toBe(false);
    });

    it('should throw if graph not built', () => {
      expect(() => graph.toJson()).toThrow('not been built');
    });
  });

  // ── getAllNodes / getAllEdges ─────────────────────────────────

  describe('getAllNodes / getAllEdges', () => {
    it('should return all nodes and edges', () => {
      graph.build([
        makeAst({
          resources: [
            { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
            {
              resource_type: 'aws_subnet',
              name: 'pub',
              attributes: { vpc_id: '${aws_vpc.main.id}' },
              meta: META,
            },
          ],
        }),
      ]);
      expect(graph.getAllNodes()).toHaveLength(2);
      expect(graph.getAllEdges()).toHaveLength(1);
    });
  });
});
