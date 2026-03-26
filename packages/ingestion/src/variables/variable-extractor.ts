import type { HclAst } from '@tla/shared';
import { createComponentLogger } from '@tla/shared';
import type {
  VariableMap,
  VariableDefinition,
  LocalDefinition,
  OutputDefinition,
  TerraformType,
} from './types.js';

const logger = createComponentLogger('variables');

/**
 * Parse a Terraform type string into a structured TerraformType.
 *
 * @param typeStr - The raw type string from the HCL variable block
 * @returns A TerraformType discriminated union value
 */
export function parseTerraformType(typeStr: string | undefined): TerraformType {
  if (typeStr === undefined || typeStr === '') {
    return { kind: 'primitive', value: 'any' };
  }

  const normalized = typeStr.trim().toLowerCase();

  if (normalized === 'string') {
    return { kind: 'primitive', value: 'string' };
  }
  if (normalized === 'number') {
    return { kind: 'primitive', value: 'number' };
  }
  if (normalized === 'bool') {
    return { kind: 'primitive', value: 'bool' };
  }

  // Complex types: list(...), map(...), object({...}), set(...), tuple([...]), etc.
  return { kind: 'complex', raw: typeStr };
}

/**
 * Extract all variable, local, and output definitions from an array of HCL ASTs.
 *
 * Processing rules:
 * - Keys are UNQUALIFIED names (e.g., "region" not "var.region")
 * - Multi-file: last occurrence wins (Map.set overwrites)
 * - Errors are isolated per entry: a malformed entry is logged and skipped
 * - Sensitive variable defaults are NEVER logged
 *
 * @param asts - Readonly array of parsed HCL ASTs
 * @returns A VariableMap containing all extracted definitions
 */
export function extractVariables(asts: readonly HclAst[]): VariableMap {
  const variables = new Map<string, VariableDefinition>();
  const locals = new Map<string, LocalDefinition>();
  const outputs = new Map<string, OutputDefinition>();

  for (const ast of asts) {
    // Extract variables
    for (const v of ast.variables) {
      try {
        const def: VariableDefinition = {
          name: v.name,
          type: parseTerraformType(v.type),
          defaultValue: v.default,
          description: v.description,
          sensitive: v.sensitive,
          validation: v.validation,
          sourceLocation: {
            file: ast.file_path,
            line: 0,
            column: 0,
          },
        };
        variables.set(v.name, def);
      } catch (err) {
        logger.warn(
          { file: ast.file_path, variable: v.name, error: String(err) },
          'Failed to extract variable, skipping',
        );
      }
    }

    // Extract locals
    for (const l of ast.locals) {
      try {
        const def: LocalDefinition = {
          name: l.name,
          expression: l.expression,
          sourceLocation: {
            file: ast.file_path,
            line: 0,
            column: 0,
          },
        };
        locals.set(l.name, def);
      } catch (err) {
        logger.warn(
          { file: ast.file_path, local: l.name, error: String(err) },
          'Failed to extract local, skipping',
        );
      }
    }

    // Extract outputs
    for (const o of ast.outputs) {
      try {
        const def: OutputDefinition = {
          name: o.name,
          value: o.value,
          description: o.description,
          sensitive: o.sensitive,
          sourceLocation: {
            file: ast.file_path,
            line: 0,
            column: 0,
          },
        };
        outputs.set(o.name, def);
      } catch (err) {
        logger.warn(
          { file: ast.file_path, output: o.name, error: String(err) },
          'Failed to extract output, skipping',
        );
      }
    }
  }

  logger.info(
    {
      variables: variables.size,
      locals: locals.size,
      outputs: outputs.size,
      files: asts.length,
    },
    'Variable extraction complete',
  );

  return { variables, locals, outputs };
}
