import { describe, it, expect } from 'vitest';
import type { TranslatedResource } from '@tla/shared/types/translation.js';
import {
  applyStyle,
  toSnakeCase,
  toKebabCase,
  toCamelCase,
} from '../../src/style/style-applier.js';
import {
  DEFAULT_PROFILE,
  ENTERPRISE_PROFILE,
  MINIMAL_PROFILE,
} from '../../src/style/style-profile.js';
import type { StyleProfile } from '../../src/style/style-profile.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResource(overrides: Partial<TranslatedResource> = {}): TranslatedResource {
  return {
    targetType: 'azurerm_resource_group',
    targetName: 'my_resource',
    attributes: { location: 'eastus' },
    sourceId: 'aws_vpc.main',
    traceability: {
      sourceId: 'aws_vpc.main',
      sourceType: 'aws_vpc',
      registryEntryId: null,
      mappingType: 'direct',
      confidence: 0.9,
      engineUsed: 'direct-engine',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Case-conversion unit tests
// ---------------------------------------------------------------------------

describe('toSnakeCase', () => {
  it('keeps already-snake_case names unchanged', () => {
    expect(toSnakeCase('my_resource')).toBe('my_resource');
  });

  it('converts kebab-case', () => {
    expect(toSnakeCase('my-resource-name')).toBe('my_resource_name');
  });

  it('converts camelCase', () => {
    expect(toSnakeCase('myResourceName')).toBe('my_resource_name');
  });

  it('converts PascalCase', () => {
    expect(toSnakeCase('MyResourceName')).toBe('my_resource_name');
  });

  it('handles consecutive uppercase (acronyms)', () => {
    expect(toSnakeCase('VPCConfig')).toBe('vpc_config');
  });
});

describe('toKebabCase', () => {
  it('converts snake_case', () => {
    expect(toKebabCase('my_resource')).toBe('my-resource');
  });

  it('converts camelCase', () => {
    expect(toKebabCase('myResourceName')).toBe('my-resource-name');
  });

  it('keeps already-kebab names unchanged', () => {
    expect(toKebabCase('my-resource-name')).toBe('my-resource-name');
  });
});

describe('toCamelCase', () => {
  it('converts snake_case', () => {
    expect(toCamelCase('my_resource_name')).toBe('myResourceName');
  });

  it('converts kebab-case', () => {
    expect(toCamelCase('my-resource-name')).toBe('myResourceName');
  });

  it('converts PascalCase to camelCase', () => {
    expect(toCamelCase('MyResourceName')).toBe('myResourceName');
  });

  it('handles single token', () => {
    expect(toCamelCase('resource')).toBe('resource');
  });

  it('returns empty string for empty input', () => {
    expect(toCamelCase('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_PROFILE — regression / no-op
// ---------------------------------------------------------------------------

describe('applyStyle — DEFAULT_PROFILE', () => {
  it('is a no-op for snake_case names', () => {
    const resources = [makeResource({ targetName: 'my_resource' })];
    const result = applyStyle(resources, DEFAULT_PROFILE);
    expect(result[0].targetName).toBe('my_resource');
  });

  it('converts camelCase names to snake_case (DEFAULT is snake_case)', () => {
    const resources = [makeResource({ targetName: 'myResource' })];
    const result = applyStyle(resources, DEFAULT_PROFILE);
    expect(result[0].targetName).toBe('my_resource');
  });

  it('does not add prefix or suffix', () => {
    const resources = [makeResource({ targetName: 'rg_main' })];
    const result = applyStyle(resources, DEFAULT_PROFILE);
    expect(result[0].targetName).toBe('rg_main');
  });

  it('returns the same number of resources', () => {
    const resources = [makeResource(), makeResource({ targetName: 'other_res' })];
    const result = applyStyle(resources, DEFAULT_PROFILE);
    expect(result).toHaveLength(2);
  });

  it('works with an empty array', () => {
    expect(applyStyle([], DEFAULT_PROFILE)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Prefix / suffix
// ---------------------------------------------------------------------------

describe('applyStyle — prefix and suffix', () => {
  it('prepends resourcePrefix', () => {
    const profile: StyleProfile = {
      ...DEFAULT_PROFILE,
      naming: { ...DEFAULT_PROFILE.naming, resourcePrefix: 'prod_' },
    };
    const result = applyStyle([makeResource({ targetName: 'rg_main' })], profile);
    expect(result[0].targetName).toBe('prod_rg_main');
  });

  it('appends resourceSuffix', () => {
    const profile: StyleProfile = {
      ...DEFAULT_PROFILE,
      naming: { ...DEFAULT_PROFILE.naming, resourceSuffix: '_v2' },
    };
    const result = applyStyle([makeResource({ targetName: 'rg_main' })], profile);
    expect(result[0].targetName).toBe('rg_main_v2');
  });

  it('applies both prefix and suffix', () => {
    const profile: StyleProfile = {
      ...DEFAULT_PROFILE,
      naming: {
        ...DEFAULT_PROFILE.naming,
        resourcePrefix: 'pre_',
        resourceSuffix: '_suf',
      },
    };
    const result = applyStyle([makeResource({ targetName: 'rg_main' })], profile);
    expect(result[0].targetName).toBe('pre_rg_main_suf');
  });

  it('applies prefix AFTER case conversion', () => {
    const profile: StyleProfile = {
      ...DEFAULT_PROFILE,
      naming: {
        caseStyle: 'snake_case',
        resourcePrefix: 'env_',
      },
    };
    const result = applyStyle([makeResource({ targetName: 'myResource' })], profile);
    // camelCase → snake → env_my_resource
    expect(result[0].targetName).toBe('env_my_resource');
  });

  it('truncates to maxLength after prefix+suffix', () => {
    const profile: StyleProfile = {
      ...DEFAULT_PROFILE,
      naming: {
        caseStyle: 'snake_case',
        resourcePrefix: 'x_',
        maxLength: 6,
      },
    };
    // 'x_' + 'rg_main' → 'x_rg_main' (9 chars) → truncate to 6 → 'x_rg_m'
    const result = applyStyle([makeResource({ targetName: 'rg_main' })], profile);
    expect(result[0].targetName.length).toBeLessThanOrEqual(6);
    expect(result[0].targetName).toBe('x_rg_m');
  });
});

// ---------------------------------------------------------------------------
// Case conversions through applyStyle
// ---------------------------------------------------------------------------

describe('applyStyle — caseStyle', () => {
  it('converts to kebab-case', () => {
    const profile: StyleProfile = {
      ...DEFAULT_PROFILE,
      naming: { caseStyle: 'kebab-case' },
    };
    const result = applyStyle([makeResource({ targetName: 'my_resource_name' })], profile);
    expect(result[0].targetName).toBe('my-resource-name');
  });

  it('converts to camelCase', () => {
    const profile: StyleProfile = {
      ...DEFAULT_PROFILE,
      naming: { caseStyle: 'camelCase' },
    };
    const result = applyStyle([makeResource({ targetName: 'my_resource_name' })], profile);
    expect(result[0].targetName).toBe('myResourceName');
  });

  it('converts to snake_case from camelCase input', () => {
    const profile: StyleProfile = {
      ...DEFAULT_PROFILE,
      naming: { caseStyle: 'snake_case' },
    };
    const result = applyStyle([makeResource({ targetName: 'myResourceName' })], profile);
    expect(result[0].targetName).toBe('my_resource_name');
  });
});

// ---------------------------------------------------------------------------
// targetType is never changed
// ---------------------------------------------------------------------------

describe('applyStyle — targetType unchanged', () => {
  it('leaves targetType untouched regardless of profile', () => {
    const profile: StyleProfile = {
      ...DEFAULT_PROFILE,
      naming: {
        caseStyle: 'kebab-case',
        resourcePrefix: 'prd_',
        resourceSuffix: '_x',
      },
    };
    const resource = makeResource({ targetType: 'azurerm_storage_account' });
    const result = applyStyle([resource], profile);
    expect(result[0].targetType).toBe('azurerm_storage_account');
  });

  it('leaves attributes untouched', () => {
    const attrs = { location: 'westus', sku: { name: 'Standard_LRS' } };
    const resource = makeResource({ attributes: attrs });
    const result = applyStyle([resource], DEFAULT_PROFILE);
    expect(result[0].attributes).toEqual(attrs);
  });

  it('leaves traceability untouched', () => {
    const resource = makeResource();
    const result = applyStyle([resource], DEFAULT_PROFILE);
    expect(result[0].traceability).toEqual(resource.traceability);
  });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe('applyStyle — immutability', () => {
  it('does not mutate the input array', () => {
    const resources = [makeResource({ targetName: 'rg_main' })];
    const original = resources[0];
    const profile: StyleProfile = {
      ...DEFAULT_PROFILE,
      naming: { caseStyle: 'kebab-case', resourcePrefix: 'pre_' },
    };
    applyStyle(resources, profile);
    expect(resources[0]).toBe(original);
    expect(resources[0].targetName).toBe('rg_main');
  });

  it('returns a new array, not the same reference', () => {
    const resources = [makeResource()];
    const result = applyStyle(resources, DEFAULT_PROFILE);
    expect(result).not.toBe(resources);
  });

  it('returns new resource objects, not the same references', () => {
    const resources = [makeResource()];
    const result = applyStyle(resources, DEFAULT_PROFILE);
    expect(result[0]).not.toBe(resources[0]);
  });
});

// ---------------------------------------------------------------------------
// ENTERPRISE_PROFILE smoke test
// ---------------------------------------------------------------------------

describe('applyStyle — ENTERPRISE_PROFILE', () => {
  it('applies prefix when set on enterprise profile', () => {
    const profile: StyleProfile = {
      ...ENTERPRISE_PROFILE,
      naming: { ...ENTERPRISE_PROFILE.naming, resourcePrefix: 'corp_' },
    };
    const result = applyStyle([makeResource({ targetName: 'rg_main' })], profile);
    expect(result[0].targetName).toBe('corp_rg_main');
  });
});

// ---------------------------------------------------------------------------
// MINIMAL_PROFILE smoke test
// ---------------------------------------------------------------------------

describe('applyStyle — MINIMAL_PROFILE', () => {
  it('is effectively a no-op for naming when no prefix/suffix set', () => {
    const result = applyStyle([makeResource({ targetName: 'my_resource' })], MINIMAL_PROFILE);
    expect(result[0].targetName).toBe('my_resource');
  });
});

// ---------------------------------------------------------------------------
// Multiple resources
// ---------------------------------------------------------------------------

describe('applyStyle — multiple resources', () => {
  it('applies naming to every resource independently', () => {
    const profile: StyleProfile = {
      ...DEFAULT_PROFILE,
      naming: { caseStyle: 'kebab-case', resourcePrefix: 'p-' },
    };
    const resources = [
      makeResource({ targetName: 'rg_main' }),
      makeResource({ targetName: 'storage_account' }),
      makeResource({ targetName: 'virtualNetwork' }),
    ];
    const result = applyStyle(resources, profile);
    expect(result[0].targetName).toBe('p-rg-main');
    expect(result[1].targetName).toBe('p-storage-account');
    expect(result[2].targetName).toBe('p-virtual-network');
  });
});
