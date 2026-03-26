import { describe, it, expect } from 'vitest';
import {
  resolveRegistryKey,
  RESOURCE_TYPE_REGISTRY_MAP,
} from '../../src/ir/resource-type-registry-map.js';

describe('RESOURCE_TYPE_REGISTRY_MAP', () => {
  it('is a read-only Map', () => {
    expect(RESOURCE_TYPE_REGISTRY_MAP).toBeInstanceOf(Map);
    // ReadonlyMap should not expose set/delete at type level,
    // but verify the runtime Map has expected entries.
    expect(RESOURCE_TYPE_REGISTRY_MAP.size).toBeGreaterThan(0);
  });

  it('contains expected compute entries', () => {
    expect(RESOURCE_TYPE_REGISTRY_MAP.get('aws_instance')).toBe('ec2');
    expect(RESOURCE_TYPE_REGISTRY_MAP.get('aws_ec2')).toBe('ec2');
    expect(RESOURCE_TYPE_REGISTRY_MAP.get('aws_launch_template')).toBe('ec2');
    expect(RESOURCE_TYPE_REGISTRY_MAP.get('aws_ami')).toBe('ec2');
  });

  it('contains expected storage entries', () => {
    expect(RESOURCE_TYPE_REGISTRY_MAP.get('aws_s3')).toBe('s3');
    expect(RESOURCE_TYPE_REGISTRY_MAP.get('aws_efs')).toBe('efs');
    expect(RESOURCE_TYPE_REGISTRY_MAP.get('aws_ebs')).toBe('ebs');
  });

  it('contains expected networking entries', () => {
    expect(RESOURCE_TYPE_REGISTRY_MAP.get('aws_vpc')).toBe('vpc');
    expect(RESOURCE_TYPE_REGISTRY_MAP.get('aws_subnet')).toBe('subnet');
    expect(RESOURCE_TYPE_REGISTRY_MAP.get('aws_route53')).toBe('route53');
    expect(RESOURCE_TYPE_REGISTRY_MAP.get('aws_cloudfront')).toBe('cloudfront');
  });
});

describe('resolveRegistryKey', () => {
  // ---- Exact matches ----

  it('returns exact match for known prefix', () => {
    expect(resolveRegistryKey('aws_s3')).toBe('s3');
    expect(resolveRegistryKey('aws_instance')).toBe('ec2');
    expect(resolveRegistryKey('aws_vpc')).toBe('vpc');
  });

  // ---- Progressive prefix fallback ----

  it('resolves aws_s3_bucket via prefix fallback to s3', () => {
    expect(resolveRegistryKey('aws_s3_bucket')).toBe('s3');
  });

  it('resolves aws_s3_bucket_policy via prefix fallback to s3', () => {
    expect(resolveRegistryKey('aws_s3_bucket_policy')).toBe('s3');
  });

  it('resolves aws_security_group_rule via prefix fallback to security_group', () => {
    expect(resolveRegistryKey('aws_security_group_rule')).toBe('security_group');
  });

  it('resolves deeply nested type via progressive stripping', () => {
    // aws_rds_cluster_instance -> strip _instance -> aws_rds_cluster -> strip _cluster -> aws_rds -> 'rds'
    expect(resolveRegistryKey('aws_rds_cluster_instance')).toBe('rds');
  });

  it('resolves aws_lambda_function to lambda', () => {
    expect(resolveRegistryKey('aws_lambda_function')).toBe('lambda');
  });

  it('resolves aws_ecs_service to ecs', () => {
    expect(resolveRegistryKey('aws_ecs_service')).toBe('ecs');
  });

  it('resolves aws_dynamodb_table to dynamodb', () => {
    expect(resolveRegistryKey('aws_dynamodb_table')).toBe('dynamodb');
  });

  // ---- Ambiguous / ALB vs ELB ----

  it('resolves aws_lb_target_group to alb', () => {
    expect(resolveRegistryKey('aws_lb_target_group')).toBe('alb');
  });

  it('resolves aws_alb_listener to alb', () => {
    expect(resolveRegistryKey('aws_alb_listener')).toBe('alb');
  });

  // ---- Route table and internet gateway map to VPC ----

  it('resolves aws_internet_gateway to vpc', () => {
    expect(resolveRegistryKey('aws_internet_gateway')).toBe('vpc');
  });

  it('resolves aws_route_table_association to vpc', () => {
    expect(resolveRegistryKey('aws_route_table_association')).toBe('vpc');
  });

  // ---- No match cases ----

  it('returns undefined for non-AWS provider types', () => {
    expect(resolveRegistryKey('google_storage_bucket')).toBeUndefined();
    expect(resolveRegistryKey('azurerm_resource_group')).toBeUndefined();
  });

  it('returns undefined for completely unknown type', () => {
    expect(resolveRegistryKey('not_a_real_resource')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(resolveRegistryKey('')).toBeUndefined();
  });

  it('returns undefined for single-segment string with no underscore', () => {
    expect(resolveRegistryKey('aws')).toBeUndefined();
  });

  // ---- Edge cases ----

  it('does not match partial prefix (aws_ alone is not in map)', () => {
    // 'aws' is not a key in the map; stripping segments from 'aws_foobar'
    // yields 'aws' which has no underscore -> breaks loop -> undefined
    expect(resolveRegistryKey('aws_foobar')).toBeUndefined();
  });

  it('handles type with trailing underscore gracefully', () => {
    // 'aws_s3_' -> strip '_' -> 'aws_s3' -> match
    expect(resolveRegistryKey('aws_s3_')).toBe('s3');
  });

  it('handles type that is only underscores', () => {
    expect(resolveRegistryKey('___')).toBeUndefined();
  });

  it('prefers exact match over prefix fallback', () => {
    // aws_vpc_peering is an exact key -> 'vpc_peering', not 'vpc'
    expect(resolveRegistryKey('aws_vpc_peering')).toBe('vpc_peering');
  });

  it('differentiates db (rds) from dynamodb', () => {
    expect(resolveRegistryKey('aws_db_instance')).toBe('rds');
    expect(resolveRegistryKey('aws_dynamodb_table')).toBe('dynamodb');
  });

  it('differentiates elasticache from ec2', () => {
    expect(resolveRegistryKey('aws_elasticache_cluster')).toBe('elasticache_redis');
  });
});
