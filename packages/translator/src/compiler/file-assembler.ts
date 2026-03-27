import type { CloudProvider, TranslatedResource, CompilerOptions } from '@tla/shared';
import { createComponentLogger } from '@tla/shared';
import type { AssemblyInput } from '../engines/mapping-engine.js';

const logger = createComponentLogger('file-assembler');

// ---------------------------------------------------------------------------
// HCL value printer
// ---------------------------------------------------------------------------

/**
 * Renders an arbitrary value as an HCL literal string.
 */
function printHclValue(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  const innerPad = '  '.repeat(indent + 1);

  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => `${innerPad}${printHclValue(v, indent + 1)}`);
    return `[\n${items.join(',\n')},\n${pad}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
    if (keys.length === 0) return '{}';
    const entries = keys.map(
      (k) => `${innerPad}${k} = ${printHclValue(obj[k], indent + 1)}`,
    );
    return `{\n${entries.join('\n')}\n${pad}}`;
  }
  return `"${String(value)}"`;
}

// ---------------------------------------------------------------------------
// HCL block printer
// ---------------------------------------------------------------------------

/**
 * Renders an HCL block with the given type, labels, and body attributes.
 */
function printHclBlock(
  blockType: string,
  labels: readonly string[],
  body: Record<string, unknown>,
  options: CompilerOptions,
): string {
  const labelStr = labels.map((l) => `"${l}"`).join(' ');
  const header = labels.length > 0
    ? `${blockType} ${labelStr} {`
    : `${blockType} {`;

  const keys = options.sortKeys
    ? Object.keys(body).sort((a, b) => a.localeCompare(b))
    : Object.keys(body);

  const lines = keys.map((k) => `  ${k} = ${printHclValue(body[k], 1)}`);

  return `${header}\n${lines.join('\n')}\n}`;
}

// ---------------------------------------------------------------------------
// Provider and terraform blocks
// ---------------------------------------------------------------------------

/**
 * Generates the provider block for the given cloud target.
 */
function providerBlock(target: CloudProvider, options: CompilerOptions): string {
  const providerName = target === 'azure' ? 'azurerm' : target === 'gcp' ? 'google' : target;

  const body: Record<string, unknown> = {};
  if (target === 'azure') {
    body['features'] = {};
  }
  if (target === 'gcp') {
    body['project'] = 'var.project_id';
    body['region'] = 'var.region';
  }

  return printHclBlock('provider', [providerName], body, options);
}

/**
 * Generates the terraform required_providers block.
 *
 * Renders manually instead of delegating to printHclBlock because the
 * terraform block mixes attributes (`required_version = ...`) with
 * sub-blocks (`required_providers { ... }`) that must NOT have `=`.
 */
function terraformBlock(target: CloudProvider, _options: CompilerOptions): string {
  const providerName = target === 'azure' ? 'azurerm' : target === 'gcp' ? 'google' : target;

  const sourceMap: Record<string, string> = {
    azurerm: 'hashicorp/azurerm',
    google: 'hashicorp/google',
  };

  const versionMap: Record<string, string> = {
    azurerm: '~> 3.0',
    google: '~> 5.0',
  };

  const source = sourceMap[providerName] ?? `hashicorp/${providerName}`;
  const version = versionMap[providerName] ?? '~> 1.0';

  return renderTerraformBlock(providerName, source, version);
}

/**
 * Renders the terraform block with correct HCL syntax:
 *   - `required_version` is an attribute (uses `=`)
 *   - `required_providers` is a sub-block (no `=`)
 *   - Each provider inside `required_providers` is a sub-block (no `=`)
 *   - `source` and `version` inside each provider are attributes (use `=`)
 */
function renderTerraformBlock(
  providerName: string,
  source: string,
  version: string,
): string {
  const lines: string[] = [];
  lines.push('terraform {');
  lines.push('  required_version = "~> 1.8"');
  lines.push('');
  lines.push('  required_providers {');
  lines.push(`    ${providerName} {`);
  lines.push(`      source  = "${source}"`);
  lines.push(`      version = "${version}"`);
  lines.push('    }');
  lines.push('  }');
  lines.push('}');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Resource rendering
// ---------------------------------------------------------------------------

/**
 * Renders a single translated resource as an HCL resource block.
 */
function renderResource(
  resource: TranslatedResource,
  options: CompilerOptions,
): string {
  const lines: string[] = [];

  if (options.emitComments) {
    lines.push(`# Source: ${resource.traceability.sourceType} (${resource.sourceId})`);
    lines.push(
      `# Engine: ${resource.traceability.engineUsed}, confidence: ${resource.traceability.confidence}`,
    );
  }

  lines.push(
    printHclBlock(
      'resource',
      [resource.targetType, resource.targetName],
      resource.attributes as Record<string, unknown>,
      options,
    ),
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assembles translated resources into HCL file content.
 *
 * Output files:
 * - `main.tf` - All resource blocks
 * - `variables.tf` - Variable declarations (placeholder)
 * - `outputs.tf` - Output declarations (placeholder)
 * - `providers.tf` - Provider and terraform blocks
 *
 * Resources are sorted by targetType then targetName for determinism.
 */
export function assembleFiles(input: AssemblyInput): Map<string, string> {
  const { targetProvider, resources, options } = input;
  const files = new Map<string, string>();

  logger.info(
    { resourceCount: resources.length, targetProvider },
    'Assembling HCL files',
  );

  // Sort resources deterministically
  const sorted = [...resources].sort((a, b) => {
    const typeCmp = a.targetType.localeCompare(b.targetType);
    if (typeCmp !== 0) return typeCmp;
    return a.targetName.localeCompare(b.targetName);
  });

  // Deduplicate: suffix colliding targetType+targetName with _2, _3, etc.
  const nameCounts = new Map<string, number>();
  const deduped = sorted.map((r) => {
    const key = `${r.targetType}::${r.targetName}`;
    const count = (nameCounts.get(key) ?? 0) + 1;
    nameCounts.set(key, count);
    if (count === 1) return r;
    logger.warn(
      { targetType: r.targetType, targetName: r.targetName, suffix: count },
      'Duplicate resource name detected — renaming to avoid HCL collision',
    );
    return { ...r, targetName: `${r.targetName}_${count}` };
  });

  // main.tf
  const resourceBlocks = deduped.map((r) => renderResource(r, options));
  const mainContent = resourceBlocks.length > 0
    ? resourceBlocks.join('\n\n') + '\n'
    : '# No resources translated\n';
  files.set('main.tf', mainContent);

  // variables.tf
  const variablesContent = [
    '# Variables for translated infrastructure',
    '',
    'variable "environment" {',
    '  description = "Deployment environment"',
    '  type        = string',
    '  default     = "dev"',
    '}',
    '',
  ].join('\n');
  files.set('variables.tf', variablesContent);

  // outputs.tf
  const outputsContent = [
    '# Outputs for translated infrastructure',
    '',
    '# Add outputs as needed for inter-module references',
    '',
  ].join('\n');
  files.set('outputs.tf', outputsContent);

  // providers.tf
  const providersContent = [
    terraformBlock(targetProvider, options),
    '',
    providerBlock(targetProvider, options),
    '',
  ].join('\n');
  files.set('providers.tf', providersContent);

  logger.info(
    { fileCount: files.size },
    'HCL file assembly complete',
  );

  return files;
}
