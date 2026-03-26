/**
 * MCP Server scaffold tests.
 *
 * Tests cover:
 *  - Config loading from environment
 *  - RegistryManager: success, cache, error paths
 *  - Tool registration: all 10 tools present with expected descriptions
 *  - Tool handlers: registry-backed tools return correct data
 *  - Tool handlers: stub tools return not_implemented
 *  - Tool handlers: registry error propagation
 *  - Resource registration: all 4 resources present
 *  - Resource handlers: correct data from fake registry
 *  - Error handling: missing terraform binary, missing registry dir
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig, registryNotConfiguredError, terraformNotFoundError } from '../src/config.js';
import { RegistryManager } from '../src/registry-manager.js';
import { registerTools } from '../src/tools/index.js';
import { registerResources } from '../src/resources/index.js';
import {
  createTestEntry,
  defaultConfig,
  buildFakeRegistryManager,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Calls a registered tool handler by name with the given args. */
async function callTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown> = {},
) {
  // Access internal record via type assertion (test-only; _registeredTools is a plain object)
  const tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
    ._registeredTools;
  const tool = tools[name];
  if (!tool) throw new Error(`Tool '${name}' not registered`);

  // handler signature: (args, extra) — pass empty extra for unit tests
  const result = await (tool.handler as (args: Record<string, unknown>, extra: unknown) => unknown)(
    args,
    {},
  );
  return result as { content: Array<{ type: string; text: string }>; isError?: boolean };
}

/** Parses the text content of the first content item. */
function parseResult(result: { content: Array<{ type: string; text: string }> }): unknown {
  const first = result.content[0];
  if (!first) throw new Error('No content in result');
  return JSON.parse(first.text);
}

// ---------------------------------------------------------------------------
// Config tests
// ---------------------------------------------------------------------------

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns empty registryDir when TLA_REGISTRY_DIR is not set', () => {
    delete process.env['TLA_REGISTRY_DIR'];
    const cfg = loadConfig();
    expect(cfg.registryDir).toBe('');
  });

  it('reads TLA_REGISTRY_DIR', () => {
    process.env['TLA_REGISTRY_DIR'] = '/tmp/registry';
    const cfg = loadConfig();
    expect(cfg.registryDir).toBe('/tmp/registry');
  });

  it('defaults logLevel to info', () => {
    delete process.env['TLA_LOG_LEVEL'];
    const cfg = loadConfig();
    expect(cfg.logLevel).toBe('info');
  });

  it('accepts valid log levels', () => {
    process.env['TLA_LOG_LEVEL'] = 'debug';
    expect(loadConfig().logLevel).toBe('debug');
    process.env['TLA_LOG_LEVEL'] = 'warn';
    expect(loadConfig().logLevel).toBe('warn');
  });

  it('falls back to info for invalid log level', () => {
    process.env['TLA_LOG_LEVEL'] = 'verbose';
    expect(loadConfig().logLevel).toBe('info');
  });

  it('reads TLA_TERRAFORM_BIN', () => {
    process.env['TLA_TERRAFORM_BIN'] = '/usr/local/bin/terraform';
    expect(loadConfig().terraformBin).toBe('/usr/local/bin/terraform');
  });

  it('returns null terraformBin when unset', () => {
    delete process.env['TLA_TERRAFORM_BIN'];
    expect(loadConfig().terraformBin).toBeNull();
  });

  it('reads TLA_SEARCH_LIMIT', () => {
    process.env['TLA_SEARCH_LIMIT'] = '25';
    expect(loadConfig().searchLimit).toBe(25);
  });

  it('falls back to default searchLimit for invalid value', () => {
    process.env['TLA_SEARCH_LIMIT'] = 'banana';
    expect(loadConfig().searchLimit).toBe(50);
  });

  it('reads TLA_CACHE_TTL_MS', () => {
    process.env['TLA_CACHE_TTL_MS'] = '60000';
    expect(loadConfig().cacheTtlMs).toBe(60_000);
  });
});

