import { describe, it, expect } from 'vitest';
import { buildCrossReferences } from '../../src/variables/cross-ref-builder.js';
import type { HclAst, HclResource, HclDataBlock, HclModuleCall, HclLocal, HclOutput } from '@tla/shared';
import type { VariableMap, VariableDefinition, LocalDefinition, OutputDefinition } from '../../src/variables/types.js';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const SOURCE = { file: 'main.tf', line: 0, column: 0 };
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

function makeResource(overrides: Partial<HclResource> = {}): HclResource {
  return {
    resource_type: overrides.resource_type ?? 'aws_vpc',
    name: overrides.name ?? 'main',
    attributes: overrides.attributes ?? {},
    meta: overrides.meta ?? META,
  };
}

function makeDataBlock(overrides: Partial<HclDataBlock> = {}): HclDataBlock {
  return {
    data_type: overrides.data_type ?? 'aws_ami',
    name: overrides.name ?? 'latest',
    attributes: overrides.attributes ?? {},
    meta: overrides.meta ?? META,
  };
}

function makeModuleCall(overrides: Partial<HclModuleCall> = {}): HclModuleCall {
  return {
    name: overrides.name ?? 'vpc',
    source: overrides.source ?? './modules/vpc',
    attributes: overrides.attributes ?? {},
    meta: overrides.meta ?? META,
    version: overrides.version,
  };
}

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
    expression: overrides.expression ?? 'static',
    sourceLocation: overrides.sourceLocation ?? SOURCE,
  };
}

