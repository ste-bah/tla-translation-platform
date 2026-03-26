import type { ExpressionAnalysis } from './types.js';

/**
 * Regex to capture Terraform references as full dot-paths.
 * Matches: var.region, local.tags, data.aws_ami.latest, module.vpc.output_id
 *
 * Simpler than dependency-graph.ts: captures the full match as a single string
 * rather than decomposing into capture groups.
 */
export const REFERENCE_RE = /\b(?:var|local|data|module)\.[a-zA-Z_][a-zA-Z0-9_.]*\b/g;

/**
 * Regex to detect function calls in Terraform expressions.
 * Matches identifiers followed by an opening paren: lookup(, length(, etc.
 */
const FUNCTION_RE = /\b[a-zA-Z_]\w*\s*\(/;

/**
 * Analyze a Terraform expression value to extract references, determine
 * complexity, and detect function usage.
 *
 * @param value - The expression value from the HCL AST (may be any JSON type)
 * @returns Analysis with references, complexity classification, and function flag
 */
export function analyzeExpression(value: unknown): ExpressionAnalysis {
  // Non-string primitives are always literal
  if (value === null || value === undefined) {
    return { references: [], complexity: 'literal', hasFunctions: false };
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return { references: [], complexity: 'literal', hasFunctions: false };
  }

  // Convert to scannable string
  const text = typeof value === 'string'
    ? value
    : JSON.stringify(value);

  // Extract unique references
  REFERENCE_RE.lastIndex = 0;
  const refSet = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = REFERENCE_RE.exec(text)) !== null) {
    refSet.add(match[0]);
  }
  const references = [...refSet];

  // Detect functions
  const hasFunctions = FUNCTION_RE.test(text);

  // Classify complexity
  const complexity = classifyComplexity(value, references, hasFunctions);

  return { references, complexity, hasFunctions };
}

/**
 * Classify expression complexity based on its shape and content.
 */
function classifyComplexity(
  value: unknown,
  references: string[],
  hasFunctions: boolean,
): ExpressionAnalysis['complexity'] {
  // Non-string primitives
  if (typeof value !== 'string') {
    if (references.length === 0 && !hasFunctions) {
      return 'literal';
    }
    // Objects/arrays with references are complex
    return 'complex';
  }

  // String values
  if (references.length === 0 && !hasFunctions) {
    return 'literal';
  }

  // Exact single reference (e.g., "var.region" with no surrounding text)
  if (references.length === 1 && value.trim() === references[0]) {
    return 'simple_ref';
  }

  // Interpolation: contains ${...} patterns or mixed text+refs
  if (value.includes('${') || (references.length > 0 && !hasFunctions)) {
    return 'interpolation';
  }

  return 'complex';
}

/**
 * Convenience function: extract just the reference strings from a value.
 *
 * @param value - The expression value to scan
 * @returns Array of unique reference strings found in the value
 */
export function extractReferencesFromValue(value: unknown): string[] {
  return analyzeExpression(value).references;
}
