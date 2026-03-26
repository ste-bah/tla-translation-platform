import type { HclAst } from '@tla/shared';
import { createComponentLogger } from '@tla/shared';
import type { VariableMap, CrossReferenceEntry } from './types.js';
import { extractReferencesFromValue } from './expression-analyzer.js';

const logger = createComponentLogger('variables');

/**
 * Build a cross-reference map showing which blocks consume each variable,
 * local, and output.
 *
 * Keys in the returned Map are QUALIFIED: "var.region", "local.tags", "output.vpc_id"
 *
 * Block IDs follow Terraform conventions:
 * - Resources: "resource_type.name" (e.g., "aws_s3_bucket.main")
 * - Data sources: "data.data_type.name" (e.g., "data.aws_ami.latest")
 * - Modules: "module.name" (e.g., "module.vpc")
 * - Locals: "local.name" (e.g., "local.tags")
 * - Outputs: "output.name" (e.g., "output.vpc_id")
 *
 * @param asts - Readonly array of parsed HCL ASTs
 * @param variableMap - Previously extracted variable definitions
 * @returns Map of qualified names to cross-reference entries
 */
export function buildCrossReferences(
  asts: readonly HclAst[],
  variableMap: VariableMap,
): Map<string, CrossReferenceEntry> {
  const refs = new Map<string, CrossReferenceEntry>();

  // Initialize entries from the variable map
  initializeEntries(refs, variableMap);

  // Scan all AST blocks for references
  for (const ast of asts) {
    scanResources(ast, refs);
    scanDataBlocks(ast, refs);
    scanModuleCalls(ast, refs);
    scanLocals(ast, refs);
    scanOutputs(ast, refs);
  }

  logger.info(
    { entries: refs.size, files: asts.length },
    'Cross-reference build complete',
  );

  return refs;
}

/**
 * Initialize cross-reference entries from the variable map with empty consumers.
 */
function initializeEntries(
  refs: Map<string, CrossReferenceEntry>,
  variableMap: VariableMap,
): void {
  for (const name of variableMap.variables.keys()) {
    refs.set(`var.${name}`, {
      name: `var.${name}`,
      kind: 'variable',
      consumers: [],
      referenceCount: 0,
    });
  }

  for (const name of variableMap.locals.keys()) {
    refs.set(`local.${name}`, {
      name: `local.${name}`,
      kind: 'local',
      consumers: [],
      referenceCount: 0,
    });
  }

  for (const name of variableMap.outputs.keys()) {
    refs.set(`output.${name}`, {
      name: `output.${name}`,
      kind: 'output',
      consumers: [],
      referenceCount: 0,
    });
  }
}

/**
 * Add a consumer to a cross-reference entry if the reference is known.
 */
function addConsumer(
  refs: Map<string, CrossReferenceEntry>,
  reference: string,
  consumerId: string,
): void {
  const entry = refs.get(reference);
  if (entry === undefined) return;

  // Avoid duplicate consumers
  if (!entry.consumers.includes(consumerId)) {
    entry.consumers.push(consumerId);
  }
  entry.referenceCount++;
}

/**
 * Scan a value for references and record consumers.
 */
function scanValue(
  refs: Map<string, CrossReferenceEntry>,
  value: unknown,
  consumerId: string,
): void {
  const references = extractReferencesFromValue(value);
  for (const ref of references) {
    addConsumer(refs, ref, consumerId);
  }
}

/** Scan resource blocks for references to known variables/locals/outputs. */
function scanResources(ast: HclAst, refs: Map<string, CrossReferenceEntry>): void {
  for (const r of ast.resources) {
    const blockId = `${r.resource_type}.${r.name}`;
    scanValue(refs, r.attributes, blockId);
  }
}

/** Scan data blocks for references. */
function scanDataBlocks(ast: HclAst, refs: Map<string, CrossReferenceEntry>): void {
  for (const d of ast.data_blocks) {
    const blockId = `data.${d.data_type}.${d.name}`;
    scanValue(refs, d.attributes, blockId);
  }
}

/** Scan module calls for references. */
function scanModuleCalls(ast: HclAst, refs: Map<string, CrossReferenceEntry>): void {
  for (const m of ast.module_calls) {
    const blockId = `module.${m.name}`;
    scanValue(refs, m.attributes, blockId);
  }
}

/** Scan local definitions for references. */
function scanLocals(ast: HclAst, refs: Map<string, CrossReferenceEntry>): void {
  for (const l of ast.locals) {
    const blockId = `local.${l.name}`;
    scanValue(refs, l.expression, blockId);
  }
}

/** Scan output definitions for references. */
function scanOutputs(ast: HclAst, refs: Map<string, CrossReferenceEntry>): void {
  for (const o of ast.outputs) {
    const blockId = `output.${o.name}`;
    scanValue(refs, o.value, blockId);
  }
}
