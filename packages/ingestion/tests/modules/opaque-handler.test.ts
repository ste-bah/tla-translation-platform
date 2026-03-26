import { describe, it, expect } from 'vitest';
import { handleOpaqueModule, inferResourceTypes } from '../../src/modules/opaque-handler.js';
import type { HclModuleCall } from '@tla/shared';

const SOURCE = { file: 'main.tf', line: 1, column: 0 };
const META = { source: SOURCE, depends_on: [] };

function makeCall(overrides: Partial<HclModuleCall> = {}): HclModuleCall {
  return {
    name: overrides.name ?? 'test_module',
    source: overrides.source ?? 'hashicorp/consul/aws',
    attributes: overrides.attributes ?? {},
    meta: overrides.meta ?? META,
    version: overrides.version,
  };
}

describe('handleOpaqueModule', () => {
  it('should create an OpaqueRecord with all required fields', () => {
    const call = makeCall({ name: 'vpc', source: 'terraform-aws-modules/vpc/aws' });
    const record = handleOpaqueModule(call, 'vpc', 'registry', 'Not cached locally');

    expect(record.moduleName).toBe('vpc');
    expect(record.callPath).toBe('vpc');
    expect(record.source).toBe('terraform-aws-modules/vpc/aws');
    expect(record.sourceKind).toBe('registry');
    expect(record.reason).toBe('Not cached locally');
    expect(record.reviewRequired).toBe(true);
    expect(Array.isArray(record.inferredResourceTypes)).toBe(true);
  });

  it('should always set reviewRequired to true', () => {
    const record = handleOpaqueModule(makeCall(), 'test', 'opaque', 'unknown');
    expect(record.reviewRequired).toBe(true);
  });

  it('should preserve the full call path for nested modules', () => {
    const call = makeCall({ name: 'subnets' });
    const record = handleOpaqueModule(call, 'vpc.subnets', 'local', 'not found');
    expect(record.callPath).toBe('vpc.subnets');
  });

  it('should infer vpc resource types for vpc-named modules', () => {
    const call = makeCall({ name: 'my_vpc' });
    const record = handleOpaqueModule(call, 'my_vpc', 'registry', 'not cached');
    expect(record.inferredResourceTypes).toContain('aws_vpc');
    expect(record.inferredResourceTypes).toContain('aws_subnet');
  });

  it('should infer rds resource types for rds-named modules', () => {
    const call = makeCall({ name: 'rds_instance' });
    const record = handleOpaqueModule(call, 'rds_instance', 'registry', 'not cached');
    expect(record.inferredResourceTypes).toContain('aws_db_instance');
  });

  it('should return empty inferred types for unrecognized names', () => {
    const call = makeCall({ name: 'custom_thing' });
    const record = handleOpaqueModule(call, 'custom_thing', 'opaque', 'unknown');
    expect(record.inferredResourceTypes).toEqual([]);
  });
});

describe('inferResourceTypes', () => {
  it('should match vpc substring', () => {
    const types = inferResourceTypes('my_vpc_module');
    expect(types).toContain('aws_vpc');
    expect(types).toContain('aws_subnet');
    expect(types).toContain('aws_internet_gateway');
    expect(types).toContain('aws_route_table');
  });

  it('should match rds substring', () => {
    const types = inferResourceTypes('rds_postgres');
    expect(types).toContain('aws_db_instance');
    expect(types).toContain('aws_db_subnet_group');
  });

  it('should match s3 substring', () => {
    const types = inferResourceTypes('s3_bucket');
    expect(types).toContain('aws_s3_bucket');
  });

  it('should match lambda substring', () => {
    const types = inferResourceTypes('lambda_handler');
    expect(types).toContain('aws_lambda_function');
  });

  it('should match ecs substring', () => {
    const types = inferResourceTypes('ecs_service');
    expect(types).toContain('aws_ecs_cluster');
    expect(types).toContain('aws_ecs_service');
  });

  it('should match eks substring', () => {
    const types = inferResourceTypes('eks_cluster');
    expect(types).toContain('aws_eks_cluster');
  });

  it('should match alb substring', () => {
    const types = inferResourceTypes('alb_external');
    expect(types).toContain('aws_lb');
  });

  it('should match iam substring', () => {
    const types = inferResourceTypes('iam_roles');
    expect(types).toContain('aws_iam_role');
    expect(types).toContain('aws_iam_policy');
  });

  it('should match security_group substring', () => {
    const types = inferResourceTypes('web_security_group');
    expect(types).toContain('aws_security_group');
  });

  it('should match dns substring', () => {
    const types = inferResourceTypes('dns_records');
    expect(types).toContain('aws_route53_zone');
    expect(types).toContain('aws_route53_record');
  });

  it('should match sqs substring', () => {
    const types = inferResourceTypes('sqs_queue');
    expect(types).toContain('aws_sqs_queue');
  });

  it('should match sns substring', () => {
    const types = inferResourceTypes('sns_notifications');
    expect(types).toContain('aws_sns_topic');
  });

  it('should match cloudwatch substring', () => {
    const types = inferResourceTypes('cloudwatch_alarms');
    expect(types).toContain('aws_cloudwatch_log_group');
  });

  it('should match ecr substring', () => {
    const types = inferResourceTypes('ecr_repos');
    expect(types).toContain('aws_ecr_repository');
  });

  it('should return empty array for unrecognized names', () => {
    expect(inferResourceTypes('custom_thing')).toEqual([]);
    expect(inferResourceTypes('foobar')).toEqual([]);
  });

  it('should be case-insensitive', () => {
    expect(inferResourceTypes('MyVPC')).toContain('aws_vpc');
    expect(inferResourceTypes('RDS_Cluster')).toContain('aws_db_instance');
  });
});
