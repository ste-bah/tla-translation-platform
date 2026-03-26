/**
 * Manages a lazily-initialised, optionally cached RegistryApi instance.
 *
 * The MCP server is read-only with respect to the registry (PRD §17.1).
 * This module owns the single shared RegistryApi used by all tool and
 * resource handlers.
 */

import {
  RegistryApi,
  loadRegistryFromDirectory,
  validateRegistryEntries,
} from '@tla/registry';
import type { McpServerConfig } from './config.js';
import { registryNotConfiguredError } from './config.js';

export type RegistryResult =
  | { ok: true; api: RegistryApi }
  | { ok: false; error: string };

export class RegistryManager {
  private api: RegistryApi | null = null;
  private lastLoadedAt = 0;

  constructor(private readonly config: McpServerConfig) {}

  /**
   * Returns a ready-to-use RegistryApi, loading it if necessary.
   *
   * Re-loads from disk when the cache TTL has elapsed.
   * Returns an error result when the registry directory is not configured.
   */
  async getRegistry(): Promise<RegistryResult> {
    if (!this.config.registryDir) {
      return { ok: false, error: registryNotConfiguredError() };
    }

    const now = Date.now();
    const expired =
      this.config.cacheTtlMs === 0 ||
      now - this.lastLoadedAt > this.config.cacheTtlMs;

    if (this.api !== null && !expired) {
      return { ok: true, api: this.api };
    }

    try {
      const api = new RegistryApi(
        this.config.registryDir,
        loadRegistryFromDirectory,
        validateRegistryEntries,
      );
      await api.init();
      this.api = api;
      this.lastLoadedAt = now;
      return { ok: true, api };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `Failed to load registry from '${this.config.registryDir}': ${message}`,
      };
    }
  }

  /** Invalidates the cache so the next call forces a reload. */
  invalidate(): void {
    this.lastLoadedAt = 0;
  }
}
