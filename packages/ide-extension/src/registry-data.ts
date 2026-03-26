import registryBundle from './registry-bundle.json';

export interface RegistryEntry {
  band: string;
  confidence: number;
  azure_targets: string[];
  gcp_targets: string[];
  mapping_type: string;
}

type RegistryBundle = Record<string, RegistryEntry>;

const registry: RegistryBundle = registryBundle as RegistryBundle;

/**
 * Sorted keys longest-first for progressive prefix matching.
 * When a user writes `aws_lambda_function`, we try exact match first,
 * then progressively strip the last `_segment` to find a prefix hit.
 */
const sortedKeys = Object.keys(registry).sort((a, b) => b.length - a.length);

/**
 * Look up a Terraform AWS resource type in the registry.
 *
 * Matching strategy (in order):
 * 1. Exact match on the full type string (e.g. `aws_s3_bucket`)
 * 2. Progressive prefix match — strip trailing `_segment` repeatedly
 *    until a registry key matches (e.g. `aws_s3_bucket_policy` -> `aws_s3_bucket`)
 * 3. Return `undefined` if no match found
 */
export function lookupService(awsType: string): RegistryEntry | undefined {
  // 1. Exact match
  if (registry[awsType]) {
    return registry[awsType];
  }

  // 2. Progressive prefix: strip last _segment each iteration
  let prefix = awsType;
  while (prefix.includes('_')) {
    const lastUnderscore = prefix.lastIndexOf('_');
    prefix = prefix.substring(0, lastUnderscore);

    for (const key of sortedKeys) {
      if (key === prefix) {
        return registry[key];
      }
    }
  }

  return undefined;
}

/**
 * Return all registry keys (useful for diagnostics iteration).
 */
export function allRegistryKeys(): string[] {
  return Object.keys(registry);
}

/**
 * Return the full bundle (useful for tests).
 */
export function getRegistryBundle(): RegistryBundle {
  return registry;
}
