import { describe, it, expect } from 'vitest';
import {
  identifyAwsServices,
  AWS_RESOURCE_PREFIX_MAP,
} from '../../src/discovery/service-identifier.js';
import type { HclAst } from '@tla/shared';

/**
 * Helper to create a minimal HclAst for testing.
 */
function makeAst(
  resources: Array<{ resource_type: string; name: string; attributes?: Record<string, unknown> }>,
  filePath = '/tmp/main.tf',
): HclAst {
  return {
    file_path: filePath,
    resources: resources.map((r) => ({
      resource_type: r.resource_type,
      name: r.name,
      attributes: r.attributes ?? {},
      meta: {
        source: { file: filePath, line: 0, column: 0 },
        depends_on: [],
      },
    })),
    data_blocks: [],
    variables: [],
    locals: [],
    outputs: [],
    providers: [],
    module_calls: [],
  };
}

describe('identifyAwsServices', () => {
  it('identifies AWS S3 resources as storage family', () => {
    const ast = makeAst([
      { resource_type: 'aws_s3_bucket', name: 'data' },
      { resource_type: 'aws_s3_bucket_versioning', name: 'data' },
    ]);

    const result = identifyAwsServices([ast]);

    expect(result.total_resources).toBe(2);
    expect(result.total_aws_resources).toBe(2);
    expect(result.identified_services).toHaveLength(2);

    const s3Bucket = result.identified_services.find(
      (s) => s.resource_type === 'aws_s3_bucket',
    );
    expect(s3Bucket).toBeDefined();
    expect(s3Bucket!.family).toBe('storage');
    expect(s3Bucket!.service_prefix).toBe('aws_s3');
  });

  it('identifies compute resources (EC2, ALB)', () => {
    const ast = makeAst([
      { resource_type: 'aws_instance', name: 'web' },
      { resource_type: 'aws_alb', name: 'main' },
    ]);

    const result = identifyAwsServices([ast]);

    expect(result.identified_services).toHaveLength(2);
    const instance = result.identified_services.find(
      (s) => s.resource_type === 'aws_instance',
    );
    expect(instance!.family).toBe('compute');

    const alb = result.identified_services.find(
      (s) => s.resource_type === 'aws_alb',
    );
    expect(alb!.family).toBe('compute');
  });

  it('identifies networking resources', () => {
    const ast = makeAst([
      { resource_type: 'aws_vpc', name: 'main' },
      { resource_type: 'aws_subnet', name: 'private' },
      { resource_type: 'aws_security_group', name: 'web' },
    ]);

    const result = identifyAwsServices([ast]);

    for (const svc of result.identified_services) {
      expect(svc.family).toBe('networking');
    }
  });

  it('identifies serverless resources', () => {
    const ast = makeAst([
      { resource_type: 'aws_lambda_function', name: 'processor' },
      { resource_type: 'aws_api_gateway_rest_api', name: 'api' },
    ]);

    const result = identifyAwsServices([ast]);

    for (const svc of result.identified_services) {
      expect(svc.family).toBe('serverless');
    }
  });

  it('identifies identity resources', () => {
    const ast = makeAst([
      { resource_type: 'aws_iam_role', name: 'lambda_exec' },
      { resource_type: 'aws_iam_policy', name: 'read_only' },
    ]);

    const result = identifyAwsServices([ast]);

    for (const svc of result.identified_services) {
      expect(svc.family).toBe('identity');
    }
  });

  it('flags null_resource as procedural', () => {
    const ast = makeAst([
      { resource_type: 'null_resource', name: 'provisioner' },
    ]);

    const result = identifyAwsServices([ast]);

    expect(result.procedural_resources).toHaveLength(1);
    expect(result.procedural_resources[0]!.resource_type).toBe(
      'null_resource',
    );
    expect(result.procedural_resources[0]!.reason).toContain('Procedural');
    expect(result.identified_services).toHaveLength(0);
  });

  it('flags random_* resources as procedural', () => {
    const ast = makeAst([
      { resource_type: 'random_id', name: 'suffix' },
      { resource_type: 'random_password', name: 'db_pass' },
    ]);

    const result = identifyAwsServices([ast]);

    expect(result.procedural_resources).toHaveLength(2);
  });

  it('flags resources with local-exec provisioner', () => {
    const ast = makeAst([
      {
        resource_type: 'aws_instance',
        name: 'web',
        attributes: {
          provisioner: [{ 'local-exec': [{ command: 'echo hi' }] }],
        },
      },
    ]);

    const result = identifyAwsServices([ast]);

    // The resource is both procedural AND still counted as an AWS resource
    expect(result.procedural_resources).toHaveLength(1);
    expect(result.procedural_resources[0]!.reason).toContain('provisioner');
    expect(result.total_aws_resources).toBe(1);
    expect(result.identified_services).toHaveLength(1);
  });

  it('flags non-AWS resources as unknown providers', () => {
    const ast = makeAst([
      { resource_type: 'google_compute_instance', name: 'gcp_vm' },
      { resource_type: 'azurerm_resource_group', name: 'rg' },
    ]);

    const result = identifyAwsServices([ast]);

    expect(result.unknown_providers).toHaveLength(2);
    expect(result.identified_services).toHaveLength(0);
  });

  it('aggregates counts across multiple files', () => {
    const ast1 = makeAst(
      [
        { resource_type: 'aws_s3_bucket', name: 'data' },
        { resource_type: 'aws_s3_bucket', name: 'logs' },
      ],
      '/tmp/buckets.tf',
    );
    const ast2 = makeAst(
      [{ resource_type: 'aws_s3_bucket', name: 'artifacts' }],
      '/tmp/artifacts.tf',
    );

    const result = identifyAwsServices([ast1, ast2]);

    const s3 = result.identified_services.find(
      (s) => s.resource_type === 'aws_s3_bucket',
    );
    expect(s3).toBeDefined();
    expect(s3!.count).toBe(3);
    expect(s3!.file_paths).toContain('/tmp/buckets.tf');
    expect(s3!.file_paths).toContain('/tmp/artifacts.tf');
  });

  it('handles empty AST array', () => {
    const result = identifyAwsServices([]);

    expect(result.total_resources).toBe(0);
    expect(result.total_aws_resources).toBe(0);
    expect(result.identified_services).toEqual([]);
    expect(result.procedural_resources).toEqual([]);
    expect(result.unknown_providers).toEqual([]);
  });

  it('sorts identified services by count descending', () => {
    const ast = makeAst([
      { resource_type: 'aws_iam_role', name: 'a' },
      { resource_type: 'aws_s3_bucket', name: 'a' },
      { resource_type: 'aws_s3_bucket', name: 'b' },
      { resource_type: 'aws_s3_bucket', name: 'c' },
      { resource_type: 'aws_iam_role', name: 'b' },
    ]);

    const result = identifyAwsServices([ast]);

    expect(result.identified_services[0]!.resource_type).toBe('aws_s3_bucket');
    expect(result.identified_services[0]!.count).toBe(3);
    expect(result.identified_services[1]!.resource_type).toBe('aws_iam_role');
    expect(result.identified_services[1]!.count).toBe(2);
  });

  it('covers all major AWS service families in the prefix map', () => {
    const families = new Set(AWS_RESOURCE_PREFIX_MAP.values());
    const expectedFamilies = [
      'compute',
      'storage',
      'database',
      'networking',
      'security',
      'serverless',
      'messaging',
      'observability',
      'containers',
      'identity',
    ];
    for (const f of expectedFamilies) {
      expect(families.has(f as never)).toBe(true);
    }
  });
});
