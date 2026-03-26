import { describe, it, expect } from 'vitest';
import { normalizeAttributes } from '../../src/ir/attribute-normalizer.js';

describe('normalizeAttributes', () => {
  it('extracts tags into a separate map', () => {
    const attrs = {
      bucket: 'my-bucket',
      tags: { Name: 'test', Env: 'prod' },
      acl: 'private',
    };

    const result = normalizeAttributes(attrs);

    expect(result.tags).toEqual({ Name: 'test', Env: 'prod' });
    expect(result.attributes).not.toHaveProperty('tags');
    expect(result.attributes['bucket']).toBe('my-bucket');
    expect(result.attributes['acl']).toBe('private');
  });

  it('merges tags and tags_all into the same tags map', () => {
    const attrs = {
      tags: { Name: 'bucket' },
      tags_all: { Name: 'bucket', ManagedBy: 'terraform' },
    };

    const result = normalizeAttributes(attrs);

    expect(result.tags).toEqual({ Name: 'bucket', ManagedBy: 'terraform' });
    expect(result.attributes).not.toHaveProperty('tags');
    expect(result.attributes).not.toHaveProperty('tags_all');
  });

  it('coerces string "true" and "false" to native booleans', () => {
    const attrs = {
      enabled: 'true',
      versioning: 'false',
      name: 'test',
      count: 42,
    };

    const result = normalizeAttributes(attrs);

    expect(result.attributes['enabled']).toBe(true);
    expect(result.attributes['versioning']).toBe(false);
    expect(result.attributes['name']).toBe('test');
    expect(result.attributes['count']).toBe(42);
  });

  it('coerces booleans recursively in nested objects', () => {
    const attrs = {
      config: {
        enable_logging: 'true',
        nested: {
          active: 'false',
        },
      },
    };

    const result = normalizeAttributes(attrs);
    const config = result.attributes['config'] as Record<string, unknown>;

    expect(config['enable_logging']).toBe(true);
    expect((config['nested'] as Record<string, unknown>)['active']).toBe(false);
  });

  it('coerces booleans inside arrays', () => {
    const attrs = {
      items: ['true', 'false', 'hello'],
    };

    const result = normalizeAttributes(attrs);

    expect(result.attributes['items']).toEqual([true, false, 'hello']);
  });

  it('ignores tags key when value is not a string record', () => {
    const attrs = {
      tags: [{ key: 'Name', value: 'test' }],
    };

    const result = normalizeAttributes(attrs);

    // Non-string-record tags stay in attributes
    expect(result.tags).toEqual({});
    expect(result.attributes).toHaveProperty('tags');
  });

  it('handles empty attributes', () => {
    const result = normalizeAttributes({});

    expect(result.attributes).toEqual({});
    expect(result.tags).toEqual({});
  });

  it('preserves null values', () => {
    const attrs = { key: null };
    const result = normalizeAttributes(attrs);
    expect(result.attributes['key']).toBeNull();
  });

  it('preserves numeric values without coercion', () => {
    const attrs = { port: 8080, ratio: 0.5 };
    const result = normalizeAttributes(attrs);
    expect(result.attributes['port']).toBe(8080);
    expect(result.attributes['ratio']).toBe(0.5);
  });
});
