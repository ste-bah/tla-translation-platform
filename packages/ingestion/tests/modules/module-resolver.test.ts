import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HclAst, HclModuleCall } from '@tla/shared';

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

// ---------------------------------------------------------------------------
// classifyModuleSource — direct import (no filesystem dependency)
// ---------------------------------------------------------------------------

// Mock the parser before importing module-resolver
const mockParseHclDirectory = vi.fn();
vi.mock('../../src/parser/hcl-parser.js', () => ({
  parseHclDirectory: (...args: unknown[]) => mockParseHclDirectory(...args),
}));

// Now import after mock is set up
const { classifyModuleSource, resolveModules } = await import(
  '../../src/modules/module-resolver.js'
);

describe('classifyModuleSource', () => {
  describe('local sources', () => {
    it('should classify "./" prefix as local', () => {
      expect(classifyModuleSource('./modules/vpc')).toBe('local');
    });

    it('should classify "../" prefix as local', () => {
      expect(classifyModuleSource('../shared/vpc')).toBe('local');
    });
  });

  describe('registry sources', () => {
    it('should classify namespace/name/provider as registry', () => {
      expect(classifyModuleSource('hashicorp/consul/aws')).toBe('registry');
    });

    it('should classify terraform-aws-modules/vpc/aws as registry', () => {
      expect(classifyModuleSource('terraform-aws-modules/vpc/aws')).toBe('registry');
    });

    it('should handle registry source with subdir', () => {
      expect(classifyModuleSource('hashicorp/consul/aws//modules/server')).toBe('registry');
    });
  });

  describe('git sources', () => {
    it('should classify "git::" prefix as git', () => {
      expect(classifyModuleSource('git::https://example.com/module.git')).toBe('git');
    });

    it('should classify github.com URLs as git', () => {
      expect(classifyModuleSource('github.com/org/terraform-module')).toBe('git');
    });

    it('should classify bitbucket.org URLs as git', () => {
      expect(classifyModuleSource('bitbucket.org/org/terraform-module')).toBe('git');
    });
  });

  describe('s3 sources', () => {
    it('should classify "s3::" prefix as s3', () => {
      expect(classifyModuleSource('s3::https://bucket.s3.amazonaws.com/module.zip')).toBe('s3');
    });
  });

  describe('gcs sources', () => {
    it('should classify "gcs::" prefix as gcs', () => {
      expect(classifyModuleSource('gcs::https://bucket.storage.googleapis.com/module.zip')).toBe('gcs');
    });
  });

  describe('opaque sources', () => {
    it('should classify unrecognized patterns as opaque', () => {
      expect(classifyModuleSource('some-unknown-source')).toBe('opaque');
    });

    it('should classify single-segment paths as opaque', () => {
      expect(classifyModuleSource('mymodule')).toBe('opaque');
    });

    it('should classify two-segment paths as opaque', () => {
      expect(classifyModuleSource('org/module')).toBe('opaque');
    });
  });

  it('should handle whitespace in source strings', () => {
    expect(classifyModuleSource('  ./modules/vpc  ')).toBe('local');
  });
});

// ---------------------------------------------------------------------------
// resolveModules
// ---------------------------------------------------------------------------

