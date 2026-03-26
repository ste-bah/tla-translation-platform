import { describe, it, expect } from 'vitest';
import {
  literal,
  expr,
  hclMap,
  block,
  list,
  writeHclValue,
  writeResourceBlock,
  writeProviderBlock,
  writeTerraformBlock,
  writeVariableBlock,
  writeOutputBlock,
} from '../../src/codegen/hcl-writer.js';
import type { HclValue, HclMapEntry } from '../../src/codegen/hcl-writer.js';

// ---------------------------------------------------------------------------
// literal()
// ---------------------------------------------------------------------------

describe('literal()', () => {
  it('renders a string value with double quotes', () => {
    const val = literal('hello');
    expect(val.kind).toBe('literal');
    expect(writeHclValue(val, 0)).toBe('"hello"');
  });

  it('renders a number value without quotes', () => {
    const val = literal(42);
    expect(writeHclValue(val, 0)).toBe('42');
  });

  it('renders zero correctly', () => {
    expect(writeHclValue(literal(0), 0)).toBe('0');
  });

  it('renders a negative number', () => {
    expect(writeHclValue(literal(-3.14), 0)).toBe('-3.14');
  });

  it('renders boolean true', () => {
    expect(writeHclValue(literal(true), 0)).toBe('true');
  });

  it('renders boolean false', () => {
    expect(writeHclValue(literal(false), 0)).toBe('false');
  });

  it('renders null', () => {
    expect(writeHclValue(literal(null), 0)).toBe('null');
  });

  it('escapes backslashes in strings', () => {
    const val = literal('path\\to\\file');
    expect(writeHclValue(val, 0)).toBe('"path\\\\to\\\\file"');
  });

  it('escapes double quotes in strings', () => {
    const val = literal('say "hello"');
    expect(writeHclValue(val, 0)).toBe('"say \\"hello\\""');
  });

  it('escapes both backslash and double quote together', () => {
    const val = literal('a\\b"c');
    const rendered = writeHclValue(val, 0);
    expect(rendered).toContain('\\\\');
    expect(rendered).toContain('\\"');
  });

  it('renders empty string', () => {
    expect(writeHclValue(literal(''), 0)).toBe('""');
  });
});

// ---------------------------------------------------------------------------
// expr()
// ---------------------------------------------------------------------------

describe('expr()', () => {
  it('renders an expression without quotes', () => {
    const val = expr('var.location');
    expect(val.kind).toBe('expr');
    expect(writeHclValue(val, 0)).toBe('var.location');
  });

  it('renders a resource reference bare', () => {
    const val = expr('azurerm_resource_group.main.name');
    expect(writeHclValue(val, 0)).toBe('azurerm_resource_group.main.name');
  });

  it('renders a complex expression', () => {
    const val = expr('length(var.subnets) > 0 ? var.subnets[0] : "default"');
    expect(writeHclValue(val, 0)).toBe(
      'length(var.subnets) > 0 ? var.subnets[0] : "default"',
    );
  });
});

// ---------------------------------------------------------------------------
// hclMap()
// ---------------------------------------------------------------------------

describe('hclMap()', () => {
  it('renders an empty map as {}', () => {
    const val = hclMap({});
    expect(writeHclValue(val, 0)).toBe('{}');
  });

  it('renders entries with = sign', () => {
    const val = hclMap({ env: literal('prod'), tier: literal('web') });
    const out = writeHclValue(val, 0);
    expect(out).toContain('env = "prod"');
    expect(out).toContain('tier = "web"');
  });

  it('preserves insertion order of keys', () => {
    const val = hclMap({ z_key: literal(1), a_key: literal(2) });
    const out = writeHclValue(val, 0);
    const zIdx = out.indexOf('z_key');
    const aIdx = out.indexOf('a_key');
    expect(zIdx).toBeLessThan(aIdx);
  });

  it('indents entries at the correct depth', () => {
    const val = hclMap({ name: literal('test') });
    const out = writeHclValue(val, 1);
    // inner indent = 2 * (1+1) = 4 spaces
    expect(out).toContain('    name = "test"');
  });
});

