// ---------------------------------------------------------------------------
// Built-in policy: encryption_at_rest
// ---------------------------------------------------------------------------

import type { PolicyDefinition, PolicyEvalContext, PolicyResult } from '../types.js';
import { POLICY_CODES } from '../policy-codes.js';

const POLICY_ID = 'encryption_at_rest';
const SEVERITY = 'warning' as const;

function fail(ctx: PolicyEvalContext, message: string): PolicyResult {
  return {
    policyId: POLICY_ID,
    resourceId: ctx.resourceId,
    passed: false,
    severity: SEVERITY,
    code: POLICY_CODES.ENCRYPTION_AT_REST,
    message,
  };
}

function pass(ctx: PolicyEvalContext, message: string): PolicyResult {
  return {
    policyId: POLICY_ID,
    resourceId: ctx.resourceId,
    passed: true,
    severity: SEVERITY,
    code: POLICY_CODES.ENCRYPTION_AT_REST,
    message,
  };
}

const checkRds = (ctx: PolicyEvalContext): PolicyResult => {
  return ctx.attributes['storage_encrypted'] === true
    ? pass(ctx, 'RDS instance has at-rest encryption enabled')
    : fail(ctx, 'RDS instance missing at-rest encryption (storage_encrypted)');
};

const checkS3 = (ctx: PolicyEvalContext): PolicyResult => {
  const sse = ctx.attributes['server_side_encryption_configuration'];
  return sse
    ? pass(ctx, 'S3 bucket has server-side encryption configured')
    : fail(ctx, 'S3 bucket missing server-side encryption configuration');
};

const checkEc2 = (ctx: PolicyEvalContext): PolicyResult => {
  const rootDevice = ctx.attributes['root_block_device'] as Record<string, unknown> | undefined;
  if (rootDevice && typeof rootDevice === 'object') {
    const encrypted = Array.isArray(rootDevice)
      ? (rootDevice[0] as Record<string, unknown> | undefined)?.['encrypted']
      : rootDevice['encrypted'];
    if (encrypted === true) {
      return pass(ctx, 'EC2 instance root volume is encrypted');
    }
  }
  return fail(ctx, 'EC2 instance root_block_device is not encrypted');
};

const checkElastiCache = (ctx: PolicyEvalContext): PolicyResult => {
  return ctx.attributes['at_rest_encryption_enabled'] === true
    ? pass(ctx, 'ElastiCache has at-rest encryption enabled')
    : fail(ctx, 'ElastiCache missing at_rest_encryption_enabled');
};

const DISPATCH: Record<string, (ctx: PolicyEvalContext) => PolicyResult> = {
  aws_db_instance: checkRds,
  aws_s3_bucket: checkS3,
  aws_instance: checkEc2,
  aws_elasticache_replication_group: checkElastiCache,
  aws_elasticache_cluster: checkElastiCache,
};

export const encryptionAtRest: PolicyDefinition = {
  id: POLICY_ID,
  description: 'Checks that resources have at-rest encryption enabled',
  severity: SEVERITY,

  evaluate(ctx: PolicyEvalContext): PolicyResult | null {
    const checker = DISPATCH[ctx.sourceType];
    return checker ? checker(ctx) : null;
  },
};