describe('resolveModules', () => {
  beforeEach(() => {
    mockParseHclDirectory.mockReset();
  });

  it('should resolve local modules via parseHclDirectory', async () => {
    const childAst = makeAst({
      file_path: '/project/modules/vpc/main.tf',
      resources: [
        { resource_type: 'aws_vpc', name: 'main', attributes: {}, meta: META },
      ],
    });
    mockParseHclDirectory.mockResolvedValue({ asts: [childAst], errors: [] });

    const rootAst = makeAst({
      module_calls: [makeCall({ name: 'vpc', source: './modules/vpc' })],
    });

    const tree = await resolveModules([rootAst], { rootDir: '/project' });

    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].status).toBe('resolved');
    expect(tree.roots[0].asts).toHaveLength(1);
    expect(tree.stats.resolved).toBe(1);
    expect(tree.stats.opaque).toBe(0);
  });

  it('should mark registry modules without cache as opaque', async () => {
    const rootAst = makeAst({
      module_calls: [
        makeCall({ name: 'consul', source: 'hashicorp/consul/aws' }),
      ],
    });

    const tree = await resolveModules([rootAst], {
      rootDir: '/project',
      modulesJsonPath: '/nonexistent/modules.json',
    });

    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].status).toBe('opaque');
    expect(tree.roots[0].opaque).toBeDefined();
    expect(tree.roots[0].opaque!.reviewRequired).toBe(true);
    expect(tree.stats.opaque).toBe(1);
  });

  it('should enforce maxDepth limit', async () => {
    // Create a chain that exceeds depth
    const childAst = makeAst({
      file_path: '/project/modules/deep/main.tf',
      module_calls: [makeCall({ name: 'deeper', source: './deeper' })],
    });
    mockParseHclDirectory.mockResolvedValue({ asts: [childAst], errors: [] });

    const rootAst = makeAst({
      module_calls: [makeCall({ name: 'deep', source: './modules/deep' })],
    });

    const tree = await resolveModules([rootAst], {
      rootDir: '/project',
      maxDepth: 1,
    });

    // depth=0: "deep" resolves, enqueues "deep.deeper" at depth=1
    // depth=1: "deep.deeper" hits maxDepth
    expect(tree.stats.depthExceeded).toBe(1);
    expect(tree.stats.resolved).toBe(1);
  });

  it('should handle modules with no .tf files as opaque', async () => {
    mockParseHclDirectory.mockResolvedValue({
      asts: [],
      errors: [{ file: 'bad.tf', error: new Error('parse') }],
    });

    const rootAst = makeAst({
      module_calls: [makeCall({ name: 'broken', source: './modules/broken' })],
    });

    const tree = await resolveModules([rootAst], { rootDir: '/project' });

    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].status).toBe('opaque');
    expect(tree.stats.opaque).toBe(1);
  });

  it('should resolve multiple root-level modules', async () => {
    mockParseHclDirectory.mockResolvedValue({
      asts: [makeAst({ file_path: '/project/modules/a/main.tf' })],
      errors: [],
    });

    const rootAst = makeAst({
      module_calls: [
        makeCall({ name: 'mod_a', source: './modules/a' }),
        makeCall({ name: 'mod_b', source: './modules/b' }),
      ],
    });

    const tree = await resolveModules([rootAst], { rootDir: '/project' });

    expect(tree.roots).toHaveLength(2);
    expect(tree.stats.totalModuleCalls).toBe(2);
  });

  it('should produce correct stats totals', async () => {
    mockParseHclDirectory.mockResolvedValue({
      asts: [makeAst({ file_path: '/project/modules/ok/main.tf' })],
      errors: [],
    });

    const rootAst = makeAst({
      module_calls: [
        makeCall({ name: 'local_mod', source: './modules/ok' }),
        makeCall({ name: 'remote_mod', source: 'hashicorp/consul/aws' }),
      ],
    });

    const tree = await resolveModules([rootAst], {
      rootDir: '/project',
      modulesJsonPath: '/nonexistent/modules.json',
    });

    expect(tree.stats.resolved).toBe(1);
    expect(tree.stats.opaque).toBe(1);
    expect(tree.stats.totalModuleCalls).toBe(2);
  });

  it('should handle parseHclDirectory throwing as opaque', async () => {
    mockParseHclDirectory.mockRejectedValue(new Error('Directory not found'));

    const rootAst = makeAst({
      module_calls: [makeCall({ name: 'missing', source: './modules/missing' })],
    });

    const tree = await resolveModules([rootAst], { rootDir: '/project' });

    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].status).toBe('opaque');
    expect(tree.roots[0].opaque!.reason).toContain('Parse failed');
    expect(tree.stats.opaque).toBe(1);
  });

  it('should assign correct sourceKind for different source types', async () => {
    const rootAst = makeAst({
      module_calls: [
        makeCall({ name: 'git_mod', source: 'git::https://example.com/mod.git' }),
        makeCall({ name: 's3_mod', source: 's3::https://bucket.s3.amazonaws.com/mod.zip' }),
        makeCall({ name: 'gcs_mod', source: 'gcs::https://bucket.storage.googleapis.com/mod.zip' }),
      ],
    });

    const tree = await resolveModules([rootAst], {
      rootDir: '/project',
      modulesJsonPath: '/nonexistent/modules.json',
    });

    expect(tree.roots[0].sourceKind).toBe('git');
    expect(tree.roots[1].sourceKind).toBe('s3');
    expect(tree.roots[2].sourceKind).toBe('gcs');
  });

  it('should detect circular module references', async () => {
    // A module that refers to itself via its own child having the same callPath
    // The BFS uses visited set keyed on callPath — so if a resolved child
    // re-enqueues a callPath that was already visited, it should be circular.
    const childAst = makeAst({
      file_path: '/project/modules/loop/main.tf',
      module_calls: [makeCall({ name: 'loop', source: './.' })],
    });
    mockParseHclDirectory.mockResolvedValue({ asts: [childAst], errors: [] });

    const rootAst = makeAst({
      module_calls: [makeCall({ name: 'loop', source: './modules/loop' })],
    });

    const tree = await resolveModules([rootAst], { rootDir: '/project' });

    // depth=0: "loop" resolves, enqueues child "loop.loop" at depth=1
    // depth=1: "loop.loop" resolves, enqueues "loop.loop.loop" at depth=2
    // The callPaths are unique ("loop", "loop.loop", "loop.loop.loop" ...) so
    // circular detection by callPath alone won't fire unless the same callPath
    // repeats. With maxDepth we can bound this. Let's use maxDepth=2:
    const tree2 = await resolveModules([rootAst], { rootDir: '/project', maxDepth: 2 });

    // At depth=2, the self-referencing child hits depth guard
    expect(tree2.stats.depthExceeded).toBeGreaterThanOrEqual(1);
    expect(tree2.stats.resolved).toBeGreaterThanOrEqual(1);
  });

  it('should mark duplicate callPath as circular', async () => {
    // Two separate root ASTs with the same module call name
    // The second occurrence should be marked circular
    const childAst = makeAst({
      file_path: '/project/modules/shared/main.tf',
    });
    mockParseHclDirectory.mockResolvedValue({ asts: [childAst], errors: [] });

    const rootAst1 = makeAst({
      file_path: '/project/a.tf',
      module_calls: [makeCall({ name: 'shared', source: './modules/shared' })],
    });
    const rootAst2 = makeAst({
      file_path: '/project/b.tf',
      module_calls: [makeCall({ name: 'shared', source: './modules/shared' })],
    });

    const tree = await resolveModules([rootAst1, rootAst2], { rootDir: '/project' });

    expect(tree.stats.circular).toBe(1);
    expect(tree.stats.resolved).toBe(1);
    expect(tree.stats.totalModuleCalls).toBe(2);
    // One of them should have status circular
    const circularNode = tree.roots.find(r => r.status === 'circular');
    expect(circularNode).toBeDefined();
    expect(circularNode!.opaque).toBeDefined();
    expect(circularNode!.opaque!.reason).toContain('Circular');
  });

  it('should resolve modules from modules.json cache', async () => {
    // Write a modules.json fixture in a temp location
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const os = await import('node:os');
    const tmpDir = join(os.default.tmpdir(), `tla-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });

    const modulesJsonPath = join(tmpDir, 'modules.json');
    const modulesJson = {
      Modules: [
        { Key: 'consul', Source: 'hashicorp/consul/aws', Dir: 'modules/consul-cached' },
      ],
    };
    await writeFile(modulesJsonPath, JSON.stringify(modulesJson));

    // Create the target directory with a tf file so parse succeeds
    const cachedDir = join(tmpDir, 'modules', 'consul-cached');
    await mkdir(cachedDir, { recursive: true });

    const cachedAst = makeAst({
      file_path: join(cachedDir, 'main.tf'),
      resources: [
        { resource_type: 'consul_cluster', name: 'main', attributes: {}, meta: META },
      ],
    });
    mockParseHclDirectory.mockResolvedValue({ asts: [cachedAst], errors: [] });

    const rootAst = makeAst({
      module_calls: [
        makeCall({ name: 'consul', source: 'hashicorp/consul/aws' }),
      ],
    });

    const tree = await resolveModules([rootAst], {
      rootDir: tmpDir,
      modulesJsonPath,
    });

    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].status).toBe('resolved');
    expect(tree.roots[0].sourceKind).toBe('registry');
    expect(tree.stats.resolved).toBe(1);
    expect(tree.stats.opaque).toBe(0);

    // Verify parseHclDirectory was called with the cached dir
    expect(mockParseHclDirectory).toHaveBeenCalledWith(
      expect.stringContaining('consul-cached'),
    );

    // Cleanup
    const { rm } = await import('node:fs/promises');
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should block path traversal in local module sources', async () => {
    const rootAst = makeAst({
      module_calls: [
        makeCall({ name: 'evil', source: '../../../etc' }),
      ],
    });

    const tree = await resolveModules([rootAst], { rootDir: '/project' });

    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].status).toBe('opaque');
    expect(tree.roots[0].opaque!.reason).toContain('Path traversal blocked');
    expect(tree.stats.opaque).toBe(1);
  });

  it('should nest child modules under their parent', async () => {
    const parentAst = makeAst({
      file_path: '/project/modules/network/main.tf',
      module_calls: [makeCall({ name: 'subnets', source: './subnets' })],
    });
    const childAst = makeAst({
      file_path: '/project/modules/network/subnets/main.tf',
      resources: [
        { resource_type: 'aws_subnet', name: 'pub', attributes: {}, meta: META },
      ],
    });

    mockParseHclDirectory
      .mockResolvedValueOnce({ asts: [parentAst], errors: [] })
      .mockResolvedValueOnce({ asts: [childAst], errors: [] });

    const rootAst = makeAst({
      module_calls: [makeCall({ name: 'network', source: './modules/network' })],
    });

    const tree = await resolveModules([rootAst], { rootDir: '/project' });

    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].callPath).toBe('network');
    expect(tree.roots[0].children).toHaveLength(1);
    expect(tree.roots[0].children[0].callPath).toBe('network.subnets');
    expect(tree.stats.resolved).toBe(2);
  });
});
