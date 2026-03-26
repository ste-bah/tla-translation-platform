// ---------------------------------------------------------------------------
// Compliance rule: encryption_in_transit
// ---------------------------------------------------------------------------

import type { ComplianceRuleDefinition, ComplianceEvalContext, ComplianceResult } from '../types.js';
import { COMPLIANCE_CODES } from '../compliance-codes.js';

const RULE_ID = 'encryption_in_transit';
const SEVERITY = 'warning' as const;

type Checker = (ctx: ComplianceEvalContext) => ComplianceResult | null;

function fail(ctx: ComplianceEvalContext, message: string, detail?: string): ComplianceResult {
  return {
    ruleId: RULE_ID,
    resourceId: ctx.resource.sourceId,
    targetType: ctx.targetType,
    passed: false,
    severity: SEVERITY,
    code: COMPLIANCE_CODES.ENCRYPTION_IN_TRANSIT,
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
    code: COMPLIANCE_CODES.ENCRYPTION_IN_TRANSIT,
    message: 'Encryption in transit configured',
  };
}

// -- Azure checks -----------------------------------------------------------

const checkAzureStorage: Checker = (ctx) => {
  const httpsOnly = ctx.attributes['https_only'] ?? ctx.attributes['enable_https_traffic_only'];
  const minTls = ctx.attributes['min_tls_version'];
  if (httpsOnly === false) {
    return fail(ctx, 'Azure storage account does not enforce HTTPS-only traffic');
  }
  if (minTls && typeof minTls === 'string' && minTls < 'TLS1_2') {
    return fail(ctx, `Azure storage account min_tls_version is ${minTls}, should be TLS1_2 or higher`);
  }
  return pass(ctx);
};

const checkAzureAppService: Checker = (ctx) => {
  const httpsOnly = ctx.attributes['https_only'];
  const minTls = ctx.attributes['minimum_tls_version'] ?? ctx.attributes['min_tls_version'];
  if (httpsOnly === false) {
    return fail(ctx, 'Azure App Service does not enforce HTTPS-only');
  }
  if (minTls && typeof minTls === 'string' && minTls < '1.2') {
    return fail(ctx, `Azure App Service minimum_tls_version is ${minTls}, should be 1.2 or higher`);
  }
  return pass(ctx);
};

const checkAzureSql: Checker = (ctx) => {
  const minTls = ctx.attributes['minimum_tls_version'] ?? ctx.attributes['min_tls_version'];
  if (minTls && typeof minTls === 'string' && minTls < '1.2') {
    return fail(ctx, `Azure SQL minimum_tls_version is ${minTls}, should be 1.2 or higher`);
  }
  return pass(ctx);
};

// -- GCP checks -------------------------------------------------------------

const checkGcpSql: Checker = (ctx) => {
  const settings = ctx.attributes['settings'] as Record<string, unknown> | undefined;
  const ipConfig = settings?.['ip_configuration'] as Record<string, unknown> | undefined;
  const requireSsl = ipConfig?.['require_ssl'] ?? ipConfig?.['ssl_mode'];
  if (requireSsl === false || requireSsl === 'ALLOW_UNENCRYPTED_AND_ENCRYPTED') {
    return fail(ctx, 'GCP SQL instance does not require SSL connections');
  }
  return pass(ctx);
};

const checkGcpAppEngine: Checker = (ctx) => {
  // App Engine enforces HTTPS by default; check redirect
  const handlers = ctx.attributes['handlers'] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(handlers)) {
    const insecure = handlers.some((h) => h['security_level'] === 'SECURE_NEVER');
    if (insecure) {
      return fail(ctx, 'GCP App Engine has handlers with security_level SECURE_NEVER');
    }
  }
  return pass(ctx);
};

// -- Dispatch table ----------------------------------------------------------

const DISPATCH: Record<string, Checker> = {
  // Azure
  azurerm_storage_account: checkAzureStorage,
  azurerm_linux_web_app: checkAzureAppService,
  azurerm_windows_web_app: checkAzureAppService,
  azurerm_mssql_server: checkAzureSql,
  azurerm_postgresql_flexible_server: checkAzureSql,
  azurerm_mysql_flexible_server: checkAzureSql,
  // GCP
  google_sql_database_instance: checkGcpSql,
  google_app_engine_standard_app_version: checkGcpAppEngine,
  google_app_engine_flexible_app_version: checkGcpAppEngine,
};

// -- Rule definition ---------------------------------------------------------

export const encryptionInTransit: ComplianceRuleDefinition = {
  id: RULE_ID,
  description: 'Checks that translated resources enforce encryption in transit (HTTPS, TLS 1.2+)',
  severity: SEVERITY,
  evaluate(ctx: ComplianceEvalContext): ComplianceResult | null {
    const checker = DISPATCH[ctx.targetType];
    return checker ? checker(ctx) : null;
  },
};
