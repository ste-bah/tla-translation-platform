import { describe, it, expect, vi } from 'vitest';
import type { HclAst, HclVariable, HclLocal, HclOutput } from '@tla/shared';
import { extractVariables, parseTerraformType } from '../../src/variables/variable-extractor.js';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const META = { source: { file: 'main.tf', line: 1, column: 0 }, depends_on: [] as string[] };

function makeAst(overrides: Partial<HclAst> = {}): HclAst {
  return {
    file_path: overrides.file_path ?? '/project/main.tf',
    resources: overrides.resources ?? [],
    data_blocks: overrides.data_blocks ?? [],
    variables: overrides.variables ?? [],
    locals: overrides.locals ?? [],
    outputs: overrides.outputs ?? [],
    providers: overrides.providers ?? [],
    module_calls: overrides.module_calls ?? [],
    terraform: overrides.terraform,
  };
}

function makeVariable(overrides: Partial<HclVariable> = {}): HclVariable {
  return {
    name: overrides.name ?? 'region',
    type: overrides.type,
    default: overrides.default,
    description: overrides.description,
    sensitive: overrides.sensitive ?? false,
    validation: overrides.validation ?? [],
  };
}

function makeLocal(overrides: Partial<HclLocal> = {}): HclLocal {
  return {
    name: overrides.name ?? 'tags',
    expression: overrides.expression ?? 'static-value',
  };
}

function makeOutput(overrides: Partial<HclOutput> = {}): HclOutput {
  return {
    name: overrides.name ?? 'vpc_id',
    value: overrides.value ?? 'var.vpc_id',
    description: overrides.description,
    sensitive: overrides.sensitive ?? false,
  };
}

// ---------------------------------------------------------------------------
// parseTerraformType
// ---------------------------------------------------------------------------

describe('parseTerraformType', () => {
  it('should return primitive "any" for undefined input', () => {
    const result = parseTerraformType(undefined);
    expect(result).toEqual({ kind: 'primitive', value: 'any' });
  });

  it('should return primitive "any" for empty string', () => {
    const result = parseTerraformType('');
    expect(result).toEqual({ kind: 'primitive', value: 'any' });
  });

  it('should parse "string" as primitive string', () => {
    const result = parseTerraformType('string');
    expect(result).toEqual({ kind: 'primitive', value: 'string' });
  });

  it('should parse "number" as primitive number', () => {
    const result = parseTerraformType('number');
    expect(result).toEqual({ kind: 'primitive', value: 'number' });
  });

  it('should parse "bool" as primitive bool', () => {
    const result = parseTerraformType('bool');
    expect(result).toEqual({ kind: 'primitive', value: 'bool' });
  });

  it('should parse "String" case-insensitively as primitive string', () => {
    const result = parseTerraformType('String');
    expect(result).toEqual({ kind: 'primitive', value: 'string' });
  });

  it('should parse " number " with whitespace as primitive number', () => {
    const result = parseTerraformType(' number ');
    expect(result).toEqual({ kind: 'primitive', value: 'number' });
  });

  it('should parse "list(string)" as complex', () => {
    const result = parseTerraformType('list(string)');
    expect(result).toEqual({ kind: 'complex', raw: 'list(string)' });
  });

  it('should parse "map(string)" as complex', () => {
    const result = parseTerraformType('map(string)');
    expect(result).toEqual({ kind: 'complex', raw: 'map(string)' });
  });

  it('should parse "set(number)" as complex', () => {
    const result = parseTerraformType('set(number)');
    expect(result).toEqual({ kind: 'complex', raw: 'set(number)' });
  });

  it('should parse "object({...})" as complex preserving raw', () => {
    const raw = 'object({ name = string, age = number })';
    const result = parseTerraformType(raw);
    expect(result).toEqual({ kind: 'complex', raw });
  });

  it('should parse "tuple([string, number])" as complex', () => {
    const raw = 'tuple([string, number])';
    const result = parseTerraformType(raw);
    expect(result).toEqual({ kind: 'complex', raw });
  });
});

// ---------------------------------------------------------------------------
// extractVariables
// ---------------------------------------------------------------------------