// ---------------------------------------------------------------------------
// block()
// ---------------------------------------------------------------------------

describe('block()', () => {
  it('renders an empty block as {}', () => {
    const val = block({});
    expect(writeHclValue(val, 0)).toBe('{}');
  });

  it('renders scalar attributes with = sign', () => {
    const val = block({ name: literal('foo'), size: literal(10) });
    const out = writeHclValue(val, 0);
    expect(out).toContain('name = "foo"');
    expect(out).toContain('size = 10');
  });

  it('renders nested blocks without = sign', () => {
    const inner = block({ enabled: literal(true) });
    const outer = block({ features: inner });
    const out = writeHclValue(outer, 0);
    // "features {" not "features = {"
    expect(out).toContain('features {');
    expect(out).not.toContain('features = {');
  });

  it('renders nested maps WITH = sign', () => {
    const tags = hclMap({ env: literal('dev') });
    const val = block({ tags });
    const out = writeHclValue(val, 0);
    expect(out).toContain('tags = {');
  });
});

// ---------------------------------------------------------------------------
// list()
// ---------------------------------------------------------------------------

describe('list()', () => {
  it('renders an empty list as []', () => {
    const val = list([]);
    expect(writeHclValue(val, 0)).toBe('[]');
  });

  it('renders literal items', () => {
    const val = list([literal('a'), literal('b')]);
    const out = writeHclValue(val, 0);
    expect(out).toContain('"a"');
    expect(out).toContain('"b"');
  });

  it('renders items with trailing commas', () => {
    const val = list([literal(1), literal(2)]);
    const out = writeHclValue(val, 0);
    // Each item line should end with a comma
    const lines = out.split('\n').filter((l) => l.trim().match(/^\d/));
    for (const line of lines) {
      expect(line.trimEnd().endsWith(',')).toBe(true);
    }
  });

  it('renders mixed value types', () => {
    const val = list([literal('hello'), literal(42), literal(true)]);
    const out = writeHclValue(val, 0);
    expect(out).toContain('"hello"');
    expect(out).toContain('42');
    expect(out).toContain('true');
  });
});

// ---------------------------------------------------------------------------
// Nested structures
// ---------------------------------------------------------------------------

describe('nested structures', () => {
  it('block containing a map and a literal child', () => {
    const val = block({
      name: literal('server'),
      tags: hclMap({ env: literal('prod') }),
    });
    const out = writeHclValue(val, 0);
    expect(out).toContain('name = "server"');
    expect(out).toContain('tags = {');
    expect(out).toContain('env = "prod"');
  });

  it('block containing a nested block', () => {
    const val = block({
      os_disk: block({
        caching: literal('ReadWrite'),
        size_gb: literal(30),
      }),
    });
    const out = writeHclValue(val, 0);
    expect(out).toContain('os_disk {');
    expect(out).not.toContain('os_disk = {');
    expect(out).toContain('caching = "ReadWrite"');
    expect(out).toContain('size_gb = 30');
  });

  it('block containing a list', () => {
    const val = block({
      ports: list([literal(80), literal(443)]),
    });
    const out = writeHclValue(val, 0);
    expect(out).toContain('ports = [');
    expect(out).toContain('80');
    expect(out).toContain('443');
  });
});

// ---------------------------------------------------------------------------
// writeResourceBlock()
// ---------------------------------------------------------------------------

