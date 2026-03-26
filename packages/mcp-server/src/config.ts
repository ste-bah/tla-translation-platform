/**
 * MCP Server configuration loaded from environment variables.
 *
 * All settings have sensible defaults so the server can start without any
 * environment set (e.g., during tests).  Missing / invalid values are surfaced
 * as error strings that the tool handlers can include in responses.
 */

export interface McpServerConfig {
  /** Absolute path to the directory containing registry YAML files. */
  readonly registryDir: string;
  /** Absolute path to the Terraform binary, or null when not configured. */
  readonly terraformBin: string | null;
  /** Logging level forwarded to pino / any logger. */
  readonly logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';
  /** Maximum number of search results returned by registry-search. */
  readonly searchLimit: number;
  /** TTL (ms) for in-memory registry cache (0 = no cache, reload every call). */
  readonly cacheTtlMs: number;
}

const VALID_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'silent'] as const;

function parseLogLevel(raw: string | undefined): McpServerConfig['logLevel'] {
  if (raw !== undefined && (VALID_LOG_LEVELS as readonly string[]).includes(raw)) {
    return raw as McpServerConfig['logLevel'];
  }
  return 'info';
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Reads configuration from `process.env`.
 *
 * Environment variables:
 *   TLA_REGISTRY_DIR   — path to registry YAML directory (required for production)
 *   TLA_TERRAFORM_BIN  — path to terraform binary
 *   TLA_LOG_LEVEL      — trace | debug | info | warn | error | silent  (default: info)
 *   TLA_SEARCH_LIMIT   — max search results per request             (default: 50)
 *   TLA_CACHE_TTL_MS   — registry cache TTL in milliseconds         (default: 30000)
 */
export function loadConfig(): McpServerConfig {
  return {
    registryDir: process.env['TLA_REGISTRY_DIR'] ?? '',
    terraformBin: process.env['TLA_TERRAFORM_BIN'] ?? null,
    logLevel: parseLogLevel(process.env['TLA_LOG_LEVEL']),
    searchLimit: parsePositiveInt(process.env['TLA_SEARCH_LIMIT'], 50),
    cacheTtlMs: parsePositiveInt(process.env['TLA_CACHE_TTL_MS'], 30_000),
  };
}

/**
 * Returns a human-readable error message when registry is not available.
 */
export function registryNotConfiguredError(): string {
  return (
    'Registry directory is not configured. ' +
    'Set the TLA_REGISTRY_DIR environment variable to the path ' +
    'containing the registry YAML files and restart the server.'
  );
}

/**
 * Returns a human-readable error message when Terraform binary is not available.
 */
export function terraformNotFoundError(binPath: string | null): string {
  const hint =
    binPath === null
      ? 'Set TLA_TERRAFORM_BIN to the path of the terraform binary.'
      : `Terraform binary was not found at the configured path: ${binPath}`;
  return `Terraform binary is not available. ${hint}`;
}
