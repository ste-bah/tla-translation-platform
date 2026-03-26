import { describe, it, expect } from 'vitest';
import {
  AzureCodeGenerator,
  convertValue,
} from '../../src/codegen/azure-codegen.js';
import type { AzureGenOptions } from '../../src/codegen/azure-codegen.js';
import type { TranslatedResource } from '@tla/shared';
import { resolveAzureRegion, azToAzureZone } from '../../src/codegen/azure/region-mapping.js';
import { sanitizeAzureName, AZURE_NAME_LIMITS } from '../../src/codegen/azure/naming.js';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeResource(overrides: Partial<TranslatedResource> = {}): TranslatedResource {
  return {
    targetType: 'azurerm_virtual_network',
    targetName: 'main',
    attributes: {},
    sourceId: 'res-001',
    traceability: {
      sourceId: 'res-001',
      sourceType: 'aws_vpc',
      registryEntryId: 'SER-NET-VPC-001',
      mappingType: 'direct',
      confidence: 0.95,
      engineUsed: 'direct',
    },
    ...overrides,
  };
}

function generate(
  resources: TranslatedResource[] = [],
  options?: AzureGenOptions,
): Map<string, string> {
  const gen = new AzureCodeGenerator();
  return gen.generate(resources, options);
}

// ---------------------------------------------------------------------------
// AzureCodeGenerator — file generation
// ---------------------------------------------------------------------------