describe('extractVariables', () => {
  describe('variable extraction', () => {
    it('should extract a single variable with all fields', () => {
      const ast = makeAst({
        variables: [
          makeVariable({
            name: 'region',
            type: 'string',
            default: 'us-east-1',
            description: 'AWS region',
            sensitive: false,
            validation: [{ condition: 'length(var.region) > 0', error_message: 'Region required' }],
          }),
        ],
      });

      const result = extractVariables([ast]);

      expect(result.variables.size).toBe(1);
      const v = result.variables.get('region');
      expect(v).toBeDefined();
      expect(v!.name).toBe('region');
      expect(v!.type).toEqual({ kind: 'primitive', value: 'string' });
      expect(v!.defaultValue).toBe('us-east-1');
      expect(v!.description).toBe('AWS region');
      expect(v!.sensitive).toBe(false);
      expect(v!.validation).toHaveLength(1);
      expect(v!.validation[0]!.condition).toBe('length(var.region) > 0');
    });

    it('should set source location from AST file_path with line:0 column:0', () => {
      const ast = makeAst({
        file_path: '/project/variables.tf',
        variables: [makeVariable({ name: 'env' })],
      });

      const result = extractVariables([ast]);
      const v = result.variables.get('env');
      expect(v!.sourceLocation).toEqual({
        file: '/project/variables.tf',
        line: 0,
        column: 0,
      });
    });

    it('should extract variable without type or default', () => {
      const ast = makeAst({
        variables: [makeVariable({ name: 'required_var' })],
      });

      const result = extractVariables([ast]);
      const v = result.variables.get('required_var');
      expect(v).toBeDefined();
      expect(v!.type).toEqual({ kind: 'primitive', value: 'any' });
      expect(v!.defaultValue).toBeUndefined();
    });

    it('should extract sensitive variable', () => {
      const ast = makeAst({
        variables: [makeVariable({ name: 'db_password', sensitive: true, default: 'secret123' })],
      });

      const result = extractVariables([ast]);
      const v = result.variables.get('db_password');
      expect(v!.sensitive).toBe(true);
      expect(v!.defaultValue).toBe('secret123');
    });

    it('should extract multiple variables from same AST', () => {
      const ast = makeAst({
        variables: [
          makeVariable({ name: 'region' }),
          makeVariable({ name: 'env' }),
          makeVariable({ name: 'project' }),
        ],
      });

      const result = extractVariables([ast]);
      expect(result.variables.size).toBe(3);
      expect(result.variables.has('region')).toBe(true);
      expect(result.variables.has('env')).toBe(true);
      expect(result.variables.has('project')).toBe(true);
    });
  });

  describe('multi-AST: last occurrence wins', () => {
    it('should overwrite variable when same name appears in two ASTs', () => {
      const ast1 = makeAst({
        file_path: '/project/first.tf',
        variables: [makeVariable({ name: 'region', default: 'us-east-1' })],
      });
      const ast2 = makeAst({
        file_path: '/project/second.tf',
        variables: [makeVariable({ name: 'region', default: 'eu-west-1' })],
      });

      const result = extractVariables([ast1, ast2]);
      expect(result.variables.size).toBe(1);
      expect(result.variables.get('region')!.defaultValue).toBe('eu-west-1');
      expect(result.variables.get('region')!.sourceLocation.file).toBe('/project/second.tf');
    });

    it('should overwrite local when same name appears in two ASTs', () => {
      const ast1 = makeAst({
        file_path: '/a.tf',
        locals: [makeLocal({ name: 'tags', expression: 'first' })],
      });
      const ast2 = makeAst({
        file_path: '/b.tf',
        locals: [makeLocal({ name: 'tags', expression: 'second' })],
      });

      const result = extractVariables([ast1, ast2]);
      expect(result.locals.get('tags')!.expression).toBe('second');
    });

    it('should overwrite output when same name appears in two ASTs', () => {
      const ast1 = makeAst({
        file_path: '/a.tf',
        outputs: [makeOutput({ name: 'vpc_id', value: 'first' })],
      });
      const ast2 = makeAst({
        file_path: '/b.tf',
        outputs: [makeOutput({ name: 'vpc_id', value: 'second' })],
      });

      const result = extractVariables([ast1, ast2]);
      expect(result.outputs.get('vpc_id')!.value).toBe('second');
    });
  });

  describe('local extraction', () => {
    it('should extract local with expression and references', () => {
      const ast = makeAst({
        locals: [makeLocal({ name: 'common_tags', expression: '${var.project}-tags' })],
      });

      const result = extractVariables([ast]);
      expect(result.locals.size).toBe(1);
      const l = result.locals.get('common_tags');
      expect(l).toBeDefined();
      expect(l!.name).toBe('common_tags');
      expect(l!.expression).toBe('${var.project}-tags');
    });

    it('should extract local with object expression', () => {
      const expression = { Name: 'var.name', Env: 'var.env' };
      const ast = makeAst({
        locals: [makeLocal({ name: 'tags', expression })],
      });

      const result = extractVariables([ast]);
      expect(result.locals.get('tags')!.expression).toEqual(expression);
    });

    it('should set source location for local', () => {
      const ast = makeAst({
        file_path: '/project/locals.tf',
        locals: [makeLocal({ name: 'x' })],
      });

      const result = extractVariables([ast]);
      expect(result.locals.get('x')!.sourceLocation).toEqual({
        file: '/project/locals.tf',
        line: 0,
        column: 0,
      });
    });
  });

  describe('output extraction', () => {
    it('should extract output with value, description, and sensitive', () => {
      const ast = makeAst({
        outputs: [
          makeOutput({
            name: 'vpc_id',
            value: 'var.vpc_id',
            description: 'The VPC ID',
            sensitive: false,
          }),
        ],
      });

      const result = extractVariables([ast]);
      expect(result.outputs.size).toBe(1);
      const o = result.outputs.get('vpc_id');
      expect(o!.name).toBe('vpc_id');
      expect(o!.value).toBe('var.vpc_id');
      expect(o!.description).toBe('The VPC ID');
      expect(o!.sensitive).toBe(false);
    });

    it('should extract sensitive output', () => {
      const ast = makeAst({
        outputs: [makeOutput({ name: 'secret', sensitive: true, value: 'var.secret' })],
      });

      const result = extractVariables([ast]);
      expect(result.outputs.get('secret')!.sensitive).toBe(true);
    });

    it('should set source location for output', () => {
      const ast = makeAst({
        file_path: '/project/outputs.tf',
        outputs: [makeOutput({ name: 'out1' })],
      });

      const result = extractVariables([ast]);
      expect(result.outputs.get('out1')!.sourceLocation).toEqual({
        file: '/project/outputs.tf',
        line: 0,
        column: 0,
      });
    });
  });

  describe('empty ASTs', () => {
    it('should return empty maps for zero ASTs', () => {
      const result = extractVariables([]);
      expect(result.variables.size).toBe(0);
      expect(result.locals.size).toBe(0);
      expect(result.outputs.size).toBe(0);
    });

    it('should return empty maps for AST with no blocks', () => {
      const result = extractVariables([makeAst()]);
      expect(result.variables.size).toBe(0);
      expect(result.locals.size).toBe(0);
      expect(result.outputs.size).toBe(0);
    });
  });

  describe('mixed extraction', () => {
    it('should extract variables, locals, and outputs from single AST', () => {
      const ast = makeAst({
        variables: [makeVariable({ name: 'region' })],
        locals: [makeLocal({ name: 'tags' })],
        outputs: [makeOutput({ name: 'vpc_id' })],
      });

      const result = extractVariables([ast]);
      expect(result.variables.size).toBe(1);
      expect(result.locals.size).toBe(1);
      expect(result.outputs.size).toBe(1);
    });

    it('should aggregate across multiple ASTs', () => {
      const ast1 = makeAst({
        variables: [makeVariable({ name: 'region' })],
        locals: [makeLocal({ name: 'tag1' })],
      });
      const ast2 = makeAst({
        variables: [makeVariable({ name: 'env' })],
        outputs: [makeOutput({ name: 'vpc_id' })],
      });

      const result = extractVariables([ast1, ast2]);
      expect(result.variables.size).toBe(2);
      expect(result.locals.size).toBe(1);
      expect(result.outputs.size).toBe(1);
    });
  });

  describe('variable with complex default', () => {
    it('should preserve object default value', () => {
      const defaultVal = { Name: 'test', Env: 'prod' };
      const ast = makeAst({
        variables: [makeVariable({ name: 'tags', type: 'map(string)', default: defaultVal })],
      });

      const result = extractVariables([ast]);
      expect(result.variables.get('tags')!.defaultValue).toEqual(defaultVal);
    });

    it('should preserve list default value', () => {
      const defaultVal = ['10.0.0.0/16', '10.1.0.0/16'];
      const ast = makeAst({
        variables: [makeVariable({ name: 'cidrs', type: 'list(string)', default: defaultVal })],
      });

      const result = extractVariables([ast]);
      expect(result.variables.get('cidrs')!.defaultValue).toEqual(defaultVal);
    });

    it('should preserve boolean default value', () => {
      const ast = makeAst({
        variables: [makeVariable({ name: 'enable_dns', type: 'bool', default: true })],
      });

      const result = extractVariables([ast]);
      expect(result.variables.get('enable_dns')!.defaultValue).toBe(true);
    });

    it('should preserve numeric default value', () => {
      const ast = makeAst({
        variables: [makeVariable({ name: 'port', type: 'number', default: 8080 })],
      });

      const result = extractVariables([ast]);
      expect(result.variables.get('port')!.defaultValue).toBe(8080);
    });
  });

  describe('validation rules', () => {
    it('should preserve multiple validation rules', () => {
      const ast = makeAst({
        variables: [
          makeVariable({
            name: 'env',
            validation: [
              { condition: 'contains(["dev","prod"], var.env)', error_message: 'Invalid env' },
              { condition: 'length(var.env) > 0', error_message: 'Env required' },
            ],
          }),
        ],
      });

      const result = extractVariables([ast]);
      expect(result.variables.get('env')!.validation).toHaveLength(2);
    });

    it('should default to empty validation array', () => {
      const ast = makeAst({
        variables: [makeVariable({ name: 'simple' })],
      });

      const result = extractVariables([ast]);
      expect(result.variables.get('simple')!.validation).toEqual([]);
    });
  });
});
