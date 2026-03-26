/**
 * TLA MCP Server entry point.
 *
 * Starts an MCP server on the stdio transport (primary; required for Claude Code).
 * HTTP/SSE transport is a Should-Have and will be added in a later task.
 *
 * Usage:
 *   node dist/server.js
 *
 * Environment variables (see config.ts for full list):
 *   TLA_REGISTRY_DIR   — path to the registry YAML directory
 *   TLA_TERRAFORM_BIN  — path to the terraform binary
 *   TLA_LOG_LEVEL      — log verbosity (default: info)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { RegistryManager } from './registry-manager.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const registry = new RegistryManager(config);

  const server = new McpServer(
    {
      name: 'tla-mcp-server',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions:
        'TLA (Terraform Landing Zone Accelerator) MCP server. ' +
        'Provides tools and resources for translating AWS Terraform ' +
        'configurations to Azure or GCP. ' +
        'Use `registry-search` to discover supported services, ' +
        '`equivalence-lookup` for specific mappings, ' +
        'and `translate` to perform the actual translation.',
    },
  );

  registerTools(server, registry, config);
  registerResources(server, registry);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${String(err)}\n`);
  process.exit(1);
});
