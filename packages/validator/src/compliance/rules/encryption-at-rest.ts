// ---------------------------------------------------------------------------
// Compliance rule: encryption_at_rest
// ---------------------------------------------------------------------------

import type { ComplianceRuleDefinition, ComplianceEvalContext, ComplianceResult } from '../types.js';
import { COMPLIANCE_CODES } from '../compliance-codes.js';

const RULE_ID = 'encryption_at_rest';
const SEVERITY = 'warning' as const;

type Checker = (ctx: ComplianceEvalContext) => ComplianceResult | null;

function fail(ctx: ComplianceEvalContext, message: string, detail?: string): ComplianceResult {
  return {
    ruleId: RULE_ID,
    resourceId: ctx.resource.sourceId,
    targetType: ctx.targetType,
    passed: false,
    severity: SEVERITY,
    code: COMPLIANCE_CODES.ENCRYPTION_AT_REST,
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
    code: COMPLIANCE_CODES.ENCRYPTION_AT_REST,
    message: 'Encryption at rest configured',
  };
}

// -- Azure checks -----------------------------------------------------------

const checkAzureStorage: Checker = (ctx) => {
  const cmk = ctx.attributes['customer_managed_key'];
  return cmk ? pass(ctx) : fail(ctx, 'Azure storage account missing customer_managed_key for encryption at rest');
};

const checkAzureSql: Checker = (ctx) => {
  const tde = ctx.attributes['transparent_data_encryption_enabled'];
  return tde === true
    ? pass(ctx)
    : fail(ctx, 'Azure SQL database missing transparent_data_encryption_enabled');
};

const checkAzureManagedDisk: Checker = (ctx) => {
  const enc = ctx.attributes['disk_encryption_set_id'] ?? ctx.attributes['encryption_settings'];
  return enc ? pass(ctx) : fail(ctx, 'Azure managed disk missing disk_encryption_set_id or encryption_settings');
};

const checkAzureKeyVault: Checker = (ctx) => {
  // Key Vault is inherently encrypted; check purge protection
  const purge = ctx.attributes['purge_protection_enabled'];
  return purge === true
    ? pass(ctx)
    : fail(ctx, 'Azure Key Vault missing purge_protection_enabled', 'Purge protection recommended for key material safety');
};

// -- GCP checks -------------------------------------------------------------

const checkGcpSql: Checker = (ctx) => {
  const kmsKey = ctx.attributes['kms_key_name'] ?? ctx.attributes['encryption_key_name'];
  return kmsKey ? pass(ctx) : fail(ctx, 'GCP SQL instance missing kms_key_name for CMEK encryption at rest');
};

const checkGcpStorage: Checker = (ctx) => {
  const enc = ctx.attributes['encryption'];
  const kmsKey = typeof enc === 'object' && enc !== null ? (enc as Record<string, unknown>)['default_kms_key_name'] : undefined;
  return kmsKey ? pass(ctx) : fail(ctx, 'GCP storage bucket missing encryption.default_kms_key_name for CMEK');
};

const checkGcpCompute: Checker = (ctx) => {
  const kmsKey = ctx.attributes['kms_key_self_link'] ?? ctx.attributes['disk_encryption_key'];
  return kmsKey ? pass(ctx) : fail(ctx, 'GCP compute disk missing kms_key_self_link for CMEK encryption at rest');
};

// -- Dispatch table ----------------------------------------------------------

const DISPATCH: Record<string, Checker> = {
  // Azure
  azurerm_storage_account: checkAzureStorage,
  azurerm_mssql_database: checkAzureSql,
  azurerm_mssql_server: checkAzureSql,
  azurerm_managed_disk: checkAzureManagedDisk,
  azurerm_key_vault: checkAzureKeyVault,
  // GCP
  google_sql_database_instance: checkGcpSql,
  google_storage_bucket: checkGcpStorage,
  google_compute_disk: checkGcpCompute,
};

// -- Rule definition ---------------------------------------------------------

export const encryptionAtRest: ComplianceRuleDefinition = {
  id: RULE_ID,
  description: 'Checks that translated resources have encryption at rest configured (CMEK/TDE)',
  severity: SEVERITY,
  evaluate(ctx: ComplianceEvalContext): ComplianceResult | null {
    const checker = DISPATCH[ctx.targetType];
    return checker ? checker(ctx) : null;
  },
};
