import { describe, it, expect, vi } from 'vitest';
import { resolveValues } from '../../src/variables/value-resolver.js';
import type { VariableMap, VariableDefinition, LocalDefinition, OutputDefinition } from '../../src/variables/types.js';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const SOURCE = { file: 'main.tf', line: 0, column: 0 };

function makeVariableDef(overrides: Partial<VariableDefinition> = {}): VariableDefinition {
  return {
    name: overrides.name ?? 'region',
    type: overrides.type ?? { kind: 'primitive', value: 'string' },
    defaultValue: overrides.defaultValue,
    description: overrides.description,
    sensitive: overrides.sensitive ?? false,
    validation: overrides.validation ?? [],
    sourceLocation: overrides.sourceLocation ?? SOURCE,
  };
}

function makeLocalDef(overrides: Partial<LocalDefinition> = {}): LocalDefinition {
  return {
    name: overrides.name ?? 'tags',
    expression: overrides.expression ?? 'static-value',
    sourceLocation: overrides.sourceLocation ?? SOURCE,
  };
}

function makeOutputDef(overrides: Partial<OutputDefinition> = {}): OutputDefinition {
  return {
    name: overrides.name ?? 'vpc_id',
    value: overrides.value ?? 'var.vpc_id',
    description: overrides.description,
    sensitive: overrides.sensitive ?? false,
    sourceLocation: overrides.sourceLocation ?? SOURCE,
  };
}

function makeVariableMap(opts: {
  variables?: Map<string, VariableDefinition>;
  locals?: Map<string, LocalDefinition>;
  outputs?: Map<string, OutputDefinition>;
} = {}): VariableMap {
  return {
    variables: opts.variables ?? new Map(),
    locals: opts.locals ?? new Map(),
    outputs: opts.outputs ?? new Map(),
  };
}

// ---------------------------------------------------------------------------
// resolveValues - Variables
// ---------------------------------------------------------------------------

