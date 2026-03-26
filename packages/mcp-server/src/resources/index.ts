/**
 * Registers all 4 MCP resources on the server instance.
 *
 * Resources are read-only and backed by the RegistryApi.
 *
 *  registry://version          — registry version string
 *  registry://completeness     — aggregate completeness metrics
 *  registry://entry/{entry_id} — individual registry entry by ID
 *  registry://family/{family}  — all entries in a service family
 */

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AwsServiceFamily } from '@tla/shared';
import type { RegistryManager } from '../registry-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorContent(uri: URL, message: string): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType: 'application/json',
        text: JSON.stringify({ error: 'registry_error', message }),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Resource registration
// ---------------------------------------------------------------------------

export function registerResources(
  server: McpServer,
  registry: RegistryManager,
): void {
  // 1. registry://version
  server.resource(
    'registry-version',
    'registry://version',
    { description: 'Current registry version string loaded from the YAML files.' },
    async (uri) => {
      const result = await registry.getRegistry();
      if (!result.ok) return errorContent(uri, result.error);

      const entries = result.api.search({});
      const version = entries[0]?.registry_version ?? 'unknown';

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify({ version }),
          },
        ],
      };
    },
  );

  // 2. registry://completeness
  server.resource(
    'registry-completeness',
    'registry://completeness',
    { description: 'Aggregate completeness metrics: entry counts by family, band, mapping type, and average confidence.' },
    async (uri) => {
      const result = await registry.getRegistry();
      if (!result.ok) return errorContent(uri, result.error);

      const completeness = result.api.getCompleteness();
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify(completeness, null, 2),
          },
        ],
      };
    },
  );

  // 3. registry://entry/{entry_id}
  const entryTemplate = new ResourceTemplate(
    'registry://entry/{entry_id}',
    { list: undefined },
  );

  server.resource(
    'registry-entry',
    entryTemplate,
    { description: 'Individual registry entry by its registry_entry_id (e.g. SER-COM-EC2-001).' },
    async (uri, variables) => {
      const result = await registry.getRegistry();
      if (!result.ok) return errorContent(uri, result.error);

      const entryId = Array.isArray(variables['entry_id'])
        ? variables['entry_id'][0]
        : variables['entry_id'];

      if (!entryId) {
        return errorContent(uri, 'Missing entry_id path variable.');
      }

      // Retrieve via search — RegistryApi exposes lookup by aws_service, so
      // we search for the entry_id across all entries.
      const all = result.api.search({});
      const entry = all.find((e) => e.registry_entry_id === entryId);

      if (!entry) {
        return errorContent(uri, `No registry entry found with ID '${entryId}'.`);
      }

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify(entry, null, 2),
          },
        ],
      };
    },
  );

  // 4. registry://family/{family}
  const familyTemplate = new ResourceTemplate(
    'registry://family/{family}',
    { list: undefined },
  );

  server.resource(
    'registry-family',
    familyTemplate,
    { description: 'All registry entries belonging to a specific AWS service family (e.g. "compute", "storage").' },
    async (uri, variables) => {
      const result = await registry.getRegistry();
      if (!result.ok) return errorContent(uri, result.error);

      const family = Array.isArray(variables['family'])
        ? variables['family'][0]
        : variables['family'];

      if (!family) {
        return errorContent(uri, 'Missing family path variable.');
      }

      const parsedFamily = AwsServiceFamily.safeParse(family);
      const entries = parsedFamily.success
        ? result.api.search({ family: parsedFamily.data })
        : [];

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify({ family, total: entries.length, entries }, null, 2),
          },
        ],
      };
    },
  );
}
