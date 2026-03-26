// ---------------------------------------------------------------------------
// Built-in policy: encryption_required
// ---------------------------------------------------------------------------

import type { PolicyDefinition, PolicyEvalContext, PolicyResult } from '../types.js';
import { POLICY_CODES } from '../policy-codes.js';

const POLICY_ID = 'encryption_required';
const SEVERITY = 'warning' as const;

type Checker = (ctx: PolicyEvalContext) => PolicyResult | null;

function fail(ctx: PolicyEvalContext, message: string, detail?: string): PolicyResult {
  return {
    policyId: POLICY_ID,
    resourceId: ctx.resourceId,
    passed: false,
    severity: SEVERITY,
    code: POLICY_CODES.ENCRYPTION_REQUIRED,
    message,
    detail,
  };
}

function pass(ctx: PolicyEvalContext): PolicyResult {
  return {
    policyId: POLICY_ID,
    resourceId: ctx.resourceId,
    passed: true,
    severity: SEVERITY,
    code: POLICY_CODES.ENCRYPTION_REQUIRED,
    message: 'Encryption configuration present',
  };
}

// -- Per-sourceType checks ---------------------------------------------------

const checkS3: Checker = (ctx) => {
  const sse = ctx.attributes['server_side_encryption_configuration'];
  return sse ? pass(ctx) : fail(ctx, 'S3 bucket missing server-side encryption configuration');
};

const checkRds: Checker = (ctx) => {
  return ctx.attributes['storage_encrypted'] === true
    ? pass(ctx)
    : fail(ctx, 'RDS instance does not have storage_encrypted enabled');
};

const checkElastiCache: Checker = (ctx) => {
  return ctx.attributes['transit_encryption_enabled'] === true
    ? pass(ctx)
    : fail(ctx, 'ElastiCache cluster does not have transit_encryption_enabled');
};

const checkEcr: Checker = (ctx) => {
  const enc = ctx.attributes['encryption_configuration'];
  return enc ? pass(ctx) : fail(ctx, 'ECR repository missing encryption_configuration');
};

const checkEks: Checker = (ctx) => {
  const enc = ctx.attributes['encryption_config'];
  return enc ? pass(ctx) : fail(ctx, 'EKS cluster missing encryption_config');
};

const checkSecretsManager: Checker = (ctx) => {
  const kmsKey = ctx.attributes['kms_key_id'];
  return kmsKey ? pass(ctx) : fail(ctx, 'Secrets Manager secret missing kms_key_id (uses default key)');
};

// -- Dispatch table ----------------------------------------------------------

const DISPATCH: Record<string, Checker> = {
  aws_s3_bucket: checkS3,
  aws_db_instance: checkRds,
  aws_elasticache_replication_group: checkElastiCache,
  aws_elasticache_cluster: checkElastiCache,
  aws_ecr_repository: checkEcr,
  aws_eks_cluster: checkEks,
  aws_secretsmanager_secret: checkSecretsManager,
};

// -- Policy definition -------------------------------------------------------

export const encryptionRequired: PolicyDefinition = {
  id: POLICY_ID,
  description: 'Checks that resources have encryption configured',
  severity: SEVERITY,
  evaluate(ctx: PolicyEvalContext): PolicyResult | null {
    const checker = DISPATCH[ctx.sourceType];
    return checker ? checker(ctx) : null;
  },
};
