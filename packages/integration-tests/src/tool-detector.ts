/**
 * Detects which Terraform-compatible CLI tools are available on PATH.
 *
 * Checks for both `terraform` and `tofu` (OpenTofu) binaries.
 * Results are cached at module level so detection runs at most once per
 * process lifetime.
 *
 * @module tool-detector
 */

import { execFileSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Availability and version info for a single CLI tool. */
export interface ToolInfo {
  /** Whether the binary was found and responded successfully. */
  readonly available: boolean;
  /** Parsed semver string (e.g. "1.7.0") or null when unavailable. */
  readonly version: string | null;
}

/** Combined detection result for all supported Terraform-compatible tools. */
export interface TerraformTools {
  readonly terraform: ToolInfo;
  readonly tofu: ToolInfo;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VERSION_RE = /v?(\d+\.\d+\.\d+)/;
const DETECT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Module-level cache — detect once per process
// ---------------------------------------------------------------------------

let _cached: TerraformTools | undefined;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Probes `terraform` and `tofu` binaries on PATH.
 *
 * Both binaries respond to `--version` with output like:
 *   Terraform v1.7.0
 *   OpenTofu v1.6.2
 *
 * On ENOENT or any other error the tool is reported as unavailable.
 * The result is cached: subsequent calls return the same object.
 */
export function detectTerraformTools(): TerraformTools {
  if (_cached !== undefined) {
    return _cached;
  }

  _cached = {
    terraform: probe('terraform'),
    tofu: probe('tofu'),
  };

  return _cached;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function probe(bin: string): ToolInfo {
  try {
    const stdout = execFileSync(bin, ['--version'], {
      encoding: 'utf-8',
      timeout: DETECT_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const match = VERSION_RE.exec(stdout);
    return {
      available: true,
      version: match !== null ? (match[1] ?? null) : null,
    };
  } catch {
    // ENOENT → binary absent; any other error → treat as unavailable
    return { available: false, version: null };
  }
}
