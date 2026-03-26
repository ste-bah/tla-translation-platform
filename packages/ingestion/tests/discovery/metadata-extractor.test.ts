import { describe, it, expect } from 'vitest';
import { extractMetadata } from '../../src/discovery/metadata-extractor.js';
import type { HclAst } from '@tla/shared';

/**
 * Helper to create a minimal HclAst for testing.
 */
function makeAst(overrides: Partial<HclAst> = {}): HclAst {
  return {
    file_path: overrides.file_path ?? '/tmp/main.tf',
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

describe('extractMetadata', () => {
  it('extracts tags from resources', () => {
    const ast = makeAst({
      resources: [
        {
          resource_type: 'aws_s3_bucket',
          name: 'data',
          attributes: {
            tags: {
              Environment: 'production',
              Project: 'tla-demo',
            },
          },
          meta: {
            source: { file: '/tmp/main.tf', line: 0, column: 0 },
            depends_on: [],
          },
        },
        {
          resource_type: 'aws_instance',
          name: 'web',
          attributes: {
            tags: {
              Environment: 'production',
              Team: 'platform',
            },
          },
          meta: {
            source: { file: '/tmp/main.tf', line: 0, column: 0 },
            depends_on: [],
          },
        },
      ],
    });

    const metadata = extractMetadata([ast]);

    expect(metadata.tags['Environment']).toEqual(['production']);
    expect(metadata.tags['Project']).toEqual(['tla-demo']);
    expect(metadata.tags['Team']).toEqual(['platform']);
  });

  it('collects unique tag values across resources', () => {
    const ast = makeAst({
      resources: [
        {
          resource_type: 'aws_s3_bucket',
          name: 'prod',
          attributes: { tags: { Environment: 'production' } },
          meta: {
            source: { file: '/tmp/main.tf', line: 0, column: 0 },
            depends_on: [],
          },
        },
        {
          resource_type: 'aws_s3_bucket',
          name: 'staging',
          attributes: { tags: { Environment: 'staging' } },
          meta: {
            source: { file: '/tmp/main.tf', line: 0, column: 0 },
            depends_on: [],
          },
        },
      ],
    });

    const metadata = extractMetadata([ast]);

    expect(metadata.tags['Environment']).toEqual(['production', 'staging']);
  });

  it('extracts tags from data blocks', () => {
    const ast = makeAst({
      data_blocks: [
        {
          data_type: 'aws_ami',
          name: 'latest',
          attributes: {
            tags: { Owner: 'ops-team' },
          },
          meta: {
            source: { file: '/tmp/main.tf', line: 0, column: 0 },
            depends_on: [],
          },
        },
      ],
    });

    const metadata = extractMetadata([ast]);

    expect(metadata.tags['Owner']).toEqual(['ops-team']);
  });

  it('detects naming patterns from resource names', () => {
    const ast = makeAst({
      resources: [
        {
          resource_type: 'aws_s3_bucket',
          name: 'app-data',
          attributes: {},
          meta: {
            source: { file: '/tmp/main.tf', line: 0, column: 0 },
            depends_on: [],
          },
        },
        {
          resource_type: 'aws_s3_bucket',
          name: 'app-logs',
          attributes: {},
          meta: {
            source: { file: '/tmp/main.tf', line: 0, column: 0 },
            depends_on: [],
          },
        },
        {
          resource_type: 'aws_instance',
          name: 'app-web',
          attributes: {},
          meta: {
            source: { file: '/tmp/main.tf', line: 0, column: 0 },
            depends_on: [],
          },
        },
      ],
    });

    const metadata = extractMetadata([ast]);

    expect(metadata.naming_patterns).toContain('app-*');
    expect(metadata.naming_patterns).toContain('kebab-case');
  });

  it('detects snake_case naming convention', () => {
    const ast = makeAst({
      resources: [
        {
          resource_type: 'aws_s3_bucket',
          name: 'app_data',
          attributes: {},
          meta: {
            source: { file: '/tmp/main.tf', line: 0, column: 0 },
            depends_on: [],
          },
        },
        {
          resource_type: 'aws_s3_bucket',
          name: 'app_logs',
          attributes: {},
          meta: {
            source: { file: '/tmp/main.tf', line: 0, column: 0 },
            depends_on: [],
          },
        },
      ],
    });

    const metadata = extractMetadata([ast]);

    expect(metadata.naming_patterns).toContain('snake_case');
  });

  it('detects mixed separator convention', () => {
    const ast = makeAst({
      resources: [
        {
          resource_type: 'aws_s3_bucket',
          name: 'app-data',
          attributes: {},
          meta: {
            source: { file: '/tmp/main.tf', line: 0, column: 0 },
            depends_on: [],
          },
        },
        {
          resource_type: 'aws_instance',
          name: 'app_web',
          attributes: {},
          meta: {
            source: { file: '/tmp/main.tf', line: 0, column: 0 },
            depends_on: [],
          },
        },
      ],
    });

    const metadata = extractMetadata([ast]);

    expect(metadata.naming_patterns).toContain('mixed-separators');
  });

  it('extracts provider versions from terraform block', () => {
    const ast = makeAst({
      terraform: {
        required_version: '>= 1.5.0',
        required_providers: {
          aws: { source: 'hashicorp/aws', version: '~> 5.0' },
          random: { source: 'hashicorp/random', version: '~> 3.0' },
        },
      },
    });

    const metadata = extractMetadata([ast]);

    expect(metadata.provider_versions['aws']).toBe('~> 5.0');
    expect(metadata.provider_versions['random']).toBe('~> 3.0');
  });

  it('extracts provider versions from provider blocks as fallback', () => {
    const ast = makeAst({
      providers: [
        {
          name: 'aws',
          attributes: { region: 'us-east-1' },
          version: '~> 5.0',
        },
      ],
    });

    const metadata = extractMetadata([ast]);

    expect(metadata.provider_versions['aws']).toBe('~> 5.0');
  });

  it('extracts module sources', () => {
    const ast = makeAst({
      module_calls: [
        {
          name: 'vpc',
          source: 'terraform-aws-modules/vpc/aws',
          version: '5.1.0',
          attributes: {},
          meta: {
            source: { file: '/tmp/main.tf', line: 0, column: 0 },
            depends_on: [],
          },
        },
        {
          name: 'sg',
          source: './modules/security-group',
          attributes: {},
          meta: {
            source: { file: '/tmp/main.tf', line: 0, column: 0 },
            depends_on: [],
          },
        },
      ],
    });

    const metadata = extractMetadata([ast]);

    expect(metadata.module_sources).toHaveLength(2);
    expect(metadata.module_sources[0]!.name).toBe('vpc');
    expect(metadata.module_sources[0]!.source).toBe(
      'terraform-aws-modules/vpc/aws',
    );
    expect(metadata.module_sources[0]!.version).toBe('5.1.0');
    expect(metadata.module_sources[1]!.name).toBe('sg');
    expect(metadata.module_sources[1]!.version).toBeUndefined();
  });

  it('deduplicates modules across files', () => {
    const ast1 = makeAst({
      file_path: '/tmp/a.tf',
      module_calls: [
        {
          name: 'vpc',
          source: 'terraform-aws-modules/vpc/aws',
          version: '5.1.0',
          attributes: {},
          meta: {
            source: { file: '/tmp/a.tf', line: 0, column: 0 },
            depends_on: [],
          },
        },
      ],
    });
    const ast2 = makeAst({
      file_path: '/tmp/b.tf',
      module_calls: [
        {
          name: 'vpc',
          source: 'terraform-aws-modules/vpc/aws',
          version: '5.1.0',
          attributes: {},
          meta: {
            source: { file: '/tmp/b.tf', line: 0, column: 0 },
            depends_on: [],
          },
        },
      ],
    });

    const metadata = extractMetadata([ast1, ast2]);

    expect(metadata.module_sources).toHaveLength(1);
  });

  it('extracts backend type', () => {
    const ast = makeAst({
      terraform: {
        required_version: '>= 1.5.0',
        required_providers: {},
        backend: {
          type: 's3',
          attributes: { bucket: 'my-state' },
        },
      },
    });

    const metadata = extractMetadata([ast]);

    expect(metadata.backend_type).toBe('s3');
  });

  it('extracts terraform version constraint', () => {
    const ast = makeAst({
      terraform: {
        required_version: '>= 1.5.0',
        required_providers: {},
      },
    });

    const metadata = extractMetadata([ast]);

    expect(metadata.terraform_version_constraint).toBe('>= 1.5.0');
  });

  it('handles empty AST array', () => {
    const metadata = extractMetadata([]);

    expect(metadata.tags).toEqual({});
    expect(metadata.naming_patterns).toEqual([]);
    expect(metadata.provider_versions).toEqual({});
    expect(metadata.module_sources).toEqual([]);
    expect(metadata.backend_type).toBeUndefined();
    expect(metadata.terraform_version_constraint).toBeUndefined();
  });

  it('handles resources without tags', () => {
    const ast = makeAst({
      resources: [
        {
          resource_type: 'aws_s3_bucket',
          name: 'no_tags',
          attributes: { bucket: 'my-bucket' },
          meta: {
            source: { file: '/tmp/main.tf', line: 0, column: 0 },
            depends_on: [],
          },
        },
      ],
    });

    const metadata = extractMetadata([ast]);

    expect(metadata.tags).toEqual({});
  });
});
