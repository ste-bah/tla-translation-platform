import { createComponentLogger } from '@tla/shared';
import type { VariableMap, ResolvedValue } from './types.js';
import { analyzeExpression } from './expression-analyzer.js';

const logger = createComponentLogger('variables');

const DEFAULT_MAX_PASSES = 10;

/**
 * Options for the value resolution process.
 */
export interface ValueResolveOptions {
  /** Maximum iterative passes for local resolution (default: 10) */
  maxPasses?: number;
}

/**
 * Resolve variable, local, and output values from a VariableMap.
 *
 * Resolution rules:
 * - Variables: has default -> resolved (source:'default'), sensitive -> sensitive, else -> unresolved
 * - Locals: iterative multi-pass resolution of local.* references
 * - Outputs: resolved if all references are resolved, else unresolved
 *
 * Keys in the returned Map are QUALIFIED: "var.region", "local.tags", "output.vpc_id"
 *
 * @param variableMap - The extracted variable map
 * @param options - Optional resolution configuration
 * @returns Map of qualified names to resolved values
 */
export function resolveValues(
  variableMap: VariableMap,
  options?: ValueResolveOptions,
): Map<string, ResolvedValue> {
  const maxPasses = options?.maxPasses ?? DEFAULT_MAX_PASSES;
  const result = new Map<string, ResolvedValue>();

  // Phase 1: Resolve variables
  resolveVariables(variableMap, result);

  // Phase 2: Iteratively resolve locals
  resolveLocals(variableMap, result, maxPasses);

  // Phase 3: Resolve outputs
  resolveOutputs(variableMap, result);

  logger.info(
    {
      total: result.size,
      resolved: countByStatus(result, 'resolved'),
      unresolved: countByStatus(result, 'unresolved'),
      circular: countByStatus(result, 'circular'),
      sensitive: countByStatus(result, 'sensitive'),
    },
    'Value resolution complete',
  );

  return result;
}

/**
 * Resolve variable definitions. Variables without external overrides
 * can only be resolved from their default values.
 */
function resolveVariables(
  variableMap: VariableMap,
  result: Map<string, ResolvedValue>,
): void {
  for (const [name, def] of variableMap.variables) {
    const key = `var.${name}`;

    if (def.sensitive) {
      result.set(key, { name: key, status: 'sensitive', value: undefined, source: 'default' });
      continue;
    }

    if (def.defaultValue !== undefined) {
      result.set(key, {
        name: key,
        status: 'resolved',
        value: def.defaultValue,
        source: 'default',
      });
    } else {
      result.set(key, { name: key, status: 'unresolved', source: 'none' });
    }
  }
}

/**
 * Iteratively resolve locals. Each pass attempts to resolve locals whose
 * local.* references have all been resolved. Stops when no progress is
 * made, marking remaining unresolved locals as circular.
 */
function resolveLocals(
  variableMap: VariableMap,
  result: Map<string, ResolvedValue>,
  maxPasses: number,
): void {
  // Track which locals are still unresolved
  const pending = new Set<string>();
  for (const name of variableMap.locals.keys()) {
    pending.add(name);
  }

  for (let pass = 0; pass < maxPasses && pending.size > 0; pass++) {
    let progressMade = false;

    for (const name of [...pending]) {
      const def = variableMap.locals.get(name);
      if (!def) {
        pending.delete(name);
        continue;
      }

      const key = `local.${name}`;
      const analysis = analyzeExpression(def.expression);

      // Check if all local.* references are resolved
      const localRefs = analysis.references.filter((r: string) => r.startsWith('local.'));
      const allRefsResolved = localRefs.every((ref: string) => {
        const existing = result.get(ref);
        return existing !== undefined && existing.status === 'resolved';
      });

      if (!allRefsResolved) {
        continue;
      }

      // Attempt substitution
      const resolvedValue = substituteLocalRefs(def.expression, localRefs, result);
      result.set(key, {
        name: key,
        status: 'resolved',
        value: resolvedValue,
        source: 'expression',
      });
      pending.delete(name);
      progressMade = true;
    }

    if (!progressMade) {
      break;
    }
  }

  // Mark remaining pending locals as circular
  for (const name of pending) {
    const key = `local.${name}`;
    result.set(key, { name: key, status: 'circular', source: 'none' });
    logger.warn({ local: name }, 'Local marked as circular: unresolvable references');
  }
}

/**
 * Attempt to substitute resolved local references into an expression value.
 *
 * - Exact match (entire value is "local.NAME"): returns the raw resolved value
 * - String interpolation ("${local.NAME}"): string replacement
 * - Otherwise: returns the original expression
 */
function substituteLocalRefs(
  expression: unknown,
  localRefs: string[],
  resolved: Map<string, ResolvedValue>,
): unknown {
  if (typeof expression !== 'string') {
    return expression;
  }

  // Exact single-reference match
  if (localRefs.length === 1 && expression.trim() === localRefs[0]) {
    const entry = resolved.get(localRefs[0]!);
    return entry?.value;
  }

  // String interpolation replacement
  let result = expression;
  for (const ref of localRefs) {
    const entry = resolved.get(ref);
    if (entry?.value !== undefined) {
      const replacement = typeof entry.value === 'string'
        ? entry.value
        : JSON.stringify(entry.value);
      // Replace ${local.name} patterns
      result = result.replace(
        new RegExp(`\\$\\{${escapeRegex(ref)}\\}`, 'g'),
        replacement,
      );
      // Replace bare local.name references
      result = result.replace(
        new RegExp(`\\b${escapeRegex(ref)}\\b`, 'g'),
        replacement,
      );
    }
  }

  return result;
}

/**
 * Resolve output definitions. An output is resolved if all its references
 * (var.*, local.*, etc.) point to resolved entries.
 */
function resolveOutputs(
  variableMap: VariableMap,
  result: Map<string, ResolvedValue>,
): void {
  for (const [name, def] of variableMap.outputs) {
    const key = `output.${name}`;

    if (def.sensitive) {
      result.set(key, { name: key, status: 'sensitive', value: undefined, source: 'expression' });
      continue;
    }

    const analysis = analyzeExpression(def.value);

    if (analysis.references.length === 0) {
      // Literal output value
      result.set(key, {
        name: key,
        status: 'resolved',
        value: def.value,
        source: 'expression',
      });
      continue;
    }

    // Check if all references are resolved
    const allResolved = analysis.references.every((ref: string) => {
      const entry = result.get(ref);
      return entry !== undefined && (entry.status === 'resolved' || entry.status === 'sensitive');
    });

    if (allResolved) {
      result.set(key, {
        name: key,
        status: 'resolved',
        value: def.value,
        source: 'expression',
      });
    } else {
      result.set(key, { name: key, status: 'unresolved', source: 'none' });
    }
  }
}

/** Escape special regex characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Count entries with a given status. */
function countByStatus(
  map: Map<string, ResolvedValue>,
  status: ResolvedValue['status'],
): number {
  let count = 0;
  for (const entry of map.values()) {
    if (entry.status === status) count++;
  }
  return count;
}