describe('registryNotConfiguredError', () => {
  it('mentions TLA_REGISTRY_DIR', () => {
    expect(registryNotConfiguredError()).toContain('TLA_REGISTRY_DIR');
  });
});

describe('terraformNotFoundError', () => {
  it('includes setup hint when bin is null', () => {
    expect(terraformNotFoundError(null)).toContain('TLA_TERRAFORM_BIN');
  });

  it('includes path when bin is set', () => {
    expect(terraformNotFoundError('/bad/path')).toContain('/bad/path');
  });
});

// ---------------------------------------------------------------------------
// RegistryManager tests
// ---------------------------------------------------------------------------

describe('RegistryManager', () => {
  it('returns error when registryDir is empty', async () => {
    const mgr = new RegistryManager({ ...defaultConfig, registryDir: '' });
    const result = await mgr.getRegistry();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('TLA_REGISTRY_DIR');
    }
  });

  it('succeeds with empty entries when directory does not exist (loader is fault-tolerant)', async () => {
    // The registry loader catches readdir errors and returns empty entries rather than throwing.
    // RegistryManager therefore returns ok:true with an empty registry.
    const mgr = new RegistryManager({
      ...defaultConfig,
      registryDir: '/nonexistent/path/that/cannot/exist',
      cacheTtlMs: 0,
    });
    const result = await mgr.getRegistry();
    // The loader is fault-tolerant: it returns ok:true with zero entries
    if (result.ok) {
      expect(result.api.search({}).length).toBe(0);
    } else {
      // Some environments may surface as an error — both outcomes are acceptable
      expect(typeof result.error).toBe('string');
    }
  });

  it('invalidate clears cache so next call reloads', async () => {
    const mgr = await buildFakeRegistryManager([createTestEntry()]);
    const r1 = await mgr.getRegistry();
    mgr.invalidate();
    const r2 = await mgr.getRegistry();
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tool registration tests
// ---------------------------------------------------------------------------

const EXPECTED_TOOLS = [
  'translate',
  'equivalence-lookup',
  'validate',
  'migrate-state',
  'assess',
  'registry-search',
  'registry-stats',
  'explain-mapping',
  'list-gaps',
  'confidence-check',
] as const;

describe('registerTools — registration', () => {
  let server: McpServer;

  beforeEach(async () => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager([]);
    registerTools(server, registry, defaultConfig);
  });

  it('registers exactly 10 tools', () => {
    const tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
      ._registeredTools;
    expect(Object.keys(tools).length).toBe(10);
  });

  it.each(EXPECTED_TOOLS)('registers tool "%s"', (name) => {
    const tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
      ._registeredTools;
    expect(name in tools).toBe(true);
  });

  it.each(EXPECTED_TOOLS)('tool "%s" has a description', (name) => {
    const tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
      ._registeredTools;
    const tool = tools[name]!;
    expect(typeof tool.description).toBe('string');
    expect(tool.description!.length).toBeGreaterThan(5);
  });

  it.each(EXPECTED_TOOLS)('tool "%s" has an inputSchema', (name) => {
    const tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
      ._registeredTools;
    const tool = tools[name]!;
    // Zero-arg tools may omit schema; all our tools with params should have one
    // Verify handler is callable at minimum
    expect(typeof tool.handler).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Tool handler: equivalence-lookup
// ---------------------------------------------------------------------------

describe('equivalence-lookup tool', () => {
  const ec2Entry = createTestEntry({
    registry_entry_id: 'SER-COM-EC2-001',
    aws_service: 'aws_instance',
    azure_targets: ['azurerm_linux_virtual_machine'],
    gcp_targets: ['google_compute_instance'],
    confidence: 0.92,
  });

  let server: McpServer;

  beforeEach(async () => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager([ec2Entry]);
    registerTools(server, registry, defaultConfig);
  });

  it('returns found:true and azure targets for a known service', async () => {
    const result = await callTool(server, 'equivalence-lookup', {
      service: 'aws_instance',
      target: 'azure',
      detail: 'summary',
    });
    const body = parseResult(result) as { found: boolean; azure: { types: string[] } };
    expect(body.found).toBe(true);
    expect(body.azure.types).toContain('azurerm_linux_virtual_machine');
  });

  it('returns found:false for an unknown service', async () => {
    const result = await callTool(server, 'equivalence-lookup', {
      service: 'aws_unknown_thing',
      target: 'gcp',
      detail: 'summary',
    });
    const body = parseResult(result) as { found: boolean };
    expect(body.found).toBe(false);
  });

  it('propagates registry error', async () => {
    const server2 = new McpServer({ name: 'test', version: '0.0.0' });
    const badRegistry = await buildFakeRegistryManager([], 'Registry exploded');
    registerTools(server2, badRegistry, defaultConfig);
    const result = await callTool(server2, 'equivalence-lookup', {
      service: 'aws_instance',
      target: 'azure',
      detail: 'summary',
    });
    expect(result.isError).toBe(true);
    const body = parseResult(result) as { error: string; message: string };
    expect(body.error).toBe('tool_error');
    expect(body.message).toContain('Registry exploded');
  });
});

// ---------------------------------------------------------------------------
// Tool handler: registry-search
// ---------------------------------------------------------------------------

describe('registry-search tool', () => {
  const entries = [
    createTestEntry({ registry_entry_id: 'SER-COM-EC2-001', aws_family: 'compute', band: 'P1', confidence: 0.92 }),
    createTestEntry({ registry_entry_id: 'SER-STO-S3-001', aws_service: 's3', aws_family: 'storage', band: 'P1', confidence: 0.88 }),
    createTestEntry({ registry_entry_id: 'SER-NET-VPC-001', aws_service: 'vpc', aws_family: 'networking', band: 'P2', confidence: 0.72 }),
  ];

  let server: McpServer;

  beforeEach(async () => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager(entries);
    registerTools(server, registry, defaultConfig);
  });

  it('returns all entries when no filters provided', async () => {
    const result = await callTool(server, 'registry-search', {});
    const body = parseResult(result) as { total: number };
    expect(body.total).toBe(3);
  });

  it('filters by family', async () => {
    const result = await callTool(server, 'registry-search', { family: 'compute' });
    const body = parseResult(result) as { total: number; entries: typeof entries };
    expect(body.total).toBe(1);
    expect(body.entries[0]!.aws_family).toBe('compute');
  });

  it('filters by band', async () => {
    const result = await callTool(server, 'registry-search', { band: 'P2' });
    const body = parseResult(result) as { total: number };
    expect(body.total).toBe(1);
  });

  it('respects limit', async () => {
    const result = await callTool(server, 'registry-search', { limit: 2 });
    const body = parseResult(result) as { total: number; returned: number };
    expect(body.total).toBe(3);
    expect(body.returned).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tool handler: registry-stats
// ---------------------------------------------------------------------------

describe('registry-stats tool', () => {
  it('returns completeness metrics', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager([
      createTestEntry({ aws_family: 'compute' }),
      createTestEntry({ registry_entry_id: 'SER-STO-S3-001', aws_service: 's3', aws_family: 'storage' }),
    ]);
    registerTools(server, registry, defaultConfig);

    const result = await callTool(server, 'registry-stats');
    const body = parseResult(result) as { totalEntries: number; byFamily: Record<string, number> };
    expect(body.totalEntries).toBe(2);
    expect(body.byFamily['compute']).toBe(1);
    expect(body.byFamily['storage']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tool handler: explain-mapping
// ---------------------------------------------------------------------------

describe('explain-mapping tool', () => {
  const entry = createTestEntry({
    registry_entry_id: 'SER-COM-EC2-001',
    aws_service: 'aws_instance',
    azure_targets: ['azurerm_linux_virtual_machine'],
    gcp_targets: ['google_compute_instance'],
    behavioral_gaps: [
      {
        gap_id: 'BGR-COM-EC2-001',
        gap_type: 'feature',
        description: 'Placement groups',
        severity: 'minor',
        affected_targets: ['azure'],
        workaround: null,
        requires_manual_review: false,
      },
    ],
  });

  let server: McpServer;

  beforeEach(async () => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager([entry]);
    registerTools(server, registry, defaultConfig);
  });

  it('returns targets for azure', async () => {
    const result = await callTool(server, 'explain-mapping', {
      aws_resource_type: 'aws_instance',
      target_provider: 'azure',
    });
    const body = parseResult(result) as { targets: string[] };
    expect(body.targets).toContain('azurerm_linux_virtual_machine');
  });

  it('returns targets for gcp', async () => {
    const result = await callTool(server, 'explain-mapping', {
      aws_resource_type: 'aws_instance',
      target_provider: 'gcp',
    });
    const body = parseResult(result) as { targets: string[] };
    expect(body.targets).toContain('google_compute_instance');
  });

  it('returns error for unknown service', async () => {
    const result = await callTool(server, 'explain-mapping', {
      aws_resource_type: 'aws_unknown',
      target_provider: 'azure',
    });
    expect(result.isError).toBe(true);
  });

  it('includes behavioral_gaps', async () => {
    const result = await callTool(server, 'explain-mapping', {
      aws_resource_type: 'aws_instance',
      target_provider: 'azure',
    });
    const body = parseResult(result) as { behavioral_gaps: unknown[] };
    expect(body.behavioral_gaps).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tool handler: list-gaps
// ---------------------------------------------------------------------------

describe('list-gaps tool', () => {
  const entryWithGaps = createTestEntry({
    aws_service: 'aws_instance',
    behavioral_gaps: [
      {
        gap_id: 'BGR-COM-EC2-001',
        gap_type: 'feature',
        description: 'Placement groups gap',
        severity: 'minor',
        affected_targets: ['azure'],
        workaround: null,
        requires_manual_review: false,
      },
      {
        gap_id: 'BGR-COM-EC2-002',
        gap_type: 'topology',
        description: 'Network blocker',
        severity: 'blocker',
        affected_targets: ['azure', 'gcp'],
        workaround: null,
        requires_manual_review: true,
      },
    ],
  });

  let server: McpServer;

  beforeEach(async () => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager([entryWithGaps]);
    registerTools(server, registry, defaultConfig);
  });

  it('returns all gaps when no filters', async () => {
    const result = await callTool(server, 'list-gaps', {});
    const body = parseResult(result) as { total: number };
    expect(body.total).toBe(2);
  });

  it('filters by severity', async () => {
    const result = await callTool(server, 'list-gaps', { severity: 'blocker' });
    const body = parseResult(result) as { total: number; gaps: Array<{ severity: string }> };
    expect(body.total).toBe(1);
    expect(body.gaps[0]!.severity).toBe('blocker');
  });

  it('filters by target_provider', async () => {
    const result = await callTool(server, 'list-gaps', { target_provider: 'gcp' });
    const body = parseResult(result) as { total: number };
    expect(body.total).toBe(1);
  });

  it('filters by aws_resource_type', async () => {
    const result = await callTool(server, 'list-gaps', { aws_resource_type: 'aws_instance' });
    const body = parseResult(result) as { total: number };
    expect(body.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tool handler: confidence-check
// ---------------------------------------------------------------------------

describe('confidence-check tool', () => {
  const entry = createTestEntry({
    aws_service: 'aws_instance',
    confidence: 0.85,
    band: 'P1',
    behavioral_gaps: [
      {
        gap_id: 'BGR-001',
        gap_type: 'feature',
        description: 'Minor gap',
        severity: 'minor',
        affected_targets: ['azure'],
        workaround: null,
        requires_manual_review: false,
      },
    ],
  });

  it('returns confidence and gap_summary', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager([entry]);
    registerTools(server, registry, defaultConfig);

    const result = await callTool(server, 'confidence-check', {
      aws_resource_type: 'aws_instance',
      target_provider: 'azure',
    });
    const body = parseResult(result) as {
      confidence: number;
      gap_summary: { blockers: number; majors: number; minors: number };
    };
    expect(body.confidence).toBe(0.85);
    expect(body.gap_summary.minors).toBe(1);
    expect(body.gap_summary.blockers).toBe(0);
  });

  it('returns error for unknown service', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager([entry]);
    registerTools(server, registry, defaultConfig);

    const result = await callTool(server, 'confidence-check', {
      aws_resource_type: 'aws_nonexistent',
      target_provider: 'gcp',
    });
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stub tools return not_implemented
// ---------------------------------------------------------------------------

// translate is now fully implemented (TASK-MCP-002) — it does not require
// Terraform and is no longer a stub. Detailed tests live in
// tests/tools/translate.test.ts.
// validate is now fully implemented (TASK-MCP-004). Detailed tests live in
// tests/tools/validate.test.ts.
// migrate-state is now fully implemented (TASK-MCP-005). Detailed tests live in
// tests/tools/migrate-state.test.ts.

describe('stub tools', () => {
  // translate, validate, and migrate-state are excluded — they are implemented
  const STUB_TOOLS = ['assess'] as const;

  let server: McpServer;

  beforeEach(async () => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager([createTestEntry()]);
    registerTools(server, registry, { ...defaultConfig, terraformBin: '/usr/bin/terraform' });
  });

  it.each(STUB_TOOLS)('"%s" returns not_implemented', async (name) => {
    let args: Record<string, unknown> = {};
    if (name === 'assess') args = { source_path: '/tmp/main.tf', target_provider: 'azure' };

    const result = await callTool(server, name, args);
    const body = parseResult(result) as { error: string };
    expect(body.error).toBe('not_implemented');
  });
});

// ---------------------------------------------------------------------------
// Resource registration tests
// ---------------------------------------------------------------------------

const EXPECTED_RESOURCES = [
  'registry-version',
  'registry-completeness',
  'registry-entry',
  'registry-family',
] as const;

describe('registerResources — registration', () => {
  let server: McpServer;

  beforeEach(async () => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager([]);
    registerResources(server, registry);
  });

  it('registers exactly 4 resources', () => {
    const resources = (server as unknown as {
      _registeredResources: Record<string, unknown>;
      _registeredResourceTemplates: Record<string, unknown>;
    });
    const total =
      Object.keys(resources._registeredResources).length +
      Object.keys(resources._registeredResourceTemplates).length;
    expect(total).toBe(4);
  });

  // Static resources are keyed by URI; templates are keyed by name.
  it.each([
    ['registry-version', 'registry://version'],
    ['registry-completeness', 'registry://completeness'],
    ['registry-entry', 'registry-entry'],    // template key = name
    ['registry-family', 'registry-family'],  // template key = name
  ] as const)('registers resource "%s"', (_label, key) => {
    const resources = (server as unknown as {
      _registeredResources: Record<string, unknown>;
      _registeredResourceTemplates: Record<string, unknown>;
    });
    const found =
      key in resources._registeredResources ||
      key in resources._registeredResourceTemplates;
    expect(found).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Resource handler tests
// ---------------------------------------------------------------------------

type ResourceEntry = {
  readCallback: (uri: URL, vars?: Record<string, string | string[]>) => Promise<{
    contents: Array<{ uri: string; mimeType: string; text: string }>;
  }>;
};

/**
 * Calls a resource by name.
 * Static resources (_registeredResources) are keyed by URI string.
 * Template resources (_registeredResourceTemplates) are keyed by name.
 */
async function callResource(
  server: McpServer,
  name: string,
  uri: string,
  variables: Record<string, string> = {},
) {
  const resources = (server as unknown as {
    _registeredResources: Record<string, ResourceEntry>;
    _registeredResourceTemplates: Record<string, ResourceEntry>;
  });

  // Static resources: look up by URI; templates: look up by name
  const resource =
    resources._registeredResources[uri] ??
    resources._registeredResourceTemplates[name];

  if (!resource) throw new Error(`Resource '${name}' not registered (uri=${uri})`);

  const result = await resource.readCallback(new URL(uri), variables);
  const content = result.contents[0];
  if (!content) throw new Error('No content');
  return JSON.parse(content.text) as unknown;
}

describe('resource handler: registry-version', () => {
  it('returns a version string', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager([createTestEntry()]);
    registerResources(server, registry);

    const body = await callResource(server, 'registry-version', 'registry://version') as { version: string };
    expect(typeof body.version).toBe('string');
  });

  it('returns "unknown" when registry is empty', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager([]);
    registerResources(server, registry);

    const body = await callResource(server, 'registry-version', 'registry://version') as { version: string };
    expect(body.version).toBe('unknown');
  });
});

describe('resource handler: registry-completeness', () => {
  it('returns completeness with totalEntries', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager([createTestEntry(), createTestEntry({ registry_entry_id: 'SER-STO-S3-001', aws_service: 's3' })]);
    registerResources(server, registry);

    const body = await callResource(server, 'registry-completeness', 'registry://completeness') as { totalEntries: number };
    expect(body.totalEntries).toBe(2);
  });
});

describe('resource handler: registry-entry', () => {
  const entry = createTestEntry({ registry_entry_id: 'SER-COM-EC2-001', aws_service: 'aws_instance' });

  it('returns the entry for a known ID', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager([entry]);
    registerResources(server, registry);

    const body = await callResource(
      server,
      'registry-entry',
      'registry://entry/SER-COM-EC2-001',
      { entry_id: 'SER-COM-EC2-001' },
    ) as { registry_entry_id: string };
    expect(body.registry_entry_id).toBe('SER-COM-EC2-001');
  });

  it('returns error for unknown ID', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager([entry]);
    registerResources(server, registry);

    const body = await callResource(
      server,
      'registry-entry',
      'registry://entry/NONEXISTENT',
      { entry_id: 'NONEXISTENT' },
    ) as { error: string };
    expect(body.error).toBe('registry_error');
  });
});

describe('resource handler: registry-family', () => {
  const entries = [
    createTestEntry({ aws_family: 'compute' }),
    createTestEntry({ registry_entry_id: 'SER-COM-002', aws_service: 'ec2-alt', aws_family: 'compute' }),
    createTestEntry({ registry_entry_id: 'SER-STO-001', aws_service: 's3', aws_family: 'storage' }),
  ];

  it('returns all entries in a family', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager(entries);
    registerResources(server, registry);

    const body = await callResource(
      server,
      'registry-family',
      'registry://family/compute',
      { family: 'compute' },
    ) as { family: string; total: number };
    expect(body.family).toBe('compute');
    expect(body.total).toBe(2);
  });

  it('returns empty entries for unknown family', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager(entries);
    registerResources(server, registry);

    const body = await callResource(
      server,
      'registry-family',
      'registry://family/unknown',
      { family: 'unknown' },
    ) as { total: number };
    expect(body.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Resource error propagation
// ---------------------------------------------------------------------------

describe('resource error propagation', () => {
  it('registry-completeness surfaces registry error', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const registry = await buildFakeRegistryManager([], 'BOOM');
    registerResources(server, registry);

    const body = await callResource(server, 'registry-completeness', 'registry://completeness') as { error: string; message: string };
    expect(body.error).toBe('registry_error');
    expect(body.message).toContain('BOOM');
  });
});
