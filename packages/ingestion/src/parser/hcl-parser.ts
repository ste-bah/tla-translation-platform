import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse as parseHcl2Json } from '@cdktf/hcl2json';
import {
  createComponentLogger,
  IngestionError,
  HclAstSchema,
} from '@tla/shared';
import type {
  HclAst,
  HclResource,
  HclDataBlock,
  HclVariable,
  HclLocal,
  HclOutput,
  HclProvider,
  HclModuleCall,
  HclTerraformBlock,
} from '@tla/shared';

const logger = createComponentLogger('ingestion');

/**
 * Result of parsing an entire directory of .tf files.
 */
export interface DirectoryParseResult {
  asts: HclAst[];
  errors: Array<{ file: string; error: Error }>;
}

/**
 * Parses a single HCL (.tf) file and returns a structured AST.
 *
 * @param filePath - Absolute or relative path to a .tf file
 * @returns Parsed and validated HCL AST
 * @throws {IngestionError} When file cannot be read or parsed
 */
export async function parseHclFile(filePath: string): Promise<HclAst> {
  const absolutePath = resolve(filePath);
  logger.info({ file: absolutePath }, 'Parsing HCL file');

  let content: string;
  try {
    content = await readFile(absolutePath, 'utf-8');
  } catch (err) {
    throw new IngestionError(
      `Failed to read HCL file: ${absolutePath}`,
      { file: absolutePath },
      err,
    );
  }

  let hcl2jsonOutput: Record<string, unknown>;
  try {
    hcl2jsonOutput = await parseHcl2Json(absolutePath, content) as Record<string, unknown>;
  } catch (err) {
    throw new IngestionError(
      `Failed to parse HCL: ${absolutePath}`,
      { file: absolutePath },
      err,
    );
  }

  const ast = transformHcl2JsonOutput(absolutePath, hcl2jsonOutput);
  return HclAstSchema.parse(ast);
}

/**
 * Parses all .tf files in a directory (non-recursive).
 * Errors in individual files are captured without halting the batch.
 *
 * @param dirPath - Path to a directory containing .tf files
 * @returns Successful ASTs and per-file errors
 */
export async function parseHclDirectory(
  dirPath: string,
): Promise<DirectoryParseResult> {
  const absoluteDir = resolve(dirPath);
  logger.info({ dir: absoluteDir }, 'Parsing HCL directory');

  let entries: string[];
  try {
    entries = await readdir(absoluteDir);
  } catch (err) {
    throw new IngestionError(
      `Failed to read directory: ${absoluteDir}`,
      { dir: absoluteDir },
      err,
    );
  }

  const tfFiles: string[] = [];
  for (const entry of entries) {
    if (entry.endsWith('.tf')) {
      const fullPath = join(absoluteDir, entry);
      const info = await stat(fullPath);
      if (info.isFile()) {
        tfFiles.push(fullPath);
      }
    }
  }

  if (tfFiles.length === 0) {
    logger.warn({ dir: absoluteDir }, 'No .tf files found in directory');
    return { asts: [], errors: [] };
  }

  const asts: HclAst[] = [];
  const errors: Array<{ file: string; error: Error }> = [];

  // Parse files individually for error isolation
  for (const file of tfFiles) {
    try {
      const ast = await parseHclFile(file);
      asts.push(ast);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ file, err: error.message }, 'Failed to parse HCL file');
      errors.push({ file, error });
    }
  }

  logger.info(
    { dir: absoluteDir, parsed: asts.length, failed: errors.length },
    'Directory parsing complete',
  );
  return { asts, errors };
}

/**
 * Transforms raw hcl2json output into our HclAst shape.
 * @internal
 */
function transformHcl2JsonOutput(
  filePath: string,
  raw: Record<string, unknown>,
): HclAst {
  const resources = extractResources(filePath, raw);
  const dataBlocks = extractDataBlocks(filePath, raw);
  const variables = extractVariables(raw);
  const locals = extractLocals(raw);
  const outputs = extractOutputs(raw);
  const providers = extractProviders(raw);
  const moduleCalls = extractModuleCalls(filePath, raw);
  const terraform = extractTerraformBlock(raw);

  return {
    file_path: filePath,
    resources,
    data_blocks: dataBlocks,
    variables,
    locals,
    outputs,
    providers,
    module_calls: moduleCalls,
    terraform,
  };
}