describe('writeResourceBlock()', () => {
  it('renders resource type and name', () => {
    const body: HclMapEntry[] = [
      { key: 'name', value: literal('myvm') },
    ];
    const out = writeResourceBlock('azurerm_linux_virtual_machine', 'main', body);
    expect(out).toContain('resource "azurerm_linux_virtual_machine" "main" {');
    expect(out).toContain('name = "myvm"');
    expect(out.trimEnd().endsWith('}')).toBe(true);
  });

  it('includes a comment when provided', () => {
    const body: HclMapEntry[] = [{ key: 'location', value: literal('eastus') }];
    const out = writeResourceBlock('azurerm_resource_group', 'main', body, {
      comment: 'Source: aws_vpc (vpc-001)',
    });
    expect(out).toContain('# Source: aws_vpc (vpc-001)');
    // Comment should be before the resource line
    const commentIdx = out.indexOf('# Source');
    const resourceIdx = out.indexOf('resource "');
    expect(commentIdx).toBeLessThan(resourceIdx);
  });

  it('sorts body keys when sortKeys is true', () => {
    const body: HclMapEntry[] = [
      { key: 'zone', value: literal('1') },
      { key: 'address', value: literal('10.0.0.0/16') },
      { key: 'name', value: literal('vnet') },
    ];
    const out = writeResourceBlock('azurerm_virtual_network', 'main', body, {
      sortKeys: true,
    });
    const addrIdx = out.indexOf('address');
    const nameIdx = out.indexOf('name');
    const zoneIdx = out.indexOf('zone');
    expect(addrIdx).toBeLessThan(nameIdx);
    expect(nameIdx).toBeLessThan(zoneIdx);
  });

  it('renders empty body', () => {
    const out = writeResourceBlock('azurerm_resource_group', 'main', []);
    expect(out).toContain('resource "azurerm_resource_group" "main" {');
    expect(out).toContain('}');
  });

  it('renders nested blocks without = sign', () => {
    const body: HclMapEntry[] = [
      { key: 'os_disk', value: block({ caching: literal('ReadWrite') }) },
    ];
    const out = writeResourceBlock('azurerm_linux_virtual_machine', 'main', body);
    expect(out).toContain('os_disk {');
    expect(out).not.toContain('os_disk = {');
  });

  it('renders scalar attributes with = sign', () => {
    const body: HclMapEntry[] = [
      { key: 'size', value: literal(30) },
    ];
    const out = writeResourceBlock('azurerm_managed_disk', 'main', body);
    expect(out).toContain('size = 30');
  });

  it('expands blocks entries into repeated sub-blocks', () => {
    const blocks: HclValue = {
      kind: 'blocks',
      blocks: [
        { key: 'rule', value: block({ priority: literal(100) }) },
        { key: 'rule', value: block({ priority: literal(200) }) },
      ],
    };
    const body: HclMapEntry[] = [{ key: 'rule', value: blocks }];
    const out = writeResourceBlock('azurerm_network_security_group', 'main', body);
    const ruleMatches = out.match(/rule \{/g);
    expect(ruleMatches).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// writeProviderBlock()
// ---------------------------------------------------------------------------

describe('writeProviderBlock()', () => {
  it('renders provider name', () => {
    const body: HclMapEntry[] = [{ key: 'features', value: block({}) }];
    const out = writeProviderBlock('azurerm', body);
    expect(out).toContain('provider "azurerm" {');
  });

  it('renders features as a block (no = sign)', () => {
    const body: HclMapEntry[] = [{ key: 'features', value: block({}) }];
    const out = writeProviderBlock('azurerm', body);
    expect(out).toContain('features {}');
    expect(out).not.toContain('features = {}');
  });

  it('includes subscription_id as expression', () => {
    const body: HclMapEntry[] = [
      { key: 'features', value: block({}) },
      { key: 'subscription_id', value: expr('var.subscription_id') },
    ];
    const out = writeProviderBlock('azurerm', body);
    expect(out).toContain('subscription_id = var.subscription_id');
  });

  it('includes comment when provided', () => {
    const out = writeProviderBlock('azurerm', [], { comment: 'Azure provider' });
    expect(out).toContain('# Azure provider');
  });
});

// ---------------------------------------------------------------------------
// writeVariableBlock()
// ---------------------------------------------------------------------------

describe('writeVariableBlock()', () => {
  it('renders variable with type, default, and description', () => {
    const out = writeVariableBlock('location', {
      description: 'Azure region for all resources',
      type: 'string',
      defaultValue: literal('eastus'),
    });
    expect(out).toContain('variable "location" {');
    expect(out).toContain('description = "Azure region for all resources"');
    expect(out).toContain('type        = string');
    expect(out).toContain('default     = "eastus"');
    expect(out.trimEnd().endsWith('}')).toBe(true);
  });

  it('renders variable without default', () => {
    const out = writeVariableBlock('api_key', {
      description: 'API key',
      type: 'string',
      sensitive: true,
    });
    expect(out).toContain('variable "api_key" {');
    expect(out).toContain('sensitive   = true');
    expect(out).not.toContain('default');
  });

  it('renders variable with minimal props', () => {
    const out = writeVariableBlock('name', {});
    expect(out).toContain('variable "name" {');
    expect(out).not.toContain('description');
    expect(out).not.toContain('type');
    expect(out).not.toContain('default');
  });

  it('escapes description with special characters', () => {
    const out = writeVariableBlock('x', {
      description: 'uses "quotes" and \\backslash',
    });
    expect(out).toContain('\\"quotes\\"');
    expect(out).toContain('\\\\backslash');
  });
});

// ---------------------------------------------------------------------------
// writeOutputBlock()
// ---------------------------------------------------------------------------

describe('writeOutputBlock()', () => {
  it('renders output with value and description', () => {
    const out = writeOutputBlock('rg_name', {
      value: expr('azurerm_resource_group.main.name'),
      description: 'The name of the resource group',
    });
    expect(out).toContain('output "rg_name" {');
    expect(out).toContain('description = "The name of the resource group"');
    expect(out).toContain('value       = azurerm_resource_group.main.name');
    expect(out.trimEnd().endsWith('}')).toBe(true);
  });

  it('renders output without description', () => {
    const out = writeOutputBlock('id', { value: literal('abc') });
    expect(out).toContain('output "id" {');
    expect(out).not.toContain('description');
    expect(out).toContain('value       = "abc"');
  });
});

// ---------------------------------------------------------------------------
// writeTerraformBlock()
// ---------------------------------------------------------------------------

describe('writeTerraformBlock()', () => {
  it('renders terraform block', () => {
    const body: HclMapEntry[] = [
      { key: 'required_version', value: literal('>= 1.0') },
    ];
    const out = writeTerraformBlock(body);
    expect(out).toContain('terraform {');
    expect(out).toContain('required_version = ">= 1.0"');
    expect(out.trimEnd().endsWith('}')).toBe(true);
  });

  it('renders nested required_providers as block', () => {
    const providers: HclMapEntry[] = [
      {
        key: 'azurerm',
        value: block({
          source: literal('hashicorp/azurerm'),
          version: literal('~> 3.0'),
        }),
      },
    ];
    const body: HclMapEntry[] = [
      { key: 'required_providers', value: { kind: 'block' as const, body: providers } },
    ];
    const out = writeTerraformBlock(body);
    expect(out).toContain('terraform {');
    expect(out).toContain('required_providers {');
    expect(out).toContain('azurerm {');
    expect(out).toContain('source = "hashicorp/azurerm"');
    expect(out).toContain('version = "~> 3.0"');
  });
});

// ---------------------------------------------------------------------------
// Unknown value kind fallback
// ---------------------------------------------------------------------------

describe('unknown value kind', () => {
  it('renders fallback comment for unknown kind', () => {
    const unknown = { kind: 'alien' } as unknown as HclValue;
    const out = writeHclValue(unknown, 0);
    expect(out).toContain('unknown HCL value kind');
    expect(out).toContain('alien');
  });
});