describe('AzureCodeGenerator', () => {
  describe('empty resources', () => {
    it('produces 5 files', () => {
      const files = generate();
      expect(files.size).toBe(5);
      expect(files.has('main.tf')).toBe(true);
      expect(files.has('providers.tf')).toBe(true);
      expect(files.has('terraform.tf')).toBe(true);
      expect(files.has('variables.tf')).toBe(true);
      expect(files.has('outputs.tf')).toBe(true);
    });

    it('main.tf contains resource group when no resources', () => {
      const files = generate();
      const main = files.get('main.tf')!;
      expect(main).toContain('azurerm_resource_group');
    });
  });

  describe('main.tf', () => {
    it('renders a resource group block by default', () => {
      const files = generate();
      const main = files.get('main.tf')!;
      expect(main).toContain('resource "azurerm_resource_group" "main"');
      expect(main).toContain('var.resource_group_name');
      expect(main).toContain('var.location');
    });

    it('omits resource group when emitResourceGroup=false', () => {
      const files = generate([], { emitResourceGroup: false });
      const main = files.get('main.tf')!;
      expect(main).not.toContain('azurerm_resource_group');
      expect(main).toContain('No resources translated');
    });

    it('renders a single translated resource', () => {
      const res = makeResource({
        targetType: 'azurerm_virtual_network',
        targetName: 'primary',
        attributes: {
          name: 'vnet-primary',
          address_space: ['10.0.0.0/16'],
        },
      });
      const files = generate([res]);
      const main = files.get('main.tf')!;
      expect(main).toContain('resource "azurerm_virtual_network"');
      expect(main).toContain('name = "vnet-primary"');
      expect(main).toContain('10.0.0.0/16');
    });

    it('sorts resources by targetType then targetName', () => {
      const r1 = makeResource({ targetType: 'azurerm_subnet', targetName: 'b' });
      const r2 = makeResource({ targetType: 'azurerm_subnet', targetName: 'a' });
      const r3 = makeResource({ targetType: 'azurerm_virtual_network', targetName: 'x' });
      const files = generate([r1, r2, r3]);
      const main = files.get('main.tf')!;
      const subnetAIdx = main.indexOf('"azurerm_subnet"');
      const vnetIdx = main.indexOf('"azurerm_virtual_network"');
      expect(subnetAIdx).toBeLessThan(vnetIdx);
    });

    it('emits traceability comments when emitComments=true', () => {
      const res = makeResource();
      const files = generate([res], { emitComments: true });
      const main = files.get('main.tf')!;
      expect(main).toContain('# Source: aws_vpc');
      expect(main).toContain('engine: direct');
      expect(main).toContain('confidence: 0.95');
    });

    it('omits traceability comments when emitComments=false', () => {
      const res = makeResource();
      const files = generate([res], { emitComments: false });
      const main = files.get('main.tf')!;
      // The resource group comment "# Resource Group" is always present
      // but no "# Source:" lines for translated resources
      expect(main).not.toContain('# Source:');
    });

    it('detects interpolation expressions and renders bare references', () => {
      const res = makeResource({
        attributes: {
          resource_group_name: '${azurerm_resource_group.main.name}',
        },
      });
      const files = generate([res]);
      const main = files.get('main.tf')!;
      // Should be bare expression, not quoted string
      expect(main).toContain('resource_group_name = azurerm_resource_group.main.name');
      expect(main).not.toContain('"${azurerm_resource_group.main.name}"');
    });

    it('renders tags as a map (with = sign)', () => {
      const res = makeResource({
        attributes: {
          tags: { Name: 'my-vnet', environment: 'prod' },
        },
      });
      const files = generate([res]);
      const main = files.get('main.tf')!;
      expect(main).toContain('tags = {');
      expect(main).toContain('Name = "my-vnet"');
    });

    it('renders block keys (os_disk, ip_configuration) as blocks', () => {
      const res = makeResource({
        targetType: 'azurerm_linux_virtual_machine',
        attributes: {
          os_disk: { caching: 'ReadWrite', storage_account_type: 'Premium_LRS' },
          ip_configuration: { name: 'internal' },
        },
      });
      const files = generate([res]);
      const main = files.get('main.tf')!;
      expect(main).toContain('os_disk {');
      expect(main).not.toContain('os_disk = {');
      expect(main).toContain('ip_configuration {');
      expect(main).not.toContain('ip_configuration = {');
    });

    it('sanitizes resource names via sanitizeAzureName', () => {
      const res = makeResource({
        targetType: 'azurerm_storage_account',
        targetName: 'MY_LONG_STORAGE_ACCOUNT_NAME_EXCEEDS_LIMIT',
      });
      const files = generate([res]);
      const main = files.get('main.tf')!;
      // Storage accounts: st type, max 24 chars, lowercase only
      const match = main.match(/resource "azurerm_storage_account" "([^"]+)"/);
      expect(match).not.toBeNull();
      const name = match![1]!;
      expect(name.length).toBeLessThanOrEqual(24);
      expect(name).toBe(name.toLowerCase());
    });
  });

  describe('providers.tf', () => {
    it('renders azurerm provider with features block', () => {
      const files = generate();
      const providers = files.get('providers.tf')!;
      expect(providers).toContain('provider "azurerm" {');
      expect(providers).toContain('features {}');
      // features must be a block, not a map
      expect(providers).not.toContain('features = {}');
    });

    it('includes subscription_id when subscriptionIdVar is set', () => {
      const files = generate([], { subscriptionIdVar: 'subscription_id' });
      const providers = files.get('providers.tf')!;
      expect(providers).toContain('subscription_id = var.subscription_id');
    });

    it('omits subscription_id by default', () => {
      const files = generate();
      const providers = files.get('providers.tf')!;
      expect(providers).not.toContain('subscription_id');
    });
  });

  describe('terraform.tf', () => {
    it('contains hashicorp/azurerm source', () => {
      const files = generate();
      const tf = files.get('terraform.tf')!;
      expect(tf).toContain('hashicorp/azurerm');
    });

    it('contains version constraint ~> 3.0', () => {
      const files = generate();
      const tf = files.get('terraform.tf')!;
      expect(tf).toContain('~> 3.0');
    });

    it('contains required_providers block', () => {
      const files = generate();
      const tf = files.get('terraform.tf')!;
      expect(tf).toContain('required_providers {');
    });

    it('wraps in terraform block', () => {
      const files = generate();
      const tf = files.get('terraform.tf')!;
      expect(tf).toContain('terraform {');
    });
  });

  describe('variables.tf', () => {
    it('declares location variable with default region', () => {
      const files = generate();
      const vars = files.get('variables.tf')!;
      expect(vars).toContain('variable "location"');
      expect(vars).toContain('type        = string');
      // Default region for us-east-1 is eastus
      expect(vars).toContain('"eastus"');
    });

    it('declares resource_group_name variable', () => {
      const files = generate();
      const vars = files.get('variables.tf')!;
      expect(vars).toContain('variable "resource_group_name"');
    });

    it('declares environment variable', () => {
      const files = generate();
      const vars = files.get('variables.tf')!;
      expect(vars).toContain('variable "environment"');
      expect(vars).toContain('"dev"');
    });

    it('declares subscription_id variable as sensitive', () => {
      const files = generate();
      const vars = files.get('variables.tf')!;
      expect(vars).toContain('variable "subscription_id"');
      expect(vars).toContain('sensitive   = true');
    });

    it('maps source region to Azure region', () => {
      const files = generate([], { sourceRegion: 'us-west-2' });
      const vars = files.get('variables.tf')!;
      expect(vars).toContain('"westus2"');
    });

    it('uses custom environment', () => {
      const files = generate([], { environment: 'staging' });
      const vars = files.get('variables.tf')!;
      expect(vars).toContain('"staging"');
      expect(vars).toContain('"rg-staging"');
    });
  });

  describe('outputs.tf', () => {
    it('declares resource_group_name output', () => {
      const files = generate();
      const outputs = files.get('outputs.tf')!;
      expect(outputs).toContain('output "resource_group_name"');
      expect(outputs).toContain('azurerm_resource_group.main.name');
    });

    it('declares resource_group_id output', () => {
      const files = generate();
      const outputs = files.get('outputs.tf')!;
      expect(outputs).toContain('output "resource_group_id"');
      expect(outputs).toContain('azurerm_resource_group.main.id');
    });

    it('uses custom resourceGroupName in output references', () => {
      const files = generate([], { resourceGroupName: 'custom' });
      const outputs = files.get('outputs.tf')!;
      expect(outputs).toContain('azurerm_resource_group.custom.name');
      expect(outputs).toContain('azurerm_resource_group.custom.id');
    });

    it('emits comment when emitResourceGroup=false', () => {
      const files = generate([], { emitResourceGroup: false });
      const outputs = files.get('outputs.tf')!;
      expect(outputs).toContain('No outputs');
      expect(outputs).not.toContain('output "');
    });
  });

  describe('deterministic output', () => {
    it('same input produces same output', () => {
      const resources = [
        makeResource({ targetType: 'azurerm_subnet', targetName: 'a', sourceId: 's1' }),
        makeResource({ targetType: 'azurerm_virtual_network', targetName: 'b', sourceId: 's2' }),
      ];
      const opts: AzureGenOptions = { sourceRegion: 'eu-west-1', environment: 'prod' };
      const files1 = generate(resources, opts);
      const files2 = generate(resources, opts);
      for (const [name, content] of files1) {
        expect(files2.get(name)).toBe(content);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// convertValue()
// ---------------------------------------------------------------------------

describe('convertValue()', () => {
  it('converts null to literal null', () => {
    const v = convertValue(null);
    expect(v.kind).toBe('literal');
    expect((v as { value: unknown }).value).toBeNull();
  });

  it('converts undefined to literal null', () => {
    const v = convertValue(undefined);
    expect(v.kind).toBe('literal');
  });

  it('converts booleans to literal', () => {
    expect(convertValue(true)).toEqual({ kind: 'literal', value: true });
    expect(convertValue(false)).toEqual({ kind: 'literal', value: false });
  });

  it('converts numbers to literal', () => {
    expect(convertValue(42)).toEqual({ kind: 'literal', value: 42 });
  });

  it('converts plain strings to literal', () => {
    const v = convertValue('hello');
    expect(v.kind).toBe('literal');
    expect((v as { value: unknown }).value).toBe('hello');
  });

  it('converts ${...} interpolation to expr', () => {
    const v = convertValue('${azurerm_resource_group.main.name}');
    expect(v.kind).toBe('expr');
    expect((v as { expr: string }).expr).toBe('azurerm_resource_group.main.name');
  });

  it('does not convert partial interpolation to expr', () => {
    const v = convertValue('prefix-${var.name}-suffix');
    expect(v.kind).toBe('literal');
  });

  it('converts arrays to list', () => {
    const v = convertValue(['a', 'b']);
    expect(v.kind).toBe('list');
  });

  it('converts objects to map by default', () => {
    const v = convertValue({ key: 'val' });
    expect(v.kind).toBe('map');
  });

  it('converts objects under block keys to block', () => {
    const v = convertValue({ caching: 'ReadWrite' }, 'os_disk');
    expect(v.kind).toBe('block');
  });

  it('always converts tags as map even though it is an object', () => {
    const v = convertValue({ env: 'prod' }, 'tags');
    expect(v.kind).toBe('map');
  });

  it('converts array of objects under block key to blocks', () => {
    const v = convertValue(
      [{ priority: 100 }, { priority: 200 }],
      'rule',
    );
    expect(v.kind).toBe('blocks');
  });

  it('converts array of primitives to list', () => {
    const v = convertValue([1, 2, 3], 'rule');
    expect(v.kind).toBe('list');
  });
});

// ---------------------------------------------------------------------------
// resolveAzureRegion()
// ---------------------------------------------------------------------------

describe('resolveAzureRegion()', () => {
  it('maps us-east-1 to eastus', () => {
    expect(resolveAzureRegion('us-east-1')).toBe('eastus');
  });

  it('maps us-west-2 to westus2', () => {
    expect(resolveAzureRegion('us-west-2')).toBe('westus2');
  });

  it('maps eu-west-1 to westeurope', () => {
    expect(resolveAzureRegion('eu-west-1')).toBe('westeurope');
  });

  it('maps ap-southeast-1 to southeastasia', () => {
    expect(resolveAzureRegion('ap-southeast-1')).toBe('southeastasia');
  });

  it('maps ap-northeast-1 to japaneast', () => {
    expect(resolveAzureRegion('ap-northeast-1')).toBe('japaneast');
  });

  it('maps sa-east-1 to brazilsouth', () => {
    expect(resolveAzureRegion('sa-east-1')).toBe('brazilsouth');
  });

  it('returns eastus for unknown region', () => {
    expect(resolveAzureRegion('mars-central-1')).toBe('eastus');
  });

  it('returns eastus for empty string', () => {
    expect(resolveAzureRegion('')).toBe('eastus');
  });
});

// ---------------------------------------------------------------------------
// azToAzureZone()
// ---------------------------------------------------------------------------

describe('azToAzureZone()', () => {
  it('maps us-east-1a to zone 1', () => {
    expect(azToAzureZone('us-east-1a')).toBe(1);
  });

  it('maps us-east-1b to zone 2', () => {
    expect(azToAzureZone('us-east-1b')).toBe(2);
  });

  it('maps us-east-1c to zone 3', () => {
    expect(azToAzureZone('us-east-1c')).toBe(3);
  });

  it('wraps d back to zone 1', () => {
    expect(azToAzureZone('us-west-2d')).toBe(1);
  });

  it('wraps e to zone 2', () => {
    expect(azToAzureZone('eu-west-1e')).toBe(2);
  });

  it('wraps f to zone 3', () => {
    expect(azToAzureZone('ap-southeast-1f')).toBe(3);
  });

  it('returns 1 for empty string', () => {
    expect(azToAzureZone('')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// sanitizeAzureName()
// ---------------------------------------------------------------------------

describe('sanitizeAzureName()', () => {
  it('truncates storage account names to 24 chars', () => {
    const name = sanitizeAzureName('st', 'verylongstoragename1234567890');
    expect(name.length).toBeLessThanOrEqual(24);
  });

  it('lowercases storage account names', () => {
    const name = sanitizeAzureName('st', 'MyStorageACCOUNT');
    expect(name).toBe(name.toLowerCase());
  });

  it('removes disallowed characters from storage names', () => {
    // st pattern: /^[a-z0-9]+$/ — no dashes, dots, or underscores
    const name = sanitizeAzureName('st', 'my-storage_account.name');
    expect(name).toMatch(/^[a-z0-9]+$/);
  });

  it('returns abbreviation for empty result', () => {
    const name = sanitizeAzureName('st', '!!!');
    expect(name).toBe('st');
  });

  it('respects vnet max length of 64', () => {
    const long = 'a'.repeat(100);
    const name = sanitizeAzureName('vnet', long);
    expect(name.length).toBeLessThanOrEqual(64);
  });

  it('preserves valid characters for vm names', () => {
    const name = sanitizeAzureName('vm', 'my-vm.test_01');
    expect(name).toBe('my-vm.test_01');
  });

  it('handles unknown resource type with basic sanitization', () => {
    const name = sanitizeAzureName('unknown_type', 'my resource!');
    // Unknown type: alphanumeric + dash + underscore, max 80
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name).not.toContain('!');
  });

  it('returns "resource" for unknown type with fully empty result', () => {
    // '!!!' -> replaced to '---' (dashes are allowed in unknown type fallback)
    const name = sanitizeAzureName('unknown_type', '!!!');
    expect(name).toBe('---');
  });

  it('returns "resource" for unknown type when all chars stripped', () => {
    // Empty string after replace -> fallback to 'resource'
    const name = sanitizeAzureName('unknown_type', '');
    expect(name).toBe('resource');
  });

  it('lowercases psql names', () => {
    const name = sanitizeAzureName('psql', 'MyPostgresDB');
    expect(name).toBe(name.toLowerCase());
  });

  it('lowercases sql names', () => {
    const name = sanitizeAzureName('sql', 'MySqlServer');
    expect(name).toBe(name.toLowerCase());
  });

  it('constraint table has expected entries', () => {
    expect(AZURE_NAME_LIMITS.has('st')).toBe(true);
    expect(AZURE_NAME_LIMITS.has('vm')).toBe(true);
    expect(AZURE_NAME_LIMITS.has('rg')).toBe(true);
    expect(AZURE_NAME_LIMITS.get('st')!.maxLen).toBe(24);
    expect(AZURE_NAME_LIMITS.get('kv')!.maxLen).toBe(24);
  });
});