function extractResources(
  filePath: string,
  raw: Record<string, unknown>,
): HclResource[] {
  const resources: HclResource[] = [];
  const resourceMap = raw['resource'] as
    | Record<string, Record<string, unknown[]>>
    | undefined;
  if (!resourceMap || typeof resourceMap !== 'object') return resources;

  for (const [resourceType, instances] of Object.entries(resourceMap)) {
    for (const [name, configs] of Object.entries(instances)) {
      const configArr = Array.isArray(configs) ? configs : [configs];
      for (const config of configArr) {
        const attrs = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
        const { depends_on, count, for_each, provider, ...rest } = attrs;
        resources.push({
          resource_type: resourceType,
          name,
          attributes: rest,
          meta: {
            source: { file: filePath, line: 0, column: 0 },
            provider: typeof provider === 'string' ? provider : undefined,
            depends_on: Array.isArray(depends_on)
              ? (depends_on as string[])
              : [],
            count:
              typeof count === 'number' || typeof count === 'string'
                ? count
                : undefined,
            for_each: for_each ?? undefined,
          },
        });
      }
    }
  }
  return resources;
}

function extractDataBlocks(
  filePath: string,
  raw: Record<string, unknown>,
): HclDataBlock[] {
  const blocks: HclDataBlock[] = [];
  const dataMap = raw['data'] as
    | Record<string, Record<string, unknown[]>>
    | undefined;
  if (!dataMap || typeof dataMap !== 'object') return blocks;

  for (const [dataType, instances] of Object.entries(dataMap)) {
    for (const [name, configs] of Object.entries(instances)) {
      const configArr = Array.isArray(configs) ? configs : [configs];
      for (const config of configArr) {
        const attrs = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
        const { depends_on, count, for_each, provider, ...rest } = attrs;
        blocks.push({
          data_type: dataType,
          name,
          attributes: rest,
          meta: {
            source: { file: filePath, line: 0, column: 0 },
            provider: typeof provider === 'string' ? provider : undefined,
            depends_on: Array.isArray(depends_on)
              ? (depends_on as string[])
              : [],
            count:
              typeof count === 'number' || typeof count === 'string'
                ? count
                : undefined,
            for_each: for_each ?? undefined,
          },
        });
      }
    }
  }
  return blocks;
}

function extractVariables(raw: Record<string, unknown>): HclVariable[] {
  const variables: HclVariable[] = [];
  const varMap = raw['variable'] as
    | Record<string, unknown[]>
    | undefined;
  if (!varMap || typeof varMap !== 'object') return variables;

  for (const [name, configs] of Object.entries(varMap)) {
    const configArr = Array.isArray(configs) ? configs : [configs];
    for (const config of configArr) {
      const attrs = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
      variables.push({
        name,
        type: typeof attrs['type'] === 'string' ? attrs['type'] : undefined,
        default: attrs['default'],
        description:
          typeof attrs['description'] === 'string'
            ? attrs['description']
            : undefined,
        sensitive: attrs['sensitive'] === true,
        validation: Array.isArray(attrs['validation'])
          ? (attrs['validation'] as Array<{ condition: string; error_message: string }>)
          : [],
      });
    }
  }
  return variables;
}

function extractLocals(raw: Record<string, unknown>): HclLocal[] {
  const locals: HclLocal[] = [];
  const localsArr = raw['locals'] as unknown[] | undefined;
  if (!Array.isArray(localsArr)) return locals;

  for (const block of localsArr) {
    if (typeof block !== 'object' || block === null) continue;
    for (const [name, expression] of Object.entries(
      block as Record<string, unknown>,
    )) {
      locals.push({ name, expression });
    }
  }
  return locals;
}

