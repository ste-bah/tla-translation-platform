// ---------------------------------------------------------------------------
// Compliance rule: iam_admin_policy
// ---------------------------------------------------------------------------

import type { ComplianceRuleDefinition, ComplianceEvalContext, ComplianceResult } from '../types.js';
import { COMPLIANCE_CODES } from '../compliance-codes.js';

const RULE_ID = 'iam_admin_policy';
const SEVERITY = 'warning' as const;

type Checker = (ctx: ComplianceEvalContext) => ComplianceResult | null;

function fail(ctx: ComplianceEvalContext, message: string, detail?: string): ComplianceResult {
  return {
    ruleId: RULE_ID,
    resourceId: ctx.resource.sourceId,
    targetType: ctx.targetType,
    passed: false,
    severity: SEVERITY,
    code: COMPLIANCE_CODES.IAM_ADMIN_POLICY,
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
    code: COMPLIANCE_CODES.IAM_ADMIN_POLICY,
    message: 'No overly permissive IAM admin role detected',
  };
}

// -- Azure checks -----------------------------------------------------------

const AZURE_WILDCARD_PATTERNS = ['*', 'Owner', 'Contributor'];

const checkAzureRoleAssignment: Checker = (ctx) => {
  const roleDefId = ctx.attributes['role_definition_id'] as string | undefined;
  const roleName = ctx.attributes['role_definition_name'] as string | undefined;

  const effective = roleName ?? roleDefId ?? '';
  if (AZURE_WILDCARD_PATTERNS.some((p) => effective.includes(p))) {
    return fail(
      ctx,
      `Azure role assignment uses overly permissive role: ${effective}`,
      'Consider using least-privilege role definitions',
    );
  }
  return pass(ctx);
};

const checkAzureRoleDefinition: Checker = (ctx) => {
  const permissions = ctx.attributes['permissions'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(permissions)) return pass(ctx);

  for (const perm of permissions) {
    const actions = perm['actions'] as string[] | undefined;
    if (Array.isArray(actions) && actions.includes('*')) {
      return fail(
        ctx,
        'Azure custom role definition grants wildcard (*) actions',
        'Restrict actions to specific resource providers and operations',
      );
    }
  }
  return pass(ctx);
};

// -- GCP checks -------------------------------------------------------------

const GCP_ADMIN_ROLES = [
  'roles/owner',
  'roles/editor',
  'roles/iam.securityAdmin',
  'roles/resourcemanager.organizationAdmin',
];

const checkGcpIamRole: Checker = (ctx) => {
  const role = ctx.attributes['role'] as string | undefined;
  if (!role) return pass(ctx);

  if (GCP_ADMIN_ROLES.includes(role)) {
    return fail(
      ctx,
      `GCP IAM binding/member uses overly permissive role: ${role}`,
      'Consider using more restrictive predefined or custom roles',
    );
  }
  return pass(ctx);
};

// -- Dispatch table ----------------------------------------------------------

const DISPATCH: Record<string, Checker> = {
  // Azure
  azurerm_role_assignment: checkAzureRoleAssignment,
  azurerm_role_definition: checkAzureRoleDefinition,
  // GCP
  google_project_iam_binding: checkGcpIamRole,
  google_project_iam_member: checkGcpIamRole,
  google_organization_iam_binding: checkGcpIamRole,
  google_organization_iam_member: checkGcpIamRole,
};

// -- Rule definition ---------------------------------------------------------

export const iamAdminPolicy: ComplianceRuleDefinition = {
  id: RULE_ID,
  description: 'Detects overly permissive IAM roles (wildcard actions, roles/owner)',
  severity: SEVERITY,
  evaluate(ctx: ComplianceEvalContext): ComplianceResult | null {
    const checker = DISPATCH[ctx.targetType];
    return checker ? checker(ctx) : null;
  },
};
