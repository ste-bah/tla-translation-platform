// ---------------------------------------------------------------------------
// Compliance rule: network_public_ip
// ---------------------------------------------------------------------------

import type { ComplianceRuleDefinition, ComplianceEvalContext, ComplianceResult } from '../types.js';
import { COMPLIANCE_CODES } from '../compliance-codes.js';

const RULE_ID = 'network_public_ip';
const SEVERITY = 'blocker' as const;

type Checker = (ctx: ComplianceEvalContext) => ComplianceResult | null;

function fail(ctx: ComplianceEvalContext, message: string, detail?: string): ComplianceResult {
  return {
    ruleId: RULE_ID,
    resourceId: ctx.resource.sourceId,
    targetType: ctx.targetType,
    passed: false,
    severity: SEVERITY,
    code: COMPLIANCE_CODES.NETWORK_PUBLIC_IP,
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
    code: COMPLIANCE_CODES.NETWORK_PUBLIC_IP,
    message: 'Public network access is disabled',
  };
}

// -- Azure checks -----------------------------------------------------------

const checkAzurePublicAccess: Checker = (ctx) => {
  const publicAccess = ctx.attributes['public_network_access_enabled'];
  if (publicAccess === true) {
    return fail(ctx, `Azure resource ${ctx.targetType} has public_network_access_enabled = true`);
  }
  return pass(ctx);
};

// -- GCP checks -------------------------------------------------------------

const checkGcpSqlPublicIp: Checker = (ctx) => {
  const settings = ctx.attributes['settings'] as Record<string, unknown> | undefined;
  const ipConfig = settings?.['ip_configuration'] as Record<string, unknown> | undefined;
  const ipv4Enabled = ipConfig?.['ipv4_enabled'];
  if (ipv4Enabled === true) {
    return fail(ctx, 'GCP SQL instance has ipv4_enabled = true (public IP assigned)');
  }
  return pass(ctx);
};

const checkGcpRedisPublic: Checker = (ctx) => {
  const connectMode = ctx.attributes['connect_mode'];
  if (connectMode === 'DIRECT_PEERING') return pass(ctx);
  const authNetwork = ctx.attributes['authorized_network'];
  if (!authNetwork) {
    return fail(ctx, 'GCP Redis instance missing authorized_network (may be publicly accessible)');
  }
  return pass(ctx);
};

// -- Dispatch table ----------------------------------------------------------

const DISPATCH: Record<string, Checker> = {
  // Azure — common resources with public_network_access_enabled
  azurerm_storage_account: checkAzurePublicAccess,
  azurerm_mssql_server: checkAzurePublicAccess,
  azurerm_postgresql_flexible_server: checkAzurePublicAccess,
  azurerm_mysql_flexible_server: checkAzurePublicAccess,
  azurerm_key_vault: checkAzurePublicAccess,
  azurerm_container_registry: checkAzurePublicAccess,
  azurerm_redis_cache: checkAzurePublicAccess,
  // GCP
  google_sql_database_instance: checkGcpSqlPublicIp,
  google_redis_instance: checkGcpRedisPublic,
};

// -- Rule definition ---------------------------------------------------------

export const networkPublicIp: ComplianceRuleDefinition = {
  id: RULE_ID,
  description: 'Blocks public network access / public IP assignment on data resources',
  severity: SEVERITY,
  evaluate(ctx: ComplianceEvalContext): ComplianceResult | null {
    const checker = DISPATCH[ctx.targetType];
    return checker ? checker(ctx) : null;
  },
};