function extractOutputs(raw: Record<string, unknown>): HclOutput[] {
  const outputs: HclOutput[] = [];
  const outputMap = raw['output'] as
    | Record<string, unknown[]>
    | undefined;
  if (!outputMap || typeof outputMap !== 'object') return outputs;

  for (const [name, configs] of Object.entries(outputMap)) {
    const configArr = Array.isArray(configs) ? configs : [configs];
    for (const config of configArr) {
      const attrs = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
      outputs.push({
        name,
        value: attrs['value'],
        description:
          typeof attrs['description'] === 'string'
            ? attrs['description']
            : undefined,
        sensitive: attrs['sensitive'] === true,
      });
    }
  }
  return outputs;
}

function extractProviders(raw: Record<string, unknown>): HclProvider[] {
  const providers: HclProvider[] = [];
  const providerMap = raw['provider'] as
    | Record<string, unknown[]>
    | undefined;
  if (!providerMap || typeof providerMap !== 'object') return providers;

  for (const [name, configs] of Object.entries(providerMap)) {
    const configArr = Array.isArray(configs) ? configs : [configs];
    for (const config of configArr) {
      const attrs = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
      const { alias, version, ...rest } = attrs;
      providers.push({
        name,
        alias: typeof alias === 'string' ? alias : undefined,
        attributes: rest,
        version: typeof version === 'string' ? version : undefined,
      });
    }
  }
  return providers;
}

function extractModuleCalls(
  filePath: string,
  raw: Record<string, unknown>,
): HclModuleCall[] {
  const modules: HclModuleCall[] = [];
  const moduleMap = raw['module'] as
    | Record<string, unknown[]>
    | undefined;
  if (!moduleMap || typeof moduleMap !== 'object') return modules;

  for (const [name, configs] of Object.entries(moduleMap)) {
    const configArr = Array.isArray(configs) ? configs : [configs];
    for (const config of configArr) {
      const attrs = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
      const { source, version, depends_on, count, for_each, providers, ...rest } = attrs;
      void providers; // meta-field excluded from attributes
      modules.push({
        name,
        source: typeof source === 'string' ? source : 'unknown',
        version: typeof version === 'string' ? version : undefined,
        attributes: rest,
        meta: {
          source: { file: filePath, line: 0, column: 0 },
          depends_on: Array.isArray(depends_on)
            ? (depends_on as string[])
            : [],
          count:
            typeof count === 'number' || typeof count === 'string'
              ? count
              : undefined,
          for_each: for_each ?? undefined,
        },
      });
    }
  }
  return modules;
}

function extractTerraformBlock(
  raw: Record<string, unknown>,
): HclTerraformBlock | undefined {
  const tfArr = raw['terraform'] as unknown[] | undefined;
  if (!Array.isArray(tfArr) || tfArr.length === 0) return undefined;

  const tf = tfArr[0] as Record<string, unknown>;
  const requiredVersion =
    typeof tf['required_version'] === 'string'
      ? tf['required_version']
      : undefined;

  const requiredProviders: Record<
    string,
    { source?: string; version?: string }
  > = {};
  const rpArr = tf['required_providers'] as unknown[] | undefined;
  if (Array.isArray(rpArr)) {
    for (const rp of rpArr) {
      if (typeof rp !== 'object' || rp === null) continue;
      for (const [provName, provConfig] of Object.entries(
        rp as Record<string, unknown>,
      )) {
        const pc = (typeof provConfig === 'object' && provConfig !== null
          ? provConfig
          : {}) as Record<string, unknown>;
        requiredProviders[provName] = {
          source: typeof pc['source'] === 'string' ? pc['source'] : undefined,
          version:
            typeof pc['version'] === 'string' ? pc['version'] : undefined,
        };
      }
    }
  }

  let backend: { type: string; attributes: Record<string, unknown> } | undefined;
  const backendArr = tf['backend'] as unknown[] | undefined;
  if (Array.isArray(backendArr)) {
    for (const be of backendArr) {
      if (typeof be !== 'object' || be === null) continue;
      for (const [beType, beConfig] of Object.entries(
        be as Record<string, unknown>,
      )) {
        const beArr = Array.isArray(beConfig) ? beConfig : [beConfig];
        const attrs = (beArr[0] && typeof beArr[0] === 'object' ? beArr[0] : {}) as Record<string, unknown>;
        backend = { type: beType, attributes: attrs };
      }
    }
  }

  return {
    required_version: requiredVersion,
    required_providers: requiredProviders,
    backend,
  };
}
