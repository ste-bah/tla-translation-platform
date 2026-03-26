import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadRegistryFromDirectory } from '@tla/registry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES = join(__dirname, 'fixtures');

describe('loadRegistryFromDirectory', () => {
  it('loads 3 entries with 0 errors from valid-registry fixtures', async () => {
    const result = await loadRegistryFromDirectory(join(FIXTURES, 'valid-registry'));

    expect(result.entries).toHaveLength(3);
    expect(result.errors).toHaveLength(0);

    // Verify entries have expected IDs
    const ids = result.entries.map((e) => e.registry_entry_id).sort();
    expect(ids).toEqual(['SER-COM-EC2-001', 'SER-NET-VPC-001', 'SER-STO-S3-001']);
  });

  it('returns error with file path from bad-yaml-syntax fixture', async () => {
    const result = await loadRegistryFromDirectory(join(FIXTURES, 'invalid-registry'));

    // Should have at least one error for the bad YAML file
    const yamlErrors = result.errors.filter((e) =>
      e.filePath.includes('bad-yaml-syntax.yaml'),
    );
    expect(yamlErrors.length).toBeGreaterThanOrEqual(1);
    expect(yamlErrors[0]!.message).toContain('YAML parse error');
    expect(yamlErrors[0]!.filePath).toContain('bad-yaml-syntax.yaml');
  });

  it('returns error with issues from missing-required-field fixture', async () => {
    const result = await loadRegistryFromDirectory(join(FIXTURES, 'invalid-registry'));

    // Should have a schema validation error for the missing-required-field file
    const schemaErrors = result.errors.filter((e) =>
      e.filePath.includes('missing-required-field.yaml'),
    );
    expect(schemaErrors.length).toBeGreaterThanOrEqual(1);
    expect(schemaErrors[0]!.message).toContain('Schema validation failed');
    expect(schemaErrors[0]!.issues).toBeDefined();
    expect(schemaErrors[0]!.issues!.length).toBeGreaterThan(0);
  });

  it('returns 0 entries and 0 errors from empty-registry fixture', async () => {
    const result = await loadRegistryFromDirectory(join(FIXTURES, 'empty-registry'));

    expect(result.entries).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('returns 0 entries and 1 error for non-existent directory (never throws)', async () => {
    const result = await loadRegistryFromDirectory(join(FIXTURES, 'does-not-exist'));

    expect(result.entries).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Failed to read directory');
  });
});
