import { describe, it, expect } from 'vitest';
import { flattenModules } from '../../src/modules/module-flattener.js';
import type { HclAst, HclModuleCall } from '@tla/shared';
import type { ModuleNode, ResolvedModuleTree, OpaqueRecord } from '../../src/modules/types.js';

const SOURCE = { file: 'main.tf', line: 1, column: 0 };
const META = { source: SOURCE, depends_on: [] };

function makeAst(overrides: Partial<HclAst> = {}): HclAst {
  return {
    file_path: overrides.file_path ?? '/project/main.tf',
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

function makeCall(overrides: Partial<HclModuleCall> = {}): HclModuleCall {
  return {
    name: overrides.name ?? 'test',
    source: overrides.source ?? './modules/test',
    attributes: overrides.attributes ?? {},
    meta: overrides.meta ?? META,
    version: overrides.version,
  };
}

function makeOpaqueRecord(overrides: Partial<OpaqueRecord> = {}): OpaqueRecord {
  return {
    moduleName: overrides.moduleName ?? 'opaque_mod',
    callPath: overrides.callPath ?? 'opaque_mod',
    source: overrides.source ?? 'hashicorp/consul/aws',
    sourceKind: overrides.sourceKind ?? 'registry',
    reason: overrides.reason ?? 'Not cached',
    reviewRequired: true,
    inferredResourceTypes: overrides.inferredResourceTypes ?? [],
  };
}

function makeNode(overrides: Partial<ModuleNode> = {}): ModuleNode {
  return {
    call: overrides.call ?? makeCall(),
    callPath: overrides.callPath ?? 'test',
    sourceKind: overrides.sourceKind ?? 'local',
    status: overrides.status ?? 'resolved',
    asts: overrides.asts ?? [],
    children: overrides.children ?? [],
    opaque: overrides.opaque,
  };
}

// ---------------------------------------------------------------------------
// flattenModules
// ---------------------------------------------------------------------------

describe('flattenModules', () => {
  it('should return root ASTs when tree has no modules', () => {
    const rootAst = makeAst();
    const tree: ResolvedModuleTree = { roots: [], stats: { resolved: 0, opaque: 0, circular: 0, depthExceeded: 0, totalModuleCalls: 0 } };

    const result = flattenModules(tree, [rootAst]);

    expect(result.augmentedAsts).toHaveLength(1);
    expect(result.augmentedAsts[0]).toBe(rootAst);
    expect(result.opaqueRecords).toHaveLength(0);
    expect(result.modulePaths.size).toBe(0);
  });

  it('should flatten a single resolved module with prefixed resource names', () => {
    const childAst = makeAst({
      file_path: '/project/modules/vpc/main.tf',
      resources: [
        { resource_type: 'aws_vpc', name: 'main', attributes: { cidr_block: '10.0.0.0/16' }, meta: META },
      ],
    });

    const node = makeNode({
      callPath: 'vpc',
      call: makeCall({ name: 'vpc', source: './modules/vpc', attributes: {} }),
      asts: [childAst],
    });

    const tree: ResolvedModuleTree = {
      roots: [node],
      stats: { resolved: 1, opaque: 0, circular: 0, depthExceeded: 0, totalModuleCalls: 1 },
    };

    const rootAst = makeAst();
    const result = flattenModules(tree, [rootAst]);

    // Root AST + 1 synthetic AST
    expect(result.augmentedAsts).toHaveLength(2);

    const syntheticAst = result.augmentedAsts[1];
    expect(syntheticAst.file_path).toContain('synthetic://module.vpc/');
    expect(syntheticAst.resources).toHaveLength(1);
    expect(syntheticAst.resources[0].name).toBe('vpc__main');
    expect(syntheticAst.resources[0].resource_type).toBe('aws_vpc');
  });

  it('should flatten nested modules with chained prefixes', () => {
    const innerAst = makeAst({
      file_path: '/project/modules/vpc/subnets/main.tf',
      resources: [
        { resource_type: 'aws_subnet', name: 'public', attributes: {}, meta: META },
      ],
    });

    const innerNode = makeNode({
      callPath: 'vpc.subnets',
      call: makeCall({ name: 'subnets', source: './subnets' }),
      asts: [innerAst],
      children: [],
    });

    const outerAst = makeAst({
      file_path: '/project/modules/vpc/main.tf',
      resources: [
        { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
      ],
    });

    const outerNode = makeNode({
      callPath: 'vpc',
      call: makeCall({ name: 'vpc', source: './modules/vpc' }),
      asts: [outerAst],
      children: [innerNode],
    });

    const tree: ResolvedModuleTree = {
      roots: [outerNode],
      stats: { resolved: 2, opaque: 0, circular: 0, depthExceeded: 0, totalModuleCalls: 2 },
    };

    const result = flattenModules(tree, [makeAst()]);

    // Root + vpc synthetic + vpc.subnets synthetic
    expect(result.augmentedAsts).toHaveLength(3);

    // Check outer module prefix
    const vpcSynthetic = result.augmentedAsts[1];
    expect(vpcSynthetic.resources[0].name).toBe('vpc__main');

    // Check nested module prefix (dots become __)
    const subnetSynthetic = result.augmentedAsts[2];
    expect(subnetSynthetic.resources[0].name).toBe('vpc__subnets__public');
  });

  it('should wire var.NAME inputs from parent call attributes', () => {
    const childAst = makeAst({
      file_path: '/project/modules/vpc/main.tf',
      resources: [
        {
          resource_type: 'aws_vpc',
          name: 'main',
          attributes: { cidr_block: 'var.vpc_cidr', enable_dns: true },
          meta: META,
        },
      ],
    });

    const node = makeNode({
      callPath: 'vpc',
      call: makeCall({
        name: 'vpc',
        source: './modules/vpc',
        attributes: { vpc_cidr: '10.0.0.0/16' },
      }),
      asts: [childAst],
    });

    const tree: ResolvedModuleTree = {
      roots: [node],
      stats: { resolved: 1, opaque: 0, circular: 0, depthExceeded: 0, totalModuleCalls: 1 },
    };

    const result = flattenModules(tree, [makeAst()]);
    const syntheticResource = result.augmentedAsts[1].resources[0];

    // var.vpc_cidr should be replaced with the call attribute value
    expect(syntheticResource.attributes['cidr_block']).toBe('10.0.0.0/16');
    // Non-var attributes should be unchanged
    expect(syntheticResource.attributes['enable_dns']).toBe(true);
  });

  it('should wire interpolated var references in strings', () => {
    const childAst = makeAst({
      file_path: '/project/modules/vpc/main.tf',
      resources: [
        {
          resource_type: 'aws_vpc',
          name: 'main',
          attributes: { tags: { Name: 'vpc-${var.environment}' } },
          meta: META,
        },
      ],
    });

    const node = makeNode({
      callPath: 'vpc',
      call: makeCall({
        name: 'vpc',
        source: './modules/vpc',
        attributes: { environment: 'production' },
      }),
      asts: [childAst],
    });

    const tree: ResolvedModuleTree = {
      roots: [node],
      stats: { resolved: 1, opaque: 0, circular: 0, depthExceeded: 0, totalModuleCalls: 1 },
    };

    const result = flattenModules(tree, [makeAst()]);
    const attrs = result.augmentedAsts[1].resources[0].attributes;
    const tags = attrs['tags'] as Record<string, unknown>;
    expect(tags['Name']).toBe('vpc-production');
  });

  it('should collect opaque records from unresolved modules', () => {
    const opaqueRecord = makeOpaqueRecord({ callPath: 'consul' });
    const node = makeNode({
      callPath: 'consul',
      status: 'opaque',
      asts: [],
      opaque: opaqueRecord,
    });

    const tree: ResolvedModuleTree = {
      roots: [node],
      stats: { resolved: 0, opaque: 1, circular: 0, depthExceeded: 0, totalModuleCalls: 1 },
    };

    const result = flattenModules(tree, [makeAst()]);

    expect(result.opaqueRecords).toHaveLength(1);
    expect(result.opaqueRecords[0].callPath).toBe('consul');
    expect(result.opaqueRecords[0].reviewRequired).toBe(true);
  });

  it('should track module paths for all flattened resources', () => {
    const childAst = makeAst({
      file_path: '/project/modules/vpc/main.tf',
      resources: [
        { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
        { resource_type: 'aws_subnet', name: 'pub', attributes: {}, meta: META },
      ],
      data_blocks: [
        { data_type: 'aws_ami', name: 'latest', attributes: {}, meta: META },
      ],
    });

    const node = makeNode({
      callPath: 'vpc',
      call: makeCall({ name: 'vpc', source: './modules/vpc' }),
      asts: [childAst],
    });

    const tree: ResolvedModuleTree = {
      roots: [node],
      stats: { resolved: 1, opaque: 0, circular: 0, depthExceeded: 0, totalModuleCalls: 1 },
    };

    const result = flattenModules(tree, [makeAst()]);

    expect(result.modulePaths.get('aws_vpc.vpc__main')).toBe('vpc');
    expect(result.modulePaths.get('aws_subnet.vpc__pub')).toBe('vpc');
    expect(result.modulePaths.get('data.aws_ami.vpc__latest')).toBe('vpc');
  });

  it('should handle data blocks with prefixed names', () => {
    const childAst = makeAst({
      file_path: '/project/modules/vpc/main.tf',
      data_blocks: [
        { data_type: 'aws_availability_zones', name: 'available', attributes: {}, meta: META },
      ],
    });

    const node = makeNode({
      callPath: 'network',
      call: makeCall({ name: 'network', source: './modules/network' }),
      asts: [childAst],
    });

    const tree: ResolvedModuleTree = {
      roots: [node],
      stats: { resolved: 1, opaque: 0, circular: 0, depthExceeded: 0, totalModuleCalls: 1 },
    };

    const result = flattenModules(tree, [makeAst()]);
    const syntheticAst = result.augmentedAsts[1];

    expect(syntheticAst.data_blocks).toHaveLength(1);
    expect(syntheticAst.data_blocks[0].name).toBe('network__available');
  });

  it('should not promote module-internal variables/locals/outputs', () => {
    const childAst = makeAst({
      file_path: '/project/modules/vpc/main.tf',
      variables: [{ name: 'cidr', type: 'string', sensitive: false, validation: [] }],
      locals: [{ name: 'tags', expression: {} }],
      outputs: [{ name: 'vpc_id', value: 'aws_vpc.main.id', sensitive: false }],
      resources: [
        { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
      ],
    });

    const node = makeNode({
      callPath: 'vpc',
      call: makeCall({ name: 'vpc', source: './modules/vpc' }),
      asts: [childAst],
    });

    const tree: ResolvedModuleTree = {
      roots: [node],
      stats: { resolved: 1, opaque: 0, circular: 0, depthExceeded: 0, totalModuleCalls: 1 },
    };

    const result = flattenModules(tree, [makeAst()]);
    const syntheticAst = result.augmentedAsts[1];

    expect(syntheticAst.variables).toHaveLength(0);
    expect(syntheticAst.locals).toHaveLength(0);
    expect(syntheticAst.outputs).toHaveLength(0);
  });

  it('should wire var references in arrays', () => {
    const childAst = makeAst({
      file_path: '/project/modules/vpc/main.tf',
      resources: [
        {
          resource_type: 'aws_vpc',
          name: 'main',
          attributes: { tags_list: ['var.tag_a', 'static', 'var.tag_b'] },
          meta: META,
        },
      ],
    });

    const node = makeNode({
      callPath: 'vpc',
      call: makeCall({
        name: 'vpc',
        source: './modules/vpc',
        attributes: { tag_a: 'alpha', tag_b: 'beta' },
      }),
      asts: [childAst],
    });

    const tree: ResolvedModuleTree = {
      roots: [node],
      stats: { resolved: 1, opaque: 0, circular: 0, depthExceeded: 0, totalModuleCalls: 1 },
    };

    const result = flattenModules(tree, [makeAst()]);
    const attrs = result.augmentedAsts[1].resources[0].attributes;
    expect(attrs['tags_list']).toEqual(['alpha', 'static', 'beta']);
  });

  it('should preserve unresolvable var references unchanged', () => {
    const childAst = makeAst({
      file_path: '/project/modules/vpc/main.tf',
      resources: [
        {
          resource_type: 'aws_vpc',
          name: 'main',
          attributes: { cidr_block: 'var.not_provided' },
          meta: META,
        },
      ],
    });

    const node = makeNode({
      callPath: 'vpc',
      call: makeCall({ name: 'vpc', source: './modules/vpc', attributes: {} }),
      asts: [childAst],
    });

    const tree: ResolvedModuleTree = {
      roots: [node],
      stats: { resolved: 1, opaque: 0, circular: 0, depthExceeded: 0, totalModuleCalls: 1 },
    };

    const result = flattenModules(tree, [makeAst()]);
    const attrs = result.augmentedAsts[1].resources[0].attributes;
    expect(attrs['cidr_block']).toBe('var.not_provided');
  });
});
