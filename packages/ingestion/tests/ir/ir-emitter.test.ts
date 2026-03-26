import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IrEmitter } from '../../src/ir/ir-emitter.js';
import { DependencyGraph } from '../../src/graph/dependency-graph.js';
import type { HclAst, RegistryEntry } from '@tla/shared';
import type { RegistryApi } from '@tla/registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegistryEntry(overrides: Partial<RegistryEntry>): RegistryEntry {
  return {
    registry_entry_id: 'SER-STO-S3-001',
    aws_service: 's3',
    aws_family: 'storage',
    azure_targets: ['azurerm_storage_account'],
    gcp_targets: ['google_storage_bucket'],
    mapping_type: 'parametric',
    output_mode: 'portable',
    band: 'P1',
    confidence: 0.88,
    portable_provider_candidate: true,
    behavioral_gaps: [],
    manual_review_required: false,
    review_domains: [],
    test_status: 'unit_tested',
    owner: 'platform-team',
    registry_version: '2026.03.13',
    last_updated: '2026-03-13T10:00:00Z',
    related_requirements: ['REQ-REG-001'],
    related_edge_cases: ['EC-005'],
    ...overrides,
  };
}

function makeAst(overrides: Partial<HclAst> = {}): HclAst {
  return {
    file_path: 'main.tf',
    resources: [],
    data_blocks: [],
    variables: [],
    locals: [],
    outputs: [],
    providers: [],
    module_calls: [],
    ...overrides,
  };
}

