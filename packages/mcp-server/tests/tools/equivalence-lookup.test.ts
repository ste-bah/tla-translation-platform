/**
 * Tests for the `equivalence-lookup` MCP tool handler.
 *
 * Covers:
 *  - Single lookup: found (summary + full, azure / gcp / both)
 *  - Single lookup: not found → suggestions
 *  - Bulk lookup: mixed found/not-found
 *  - Bulk lookup: all found
 *  - Registry failure → isError
 *  - Prefix-based suggestion logic
 *  - Band description mapping
 *  - MCP tool wiring via registerTools
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { RegistryEntry } from '@tla/shared';
import {
  createTestEntry,
  buildFakeRegistryManager,
  defaultConfig,
} from '../helpers.js';
import { handleEquivalenceLookup } from '../../src/tools/equivalence-lookup.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

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
  behavioral_gaps: [
    {
      gap_id: 'GAP-S3-001',
      description: 'No bucket versioning toggle on Azure',
      severity: 'minor',
      affected_targets: ['azure'],
      workaround: 'Use blob versioning instead',
      prd_reference: 'PRD-S3-001',
    },
  ],
  related_edge_cases: ['EC-S3-001', 'EC-S3-002'],
});

const ec2Entry: RegistryEntry = createTestEntry({
  registry_entry_id: 'SER-COM-EC2-001',
  aws_service: 'aws_instance',
  aws_family: 'compute',
  band: 'P2',
  confidence: 0.82,
  azure_targets: ['azurerm_linux_virtual_machine', 'azurerm_windows_virtual_machine'],
  gcp_targets: ['google_compute_instance'],
  mapping_type: 'parametric',
  manual_review_required: true,
  behavioral_gaps: [],
  related_edge_cases: [],
});

const dynamoEntry: RegistryEntry = createTestEntry({
  registry_entry_id: 'SER-DB-DYN-001',
  aws_service: 'aws_dynamodb_table',
  aws_family: 'database',
  band: 'M1',
  confidence: 0.30,
  azure_targets: [],
  gcp_targets: [],
  mapping_type: 'none',
  manual_review_required: true,
  behavioral_gaps: [],
  related_edge_cases: [],
});

const allEntries = [s3Entry, ec2Entry, dynamoEntry];

// ---------------------------------------------------------------------------
// Helper: parse the text payload from the tool response
// ---------------------------------------------------------------------------

function parseResponse<T = unknown>(
  response: { content: Array<{ type: string; text: string }> },
): T {
  return JSON.parse(response.content[0]!.text) as T;
}

// ---------------------------------------------------------------------------
// Single lookup — found (summary mode)
// ---------------------------------------------------------------------------

describe('handleEquivalenceLookup — single lookup, found, summary', () => {
  let manager: Awaited<ReturnType<typeof buildFakeRegistryManager>>;

  beforeEach(async () => {
    manager = await buildFakeRegistryManager(allEntries);
  });

  it('returns found:true with band and confidence', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_s3_bucket', target: 'azure', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ found: boolean; azure: { band: string; confidence: number } }>(res);
    expect(body.found).toBe(true);
    expect(body.azure.band).toBe('P1');
    expect(body.azure.confidence).toBe(0.95);
  });

  it('returns band_description for P1', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_s3_bucket', target: 'azure', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ azure: { band_description: string } }>(res);
    expect(body.azure.band_description).toBe('Direct mapping, high confidence');
  });

  it('returns band_description for P2', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_instance', target: 'gcp', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ gcp: { band_description: string } }>(res);
    expect(body.gcp.band_description).toBe('Parametric mapping');
  });

  it('returns band_description for M1', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_dynamodb_table', target: 'azure', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ azure: { band_description: string } }>(res);
    expect(body.azure.band_description).toBe('Manual migration only');
  });

  it('returns azure target types', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_s3_bucket', target: 'azure', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ azure: { types: string[] } }>(res);
    expect(body.azure.types).toEqual(['azurerm_storage_account']);
  });

  it('returns gcp target types', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_s3_bucket', target: 'gcp', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ gcp: { types: string[] } }>(res);
    expect(body.gcp.types).toEqual(['google_storage_bucket']);
  });

  it('returns both azure and gcp when target is "both"', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_s3_bucket', target: 'both', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ azure: unknown; gcp: unknown }>(res);
    expect(body.azure).toBeDefined();
    expect(body.gcp).toBeDefined();
  });

  it('omits gcp key when target is "azure"', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_s3_bucket', target: 'azure', detail: 'summary' },
      manager,
    );
    const body = parseResponse<Record<string, unknown>>(res);
    expect(body.gcp).toBeUndefined();
  });

  it('omits azure key when target is "gcp"', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_s3_bucket', target: 'gcp', detail: 'summary' },
      manager,
    );
    const body = parseResponse<Record<string, unknown>>(res);
    expect(body.azure).toBeUndefined();
  });

  it('includes mapping_type and manual_review_required at root', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_instance', target: 'azure', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ mapping_type: string; manual_review_required: boolean }>(res);
    expect(body.mapping_type).toBe('parametric');
    expect(body.manual_review_required).toBe(true);
  });

  it('summary mode does NOT include behavioral_gaps', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_s3_bucket', target: 'azure', detail: 'summary' },
      manager,
    );
    const body = parseResponse<Record<string, unknown>>(res);
    const azure = body.azure as Record<string, unknown>;
    expect(azure.behavioral_gaps).toBeUndefined();
    expect(azure.related_edge_cases).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Single lookup — found (full mode)
// ---------------------------------------------------------------------------

describe('handleEquivalenceLookup — single lookup, found, full', () => {
  let manager: Awaited<ReturnType<typeof buildFakeRegistryManager>>;

  beforeEach(async () => {
    manager = await buildFakeRegistryManager(allEntries);
  });

  it('includes behavioral_gaps in full mode', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_s3_bucket', target: 'azure', detail: 'full' },
      manager,
    );
    const body = parseResponse<{ azure: { behavioral_gaps: unknown[] } }>(res);
    expect(body.azure.behavioral_gaps).toHaveLength(1);
  });

  it('includes related_edge_cases in full mode', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_s3_bucket', target: 'azure', detail: 'full' },
      manager,
    );
    const body = parseResponse<{ azure: { related_edge_cases: string[] } }>(res);
    expect(body.azure.related_edge_cases).toEqual(['EC-S3-001', 'EC-S3-002']);
  });

  it('gap severity is preserved', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_s3_bucket', target: 'azure', detail: 'full' },
      manager,
    );
    type Gap = { severity: string };
    const body = parseResponse<{ azure: { behavioral_gaps: Gap[] } }>(res);
    expect(body.azure.behavioral_gaps[0]!.severity).toBe('minor');
  });

  it('full mode + both: both azure and gcp have behavioral_gaps', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_s3_bucket', target: 'both', detail: 'full' },
      manager,
    );
    const body = parseResponse<{
      azure: { behavioral_gaps: unknown[] };
      gcp: { behavioral_gaps: unknown[] };
    }>(res);
    expect(body.azure.behavioral_gaps).toBeDefined();
    expect(body.gcp.behavioral_gaps).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Single lookup — not found
// ---------------------------------------------------------------------------

describe('handleEquivalenceLookup — single lookup, not found', () => {
  let manager: Awaited<ReturnType<typeof buildFakeRegistryManager>>;

  beforeEach(async () => {
    manager = await buildFakeRegistryManager(allEntries);
  });

  it('returns found:false', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_no_such_resource', target: 'azure', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ found: boolean }>(res);
    expect(body.found).toBe(false);
  });

  it('includes the queried type in the response', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_no_such_resource', target: 'azure', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ aws_resource_type: string }>(res);
    expect(body.aws_resource_type).toBe('aws_no_such_resource');
  });

  it('includes a human-readable message', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_s3_bucket_unknown', target: 'azure', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ message: string }>(res);
    expect(body.message).toContain('aws_s3_bucket_unknown');
  });

  it('suggests aws_s3_bucket for a query with aws_s3 prefix', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_s3_unknown_resource', target: 'azure', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ suggestions: string[] }>(res);
    expect(body.suggestions).toContain('aws_s3_bucket');
  });

  it('suggests aws_instance for a query with aws_instance prefix', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_instance_unknown', target: 'azure', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ suggestions: string[] }>(res);
    expect(body.suggestions).toContain('aws_instance');
  });

  it('returns empty suggestions array for completely unrelated type', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'totally_alien_resource', target: 'azure', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ suggestions: string[] }>(res);
    expect(body.suggestions).toEqual([]);
  });

  it('does not return isError for not-found (it is a valid result)', async () => {
    const res = await handleEquivalenceLookup(
      { service: 'aws_no_such_resource', target: 'azure', detail: 'summary' },
      manager,
    );
    expect((res as { isError?: boolean }).isError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Bulk lookup
// ---------------------------------------------------------------------------

describe('handleEquivalenceLookup — bulk lookup', () => {
  let manager: Awaited<ReturnType<typeof buildFakeRegistryManager>>;

  beforeEach(async () => {
    manager = await buildFakeRegistryManager(allEntries);
  });

  it('returns a results array', async () => {
    const res = await handleEquivalenceLookup(
      { services: ['aws_s3_bucket', 'aws_instance'], target: 'azure', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ results: unknown[] }>(res);
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(2);
  });

  it('found entries have found:true', async () => {
    const res = await handleEquivalenceLookup(
      { services: ['aws_s3_bucket', 'aws_instance'], target: 'azure', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ results: Array<{ found: boolean }> }>(res);
    expect(body.results.every((r) => r.found === true)).toBe(true);
  });

  it('missing entries have found:false with suggestions', async () => {
    const res = await handleEquivalenceLookup(
      { services: ['aws_s3_bucket', 'aws_s3_unknown'], target: 'azure', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ results: Array<{ found: boolean; suggestions?: string[] }> }>(res);
    const notFound = body.results.find((r) => r.found === false);
    expect(notFound).toBeDefined();
    expect(notFound!.suggestions).toBeDefined();
  });

  it('mixed found/not-found returns one of each', async () => {
    const res = await handleEquivalenceLookup(
      {
        services: ['aws_s3_bucket', 'aws_nonexistent'],
        target: 'gcp',
        detail: 'summary',
      },
      manager,
    );
    const body = parseResponse<{ results: Array<{ found: boolean }> }>(res);
    expect(body.results.filter((r) => r.found).length).toBe(1);
    expect(body.results.filter((r) => !r.found).length).toBe(1);
  });

  it('bulk full mode includes behavioral_gaps for each found entry', async () => {
    const res = await handleEquivalenceLookup(
      { services: ['aws_s3_bucket'], target: 'azure', detail: 'full' },
      manager,
    );
    type FoundEntry = { found: boolean; azure: { behavioral_gaps: unknown[] } };
    const body = parseResponse<{ results: FoundEntry[] }>(res);
    const s3 = body.results[0]!;
    expect(s3.found).toBe(true);
    expect(s3.azure.behavioral_gaps).toHaveLength(1);
  });

  it('bulk handles empty services array as single lookup with no service', async () => {
    // When services is empty we fall through to single-lookup path with service=undefined
    // which means aws_resource_type = '' → not found
    const res = await handleEquivalenceLookup(
      { services: [], target: 'azure', detail: 'summary' },
      manager,
    );
    // Should not throw and should return a valid response
    expect(res.content).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Registry failure
// ---------------------------------------------------------------------------

describe('handleEquivalenceLookup — registry failure', () => {
  it('returns isError:true when registry is unavailable', async () => {
    const manager = await buildFakeRegistryManager([], 'Registry not configured');
    const res = await handleEquivalenceLookup(
      { service: 'aws_s3_bucket', target: 'azure', detail: 'summary' },
      manager,
    );
    expect((res as { isError?: boolean }).isError).toBe(true);
  });

  it('error response contains the original error message', async () => {
    const manager = await buildFakeRegistryManager([], 'Registry not configured');
    const res = await handleEquivalenceLookup(
      { service: 'aws_s3_bucket', target: 'azure', detail: 'summary' },
      manager,
    );
    const body = parseResponse<{ error: string; message: string }>(res);
    expect(body.error).toBe('tool_error');
    expect(body.message).toContain('Registry not configured');
  });
});

// ---------------------------------------------------------------------------
// MCP tool wiring via registerTools
// ---------------------------------------------------------------------------

describe('equivalence-lookup tool registered in registerTools', () => {
  it('is wired and returns found:true for a valid single lookup', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { registerTools } = await import('../../src/tools/index.js');
    const { RegistryManager } = await import('../../src/registry-manager.js');

    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const manager = new RegistryManager(defaultConfig);

    manager.getRegistry = async () => ({
      ok: true as const,
      api: {
        search: () => [s3Entry, ec2Entry, dynamoEntry],
        lookup: (svc: string) => {
          if (svc === 'aws_s3_bucket') return s3Entry;
          return undefined;
        },
      } as unknown as import('@tla/registry').RegistryApi,
    });

    registerTools(server, manager, defaultConfig);

    type ToolRecord = {
      handler: (
        args: Record<string, unknown>,
        extra: unknown,
      ) => Promise<{ content: Array<{ text: string }> }>;
    };
    const tools = (server as unknown as { _registeredTools: Record<string, ToolRecord> })
      ._registeredTools;
    const tool = tools['equivalence-lookup'];
    expect(tool).toBeDefined();

    const result = await tool!.handler(
      { service: 'aws_s3_bucket', target: 'azure', detail: 'summary' },
      {},
    );
    const body = JSON.parse(result.content[0]!.text) as { found: boolean };
    expect(body.found).toBe(true);
  });

  it('returns found:false with suggestions for an unknown type', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { registerTools } = await import('../../src/tools/index.js');
    const { RegistryManager } = await import('../../src/registry-manager.js');

    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const manager = new RegistryManager(defaultConfig);

    manager.getRegistry = async () => ({
      ok: true as const,
      api: {
        search: () => [s3Entry, ec2Entry, dynamoEntry],
        lookup: (_svc: string) => undefined,
      } as unknown as import('@tla/registry').RegistryApi,
    });

    registerTools(server, manager, defaultConfig);

    type ToolRecord = {
      handler: (
        args: Record<string, unknown>,
        extra: unknown,
      ) => Promise<{ content: Array<{ text: string }> }>;
    };
    const tools = (server as unknown as { _registeredTools: Record<string, ToolRecord> })
      ._registeredTools;
    const tool = tools['equivalence-lookup'];

    const result = await tool!.handler(
      { service: 'aws_s3_unknown', target: 'azure', detail: 'summary' },
      {},
    );
    const body = JSON.parse(result.content[0]!.text) as {
      found: boolean;
      suggestions: string[];
    };
    expect(body.found).toBe(false);
    expect(Array.isArray(body.suggestions)).toBe(true);
  });
});
