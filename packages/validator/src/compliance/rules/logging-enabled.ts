// ---------------------------------------------------------------------------
// Compliance rule: logging_enabled
// ---------------------------------------------------------------------------

import type { ComplianceRuleDefinition, ComplianceEvalContext, ComplianceResult } from '../types.js';
import { COMPLIANCE_CODES } from '../compliance-codes.js';

const RULE_ID = 'logging_enabled';
const SEVERITY = 'warning' as const;

type Checker = (ctx: ComplianceEvalContext) => ComplianceResult | null;

function fail(ctx: ComplianceEvalContext, message: string, detail?: string): ComplianceResult {
  return {
    ruleId: RULE_ID,
    resourceId: ctx.resource.sourceId,
    targetType: ctx.targetType,
    passed: false,
    severity: SEVERITY,
    code: COMPLIANCE_CODES.LOGGING_ENABLED,
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
    code: COMPLIANCE_CODES.LOGGING_ENABLED,
    message: 'Logging/diagnostics configured',
  };
}

// -- Azure checks -----------------------------------------------------------

const checkAzureDiagnosticSetting: Checker = (ctx) => {
  const diag = ctx.attributes['diagnostic_setting'] ?? ctx.attributes['diagnostic_settings'];
  return diag ? pass(ctx) : fail(ctx, `Azure resource ${ctx.targetType} missing diagnostic_setting for logging`);
};

const checkAzureStorageLogging: Checker = (ctx) => {
  const logging = ctx.attributes['logging'] ?? ctx.attributes['queue_properties'];
  const diag = ctx.attributes['diagnostic_setting'] ?? ctx.attributes['diagnostic_settings'];
  return (logging || diag)
    ? pass(ctx)
    : fail(ctx, 'Azure storage account missing logging or diagnostic_setting configuration');
};

// -- GCP checks -------------------------------------------------------------

const checkGcpSubnetwork: Checker = (ctx) => {
  const logConfig = ctx.attributes['log_config'];
  return logConfig ? pass(ctx) : fail(ctx, 'GCP subnetwork missing log_config for VPC flow logs');
};

const checkGcpSql: Checker = (ctx) => {
  const settings = ctx.attributes['settings'] as Record<string, unknown> | undefined;
  const dbFlags = settings?.['database_flags'] as Array<Record<string, unknown>> | undefined;
  const logConfig = settings?.['backup_configuration'];
  const hasAuditLog = Array.isArray(dbFlags) && dbFlags.some((f) => {
    const name = String(f['name'] ?? '');
    return name.includes('log') || name.includes('audit');
  });
  return (hasAuditLog || logConfig)
    ? pass(ctx)
    : fail(ctx, 'GCP SQL instance missing audit logging database flags');
};

const checkGcpComputeFirewall: Checker = (ctx) => {
  const logConfig = ctx.attributes['log_config'];
  return logConfig ? pass(ctx) : fail(ctx, 'GCP firewall rule missing log_config');
};

// -- Dispatch table ----------------------------------------------------------

const DISPATCH: Record<string, Checker> = {
  // Azure
  azurerm_storage_account: checkAzureStorageLogging,
  azurerm_mssql_server: checkAzureDiagnosticSetting,
  azurerm_key_vault: checkAzureDiagnosticSetting,
  azurerm_linux_web_app: checkAzureDiagnosticSetting,
  azurerm_windows_web_app: checkAzureDiagnosticSetting,
  // GCP
  google_compute_subnetwork: checkGcpSubnetwork,
  google_sql_database_instance: checkGcpSql,
  google_compute_firewall: checkGcpComputeFirewall,
};

// -- Rule definition ---------------------------------------------------------

export const loggingEnabled: ComplianceRuleDefinition = {
  id: RULE_ID,
  description: 'Checks that logging/diagnostics are configured on translated resources',
  severity: SEVERITY,
  evaluate(ctx: ComplianceEvalContext): ComplianceResult | null {
    const checker = DISPATCH[ctx.targetType];
    return checker ? checker(ctx) : null;
  },
};