function makeMockRegistry(entries: Map<string, RegistryEntry>): RegistryApi {
  return {
    lookup: vi.fn((key: string) => entries.get(key)),
  } as unknown as RegistryApi;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IrEmitter', () => {
  let s3Entry: RegistryEntry;
  let ec2Entry: RegistryEntry;
  let registryEntries: Map<string, RegistryEntry>;

  beforeEach(() => {
    s3Entry = makeRegistryEntry({
      registry_entry_id: 'SER-STO-S3-001',
      aws_service: 's3',
      aws_family: 'storage',
      confidence: 0.88,
    });
    ec2Entry = makeRegistryEntry({
      registry_entry_id: 'SER-COM-EC2-001',
      aws_service: 'ec2',
      aws_family: 'compute',
      mapping_type: 'direct',
      confidence: 0.92,
    });
    registryEntries = new Map([
      ['s3', s3Entry],
      ['ec2', ec2Entry],
    ]);
  });

  describe('full emission', () => {
    it('emits a valid CanonicalIR for a simple configuration', () => {
      const ast = makeAst({
        file_path: 'main.tf',
        resources: [
          {
            resource_type: 'aws_s3_bucket',
            name: 'my_bucket',
            attributes: { bucket: 'my-bucket', tags: { Env: 'prod' } },
            meta: {
              source: { file: 'main.tf', line: 1, column: 0 },
              depends_on: [],
            },
          },
        ],
      });

      const graph = new DependencyGraph();
      graph.build([ast]);

      const registry = makeMockRegistry(registryEntries);
      const emitter = new IrEmitter(registry);
      const { ir, unmappedTypes, uncorrelatedNodes } = emitter.emit([ast], graph);

      // Valid IR
      expect(ir.version).toBe('1.0.0');
      expect(ir.sourceProvider).toBe('aws');
      expect(ir.resources).toHaveLength(1);

      const resource = ir.resources[0];
      expect(resource.id).toBe('aws_s3_bucket.my_bucket');
      expect(resource.sourceType).toBe('aws_s3_bucket');
      expect(resource.sourceName).toBe('my_bucket');
      expect(resource.category).toBe('storage');
      expect(resource.registryEntryId).toBe('SER-STO-S3-001');
      expect(resource.translationStatus).toBe('pending');
      expect(resource.confidence).toBe(0.88);
      expect(resource.tags).toEqual({ Env: 'prod' });
      expect(resource.sourceLocation.file).toBe('main.tf');

      // No unmapped or uncorrelated
      expect(unmappedTypes).toHaveLength(0);
      expect(uncorrelatedNodes).toHaveLength(0);
    });

    it('uses custom version and toolVersion from options', () => {
      const ast = makeAst({
        resources: [{
          resource_type: 'aws_s3_bucket',
          name: 'b',
          attributes: {},
          meta: { source: { file: 'main.tf', line: 1, column: 0 }, depends_on: [] },
        }],
      });

      const graph = new DependencyGraph();
      graph.build([ast]);

      const registry = makeMockRegistry(registryEntries);
      const emitter = new IrEmitter(registry);
      const { ir } = emitter.emit([ast], graph, {
        version: '2.0.0',
        toolVersion: '1.5.0',
      });

      expect(ir.version).toBe('2.0.0');
      expect(ir.metadata.toolVersion).toBe('1.5.0');
    });
  });

  describe('registry enrichment', () => {
    it('sets registryEntryId and confidence from registry entry', () => {
      const ast = makeAst({
        resources: [{
          resource_type: 'aws_instance',
          name: 'web',
          attributes: {},
          meta: { source: { file: 'main.tf', line: 5, column: 0 }, depends_on: [] },
        }],
      });

      const graph = new DependencyGraph();
      graph.build([ast]);

      const registry = makeMockRegistry(registryEntries);
      const emitter = new IrEmitter(registry);
      const { ir } = emitter.emit([ast], graph);

      expect(ir.resources[0].registryEntryId).toBe('SER-COM-EC2-001');
      expect(ir.resources[0].confidence).toBe(0.92);
      expect(ir.resources[0].category).toBe('compute');
    });
  });

  describe('unmapped resources', () => {
    it('reports unmapped types for resources with no registry entry', () => {
      const ast = makeAst({
        resources: [{
          resource_type: 'aws_unknown_thing',
          name: 'mystery',
          attributes: {},
          meta: { source: { file: 'main.tf', line: 1, column: 0 }, depends_on: [] },
        }],
      });

      const graph = new DependencyGraph();
      graph.build([ast]);

      const registry = makeMockRegistry(new Map());
      const emitter = new IrEmitter(registry);
      const { ir, unmappedTypes } = emitter.emit([ast], graph);

      expect(unmappedTypes).toContain('aws_unknown_thing');
      expect(ir.resources[0].translationStatus).toBe('blocked');
      expect(ir.resources[0].confidence).toBe(0);
      expect(ir.resources[0].registryEntryId).toBeNull();
    });

    it('deduplicates unmapped types', () => {
      const ast = makeAst({
        resources: [
          {
            resource_type: 'aws_unknown_thing',
            name: 'a',
            attributes: {},
            meta: { source: { file: 'main.tf', line: 1, column: 0 }, depends_on: [] },
          },
          {
            resource_type: 'aws_unknown_thing',
            name: 'b',
            attributes: {},
            meta: { source: { file: 'main.tf', line: 5, column: 0 }, depends_on: [] },
          },
        ],
      });

      const graph = new DependencyGraph();
      graph.build([ast]);

      const registry = makeMockRegistry(new Map());
      const emitter = new IrEmitter(registry);
      const { unmappedTypes } = emitter.emit([ast], graph);

      expect(unmappedTypes).toEqual(['aws_unknown_thing']);
    });
  });

  describe('edge mapping', () => {
    it('maps explicit_depends_on edges to depends_on relationships', () => {
      const ast = makeAst({
        resources: [
          {
            resource_type: 'aws_instance',
            name: 'web',
            attributes: {},
            meta: {
              source: { file: 'main.tf', line: 1, column: 0 },
              depends_on: ['aws_s3_bucket.data'],
            },
          },
          {
            resource_type: 'aws_s3_bucket',
            name: 'data',
            attributes: {},
            meta: { source: { file: 'main.tf', line: 10, column: 0 }, depends_on: [] },
          },
        ],
      });

      const graph = new DependencyGraph();
      graph.build([ast]);

      const registry = makeMockRegistry(registryEntries);
      const emitter = new IrEmitter(registry);
      const { ir } = emitter.emit([ast], graph);

      expect(ir.relationships).toHaveLength(1);
      const rel = ir.relationships[0];
      // GraphEdge source/target -> IrRelationship from/to
      expect(rel.from).toBe('aws_instance.web');
      expect(rel.to).toBe('aws_s3_bucket.data');
      expect(rel.type).toBe('depends_on');
    });

    it('maps attribute_reference edges to references relationships', () => {
      const ast = makeAst({
        resources: [
          {
            resource_type: 'aws_instance',
            name: 'web',
            attributes: { subnet_id: '${aws_s3_bucket.data.id}' },
            meta: { source: { file: 'main.tf', line: 1, column: 0 }, depends_on: [] },
          },
          {
            resource_type: 'aws_s3_bucket',
            name: 'data',
            attributes: {},
            meta: { source: { file: 'main.tf', line: 10, column: 0 }, depends_on: [] },
          },
        ],
      });

      const graph = new DependencyGraph();
      graph.build([ast]);

      const registry = makeMockRegistry(registryEntries);
      const emitter = new IrEmitter(registry);
      const { ir } = emitter.emit([ast], graph);

      const refs = ir.relationships.filter((r) => r.type === 'references');
      expect(refs.length).toBeGreaterThanOrEqual(1);
      expect(refs.some((r) => r.from === 'aws_instance.web' && r.to === 'aws_s3_bucket.data')).toBe(true);
    });

    it('excludes edges involving non-resource nodes', () => {
      const ast = makeAst({
        resources: [
          {
            resource_type: 'aws_s3_bucket',
            name: 'b',
            attributes: { name: '${var.name}' },
            meta: { source: { file: 'main.tf', line: 1, column: 0 }, depends_on: [] },
          },
        ],
        variables: [{ name: 'name', description: 'Bucket name' }],
      });

      const graph = new DependencyGraph();
      graph.build([ast]);

      const registry = makeMockRegistry(registryEntries);
      const emitter = new IrEmitter(registry);
      const { ir } = emitter.emit([ast], graph);

      // Edge from aws_s3_bucket.b -> var.name exists in graph,
      // but var.name is not a resource, so no relationship in IR
      expect(ir.relationships).toHaveLength(0);
    });
  });

  describe('module grouping', () => {
    it('builds IrModules from graph module boundaries', () => {
      const ast = makeAst({
        resources: [
          {
            resource_type: 'aws_instance',
            name: 'web',
            attributes: {},
            meta: { source: { file: 'main.tf', line: 1, column: 0 }, depends_on: [] },
          },
        ],
        module_calls: [
          {
            name: 'vpc',
            source: './modules/vpc',
            attributes: {},
            meta: { source: { file: 'main.tf', line: 20, column: 0 }, depends_on: [] },
          },
        ],
      });

      const graph = new DependencyGraph();
      graph.build([ast]);

      const registry = makeMockRegistry(registryEntries);
      const emitter = new IrEmitter(registry);
      const { ir } = emitter.emit([ast], graph);

      // Module boundaries only include resource nodes that were emitted.
      // Since the module node 'module.vpc' is not a resource, and
      // aws_instance.web isn't in the module's node_ids, modules may be empty.
      // This tests the filtering logic works without crashing.
      expect(Array.isArray(ir.modules)).toBe(true);
    });

    it('populates IrModule.resources with emitted resource IDs from module boundary', () => {
      // Create a resource node that has module_path metadata so that
      // getModuleBoundaries() includes it in a boundary's node_ids.
      const ast = makeAst({
        resources: [
          {
            resource_type: 'aws_s3_bucket',
            name: 'mod_bucket',
            attributes: {},
            meta: { source: { file: 'modules/storage/main.tf', line: 1, column: 0 }, depends_on: [] },
          },
        ],
        module_calls: [
          {
            name: 'storage',
            source: './modules/storage',
            attributes: {},
            meta: { source: { file: 'main.tf', line: 1, column: 0 }, depends_on: [] },
          },
        ],
      });

      const graph = new DependencyGraph();
      graph.build([ast]);

      // Manually set module_path on the resource node so it gets grouped
      // into the module boundary. Access private _nodes for test purposes.
      const nodeMap = (graph as unknown as { _nodes: Map<string, { metadata: Record<string, unknown> }> })._nodes;
      const resNode = nodeMap.get('aws_s3_bucket.mod_bucket');
      if (resNode) {
        resNode.metadata.module_path = 'storage';
      }

      const registry = makeMockRegistry(registryEntries);
      const emitter = new IrEmitter(registry);
      const { ir } = emitter.emit([ast], graph);

      // The storage module boundary should contain the resource ID
      const storageModule = ir.modules.find((m) => m.name === 'storage');
      expect(storageModule).toBeDefined();
      expect(storageModule!.resources).toContain('aws_s3_bucket.mod_bucket');
    });
  });

  describe('uncorrelated nodes', () => {
    it('reports node IDs that have no matching HCL resource', () => {
      // Create an AST with one resource, but add an extra resource node to the graph
      // that has no corresponding HCL entry.
      const ast = makeAst({
        resources: [
          {
            resource_type: 'aws_s3_bucket',
            name: 'real',
            attributes: {},
            meta: { source: { file: 'main.tf', line: 1, column: 0 }, depends_on: [] },
          },
        ],
      });

      const graph = new DependencyGraph();
      graph.build([ast]);

      // Inject a phantom resource node into the graph's internal node map
      const nodeMap = (graph as unknown as { _nodes: Map<string, unknown> })._nodes;
      nodeMap.set('aws_instance.phantom', {
        id: 'aws_instance.phantom',
        label: 'aws_instance.phantom',
        kind: 'resource',
        metadata: { resource_type: 'aws_instance', module_path: undefined },
      });

      const registry = makeMockRegistry(registryEntries);
      const emitter = new IrEmitter(registry);
      const { uncorrelatedNodes, ir } = emitter.emit([ast], graph);

      expect(uncorrelatedNodes).toContain('aws_instance.phantom');
      // The phantom should NOT appear in resources
      expect(ir.resources.find((r) => r.id === 'aws_instance.phantom')).toBeUndefined();
      // The real resource should still be there
      expect(ir.resources.find((r) => r.id === 'aws_s3_bucket.real')).toBeDefined();
    });
  });

  describe('metadata', () => {
    it('includes source files and correct counts', () => {
      const ast1 = makeAst({
        file_path: 'main.tf',
        resources: [{
          resource_type: 'aws_s3_bucket',
          name: 'a',
          attributes: {},
          meta: { source: { file: 'main.tf', line: 1, column: 0 }, depends_on: [] },
        }],
      });
      const ast2 = makeAst({
        file_path: 'network.tf',
        resources: [{
          resource_type: 'aws_instance',
          name: 'b',
          attributes: {},
          meta: { source: { file: 'network.tf', line: 1, column: 0 }, depends_on: [] },
        }],
      });

      const graph = new DependencyGraph();
      graph.build([ast1, ast2]);

      const registry = makeMockRegistry(registryEntries);
      const emitter = new IrEmitter(registry);
      const { ir } = emitter.emit([ast1, ast2], graph);

      expect(ir.metadata.sourceFiles).toEqual(['main.tf', 'network.tf']);
      expect(ir.metadata.resourceCount).toBe(2);
      expect(ir.metadata.toolVersion).toBe('0.1.0');
      expect(ir.metadata.generatedAt).toBeTruthy();
    });
  });

  describe('multiple ASTs', () => {
    it('correlates resources across multiple AST files', () => {
      const ast1 = makeAst({
        file_path: 'storage.tf',
        resources: [{
          resource_type: 'aws_s3_bucket',
          name: 'logs',
          attributes: { bucket: 'logs-bucket' },
          meta: { source: { file: 'storage.tf', line: 1, column: 0 }, depends_on: [] },
        }],
      });
      const ast2 = makeAst({
        file_path: 'compute.tf',
        resources: [{
          resource_type: 'aws_instance',
          name: 'app',
          attributes: { ami: 'ami-123', log_bucket: '${aws_s3_bucket.logs.id}' },
          meta: {
            source: { file: 'compute.tf', line: 1, column: 0 },
            depends_on: [],
          },
        }],
      });

      const graph = new DependencyGraph();
      graph.build([ast1, ast2]);

      const registry = makeMockRegistry(registryEntries);
      const emitter = new IrEmitter(registry);
      const { ir } = emitter.emit([ast1, ast2], graph);

      expect(ir.resources).toHaveLength(2);

      const bucket = ir.resources.find((r) => r.id === 'aws_s3_bucket.logs');
      const instance = ir.resources.find((r) => r.id === 'aws_instance.app');
      expect(bucket).toBeDefined();
      expect(instance).toBeDefined();

      expect(bucket!.sourceLocation.file).toBe('storage.tf');
      expect(instance!.sourceLocation.file).toBe('compute.tf');

      // Cross-file relationship
      const crossRef = ir.relationships.find(
        (r) => r.from === 'aws_instance.app' && r.to === 'aws_s3_bucket.logs',
      );
      expect(crossRef).toBeDefined();
      expect(crossRef!.type).toBe('references');
    });
  });

  describe('intent detection integration', () => {
    it('detects networking intent for VPC resources', () => {
      const ast = makeAst({
        resources: [{
          resource_type: 'aws_vpc',
          name: 'main',
          attributes: { cidr_block: '10.0.0.0/16' },
          meta: { source: { file: 'main.tf', line: 1, column: 0 }, depends_on: [] },
        }],
      });

      const graph = new DependencyGraph();
      graph.build([ast]);

      const vpcEntry = makeRegistryEntry({
        registry_entry_id: 'SER-NET-VPC-001',
        aws_service: 'vpc',
        aws_family: 'networking',
        confidence: 0.85,
      });
      const registry = makeMockRegistry(new Map([['vpc', vpcEntry]]));
      const emitter = new IrEmitter(registry);
      const { ir } = emitter.emit([ast], graph);

      const netIntent = ir.intents.find((i) => i.kind === 'networking');
      expect(netIntent).toBeDefined();
      expect(netIntent!.resources).toContain('aws_vpc.main');
    });
  });

  describe('attribute normalization integration', () => {
    it('separates tags from attributes in emitted resources', () => {
      const ast = makeAst({
        resources: [{
          resource_type: 'aws_s3_bucket',
          name: 'tagged',
          attributes: {
            bucket: 'tagged-bucket',
            versioning: 'true',
            tags: { Team: 'platform', Env: 'staging' },
          },
          meta: { source: { file: 'main.tf', line: 1, column: 0 }, depends_on: [] },
        }],
      });

      const graph = new DependencyGraph();
      graph.build([ast]);

      const registry = makeMockRegistry(registryEntries);
      const emitter = new IrEmitter(registry);
      const { ir } = emitter.emit([ast], graph);

      const resource = ir.resources[0];
      expect(resource.tags).toEqual({ Team: 'platform', Env: 'staging' });
      expect(resource.attributes).not.toHaveProperty('tags');
      // Boolean coercion
      expect(resource.attributes['versioning']).toBe(true);
      // sourceAttributes preserved as-is
      expect(resource.sourceAttributes['versioning']).toBe('true');
    });
  });
});
