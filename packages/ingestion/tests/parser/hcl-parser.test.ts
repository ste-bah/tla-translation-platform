import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve, join } from 'node:path';
import type { HclAst } from '@tla/shared';

// We mock @cdktf/hcl2json since it requires WASM and may not be available in CI
vi.mock('@cdktf/hcl2json', () => ({
  parse: vi.fn(),
}));

// We also mock fs/promises for controlled tests
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

import { parseHclFile, parseHclDirectory } from '../../src/parser/hcl-parser.js';
import { parse as parseHcl2Json } from '@cdktf/hcl2json';
import { readFile, readdir, stat } from 'node:fs/promises';

const mockParse = vi.mocked(parseHcl2Json);
const mockReadFile = vi.mocked(readFile);
const mockReaddir = vi.mocked(readdir);
const mockStat = vi.mocked(stat);

const FIXTURES_DIR = resolve(__dirname, '../fixtures');

/**
 * Minimal hcl2json output representing sample.tf-like content.
 */
const SAMPLE_HCL2JSON_OUTPUT = {
  resource: {
    aws_s3_bucket: {
      data: [
        {
          bucket: 'my-bucket',
          tags: { Environment: 'prod' },
        },
      ],
    },
    aws_instance: {
      web: [
        {
          ami: 'ami-123',
          instance_type: 't3.micro',
          depends_on: ['aws_s3_bucket.data'],
        },
      ],
    },
    null_resource: {
      provisioner: [
        {
          triggers: { always_run: '${timestamp()}' },
          provisioner: [{ 'local-exec': [{ command: 'echo hello' }] }],
        },
      ],
    },
  },
  data: {
    aws_ami: {
      latest: [
        {
          most_recent: true,
          owners: ['amazon'],
        },
      ],
    },
  },
  variable: {
    environment: [
      {
        type: 'string',
        description: 'Deployment environment',
        default: 'production',
      },
    ],
    instance_type: [
      {
        type: 'string',
        default: 't3.micro',
      },
    ],
  },
  locals: [
    {
      common_tags: {
        Environment: '${var.environment}',
        Project: 'tla-demo',
      },
    },
  ],
  output: {
    bucket_arn: [
      {
        value: '${aws_s3_bucket.data.arn}',
        description: 'ARN of the data bucket',
      },
    ],
  },
  provider: {
    aws: [
      {
        region: 'us-east-1',
      },
    ],
  },
  module: {
    vpc: [
      {
        source: 'terraform-aws-modules/vpc/aws',
        version: '5.1.0',
        name: 'tla-demo-vpc',
        cidr: '10.0.0.0/16',
      },
    ],
  },
  terraform: [
    {
      required_version: '>= 1.5.0',
      required_providers: [
        {
          aws: {
            source: 'hashicorp/aws',
            version: '~> 5.0',
          },
        },
      ],
      backend: [
        {
          s3: [
            {
              bucket: 'my-tf-state',
              key: 'prod/terraform.tfstate',
              region: 'us-east-1',
            },
          ],
        },
      ],
    },
  ],
};

