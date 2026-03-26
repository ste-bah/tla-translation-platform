// ---------------------------------------------------------------------------
// Built-in policy: public_storage_blocked
// ---------------------------------------------------------------------------

import type { PolicyDefinition, PolicyEvalContext, PolicyResult } from '../types.js';
import { POLICY_CODES } from '../policy-codes.js';

const POLICY_ID = 'public_storage_blocked';
const SEVERITY = 'blocker' as const;

const PUBLIC_ACLS = new Set(['public-read', 'public-read-write', 'authenticated-read']);

function fail(ctx: PolicyEvalContext, message: string): PolicyResult {
  return {
    policyId: POLICY_ID,
    resourceId: ctx.resourceId,
    passed: false,
    severity: SEVERITY,
    code: POLICY_CODES.PUBLIC_STORAGE_BLOCKED,
    message,
  };
}

function pass(ctx: PolicyEvalContext, message: string): PolicyResult {
  return {
    policyId: POLICY_ID,
    resourceId: ctx.resourceId,
    passed: true,
    severity: SEVERITY,
    code: POLICY_CODES.PUBLIC_STORAGE_BLOCKED,
    message,
  };
}

const checkS3 = (ctx: PolicyEvalContext): PolicyResult => {
  const acl = ctx.attributes['acl'];
  if (typeof acl === 'string' && PUBLIC_ACLS.has(acl)) {
    return fail(ctx, `S3 bucket has public ACL: ${acl}`);
  }
  return pass(ctx, 'S3 bucket ACL is not public');
};

const checkRds = (ctx: PolicyEvalContext): PolicyResult => {
  if (ctx.attributes['publicly_accessible'] === true) {
    return fail(ctx, 'RDS instance is publicly accessible');
  }
  return pass(ctx, 'RDS instance is not publicly accessible');
};

const DISPATCH: Record<string, (ctx: PolicyEvalContext) => PolicyResult> = {
  aws_s3_bucket: checkS3,
  aws_db_instance: checkRds,
};

export const publicStorageBlocked: PolicyDefinition = {
  id: POLICY_ID,
  description: 'Blocks public storage access (S3 public ACL, RDS publicly accessible)',
  severity: SEVERITY,

  evaluate(ctx: PolicyEvalContext): PolicyResult | null {
    const checker = DISPATCH[ctx.sourceType];
    return checker ? checker(ctx) : null;
  },
};