describe('resolveValues', () => {
  describe('variable resolution', () => {
    it('should resolve variable with default to status:resolved, source:default', () => {
      const variables = new Map([
        ['region', makeVariableDef({ name: 'region', defaultValue: 'us-east-1' })],
      ]);
      const result = resolveValues(makeVariableMap({ variables }));

      const entry = result.get('var.region');
      expect(entry).toBeDefined();
      expect(entry!.status).toBe('resolved');
      expect(entry!.source).toBe('default');
      expect(entry!.value).toBe('us-east-1');
    });

    it('should mark variable without default as unresolved, source:none', () => {
      const variables = new Map([
        ['region', makeVariableDef({ name: 'region' })],
      ]);
      const result = resolveValues(makeVariableMap({ variables }));

      const entry = result.get('var.region');
      expect(entry!.status).toBe('unresolved');
      expect(entry!.source).toBe('none');
    });

    it('should mark sensitive variable as sensitive, source:default, value:undefined', () => {
      const variables = new Map([
        ['password', makeVariableDef({ name: 'password', sensitive: true, defaultValue: 'secret' })],
      ]);
      const result = resolveValues(makeVariableMap({ variables }));

      const entry = result.get('var.password');
      expect(entry!.status).toBe('sensitive');
      expect(entry!.source).toBe('default');
      expect(entry!.value).toBeUndefined();
    });

    it('should resolve variable with object default', () => {
      const defaultVal = { Name: 'test' };
      const variables = new Map([
        ['tags', makeVariableDef({ name: 'tags', defaultValue: defaultVal })],
      ]);
      const result = resolveValues(makeVariableMap({ variables }));

      expect(result.get('var.tags')!.status).toBe('resolved');
      expect(result.get('var.tags')!.value).toEqual(defaultVal);
    });

    it('should resolve variable with boolean false default', () => {
      const variables = new Map([
        ['enabled', makeVariableDef({ name: 'enabled', defaultValue: false })],
      ]);
      const result = resolveValues(makeVariableMap({ variables }));

      // false is not undefined, so should be resolved
      expect(result.get('var.enabled')!.status).toBe('resolved');
      expect(result.get('var.enabled')!.value).toBe(false);
    });

    it('should resolve variable with numeric 0 default', () => {
      const variables = new Map([
        ['count', makeVariableDef({ name: 'count', defaultValue: 0 })],
      ]);
      const result = resolveValues(makeVariableMap({ variables }));

      expect(result.get('var.count')!.status).toBe('resolved');
      expect(result.get('var.count')!.value).toBe(0);
    });

    it('should resolve variable with empty string default', () => {
      const variables = new Map([
        ['prefix', makeVariableDef({ name: 'prefix', defaultValue: '' })],
      ]);
      const result = resolveValues(makeVariableMap({ variables }));

      expect(result.get('var.prefix')!.status).toBe('resolved');
      expect(result.get('var.prefix')!.value).toBe('');
    });

    it('should resolve variable with null default', () => {
      const variables = new Map([
        ['optional', makeVariableDef({ name: 'optional', defaultValue: null })],
      ]);
      const result = resolveValues(makeVariableMap({ variables }));

      expect(result.get('var.optional')!.status).toBe('resolved');
      expect(result.get('var.optional')!.value).toBeNull();
    });

    it('should use qualified key "var.name"', () => {
      const variables = new Map([
        ['region', makeVariableDef({ name: 'region', defaultValue: 'x' })],
      ]);
      const result = resolveValues(makeVariableMap({ variables }));

      expect(result.has('var.region')).toBe(true);
      expect(result.has('region')).toBe(false);
    });

    it('should resolve multiple variables', () => {
      const variables = new Map([
        ['region', makeVariableDef({ name: 'region', defaultValue: 'us-east-1' })],
        ['env', makeVariableDef({ name: 'env', defaultValue: 'prod' })],
        ['required', makeVariableDef({ name: 'required' })],
      ]);
      const result = resolveValues(makeVariableMap({ variables }));

      expect(result.get('var.region')!.status).toBe('resolved');
      expect(result.get('var.env')!.status).toBe('resolved');
      expect(result.get('var.required')!.status).toBe('unresolved');
    });
  });

  // -------------------------------------------------------------------------
  // Local resolution
  // -------------------------------------------------------------------------

  describe('local resolution', () => {
    it('should resolve local with literal expression', () => {
      const locals = new Map([
        ['name', makeLocalDef({ name: 'name', expression: 'static-value' })],
      ]);
      const result = resolveValues(makeVariableMap({ locals }));

      const entry = result.get('local.name');
      expect(entry!.status).toBe('resolved');
      expect(entry!.source).toBe('expression');
    });

    it('should resolve local referencing a resolved variable', () => {
      const variables = new Map([
        ['region', makeVariableDef({ name: 'region', defaultValue: 'us-east-1' })],
      ]);
      const locals = new Map([
        ['selected_region', makeLocalDef({ name: 'selected_region', expression: 'var.region' })],
      ]);
      const result = resolveValues(makeVariableMap({ variables, locals }));

      // local references var.* which is not a local.* reference,
      // so it resolves on first pass (no local.* deps)
      expect(result.get('local.selected_region')!.status).toBe('resolved');
    });

    it('should resolve local chain: local.a -> local.b in 2 passes', () => {
      const locals = new Map([
        ['b', makeLocalDef({ name: 'b', expression: 'base-value' })],
        ['a', makeLocalDef({ name: 'a', expression: 'local.b' })],
      ]);
      const result = resolveValues(makeVariableMap({ locals }));

      expect(result.get('local.b')!.status).toBe('resolved');
      expect(result.get('local.a')!.status).toBe('resolved');
    });

    it('should resolve 3-level local chain', () => {
      const locals = new Map([
        ['c', makeLocalDef({ name: 'c', expression: 'root' })],
        ['b', makeLocalDef({ name: 'b', expression: 'local.c' })],
        ['a', makeLocalDef({ name: 'a', expression: 'local.b' })],
      ]);
      const result = resolveValues(makeVariableMap({ locals }));

      expect(result.get('local.a')!.status).toBe('resolved');
      expect(result.get('local.b')!.status).toBe('resolved');
      expect(result.get('local.c')!.status).toBe('resolved');
    });

    it('should mark circular locals: local.a -> local.b -> local.a', () => {
      const locals = new Map([
        ['a', makeLocalDef({ name: 'a', expression: 'local.b' })],
        ['b', makeLocalDef({ name: 'b', expression: 'local.a' })],
      ]);
      const result = resolveValues(makeVariableMap({ locals }));

      expect(result.get('local.a')!.status).toBe('circular');
      expect(result.get('local.b')!.status).toBe('circular');
    });

    it('should mark self-referencing local as circular', () => {
      const locals = new Map([
        ['x', makeLocalDef({ name: 'x', expression: 'local.x' })],
      ]);
      const result = resolveValues(makeVariableMap({ locals }));

      expect(result.get('local.x')!.status).toBe('circular');
    });

    it('should mark as circular when maxPasses is 0 (no passes allowed)', () => {
      // With maxPasses=0, no resolution passes run at all
      const locals = new Map([
        ['a', makeLocalDef({ name: 'a', expression: 'literal' })],
      ]);

      const result = resolveValues(makeVariableMap({ locals }), { maxPasses: 0 });

      // Even though 'a' has no local.* deps, 0 passes means it never gets resolved
      expect(result.get('local.a')!.status).toBe('circular');
    });

    it('should resolve entire chain in a single pass due to cascading', () => {
      // Implementation resolves within same pass as dependencies resolve,
      // so even a long chain resolves in 1 pass
      const locals = new Map<string, LocalDefinition>();
      for (let i = 0; i < 5; i++) {
        locals.set(
          `step${i}`,
          makeLocalDef({
            name: `step${i}`,
            expression: i > 0 ? `local.step${i - 1}` : 'root',
          }),
        );
      }

      const result = resolveValues(makeVariableMap({ locals }), { maxPasses: 1 });

      // All should resolve because cascading within a single pass
      for (let i = 0; i < 5; i++) {
        expect(result.get(`local.step${i}`)!.status).toBe('resolved');
      }
    });

    it('should use qualified key "local.name"', () => {
      const locals = new Map([
        ['tags', makeLocalDef({ name: 'tags', expression: 'value' })],
      ]);
      const result = resolveValues(makeVariableMap({ locals }));

      expect(result.has('local.tags')).toBe(true);
      expect(result.has('tags')).toBe(false);
    });

    it('should resolve local with non-string expression as resolved', () => {
      const locals = new Map([
        ['count', makeLocalDef({ name: 'count', expression: 42 })],
      ]);
      const result = resolveValues(makeVariableMap({ locals }));

      expect(result.get('local.count')!.status).toBe('resolved');
    });
  });

  // -------------------------------------------------------------------------
  // Output resolution
  // -------------------------------------------------------------------------

  describe('output resolution', () => {
    it('should resolve output with literal value', () => {
      const outputs = new Map([
        ['static', makeOutputDef({ name: 'static', value: 'hardcoded' })],
      ]);
      const result = resolveValues(makeVariableMap({ outputs }));

      expect(result.get('output.static')!.status).toBe('resolved');
      expect(result.get('output.static')!.source).toBe('expression');
      expect(result.get('output.static')!.value).toBe('hardcoded');
    });

    it('should resolve output with all refs resolved', () => {
      const variables = new Map([
        ['vpc_id', makeVariableDef({ name: 'vpc_id', defaultValue: 'vpc-123' })],
      ]);
      const outputs = new Map([
        ['vpc', makeOutputDef({ name: 'vpc', value: 'var.vpc_id' })],
      ]);
      const result = resolveValues(makeVariableMap({ variables, outputs }));

      expect(result.get('output.vpc')!.status).toBe('resolved');
    });

    it('should mark output as unresolved when refs are unresolved', () => {
      const variables = new Map([
        ['required', makeVariableDef({ name: 'required' })], // no default
      ]);
      const outputs = new Map([
        ['out', makeOutputDef({ name: 'out', value: 'var.required' })],
      ]);
      const result = resolveValues(makeVariableMap({ variables, outputs }));

      expect(result.get('output.out')!.status).toBe('unresolved');
    });

    it('should mark sensitive output as sensitive, value:undefined', () => {
      const outputs = new Map([
        ['secret', makeOutputDef({ name: 'secret', sensitive: true, value: 'some-secret' })],
      ]);
      const result = resolveValues(makeVariableMap({ outputs }));

      expect(result.get('output.secret')!.status).toBe('sensitive');
      expect(result.get('output.secret')!.value).toBeUndefined();
    });

    it('should resolve output referencing a resolved local', () => {
      const locals = new Map([
        ['tags', makeLocalDef({ name: 'tags', expression: 'value' })],
      ]);
      const outputs = new Map([
        ['tags_out', makeOutputDef({ name: 'tags_out', value: 'local.tags' })],
      ]);
      const result = resolveValues(makeVariableMap({ locals, outputs }));

      expect(result.get('output.tags_out')!.status).toBe('resolved');
    });

    it('should resolve output referencing a sensitive variable', () => {
      const variables = new Map([
        ['password', makeVariableDef({ name: 'password', sensitive: true, defaultValue: 'x' })],
      ]);
      const outputs = new Map([
        ['pass_out', makeOutputDef({ name: 'pass_out', value: 'var.password' })],
      ]);
      const result = resolveValues(makeVariableMap({ variables, outputs }));

      // sensitive vars have status 'sensitive', which the output resolver accepts
      expect(result.get('output.pass_out')!.status).toBe('resolved');
    });

    it('should use qualified key "output.name"', () => {
      const outputs = new Map([
        ['vpc_id', makeOutputDef({ name: 'vpc_id', value: 'literal' })],
      ]);
      const result = resolveValues(makeVariableMap({ outputs }));

      expect(result.has('output.vpc_id')).toBe(true);
      expect(result.has('vpc_id')).toBe(false);
    });

    it('should mark output as unresolved when referencing unknown key', () => {
      const outputs = new Map([
        ['out', makeOutputDef({ name: 'out', value: 'var.nonexistent' })],
      ]);
      const result = resolveValues(makeVariableMap({ outputs }));

      expect(result.get('output.out')!.status).toBe('unresolved');
    });
  });

  // -------------------------------------------------------------------------
  // Empty / edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should return empty map for empty VariableMap', () => {
      const result = resolveValues(makeVariableMap());
      expect(result.size).toBe(0);
    });

    it('should handle all three types together', () => {
      const variables = new Map([
        ['region', makeVariableDef({ name: 'region', defaultValue: 'us-east-1' })],
      ]);
      const locals = new Map([
        ['prefix', makeLocalDef({ name: 'prefix', expression: 'app' })],
      ]);
      const outputs = new Map([
        ['region_out', makeOutputDef({ name: 'region_out', value: 'var.region' })],
      ]);
      const result = resolveValues(makeVariableMap({ variables, locals, outputs }));

      expect(result.size).toBe(3);
      expect(result.get('var.region')!.status).toBe('resolved');
      expect(result.get('local.prefix')!.status).toBe('resolved');
      expect(result.get('output.region_out')!.status).toBe('resolved');
    });

    it('should handle local referencing unresolved variable (not circular)', () => {
      const variables = new Map([
        ['required', makeVariableDef({ name: 'required' })],
      ]);
      const locals = new Map([
        ['derived', makeLocalDef({ name: 'derived', expression: 'var.required' })],
      ]);
      const result = resolveValues(makeVariableMap({ variables, locals }));

      // var.required is not a local.* ref, so local resolves on first pass
      expect(result.get('local.derived')!.status).toBe('resolved');
      expect(result.get('var.required')!.status).toBe('unresolved');
    });
  });
});