describe('parseHclFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses a valid HCL file and returns a structured AST', async () => {
    const filePath = join(FIXTURES_DIR, 'sample.tf');
    const absPath = resolve(filePath);

    mockReadFile.mockResolvedValueOnce('# HCL content' as never);
    mockParse.mockResolvedValueOnce(SAMPLE_HCL2JSON_OUTPUT);

    const ast = await parseHclFile(filePath);

    expect(ast.file_path).toBe(absPath);
    expect(ast.resources).toHaveLength(3);
    expect(ast.data_blocks).toHaveLength(1);
    expect(ast.variables).toHaveLength(2);
    expect(ast.locals).toHaveLength(1);
    expect(ast.outputs).toHaveLength(1);
    expect(ast.providers).toHaveLength(1);
    expect(ast.module_calls).toHaveLength(1);
    expect(ast.terraform).toBeDefined();
  });

  it('extracts resource attributes correctly', async () => {
    const filePath = '/tmp/test.tf';
    mockReadFile.mockResolvedValueOnce('# content' as never);
    mockParse.mockResolvedValueOnce(SAMPLE_HCL2JSON_OUTPUT);

    const ast = await parseHclFile(filePath);

    const s3 = ast.resources.find((r) => r.resource_type === 'aws_s3_bucket');
    expect(s3).toBeDefined();
    expect(s3!.name).toBe('data');
    expect(s3!.attributes['bucket']).toBe('my-bucket');
  });

  it('extracts depends_on metadata', async () => {
    const filePath = '/tmp/test.tf';
    mockReadFile.mockResolvedValueOnce('# content' as never);
    mockParse.mockResolvedValueOnce(SAMPLE_HCL2JSON_OUTPUT);

    const ast = await parseHclFile(filePath);

    const instance = ast.resources.find(
      (r) => r.resource_type === 'aws_instance',
    );
    expect(instance).toBeDefined();
    expect(instance!.meta.depends_on).toEqual(['aws_s3_bucket.data']);
  });

  it('extracts variables with types and defaults', async () => {
    const filePath = '/tmp/test.tf';
    mockReadFile.mockResolvedValueOnce('# content' as never);
    mockParse.mockResolvedValueOnce(SAMPLE_HCL2JSON_OUTPUT);

    const ast = await parseHclFile(filePath);

    const envVar = ast.variables.find((v) => v.name === 'environment');
    expect(envVar).toBeDefined();
    expect(envVar!.type).toBe('string');
    expect(envVar!.description).toBe('Deployment environment');
    expect(envVar!.default).toBe('production');
  });

  it('extracts locals', async () => {
    const filePath = '/tmp/test.tf';
    mockReadFile.mockResolvedValueOnce('# content' as never);
    mockParse.mockResolvedValueOnce(SAMPLE_HCL2JSON_OUTPUT);

    const ast = await parseHclFile(filePath);

    expect(ast.locals).toHaveLength(1);
    expect(ast.locals[0]!.name).toBe('common_tags');
  });

  it('extracts outputs', async () => {
    const filePath = '/tmp/test.tf';
    mockReadFile.mockResolvedValueOnce('# content' as never);
    mockParse.mockResolvedValueOnce(SAMPLE_HCL2JSON_OUTPUT);

    const ast = await parseHclFile(filePath);

    expect(ast.outputs).toHaveLength(1);
    expect(ast.outputs[0]!.name).toBe('bucket_arn');
    expect(ast.outputs[0]!.description).toBe('ARN of the data bucket');
  });

  it('extracts provider configuration', async () => {
    const filePath = '/tmp/test.tf';
    mockReadFile.mockResolvedValueOnce('# content' as never);
    mockParse.mockResolvedValueOnce(SAMPLE_HCL2JSON_OUTPUT);

    const ast = await parseHclFile(filePath);

    expect(ast.providers).toHaveLength(1);
    expect(ast.providers[0]!.name).toBe('aws');
    expect(ast.providers[0]!.attributes['region']).toBe('us-east-1');
  });

  it('extracts module calls with source and version', async () => {
    const filePath = '/tmp/test.tf';
    mockReadFile.mockResolvedValueOnce('# content' as never);
    mockParse.mockResolvedValueOnce(SAMPLE_HCL2JSON_OUTPUT);

    const ast = await parseHclFile(filePath);

    expect(ast.module_calls).toHaveLength(1);
    expect(ast.module_calls[0]!.name).toBe('vpc');
    expect(ast.module_calls[0]!.source).toBe(
      'terraform-aws-modules/vpc/aws',
    );
    expect(ast.module_calls[0]!.version).toBe('5.1.0');
  });

  it('extracts terraform block with backend and required_providers', async () => {
    const filePath = '/tmp/test.tf';
    mockReadFile.mockResolvedValueOnce('# content' as never);
    mockParse.mockResolvedValueOnce(SAMPLE_HCL2JSON_OUTPUT);

    const ast = await parseHclFile(filePath);

    expect(ast.terraform).toBeDefined();
    expect(ast.terraform!.required_version).toBe('>= 1.5.0');
    expect(ast.terraform!.required_providers['aws']).toEqual({
      source: 'hashicorp/aws',
      version: '~> 5.0',
    });
    expect(ast.terraform!.backend).toBeDefined();
    expect(ast.terraform!.backend!.type).toBe('s3');
  });

  it('throws IngestionError when file cannot be read', async () => {
    const filePath = '/tmp/nonexistent.tf';
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT') as never);

    await expect(parseHclFile(filePath)).rejects.toThrow('Failed to read HCL file');
  });

  it('throws IngestionError when hcl2json fails', async () => {
    const filePath = '/tmp/bad.tf';
    mockReadFile.mockResolvedValueOnce('invalid HCL {{' as never);
    mockParse.mockRejectedValueOnce(new Error('Parse error'));

    await expect(parseHclFile(filePath)).rejects.toThrow('Failed to parse HCL');
  });

  it('handles empty resource/data/variable maps gracefully', async () => {
    const filePath = '/tmp/empty.tf';
    mockReadFile.mockResolvedValueOnce('# empty' as never);
    mockParse.mockResolvedValueOnce({});

    const ast = await parseHclFile(filePath);

    expect(ast.resources).toEqual([]);
    expect(ast.data_blocks).toEqual([]);
    expect(ast.variables).toEqual([]);
    expect(ast.locals).toEqual([]);
    expect(ast.outputs).toEqual([]);
    expect(ast.providers).toEqual([]);
    expect(ast.module_calls).toEqual([]);
    expect(ast.terraform).toBeUndefined();
  });
});

describe('parseHclDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses all .tf files in a directory', async () => {
    const dir = '/tmp/tf-project';
    mockReaddir.mockResolvedValueOnce(['main.tf', 'vars.tf', 'readme.md'] as never);
    mockStat.mockImplementation(async (p) => {
      return { isFile: () => true } as never;
    });
    mockReadFile.mockResolvedValue('# content' as never);
    mockParse.mockResolvedValue(
      { resource: { aws_s3_bucket: { b: [{ bucket: 'x' }] } } },
    );

    const result = await parseHclDirectory(dir);

    expect(result.asts).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('returns empty results for directory with no .tf files', async () => {
    const dir = '/tmp/empty-project';
    mockReaddir.mockResolvedValueOnce(['readme.md', 'main.py'] as never);

    const result = await parseHclDirectory(dir);

    expect(result.asts).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('isolates per-file errors without halting the batch', async () => {
    const dir = '/tmp/mixed-project';
    mockReaddir.mockResolvedValueOnce(['good.tf', 'bad.tf'] as never);
    mockStat.mockResolvedValue({ isFile: () => true } as never);

    // First file succeeds
    mockReadFile.mockResolvedValueOnce('# good' as never);
    mockParse.mockResolvedValueOnce(
      { resource: { aws_s3_bucket: { b: [{}] } } },
    );

    // Second file fails
    mockReadFile.mockRejectedValueOnce(new Error('Permission denied') as never);

    const result = await parseHclDirectory(dir);

    expect(result.asts).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.file).toContain('bad.tf');
  });

  it('throws IngestionError when directory cannot be read', async () => {
    const dir = '/tmp/nonexistent-dir';
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT') as never);

    await expect(parseHclDirectory(dir)).rejects.toThrow(
      'Failed to read directory',
    );
  });
});
