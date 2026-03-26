// ---------------------------------------------------------------------------
// Compliance rule: iam_mfa_required
// ---------------------------------------------------------------------------

import type { ComplianceRuleDefinition, ComplianceEvalContext, ComplianceResult } from '../types.js';
import { COMPLIANCE_CODES } from '../compliance-codes.js';

const RULE_ID = 'iam_mfa_required';
const SEVERITY = 'warning' as const;

type Checker = (ctx: ComplianceEvalContext) => ComplianceResult | null;

function fail(ctx: ComplianceEvalContext, message: string, detail?: string): ComplianceResult {
  return {
    ruleId: RULE_ID,
    resourceId: ctx.resource.sourceId,
    targetType: ctx.targetType,
    passed: false,
    severity: SEVERITY,
    code: COMPLIANCE_CODES.IAM_MFA_REQUIRED,
    message,
    detail,
  };
}

function pass(ctx: ComplianceEvalContext): ComplianceResult {
  return {
    ruleId: RULE_ID,
    resourceId: ctx.resource.sourceId,
    targetType: ctx.targetType,
    passed: true,
    severity: SEVERITY,
    code: COMPLIANCE_CODES.IAM_MFA_REQUIRED,
    message: 'MFA/conditional access is configured',
  };
}

// -- Azure checks -----------------------------------------------------------

const checkAzureConditionalAccess: Checker = (ctx) => {
  const grantControls = ctx.attributes['grant_controls'] as Record<string, unknown> | undefined;
  const conditions = ctx.attributes['conditions'] as Record<string, unknown> | undefined;

  if (!grantControls && !conditions) {
    return fail(
      ctx,
      'Azure conditional access policy missing grant_controls',
      'Configure MFA requirement in grant_controls.built_in_controls',
    );
  }

  const builtInControls = grantControls?.['built_in_controls'] as string[] | undefined;
  if (Array.isArray(builtInControls) && builtInControls.includes('mfa')) {
    return pass(ctx);
  }

  return fail(
    ctx,
    'Azure conditional access policy does not require MFA in grant_controls',
    'Add "mfa" to built_in_controls array',
  );
};

// -- GCP checks -------------------------------------------------------------

const checkGcpOrgPolicy: Checker = (ctx) => {
  const constraint = ctx.attributes['constraint'] as string | undefined;
  if (!constraint) return null;

  // Only evaluate MFA-related org policies
  const mfaConstraints = [
    'constraints/iam.allowedPolicyMemberDomains',
    'constraints/iam.disableServiceAccountKeyCreation',
  ];
  if (!mfaConstraints.some((c) => constraint.includes(c))) return null;

  const booleanPolicy = ctx.attributes['boolean_policy'] as Record<string, unknown> | undefined;
  const listPolicy = ctx.attributes['list_policy'] as Record<string, unknown> | undefined;

  if (booleanPolicy || listPolicy) return pass(ctx);

  return fail(
    ctx,
    `GCP org policy ${constraint} is not enforced`,
    'Configure boolean_policy or list_policy to enforce the constraint',
  );
};

// -- Dispatch table ----------------------------------------------------------

const DISPATCH: Record<string, Checker> = {
  // Azure
  azurerm_conditional_access_policy: checkAzureConditionalAccess,
  // GCP
  google_organization_policy: checkGcpOrgPolicy,
  google_project_organization_policy: checkGcpOrgPolicy,
};

// -- Rule definition ---------------------------------------------------------

export const iamMfaRequired: ComplianceRuleDefinition = {
  id: RULE_ID,
  description: 'Checks that MFA / conditional access is configured for identity resources',
  severity: SEVERITY,
  evaluate(ctx: ComplianceEvalContext): ComplianceResult | null {
    const checker = DISPATCH[ctx.targetType];
    return checker ? checker(ctx) : null;
  },
};
