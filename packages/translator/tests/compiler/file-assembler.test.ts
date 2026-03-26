import { describe, it, expect } from 'vitest';
import { assembleFiles } from '../../src/compiler/file-assembler.js';
import type { AssemblyInput } from '../../src/engines/mapping-engine.js';
import type {
  TranslatedResource,
  CanonicalIR,
  CompilerOptions,
  CloudProvider,
} from '@tla/shared';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeTranslatedResource(overrides: Partial<TranslatedResource> = {}): TranslatedResource {
  return {
    targetType: 'azurerm_virtual_machine',
    targetName: 'my_instance',
    attributes: { vm_size: 'Standard_B1s' },
    sourceId: 'res-001',
    traceability: {
      sourceId: 'res-001',
      sourceType: 'aws_instance',
      registryEntryId: 'SER-COMPUTE-EC2-001',
      mappingType: 'direct',
      confidence: 0.9,
      engineUsed: 'direct',
    },
    ...overrides,
  };
}

function makeCanonicalIR(): CanonicalIR {
  return {
    version: '1.0.0',
    sourceProvider: 'aws',
    resources: [],
    relationships: [],
    modules: [],
    intents: [],
    metadata: {
      generatedAt: '2025-03-01T00:00:00Z',
      sourceFiles: ['main.tf'],
      toolVersion: '0.1.0',
    },
  } as CanonicalIR;
}

function makeCompilerOptions(overrides: Partial<CompilerOptions> = {}): CompilerOptions {
  return {
    targetProvider: 'azure',
    registryVersion: '2025.03.01',
    emitComments: true,
    sortKeys: true,
    ...overrides,
  };
}