function makeOutputDef(overrides: Partial<OutputDefinition> = {}): OutputDefinition {
  return {
    name: overrides.name ?? 'vpc_id',
    value: overrides.value ?? 'literal',
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
// buildCrossReferences
// ---------------------------------------------------------------------------

describe('buildCrossReferences', () => {
  // -- Initialization -------------------------------------------------------

  describe('initialization', () => {
    it('should create entries for all variables, locals, and outputs', () => {
      const varMap = makeVariableMap({
        variables: new Map([['region', makeVariableDef({ name: 'region' })]]),
        locals: new Map([['tags', makeLocalDef({ name: 'tags' })]]),
        outputs: new Map([['vpc_id', makeOutputDef({ name: 'vpc_id' })]]),
      });

      const result = buildCrossReferences([], varMap);

      expect(result.has('var.region')).toBe(true);
      expect(result.has('local.tags')).toBe(true);
      expect(result.has('output.vpc_id')).toBe(true);
    });

    it('should initialize all entries with empty consumers and referenceCount:0', () => {
      const varMap = makeVariableMap({
        variables: new Map([['x', makeVariableDef({ name: 'x' })]]),
      });

      const result = buildCrossReferences([], varMap);
      const entry = result.get('var.x')!;

      expect(entry.consumers).toEqual([]);
      expect(entry.referenceCount).toBe(0);
    });

    it('should use qualified keys: "var.region" not "region"', () => {
      const varMap = makeVariableMap({
        variables: new Map([['region', makeVariableDef({ name: 'region' })]]),
      });

      const result = buildCrossReferences([], varMap);

      expect(result.has('var.region')).toBe(true);
      expect(result.has('region')).toBe(false);
    });

    it('should assign correct kind for each entry type', () => {
      const varMap = makeVariableMap({
        variables: new Map([['v', makeVariableDef({ name: 'v' })]]),
        locals: new Map([['l', makeLocalDef({ name: 'l' })]]),
        outputs: new Map([['o', makeOutputDef({ name: 'o' })]]),
      });

      const result = buildCrossReferences([], varMap);

      expect(result.get('var.v')!.kind).toBe('variable');
      expect(result.get('local.l')!.kind).toBe('local');
      expect(result.get('output.o')!.kind).toBe('output');
    });
  });

  // -- Resource consumers ---------------------------------------------------

  describe('resource consumers', () => {
    it('should record resource as consumer of referenced variable', () => {
      const varMap = makeVariableMap({
        variables: new Map([['region', makeVariableDef({ name: 'region' })]]),
      });
      const ast = makeAst({
        resources: [
          makeResource({
            resource_type: 'aws_vpc',
            name: 'main',
            attributes: { cidr_block: '10.0.0.0/16', tags: 'var.region' },
          }),
        ],
      });

      const result = buildCrossReferences([ast], varMap);
      const entry = result.get('var.region')!;

      expect(entry.consumers).toContain('aws_vpc.main');
      expect(entry.referenceCount).toBe(1);
    });

    it('should record resource referencing variable via interpolation', () => {
      const varMap = makeVariableMap({
        variables: new Map([['env', makeVariableDef({ name: 'env' })]]),
      });
      const ast = makeAst({
        resources: [
          makeResource({
            resource_type: 'aws_s3_bucket',
            name: 'logs',
            attributes: { bucket: '${var.env}-logs' },
          }),
        ],
      });

      const result = buildCrossReferences([ast], varMap);

      expect(result.get('var.env')!.consumers).toContain('aws_s3_bucket.logs');
    });

    it('should record multiple resources referencing same variable', () => {
      const varMap = makeVariableMap({
        variables: new Map([['region', makeVariableDef({ name: 'region' })]]),
      });
      const ast = makeAst({
        resources: [
          makeResource({
            resource_type: 'aws_vpc',
            name: 'main',
            attributes: { tags: 'var.region' },
          }),
          makeResource({
            resource_type: 'aws_subnet',
            name: 'public',
            attributes: { az: 'var.region' },
          }),
        ],
      });

      const result = buildCrossReferences([ast], varMap);
      const entry = result.get('var.region')!;

      expect(entry.consumers).toContain('aws_vpc.main');
      expect(entry.consumers).toContain('aws_subnet.public');
      expect(entry.consumers).toHaveLength(2);
    });
  });

  // -- Data block consumers -------------------------------------------------

  describe('data block consumers', () => {
    it('should record data block as consumer with "data." prefix', () => {
      const varMap = makeVariableMap({
        variables: new Map([['ami_name', makeVariableDef({ name: 'ami_name' })]]),
      });
      const ast = makeAst({
        data_blocks: [
          makeDataBlock({
            data_type: 'aws_ami',
            name: 'latest',
            attributes: { filter: 'var.ami_name' },
          }),
        ],
      });

      const result = buildCrossReferences([ast], varMap);

      expect(result.get('var.ami_name')!.consumers).toContain('data.aws_ami.latest');
    });

    it('should use "data.data_type.name" as consumer ID', () => {
      const varMap = makeVariableMap({
        variables: new Map([['vpc_id', makeVariableDef({ name: 'vpc_id' })]]),
      });
      const ast = makeAst({
        data_blocks: [
          makeDataBlock({
            data_type: 'aws_subnet',
            name: 'selected',
            attributes: { vpc_id: 'var.vpc_id' },
          }),
        ],
      });

      const result = buildCrossReferences([ast], varMap);

      expect(result.get('var.vpc_id')!.consumers).toContain('data.aws_subnet.selected');
    });
  });

  // -- Module consumers -----------------------------------------------------

  describe('module consumers', () => {
    it('should record module as consumer with "module." prefix', () => {
      const varMap = makeVariableMap({
        variables: new Map([['region', makeVariableDef({ name: 'region' })]]),
      });
      const ast = makeAst({
        module_calls: [
          makeModuleCall({
            name: 'vpc',
            attributes: { region: 'var.region' },
          }),
        ],
      });

      const result = buildCrossReferences([ast], varMap);

      expect(result.get('var.region')!.consumers).toContain('module.vpc');
    });

    it('should record module referencing multiple variables', () => {
      const varMap = makeVariableMap({
        variables: new Map([
          ['region', makeVariableDef({ name: 'region' })],
          ['env', makeVariableDef({ name: 'env' })],
        ]),
      });
      const ast = makeAst({
        module_calls: [
          makeModuleCall({
            name: 'app',
            attributes: { region: 'var.region', environment: 'var.env' },
          }),
        ],
      });

      const result = buildCrossReferences([ast], varMap);

      expect(result.get('var.region')!.consumers).toContain('module.app');
      expect(result.get('var.env')!.consumers).toContain('module.app');
    });
  });

  // -- Local consumers (outputs referencing locals) -------------------------

  describe('local and output cross-references', () => {
    it('should record output as consumer of local', () => {
      const varMap = makeVariableMap({
        locals: new Map([['tags', makeLocalDef({ name: 'tags' })]]),
        outputs: new Map([['tags_out', makeOutputDef({ name: 'tags_out' })]]),
      });
      const ast = makeAst({
        outputs: [{ name: 'tags_out', value: 'local.tags', sensitive: false }],
      });

      const result = buildCrossReferences([ast], varMap);

      expect(result.get('local.tags')!.consumers).toContain('output.tags_out');
    });

    it('should record local referencing a variable', () => {
      const varMap = makeVariableMap({
        variables: new Map([['region', makeVariableDef({ name: 'region' })]]),
        locals: new Map([['selected', makeLocalDef({ name: 'selected' })]]),
      });
      const ast = makeAst({
        locals: [{ name: 'selected', expression: 'var.region' }],
      });

      const result = buildCrossReferences([ast], varMap);

      expect(result.get('var.region')!.consumers).toContain('local.selected');
    });
  });

  // -- Unreferenced entries -------------------------------------------------

  describe('unreferenced entries', () => {
    it('should have empty consumers and referenceCount:0 for unreferenced variable', () => {
      const varMap = makeVariableMap({
        variables: new Map([['unused', makeVariableDef({ name: 'unused' })]]),
      });
      const ast = makeAst({
        resources: [makeResource({ attributes: { static: 'value' } })],
      });

      const result = buildCrossReferences([ast], varMap);
      const entry = result.get('var.unused')!;

      expect(entry.consumers).toEqual([]);
      expect(entry.referenceCount).toBe(0);
    });

    it('should have empty consumers for unreferenced local', () => {
      const varMap = makeVariableMap({
        locals: new Map([['orphan', makeLocalDef({ name: 'orphan' })]]),
      });

      const result = buildCrossReferences([makeAst()], varMap);

      expect(result.get('local.orphan')!.consumers).toEqual([]);
      expect(result.get('local.orphan')!.referenceCount).toBe(0);
    });
  });

  // -- Unknown references (silently skipped) --------------------------------

  describe('unknown references', () => {
    it('should silently skip references to unknown resources', () => {
      const varMap = makeVariableMap({
        variables: new Map([['region', makeVariableDef({ name: 'region' })]]),
      });
      // Resource attributes reference something unknown like "aws_vpc.other.id"
      // which is not in the variable map, so it should be silently ignored
      const ast = makeAst({
        resources: [
          makeResource({
            resource_type: 'aws_subnet',
            name: 'pub',
            attributes: { vpc_id: 'aws_vpc.main.id' }, // not var/local/output/data/module
          }),
        ],
      });

      const result = buildCrossReferences([ast], varMap);

      // var.region should exist but with no consumers (no one referenced it)
      expect(result.get('var.region')!.consumers).toEqual([]);
    });

    it('should not create entries for non-var/local/output references', () => {
      const varMap = makeVariableMap();
      const ast = makeAst({
        resources: [
          makeResource({
            attributes: { vpc_id: 'aws_vpc.main.id' },
          }),
        ],
      });

      const result = buildCrossReferences([ast], varMap);

      // No entries should be created for resource-to-resource references
      expect(result.size).toBe(0);
    });
  });

  // -- Duplicate consumers --------------------------------------------------

  describe('duplicate consumer handling', () => {
    it('should not add duplicate consumer for same block referencing same var twice', () => {
      const varMap = makeVariableMap({
        variables: new Map([['region', makeVariableDef({ name: 'region' })]]),
      });
      const ast = makeAst({
        resources: [
          makeResource({
            resource_type: 'aws_vpc',
            name: 'main',
            attributes: {
              tag1: 'var.region',
              tag2: 'var.region',
            },
          }),
        ],
      });

      const result = buildCrossReferences([ast], varMap);
      const entry = result.get('var.region')!;

      // Consumer should appear only once, but referenceCount tracks total hits
      expect(entry.consumers).toEqual(['aws_vpc.main']);
      expect(entry.referenceCount).toBe(1); // extractReferencesFromValue deduplicates within a single scan
    });
  });

  // -- referenceCount -------------------------------------------------------

  describe('referenceCount', () => {
    it('should increment referenceCount for each consuming block', () => {
      const varMap = makeVariableMap({
        variables: new Map([['env', makeVariableDef({ name: 'env' })]]),
      });
      const ast = makeAst({
        resources: [
          makeResource({
            resource_type: 'aws_vpc',
            name: 'main',
            attributes: { tag: 'var.env' },
          }),
          makeResource({
            resource_type: 'aws_subnet',
            name: 'pub',
            attributes: { tag: 'var.env' },
          }),
        ],
        module_calls: [
          makeModuleCall({
            name: 'app',
            attributes: { env: 'var.env' },
          }),
        ],
      });

      const result = buildCrossReferences([ast], varMap);
      const entry = result.get('var.env')!;

      expect(entry.consumers).toHaveLength(3);
      expect(entry.referenceCount).toBe(3);
    });
  });

  // -- Multi-AST scanning ---------------------------------------------------

  describe('multi-AST scanning', () => {
    it('should aggregate consumers across multiple ASTs', () => {
      const varMap = makeVariableMap({
        variables: new Map([['region', makeVariableDef({ name: 'region' })]]),
      });
      const ast1 = makeAst({
        resources: [
          makeResource({
            resource_type: 'aws_vpc',
            name: 'main',
            attributes: { tag: 'var.region' },
          }),
        ],
      });
      const ast2 = makeAst({
        resources: [
          makeResource({
            resource_type: 'aws_subnet',
            name: 'pub',
            attributes: { az: 'var.region' },
          }),
        ],
      });

      const result = buildCrossReferences([ast1, ast2], varMap);
      const entry = result.get('var.region')!;

      expect(entry.consumers).toContain('aws_vpc.main');
      expect(entry.consumers).toContain('aws_subnet.pub');
      expect(entry.consumers).toHaveLength(2);
    });
  });

  // -- Empty inputs ---------------------------------------------------------

  describe('empty inputs', () => {
    it('should return empty map for empty variableMap and no ASTs', () => {
      const result = buildCrossReferences([], makeVariableMap());
      expect(result.size).toBe(0);
    });

    it('should return initialized entries for variableMap with no ASTs', () => {
      const varMap = makeVariableMap({
        variables: new Map([['x', makeVariableDef({ name: 'x' })]]),
      });
      const result = buildCrossReferences([], varMap);

      expect(result.size).toBe(1);
      expect(result.get('var.x')!.consumers).toEqual([]);
    });
  });

  // -- Mixed block types referencing same var --------------------------------

  describe('mixed block types as consumers', () => {
    it('should record resource, data, module, local, and output as consumers', () => {
      const varMap = makeVariableMap({
        variables: new Map([['region', makeVariableDef({ name: 'region' })]]),
        locals: new Map([['selected', makeLocalDef({ name: 'selected' })]]),
        outputs: new Map([['out', makeOutputDef({ name: 'out' })]]),
      });
      const ast = makeAst({
        resources: [
          makeResource({
            resource_type: 'aws_vpc',
            name: 'main',
            attributes: { region: 'var.region' },
          }),
        ],
        data_blocks: [
          makeDataBlock({
            data_type: 'aws_availability_zones',
            name: 'available',
            attributes: { state: 'var.region' },
          }),
        ],
        module_calls: [
          makeModuleCall({
            name: 'net',
            attributes: { region: 'var.region' },
          }),
        ],
        locals: [
          { name: 'selected', expression: 'var.region' },
        ],
        outputs: [
          { name: 'out', value: 'var.region', sensitive: false },
        ],
      });

      const result = buildCrossReferences([ast], varMap);
      const entry = result.get('var.region')!;

      expect(entry.consumers).toContain('aws_vpc.main');
      expect(entry.consumers).toContain('data.aws_availability_zones.available');
      expect(entry.consumers).toContain('module.net');
      expect(entry.consumers).toContain('local.selected');
      expect(entry.consumers).toContain('output.out');
      expect(entry.consumers).toHaveLength(5);
      expect(entry.referenceCount).toBe(5);
    });
  });
});
