/**
 * Test helpers for the MCP server test suite.
 */

import type { RegistryEntry } from '@tla/shared';
import { RegistryApi } from '@tla/registry';
import type { LoadResult, RegistryLoader, RegistryValidator } from '@tla/registry';
import { RegistryManager } from '../src/registry-manager.js';
import type { McpServerConfig } from '../src/config.js';

export function createTestEntry(overrides?: Partial<RegistryEntry>): RegistryEntry {
  return {
    registry_entry_id: 'SER-COM-TEST-001',
    aws_service: 'test-service',
    aws_family: 'compute',
    azure_targets: ['azurerm_test'],
    gcp_targets: ['google_test'],
    mapping_type: 'direct',
    output_mode: 'portable',
    band: 'P1',
    confidence: 0.90,
    portable_provider_candidate: true,
    behavioral_gaps: [],
    manual_review_required: false,
    review_domains: [],
    test_status: 'untested',
    owner: 'test-team',
    registry_version: '2026.03.13',
    last_updated: '2026-03-13T10:00:00Z',
    related_requirements: ['REQ-REG-001'],
    related_edge_cases: ['EC-001'],
    ...overrides,
  };
}

export const defaultConfig: McpServerConfig = {
  registryDir: '/fake/registry',
  terraformBin: null,
  logLevel: 'silent',
  searchLimit: 50,
  cacheTtlMs: 30_000,
};

function fakeLoader(entries: RegistryEntry[]): RegistryLoader {
  return async (_dir: string): Promise<LoadResult> => ({ entries, errors: [] });
}

function fakeValidator(): RegistryValidator {
  return (_entries: ReadonlyArray<RegistryEntry>) => [];
}

/**
 * Builds an initialised RegistryApi backed by the given entries.
 */
export async function buildFakeApi(entries: RegistryEntry[]): Promise<RegistryApi> {
  const api = new RegistryApi('/fake', fakeLoader(entries), fakeValidator());
  await api.init();
  return api;
}

/**
 * Creates a RegistryManager whose `getRegistry` is replaced by a stub.
 *
 * @param entries  - entries the fake registry will contain
 * @param failWith - when set, getRegistry() returns an error with this message
 */
export async function buildFakeRegistryManager(
  entries: RegistryEntry[],
  failWith?: string,
): Promise<RegistryManager> {
  const api = await buildFakeApi(entries);
  const manager = new RegistryManager(defaultConfig);

  manager.getRegistry = async () => {
    if (failWith !== undefined) return { ok: false, error: failWith };
    return { ok: true, api };
  };

  return manager;
}