function makeAssemblyInput(overrides: Partial<AssemblyInput> = {}): AssemblyInput {
  return {
    targetProvider: 'azure',
    resources: [],
    ir: makeCanonicalIR(),
    options: makeCompilerOptions(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assembleFiles', () => {
  describe('file structure', () => {
    it('should produce 4 files: main.tf, variables.tf, outputs.tf, providers.tf', () => {
      const input = makeAssemblyInput();
      const files = assembleFiles(input);

      expect(files.size).toBe(4);
      expect(files.has('main.tf')).toBe(true);
      expect(files.has('variables.tf')).toBe(true);
      expect(files.has('outputs.tf')).toBe(true);
      expect(files.has('providers.tf')).toBe(true);
    });

    it('should produce "No resources translated" comment when no resources', () => {
      const input = makeAssemblyInput({ resources: [] });
      const files = assembleFiles(input);

      expect(files.get('main.tf')).toBe('# No resources translated\n');
    });

    it('should always produce variables.tf with environment variable', () => {
      const input = makeAssemblyInput();
      const files = assembleFiles(input);
      const vars = files.get('variables.tf')!;

      expect(vars).toContain('variable "environment"');
      expect(vars).toContain('type        = string');
      expect(vars).toContain('default     = "dev"');
    });

    it('should always produce outputs.tf placeholder', () => {
      const input = makeAssemblyInput();
      const files = assembleFiles(input);
      const outputs = files.get('outputs.tf')!;

      expect(outputs).toContain('Outputs for translated infrastructure');
    });
  });

  describe('provider blocks', () => {
    it('should generate azurerm provider for azure target', () => {
      const input = makeAssemblyInput({ targetProvider: 'azure' });
      const files = assembleFiles(input);
      const providers = files.get('providers.tf')!;

      expect(providers).toContain('provider "azurerm"');
      expect(providers).toContain('features');
    });

    it('should generate google provider for gcp target', () => {
      const input = makeAssemblyInput({
        targetProvider: 'gcp',
        options: makeCompilerOptions({ targetProvider: 'gcp' }),
      });
      const files = assembleFiles(input);
      const providers = files.get('providers.tf')!;

      expect(providers).toContain('provider "google"');
      expect(providers).toContain('project');
      expect(providers).toContain('region');
    });

    it('should generate terraform required_providers block for azure', () => {
      const input = makeAssemblyInput({ targetProvider: 'azure' });
      const files = assembleFiles(input);
      const providers = files.get('providers.tf')!;

      expect(providers).toContain('terraform');
      expect(providers).toContain('required_providers');
      expect(providers).toContain('hashicorp/azurerm');
      expect(providers).toContain('~> 3.0');
    });

    it('should generate terraform required_providers block for gcp', () => {
      const input = makeAssemblyInput({
        targetProvider: 'gcp',
        options: makeCompilerOptions({ targetProvider: 'gcp' }),
      });
      const files = assembleFiles(input);
      const providers = files.get('providers.tf')!;

      expect(providers).toContain('hashicorp/google');
      expect(providers).toContain('~> 5.0');
    });
  });

  describe('resource blocks', () => {
    it('should generate resource block for a single resource', () => {
      const resource = makeTranslatedResource();
      const input = makeAssemblyInput({ resources: [resource] });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('resource "azurerm_virtual_machine" "my_instance"');
      expect(main).toContain('vm_size');
    });

    it('should emit traceability comments when emitComments is true', () => {
      const resource = makeTranslatedResource();
      const input = makeAssemblyInput({
        resources: [resource],
        options: makeCompilerOptions({ emitComments: true }),
      });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('# Source: aws_instance');
      expect(main).toContain('# Engine: direct');
    });

    it('should NOT emit comments when emitComments is false', () => {
      const resource = makeTranslatedResource();
      const input = makeAssemblyInput({
        resources: [resource],
        options: makeCompilerOptions({ emitComments: false }),
      });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).not.toContain('# Source:');
      expect(main).not.toContain('# Engine:');
    });

    it('should sort attributes alphabetically when sortKeys is true', () => {
      const resource = makeTranslatedResource({
        attributes: { zebra: 'z', apple: 'a', mango: 'm' },
      });
      const input = makeAssemblyInput({
        resources: [resource],
        options: makeCompilerOptions({ sortKeys: true }),
      });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      const appleIdx = main.indexOf('apple');
      const mangoIdx = main.indexOf('mango');
      const zebraIdx = main.indexOf('zebra');
      expect(appleIdx).toBeLessThan(mangoIdx);
      expect(mangoIdx).toBeLessThan(zebraIdx);
    });

    it('should handle multiple resources', () => {
      const resources = [
        makeTranslatedResource({ targetType: 'azurerm_a', targetName: 'first' }),
        makeTranslatedResource({ targetType: 'azurerm_b', targetName: 'second' }),
      ];
      const input = makeAssemblyInput({ resources });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('resource "azurerm_a" "first"');
      expect(main).toContain('resource "azurerm_b" "second"');
    });

    it('should sort resources by targetType then targetName for determinism', () => {
      const resources = [
        makeTranslatedResource({ targetType: 'azurerm_z', targetName: 'a' }),
        makeTranslatedResource({ targetType: 'azurerm_a', targetName: 'z' }),
        makeTranslatedResource({ targetType: 'azurerm_a', targetName: 'a' }),
      ];
      const input = makeAssemblyInput({ resources });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      const idxAA = main.indexOf('"azurerm_a" "a"');
      const idxAZ = main.indexOf('"azurerm_a" "z"');
      const idxZA = main.indexOf('"azurerm_z" "a"');
      expect(idxAA).toBeLessThan(idxAZ);
      expect(idxAZ).toBeLessThan(idxZA);
    });
  });

  describe('HCL value rendering', () => {
    it('should render string values with double quotes', () => {
      const resource = makeTranslatedResource({
        attributes: { name: 'hello' },
      });
      const input = makeAssemblyInput({ resources: [resource] });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('name = "hello"');
    });

    it('should escape backslashes in strings', () => {
      const resource = makeTranslatedResource({
        attributes: { path: 'a\\b' },
      });
      const input = makeAssemblyInput({ resources: [resource] });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('"a\\\\b"');
    });

    it('should escape double quotes in strings', () => {
      const resource = makeTranslatedResource({
        attributes: { msg: 'say "hi"' },
      });
      const input = makeAssemblyInput({ resources: [resource] });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('say \\"hi\\"');
    });

    it('should render numbers as plain values', () => {
      const resource = makeTranslatedResource({
        attributes: { port: 8080 },
      });
      const input = makeAssemblyInput({ resources: [resource] });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('port = 8080');
    });

    it('should render booleans as true/false', () => {
      const resource = makeTranslatedResource({
        attributes: { enabled: true, debug: false },
      });
      const input = makeAssemblyInput({ resources: [resource] });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('enabled = true');
      expect(main).toContain('debug = false');
    });

    it('should render null as "null"', () => {
      const resource = makeTranslatedResource({
        attributes: { value: null },
      });
      const input = makeAssemblyInput({ resources: [resource] });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('value = null');
    });

    it('should render arrays as HCL lists', () => {
      const resource = makeTranslatedResource({
        attributes: { tags: ['a', 'b', 'c'] },
      });
      const input = makeAssemblyInput({ resources: [resource] });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('tags = [');
      expect(main).toContain('"a"');
      expect(main).toContain('"b"');
      expect(main).toContain('"c"');
    });

    it('should render empty arrays as []', () => {
      const resource = makeTranslatedResource({
        attributes: { empty: [] },
      });
      const input = makeAssemblyInput({ resources: [resource] });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('empty = []');
    });

    it('should render nested objects as HCL maps', () => {
      const resource = makeTranslatedResource({
        attributes: { settings: { key: 'val' } },
      });
      const input = makeAssemblyInput({ resources: [resource] });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('settings = {');
      expect(main).toContain('key = "val"');
    });

    it('should render empty objects as {}', () => {
      const resource = makeTranslatedResource({
        attributes: { empty_map: {} },
      });
      const input = makeAssemblyInput({ resources: [resource] });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('empty_map = {}');
    });

    it('should sort keys inside nested objects', () => {
      const resource = makeTranslatedResource({
        attributes: { obj: { z_key: 1, a_key: 2 } },
      });
      const input = makeAssemblyInput({
        resources: [resource],
        options: makeCompilerOptions({ sortKeys: true }),
      });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      const aIdx = main.indexOf('a_key');
      const zIdx = main.indexOf('z_key');
      expect(aIdx).toBeLessThan(zIdx);
    });
  });

  describe('determinism', () => {
    it('should produce identical output for same input across multiple calls', () => {
      const resources = [
        makeTranslatedResource({ targetType: 'azurerm_b', targetName: 'second' }),
        makeTranslatedResource({ targetType: 'azurerm_a', targetName: 'first' }),
      ];
      const input = makeAssemblyInput({ resources });

      const files1 = assembleFiles(input);
      const files2 = assembleFiles(input);

      expect(files1.get('main.tf')).toBe(files2.get('main.tf'));
      expect(files1.get('providers.tf')).toBe(files2.get('providers.tf'));
      expect(files1.get('variables.tf')).toBe(files2.get('variables.tf'));
      expect(files1.get('outputs.tf')).toBe(files2.get('outputs.tf'));
    });

    it('should produce same output regardless of input resource order', () => {
      const r1 = makeTranslatedResource({ targetType: 'azurerm_b', targetName: 'b' });
      const r2 = makeTranslatedResource({ targetType: 'azurerm_a', targetName: 'a' });

      const files1 = assembleFiles(makeAssemblyInput({ resources: [r1, r2] }));
      const files2 = assembleFiles(makeAssemblyInput({ resources: [r2, r1] }));

      expect(files1.get('main.tf')).toBe(files2.get('main.tf'));
    });
  });

  describe('deduplication', () => {
    it('should rename duplicate targetType+targetName with _2, _3 suffixes', () => {
      const resources = [
        makeTranslatedResource({ targetType: 'azurerm_storage_account', targetName: 'app_assets', sourceId: 'res-001' }),
        makeTranslatedResource({ targetType: 'azurerm_storage_account', targetName: 'app_assets', sourceId: 'res-002' }),
        makeTranslatedResource({ targetType: 'azurerm_storage_account', targetName: 'app_assets', sourceId: 'res-003' }),
      ];
      const input = makeAssemblyInput({ resources });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('"azurerm_storage_account" "app_assets"');
      expect(main).toContain('"azurerm_storage_account" "app_assets_2"');
      expect(main).toContain('"azurerm_storage_account" "app_assets_3"');
    });

    it('should not rename resources with unique names', () => {
      const resources = [
        makeTranslatedResource({ targetType: 'azurerm_storage_account', targetName: 'alpha' }),
        makeTranslatedResource({ targetType: 'azurerm_storage_account', targetName: 'beta' }),
      ];
      const input = makeAssemblyInput({ resources });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('"azurerm_storage_account" "alpha"');
      expect(main).toContain('"azurerm_storage_account" "beta"');
      expect(main).not.toContain('alpha_2');
      expect(main).not.toContain('beta_2');
    });

    it('should only deduplicate within the same targetType', () => {
      const resources = [
        makeTranslatedResource({ targetType: 'azurerm_storage_account', targetName: 'shared' }),
        makeTranslatedResource({ targetType: 'azurerm_virtual_network', targetName: 'shared' }),
      ];
      const input = makeAssemblyInput({ resources });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('"azurerm_storage_account" "shared"');
      expect(main).toContain('"azurerm_virtual_network" "shared"');
      expect(main).not.toContain('shared_2');
    });
  });

  describe('edge cases', () => {
    it('should handle resources with deeply nested attributes', () => {
      const resource = makeTranslatedResource({
        attributes: {
          level1: {
            level2: {
              level3: 'deep',
            },
          },
        },
      });
      const input = makeAssemblyInput({ resources: [resource] });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('level1');
      expect(main).toContain('level2');
      expect(main).toContain('level3');
      expect(main).toContain('"deep"');
    });

    it('should handle resources with mixed attribute types', () => {
      const resource = makeTranslatedResource({
        attributes: {
          str: 'hello',
          num: 42,
          bool: true,
          arr: [1, 2],
          obj: { k: 'v' },
          nil: null,
        },
      });
      const input = makeAssemblyInput({ resources: [resource] });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main).toContain('"hello"');
      expect(main).toContain('42');
      expect(main).toContain('true');
      expect(main).toContain('[');
      expect(main).toContain('{');
      expect(main).toContain('null');
    });

    it('should end main.tf with newline when resources present', () => {
      const resource = makeTranslatedResource();
      const input = makeAssemblyInput({ resources: [resource] });
      const files = assembleFiles(input);
      const main = files.get('main.tf')!;

      expect(main.endsWith('\n')).toBe(true);
    });
  });
});
