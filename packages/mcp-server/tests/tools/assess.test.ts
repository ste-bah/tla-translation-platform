/**
 * Tests for the `assess` MCP tool handler.
 *
 * Covers:
 *  - File-based assessment (.tf extension)
 *  - Directory-based assessment (no .tf extension)
 *  - Registry enrichment: band, confidence, target_types per resource
 *  - Resource with no registry entry (unknown type)
 *  - Target provider azure vs gcp (target_types selection)
 *  - Empty source — no .tf files → isError
 *  - Registry failure → isError
 *  - Parse error (thrown by parser) → isError
 *  - Procedural and unknown counts forwarded
 *  - MCP tool wiring via registerTools
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — declare mock functions before vi.mock() factories run
// ---------------------------------------------------------------------------

const {
  mockParseHclFile,
  mockParseHclDirectory,
  mockIdentifyAwsServices,
} = vi.hoisted(() => ({
  mockParseHclFile: vi.fn(),
  mockParseHclDirectory: vi.fn(),
  mockIdentifyAwsServices: vi.fn(),
}));

// ---- Module mocks ----------------------------------------------------------

vi.mock('@tla/ingestion', () => ({
  parseHclFile: (...args: unknown[]) => mockParseHclFile(...args),
  parseHclDirectory: (...args: unknown[]) => mockParseHclDirectory(...args),
  identifyAwsServices: (...args: unknown[]) => mockIdentifyAwsServices(...args),
}));

// ---- Import module under test AFTER mocks ----------------------------------

import { handleAssess } from '../../src/tools/assess.js';
import {
  createTestEntry,
  buildFakeRegistryManager,
  defaultConfig,
} from '../helpers.js';
import type { RegistryEntry } from '@tla/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fakeAst = {
  file_path: '/tmp/main.tf',
  resources: [],
  data_blocks: [],
  variables: [],
  locals: [],
  outputs: [],
  providers: [],
  module_calls: [],
  terraform_blocks: [],
};

const s3Entry: RegistryEntry = createTestEntry({
  registry_entry_id: 'SER-STO-S3-001',
  aws_service: 'aws_s3_bucket',
  aws_family: 'storage',
  band: 'P1',
  confidence: 0.95,
  azure_targets: ['azurerm_storage_account'],
  gcp_targets: ['google_storage_bucket'],
  mapping_type: 'direct',
  manual_review_required: false,
});

const ec2Entry: RegistryEntry = createTestEntry({
  registry_entry_id: 'SER-COM-EC2-001',
  aws_service: 'aws_instance',
  aws_family: 'compute',
  band: 'P2',
  confidence: 0.82,
  azure_targets: ['azurerm_linux_virtual_machine'],
  gcp_targets: ['google_compute_instance'],
  mapping_type: 'parametric',
  manual_review_required: true,
});

const fakeInventoryOne = {
  identified_services: [
    {
      resource_type: 'aws_s3_bucket',
      resource_name: 'data',
      family: 'storage',
      service_prefix: 'aws_s3',
      count: 2,
      file_paths: ['/tmp/main.tf'],
    },
  ],
  procedural_resources: [],
  unknown_providers: [],
  total_resources: 2,
  total_aws_resources: 2,
};

const fakeInventoryTwo = {
  identified_services: [
    {
      resource_type: 'aws_s3_bucket',
      resource_name: 'data',
      family: 'storage',
      service_prefix: 'aws_s3',
      count: 2,
      file_paths: ['/tmp/main.tf'],
    },
    {
      resource_type: 'aws_instance',
      resource_name: 'web',
      family: 'compute',
      service_prefix: 'aws_instance',
      count: 1,
      file_paths: ['/tmp/main.tf'],
    },
  ],
  procedural_resources: [],
  unknown_providers: [],
  total_resources: 3,
  total_aws_resources: 3,
};

const fakeInventoryWithUnknown = {
  identified_services: [
    {
      resource_type: 'aws_unknown_widget',
      resource_name: 'foo',
      family: 'other',
      service_prefix: 'aws_unknown',
      count: 1,
      file_paths: ['/tmp/main.tf'],
    },
  ],
  procedural_resources: [{ resource_type: 'local_file', resource_name: 'x' }],
  unknown_providers: ['random_id.suffix'],
  total_resources: 3,
  total_aws_resources: 1,
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function parseResponse<T = unknown>(
  response: { content: Array<{ type: string; text: string }> },
): T {
  return JSON.parse(response.content[0]!.text) as T;
}

// ---------------------------------------------------------------------------
// Reset before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// File-based assessment
// ---------------------------------------------------------------------------

describe('handleAssess — file mode (.tf extension)', () => {
  beforeEach(() => {
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIdentifyAwsServices.mockReturnValue(fakeInventoryOne);
  });

  it('calls parseHclFile for a .tf path', async () => {
    const manager = await buildFakeRegistryManager([s3Entry]);
    await handleAssess({ source_path: '/tmp/main.tf', target_provider: 'azure' }, manager);
    expect(mockParseHclFile).toHaveBeenCalledWith('/tmp/main.tf');
    expect(mockParseHclDirectory).not.toHaveBeenCalled();
  });

  it('returns success:true', async () => {
    const manager = await buildFakeRegistryManager([s3Entry]);
    const res = await handleAssess({ source_path: '/tmp/main.tf', target_provider: 'azure' }, manager);
    const body = parseResponse<{ success: boolean }>(res);
    expect(body.success).toBe(true);
  });

  it('reflects the target_provider in the response', async () => {
    const manager = await buildFakeRegistryManager([s3Entry]);
    const res = await handleAssess({ source_path: '/tmp/main.tf', target_provider: 'gcp' }, manager);
    const body = parseResponse<{ target_provider: string }>(res);
    expect(body.target_provider).toBe('gcp');
  });

  it('does not set isError on success', async () => {
    const manager = await buildFakeRegistryManager([s3Entry]);
    const res = await handleAssess({ source_path: '/tmp/main.tf', target_provider: 'azure' }, manager);
    expect((res as { isError?: boolean }).isError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Directory-based assessment
// ---------------------------------------------------------------------------

describe('handleAssess — directory mode', () => {
  beforeEach(() => {
    mockParseHclDirectory.mockResolvedValue({ asts: [fakeAst], errors: [] });
    mockIdentifyAwsServices.mockReturnValue(fakeInventoryOne);
  });

  it('calls parseHclDirectory for a non-.tf path', async () => {
    const manager = await buildFakeRegistryManager([s3Entry]);
    await handleAssess({ source_path: '/tmp/mymodule', target_provider: 'azure' }, manager);
    expect(mockParseHclDirectory).toHaveBeenCalledWith('/tmp/mymodule');
    expect(mockParseHclFile).not.toHaveBeenCalled();
  });

  it('returns success:true for a directory', async () => {
    const manager = await buildFakeRegistryManager([s3Entry]);
    const res = await handleAssess({ source_path: '/tmp/mymodule', target_provider: 'azure' }, manager);
    const body = parseResponse<{ success: boolean }>(res);
    expect(body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Inventory counts
// ---------------------------------------------------------------------------

describe('handleAssess — inventory counts', () => {
  it('forwards total_resources and total_aws_resources', async () => {
    mockParseHclDirectory.mockResolvedValue({ asts: [fakeAst], errors: [] });
    mockIdentifyAwsServices.mockReturnValue(fakeInventoryTwo);
    const manager = await buildFakeRegistryManager([s3Entry, ec2Entry]);
    const res = await handleAssess({ source_path: '/tmp/mymodule', target_provider: 'azure' }, manager);
    const body = parseResponse<{ total_resources: number; total_aws_resources: number }>(res);
    expect(body.total_resources).toBe(3);
    expect(body.total_aws_resources).toBe(3);
  });

  it('counts procedural and unknown correctly', async () => {
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIdentifyAwsServices.mockReturnValue(fakeInventoryWithUnknown);
    const manager = await buildFakeRegistryManager([]);
    const res = await handleAssess({ source_path: '/tmp/main.tf', target_provider: 'azure' }, manager);
    const body = parseResponse<{ procedural: number; unknown: number }>(res);
    expect(body.procedural).toBe(1);
    expect(body.unknown).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Registry enrichment — azure target_types
// ---------------------------------------------------------------------------

describe('handleAssess — registry enrichment (azure)', () => {
  beforeEach(() => {
    mockParseHclDirectory.mockResolvedValue({ asts: [fakeAst], errors: [] });
    mockIdentifyAwsServices.mockReturnValue(fakeInventoryTwo);
  });

  it('includes band and confidence for known types', async () => {
    const manager = await buildFakeRegistryManager([s3Entry, ec2Entry]);
    const res = await handleAssess({ source_path: '/tmp/mymodule', target_provider: 'azure' }, manager);
    type RS = { resource_type: string; band: string; confidence: number };
    const body = parseResponse<{ resources: RS[] }>(res);
    const s3 = body.resources.find((r) => r.resource_type === 'aws_s3_bucket')!;
    expect(s3.band).toBe('P1');
    expect(s3.confidence).toBe(0.95);
  });

  it('uses azure_targets for target_types when provider is azure', async () => {
    const manager = await buildFakeRegistryManager([s3Entry, ec2Entry]);
    const res = await handleAssess({ source_path: '/tmp/mymodule', target_provider: 'azure' }, manager);
    type RS = { resource_type: string; target_types: string[] };
    const body = parseResponse<{ resources: RS[] }>(res);
    const s3 = body.resources.find((r) => r.resource_type === 'aws_s3_bucket')!;
    expect(s3.target_types).toEqual(['azurerm_storage_account']);
  });

  it('returns the correct resource count', async () => {
    const manager = await buildFakeRegistryManager([s3Entry, ec2Entry]);
    const res = await handleAssess({ source_path: '/tmp/mymodule', target_provider: 'azure' }, manager);
    type RS = { resource_type: string; count: number };
    const body = parseResponse<{ resources: RS[] }>(res);
    const s3 = body.resources.find((r) => r.resource_type === 'aws_s3_bucket')!;
    expect(s3.count).toBe(2);
  });

  it('returns the correct family', async () => {
    const manager = await buildFakeRegistryManager([s3Entry, ec2Entry]);
    const res = await handleAssess({ source_path: '/tmp/mymodule', target_provider: 'azure' }, manager);
    type RS = { resource_type: string; family: string };
    const body = parseResponse<{ resources: RS[] }>(res);
    const ec2 = body.resources.find((r) => r.resource_type === 'aws_instance')!;
    expect(ec2.family).toBe('compute');
  });

  it('returns all discovered resources', async () => {
    const manager = await buildFakeRegistryManager([s3Entry, ec2Entry]);
    const res = await handleAssess({ source_path: '/tmp/mymodule', target_provider: 'azure' }, manager);
    const body = parseResponse<{ resources: unknown[] }>(res);
    expect(body.resources).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Registry enrichment — gcp target_types
// ---------------------------------------------------------------------------

describe('handleAssess — registry enrichment (gcp)', () => {
  beforeEach(() => {
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIdentifyAwsServices.mockReturnValue(fakeInventoryOne);
  });

  it('uses gcp_targets for target_types when provider is gcp', async () => {
    const manager = await buildFakeRegistryManager([s3Entry]);
    const res = await handleAssess({ source_path: '/tmp/main.tf', target_provider: 'gcp' }, manager);
    type RS = { resource_type: string; target_types: string[] };
    const body = parseResponse<{ resources: RS[] }>(res);
    const s3 = body.resources.find((r) => r.resource_type === 'aws_s3_bucket')!;
    expect(s3.target_types).toEqual(['google_storage_bucket']);
  });
});

// ---------------------------------------------------------------------------
// Unknown resource type (not in registry)
// ---------------------------------------------------------------------------

describe('handleAssess — unknown resource type', () => {
  it('omits band and confidence when type has no registry entry', async () => {
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIdentifyAwsServices.mockReturnValue(fakeInventoryWithUnknown);
    const manager = await buildFakeRegistryManager([]);  // empty registry
    const res = await handleAssess({ source_path: '/tmp/main.tf', target_provider: 'azure' }, manager);
    type RS = { resource_type: string; band?: string; confidence?: number };
    const body = parseResponse<{ resources: RS[] }>(res);
    const widget = body.resources.find((r) => r.resource_type === 'aws_unknown_widget')!;
    expect(widget.band).toBeUndefined();
    expect(widget.confidence).toBeUndefined();
  });

  it('returns empty target_types when type has no registry entry', async () => {
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIdentifyAwsServices.mockReturnValue(fakeInventoryWithUnknown);
    const manager = await buildFakeRegistryManager([]);
    const res = await handleAssess({ source_path: '/tmp/main.tf', target_provider: 'azure' }, manager);
    type RS = { resource_type: string; target_types: string[] };
    const body = parseResponse<{ resources: RS[] }>(res);
    const widget = body.resources.find((r) => r.resource_type === 'aws_unknown_widget')!;
    expect(widget.target_types).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Empty source (no .tf files)
// ---------------------------------------------------------------------------

describe('handleAssess — empty source', () => {
  it('returns isError:true when directory has no .tf files', async () => {
    mockParseHclDirectory.mockResolvedValue({ asts: [], errors: [] });
    const manager = await buildFakeRegistryManager([s3Entry]);
    const res = await handleAssess({ source_path: '/tmp/empty', target_provider: 'azure' }, manager);
    expect((res as { isError?: boolean }).isError).toBe(true);
  });

  it('error body contains a descriptive message', async () => {
    mockParseHclDirectory.mockResolvedValue({ asts: [], errors: [] });
    const manager = await buildFakeRegistryManager([s3Entry]);
    const res = await handleAssess({ source_path: '/tmp/empty', target_provider: 'azure' }, manager);
    const body = parseResponse<{ success: boolean; error: string }>(res);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/No \.tf files/);
  });
});

// ---------------------------------------------------------------------------
// Registry failure
// ---------------------------------------------------------------------------

describe('handleAssess — registry failure', () => {
  it('returns isError:true when registry is unavailable', async () => {
    const manager = await buildFakeRegistryManager([], 'Registry not configured');
    const res = await handleAssess({ source_path: '/tmp/main.tf', target_provider: 'azure' }, manager);
    expect((res as { isError?: boolean }).isError).toBe(true);
  });

  it('error body contains the original registry error', async () => {
    const manager = await buildFakeRegistryManager([], 'Registry not configured');
    const res = await handleAssess({ source_path: '/tmp/main.tf', target_provider: 'azure' }, manager);
    const body = parseResponse<{ success: boolean; error: string }>(res);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Registry not configured');
  });

  it('does not call parseHclFile when registry fails', async () => {
    const manager = await buildFakeRegistryManager([], 'down');
    await handleAssess({ source_path: '/tmp/main.tf', target_provider: 'azure' }, manager);
    expect(mockParseHclFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Parse error (parser throws)
// ---------------------------------------------------------------------------

describe('handleAssess — parse error', () => {
  it('returns isError:true when the HCL parser throws', async () => {
    mockParseHclFile.mockRejectedValue(new Error('Syntax error at line 3'));
    const manager = await buildFakeRegistryManager([s3Entry]);
    const res = await handleAssess({ source_path: '/tmp/bad.tf', target_provider: 'azure' }, manager);
    expect((res as { isError?: boolean }).isError).toBe(true);
  });

  it('error body contains the parser error message', async () => {
    mockParseHclFile.mockRejectedValue(new Error('Syntax error at line 3'));
    const manager = await buildFakeRegistryManager([s3Entry]);
    const res = await handleAssess({ source_path: '/tmp/bad.tf', target_provider: 'azure' }, manager);
    const body = parseResponse<{ success: boolean; error: string }>(res);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Syntax error at line 3');
  });
});

// ---------------------------------------------------------------------------
// MCP tool wiring via registerTools
// ---------------------------------------------------------------------------

describe('assess tool registered in registerTools', () => {
  beforeEach(() => {
    mockParseHclFile.mockResolvedValue(fakeAst);
    mockIdentifyAwsServices.mockReturnValue(fakeInventoryOne);
  });

  it('is wired and returns success:true for a valid .tf path', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { registerTools } = await import('../../src/tools/index.js');
    const { RegistryManager } = await import('../../src/registry-manager.js');

    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const manager = new RegistryManager(defaultConfig);
    const fakeApi = await (await import('../helpers.js')).buildFakeApi([s3Entry]);

    manager.getRegistry = async () => ({ ok: true as const, api: fakeApi });

    registerTools(server, manager, defaultConfig);

    type ToolRecord = {
      handler: (
        args: Record<string, unknown>,
        extra: unknown,
      ) => Promise<{ content: Array<{ text: string }> }>;
    };
    const tools = (server as unknown as { _registeredTools: Record<string, ToolRecord> })
      ._registeredTools;
    const tool = tools['assess'];
    expect(tool).toBeDefined();

    const result = await tool!.handler(
      { source_path: '/tmp/main.tf', target_provider: 'azure' },
      {},
    );
    const body = JSON.parse(result.content[0]!.text) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it('returns isError:true via wiring when registry fails', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { registerTools } = await import('../../src/tools/index.js');
    const { RegistryManager } = await import('../../src/registry-manager.js');

    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const manager = new RegistryManager(defaultConfig);
    manager.getRegistry = async () => ({ ok: false as const, error: 'no registry' });

    registerTools(server, manager, defaultConfig);

    type ToolRecord = {
      handler: (
        args: Record<string, unknown>,
        extra: unknown,
      ) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
    };
    const tools = (server as unknown as { _registeredTools: Record<string, ToolRecord> })
      ._registeredTools;
    const tool = tools['assess'];

    const result = await tool!.handler(
      { source_path: '/tmp/main.tf', target_provider: 'azure' },
      {},
    );
    expect(result.isError).toBe(true);
  });
});
