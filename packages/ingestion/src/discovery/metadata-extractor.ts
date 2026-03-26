import { createComponentLogger } from '@tla/shared';
import type { HclAst, InfraMetadata } from '@tla/shared';

const logger = createComponentLogger('ingestion');

/**
 * Extracts infrastructure metadata from parsed HCL ASTs.
 *
 * Gathers tags, naming patterns, provider versions, module sources,
 * backend configuration, and terraform version constraints.
 *
 * @param asts - Parsed HCL ASTs from one or more .tf files
 * @returns Aggregated infrastructure metadata
 */
export function extractMetadata(asts: readonly HclAst[]): InfraMetadata {
  logger.info({ fileCount: asts.length }, 'Extracting infrastructure metadata');

  const tags = extractTags(asts);
  const namingPatterns = extractNamingPatterns(asts);
  const providerVersions = extractProviderVersions(asts);
  const moduleSources = extractModuleSources(asts);
  const backendType = extractBackendType(asts);
  const terraformVersionConstraint = extractTerraformVersion(asts);

  const metadata: InfraMetadata = {
    tags,
    naming_patterns: namingPatterns,
    provider_versions: providerVersions,
    module_sources: moduleSources,
    backend_type: backendType,
    terraform_version_constraint: terraformVersionConstraint,
  };

  logger.info(
    {
      tagKeys: Object.keys(tags).length,
      patterns: namingPatterns.length,
      providers: Object.keys(providerVersions).length,
      modules: moduleSources.length,
    },
    'Metadata extraction complete',
  );

  return metadata;
}

/**
 * Extracts tags from resource attributes.
 * Returns a map of tag key -> array of unique values seen.
 * @internal
 */
function extractTags(
  asts: readonly HclAst[],
): Record<string, string[]> {
  const tagMap = new Map<string, Set<string>>();

  for (const ast of asts) {
    for (const resource of ast.resources) {
      collectTagsFromAttributes(resource.attributes, tagMap);
    }
    for (const dataBlock of ast.data_blocks) {
      collectTagsFromAttributes(dataBlock.attributes, tagMap);
    }
  }

  const result: Record<string, string[]> = {};
  for (const [key, values] of tagMap) {
    result[key] = [...values].sort();
  }
  return result;
}

/**
 * Collects tags from a resource's attributes map.
 * Looks for "tags" and "tags_all" keys containing object maps.
 * @internal
 */
function collectTagsFromAttributes(
  attributes: Record<string, unknown>,
  tagMap: Map<string, Set<string>>,
): void {
  for (const tagKey of ['tags', 'tags_all']) {
    const tags = attributes[tagKey];
    if (typeof tags !== 'object' || tags === null || Array.isArray(tags)) {
      continue;
    }
    for (const [key, value] of Object.entries(tags as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      const existing = tagMap.get(key);
      if (existing) {
        existing.add(value);
      } else {
        tagMap.set(key, new Set([value]));
      }
    }
  }
}

/**
 * Extracts naming patterns from resource names.
 * Detects common prefixes and conventions.
 * @internal
 */
function extractNamingPatterns(asts: readonly HclAst[]): string[] {
  const names: string[] = [];
  for (const ast of asts) {
    for (const resource of ast.resources) {
      names.push(resource.name);
    }
  }

  const patterns = new Set<string>();

  // Detect common prefix patterns (e.g., "prod-", "staging-", "app-")
  const prefixCounts = new Map<string, number>();
  for (const name of names) {
    const parts = name.split(/[-_]/);
    if (parts.length >= 2 && parts[0]) {
      const prefix = parts[0];
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
  }

  for (const [prefix, count] of prefixCounts) {
    if (count >= 2) {
      patterns.add(`${prefix}-*`);
    }
  }

  // Detect separator conventions
  const hasDash = names.some((n) => n.includes('-'));
  const hasUnderscore = names.some((n) => n.includes('_'));
  if (hasDash && !hasUnderscore) {
    patterns.add('kebab-case');
  } else if (hasUnderscore && !hasDash) {
    patterns.add('snake_case');
  } else if (hasDash && hasUnderscore) {
    patterns.add('mixed-separators');
  }

  return [...patterns].sort();
}

/**
 * Extracts provider version constraints from terraform blocks and provider blocks.
 * @internal
 */
function extractProviderVersions(
  asts: readonly HclAst[],
): Record<string, string> {
  const versions: Record<string, string> = {};

  for (const ast of asts) {
    // From terraform required_providers
    if (ast.terraform?.required_providers) {
      for (const [name, config] of Object.entries(
        ast.terraform.required_providers,
      )) {
        if (config.version && !versions[name]) {
          versions[name] = config.version;
        }
      }
    }

    // From provider blocks (fallback)
    for (const provider of ast.providers) {
      if (provider.version && !versions[provider.name]) {
        versions[provider.name] = provider.version;
      }
    }
  }

  return versions;
}

/**
 * Extracts module sources from module calls.
 * @internal
 */
function extractModuleSources(
  asts: readonly HclAst[],
): Array<{ name: string; source: string; version?: string }> {
  const seen = new Set<string>();
  const modules: Array<{ name: string; source: string; version?: string }> = [];

  for (const ast of asts) {
    for (const mod of ast.module_calls) {
      const key = `${mod.name}::${mod.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      modules.push({
        name: mod.name,
        source: mod.source,
        version: mod.version,
      });
    }
  }

  return modules;
}

/**
 * Extracts backend type from the first terraform block that has one.
 * @internal
 */
function extractBackendType(
  asts: readonly HclAst[],
): string | undefined {
  for (const ast of asts) {
    if (ast.terraform?.backend) {
      return ast.terraform.backend.type;
    }
  }
  return undefined;
}

/**
 * Extracts terraform version constraint from the first terraform block.
 * @internal
 */
function extractTerraformVersion(
  asts: readonly HclAst[],
): string | undefined {
  for (const ast of asts) {
    if (ast.terraform?.required_version) {
      return ast.terraform.required_version;
    }
  }
  return undefined;
}
