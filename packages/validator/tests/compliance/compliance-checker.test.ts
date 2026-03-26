import { describe, it, expect } from 'vitest';
import type {
  TranslatedResource,
  ManifestEntry,
  TranslationManifest,
} from '@tla/shared';

import { createComplianceFinding } from '../../src/compliance/compliance-helpers.js';
import { COMPLIANCE_CODES } from '../../src/compliance/compliance-codes.js';
import { checkCompliance } from '../../src/compliance/compliance-engine.js';
import {
  BUILT_IN_RULES,
  CIS_BASIC,
  CIS_ADVANCED,
  encryptionAtRest,
  encryptionInTransit,
  networkOpenIngress,
  networkSshRestricted,
  networkPublicIp,
  loggingEnabled,
  iamAdminPolicy,
  iamMfaRequired,
} from '../../src/compliance/rules/index.js';
import type {
  ComplianceEvalContext,
  ComplianceProfile,
  ComplianceRuleDefinition,
} from '../../src/compliance/types.js';

// ---------------------------------------------------------------------------
// Test factories
// ---------------------------------------------------------------------------

function makeTranslatedResource(
  overrides: Partial<TranslatedResource> & { targetType: string },
): TranslatedResource {
  return {
    targetName: 'test-resource',
    attributes: {},
    sourceId: 'aws_instance.web',
    traceability: {
      sourceId: 'aws_instance.web',
      sourceType: 'aws_instance',
      registryEntryId: null,
      mappingType: 'direct',
      confidence: 0.9,
      engineUsed: 'direct-engine',
    },
    ...overrides,
  };
}

function makeManifestEntry(
  resources: TranslatedResource[],
  overrides: Partial<ManifestEntry> = {},
): ManifestEntry {
  return {
    sourceId: 'aws_instance.web',
    sourceType: 'aws_instance',
    status: 'translated',
    targetResources: resources,
    confidence: 0.9,
    findings: [],
    ...overrides,
  };
}

function makeTranslationManifest(
  entries: ManifestEntry[],
): TranslationManifest {
  return {
    version: '1.0.0',
    registryVersion: '1.0.0',
    target: 'azure',
    counts: {
      total: entries.length,
      translated: entries.length,
      expanded: 0,
      partial: 0,
      blocked: 0,
      advisory: 0,
    },
    entries,
    findings: [],
    confidenceOverall: 0.9,
  };
}

function makeCtx(
  targetType: string,
  attributes: Record<string, unknown> = {},
  sourceId = 'test.resource',
): ComplianceEvalContext {
  const resource = makeTranslatedResource({ targetType, attributes, sourceId });
  return { resource, targetType, targetName: resource.targetName, attributes };
}

// ---------------------------------------------------------------------------
// 1. Compliance Helpers
// ---------------------------------------------------------------------------

describe('Compliance Helpers', () => {
  it('createComplianceFinding creates basic finding', () => {
    const f = createComplianceFinding(
      'res1',
      'warning',
      COMPLIANCE_CODES.ENCRYPTION_AT_REST,
      'Missing encryption',
    );
    expect(f.resourceId).toBe('res1');
    expect(f.severity).toBe('warning');
    expect(f.code).toBe('COMPLIANCE_ENCRYPTION_AT_REST');
    expect(f.message).toBe('Missing encryption');
    expect(f.detail).toBeUndefined();
  });

  it('createComplianceFinding includes detail when provided', () => {
    const f = createComplianceFinding(
      'res2',
      'blocker',
      COMPLIANCE_CODES.NETWORK_OPEN_INGRESS,
      'Open ingress',
      'Rule: allow-all',
    );
    expect(f.detail).toBe('Rule: allow-all');
  });

  it('COMPLIANCE_CODES has exactly 9 entries', () => {
    const keys = Object.keys(COMPLIANCE_CODES);
    expect(keys).toHaveLength(9);
    expect(keys).toContain('ENCRYPTION_AT_REST');
    expect(keys).toContain('ENCRYPTION_IN_TRANSIT');
    expect(keys).toContain('NETWORK_OPEN_INGRESS');
    expect(keys).toContain('NETWORK_SSH_RESTRICTED');
    expect(keys).toContain('NETWORK_PUBLIC_IP');
    expect(keys).toContain('LOGGING_ENABLED');
    expect(keys).toContain('IAM_ADMIN_POLICY');
    expect(keys).toContain('IAM_MFA_REQUIRED');
    expect(keys).toContain('ENGINE_ERROR');
  });
});

// ---------------------------------------------------------------------------
// 2. Encryption At Rest
// ---------------------------------------------------------------------------

describe('encryption_at_rest rule', () => {
  it('Azure storage account passes with customer_managed_key', () => {
    const ctx = makeCtx('azurerm_storage_account', { customer_managed_key: 'key-id' });
    const result = encryptionAtRest.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it('Azure storage account fails without customer_managed_key', () => {
    const ctx = makeCtx('azurerm_storage_account', {});
    const result = encryptionAtRest.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.code).toBe(COMPLIANCE_CODES.ENCRYPTION_AT_REST);
  });

  it('Azure SQL passes with transparent_data_encryption_enabled', () => {
    const ctx = makeCtx('azurerm_mssql_database', { transparent_data_encryption_enabled: true });
    const result = encryptionAtRest.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it('Azure SQL fails without TDE', () => {
    const ctx = makeCtx('azurerm_mssql_database', { transparent_data_encryption_enabled: false });
    const result = encryptionAtRest.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
  });

  it('GCP storage passes with encryption.default_kms_key_name', () => {
    const ctx = makeCtx('google_storage_bucket', {
      encryption: { default_kms_key_name: 'projects/p/locations/l/keyRings/kr/cryptoKeys/k' },
    });
    const result = encryptionAtRest.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });

  it('GCP storage fails without CMEK', () => {
    const ctx = makeCtx('google_storage_bucket', {});
    const result = encryptionAtRest.evaluate(ctx);
    expect(result!.passed).toBe(false);
  });

  it('GCP SQL passes with kms_key_name', () => {
    const ctx = makeCtx('google_sql_database_instance', { kms_key_name: 'projects/p/k' });
    const result = encryptionAtRest.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });

  it('GCP SQL fails without kms_key_name', () => {
    const ctx = makeCtx('google_sql_database_instance', {});
    const result = encryptionAtRest.evaluate(ctx);
    expect(result!.passed).toBe(false);
  });

  it('returns null for non-dispatched resource types', () => {
    const ctx = makeCtx('azurerm_virtual_network', {});
    const result = encryptionAtRest.evaluate(ctx);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Encryption In Transit
// ---------------------------------------------------------------------------

describe('encryption_in_transit rule', () => {
  it('Azure storage passes with https_only', () => {
    const ctx = makeCtx('azurerm_storage_account', { https_only: true });
    const result = encryptionInTransit.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });

  it('Azure storage fails with https_only = false', () => {
    const ctx = makeCtx('azurerm_storage_account', { https_only: false });
    const result = encryptionInTransit.evaluate(ctx);
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain('HTTPS');
  });

  it('Azure storage fails with low TLS version', () => {
    const ctx = makeCtx('azurerm_storage_account', { min_tls_version: 'TLS1_0' });
    const result = encryptionInTransit.evaluate(ctx);
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain('TLS1_0');
  });

  it('GCP SQL passes with require_ssl', () => {
    const ctx = makeCtx('google_sql_database_instance', {
      settings: { ip_configuration: { require_ssl: true } },
    });
    const result = encryptionInTransit.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });

  it('GCP SQL fails with require_ssl = false', () => {
    const ctx = makeCtx('google_sql_database_instance', {
      settings: { ip_configuration: { require_ssl: false } },
    });
    const result = encryptionInTransit.evaluate(ctx);
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain('SSL');
  });

  it('returns null for non-dispatched resource types', () => {
    const ctx = makeCtx('azurerm_virtual_network', {});
    const result = encryptionInTransit.evaluate(ctx);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Network Open Ingress
// ---------------------------------------------------------------------------

describe('network_open_ingress rule', () => {
  it('Azure NSG passes with restricted rules', () => {
    const ctx = makeCtx('azurerm_network_security_group', {
      security_rule: [{
        direction: 'Inbound',
        access: 'Allow',
        source_address_prefix: '10.0.0.0/8',
        destination_port_range: '*',
        name: 'allow-internal',
      }],
    });
    const result = networkOpenIngress.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });

  it('Azure NSG fails with 0.0.0.0/0 on all ports', () => {
    const ctx = makeCtx('azurerm_network_security_group', {
      security_rule: [{
        direction: 'Inbound',
        access: 'Allow',
        source_address_prefix: '0.0.0.0/0',
        destination_port_range: '*',
        name: 'allow-all',
      }],
    });
    const result = networkOpenIngress.evaluate(ctx);
    expect(result!.passed).toBe(false);
    expect(result!.severity).toBe('blocker');
    expect(result!.detail).toContain('allow-all');
  });

  it('GCP firewall passes with restricted source ranges', () => {
    const ctx = makeCtx('google_compute_firewall', {
      direction: 'INGRESS',
      source_ranges: ['10.0.0.0/8'],
      allow: [{ protocol: 'tcp', ports: ['80'] }],
    });
    const result = networkOpenIngress.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });

  it('GCP firewall fails with 0.0.0.0/0 and protocol all', () => {
    const ctx = makeCtx('google_compute_firewall', {
      direction: 'INGRESS',
      source_ranges: ['0.0.0.0/0'],
      allow: [{ protocol: 'all' }],
    });
    const result = networkOpenIngress.evaluate(ctx);
    expect(result!.passed).toBe(false);
    expect(result!.severity).toBe('blocker');
  });

  it('GCP firewall returns null for EGRESS direction', () => {
    const ctx = makeCtx('google_compute_firewall', { direction: 'EGRESS' });
    const result = networkOpenIngress.evaluate(ctx);
    expect(result).toBeNull();
  });

  it('GCP firewall fails with open source and no ports specified', () => {
    const ctx = makeCtx('google_compute_firewall', {
      direction: 'INGRESS',
      source_ranges: ['0.0.0.0/0'],
      allow: [{ protocol: 'tcp' }],
    });
    const result = networkOpenIngress.evaluate(ctx);
    expect(result!.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Network SSH Restricted
// ---------------------------------------------------------------------------

describe('network_ssh_restricted rule', () => {
  it('Azure NSG passes when port 22 not open to world', () => {
    const ctx = makeCtx('azurerm_network_security_group', {
      security_rule: [{
        direction: 'Inbound',
        access: 'Allow',
        source_address_prefix: '10.0.0.0/8',
        destination_port_range: '22',
        name: 'ssh-internal',
      }],
    });
    const result = networkSshRestricted.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });

  it('Azure NSG fails when port 22 open to 0.0.0.0/0', () => {
    const ctx = makeCtx('azurerm_network_security_group', {
      security_rule: [{
        direction: 'Inbound',
        access: 'Allow',
        source_address_prefix: '0.0.0.0/0',
        destination_port_range: '22',
        name: 'ssh-open',
      }],
    });
    const result = networkSshRestricted.evaluate(ctx);
    expect(result!.passed).toBe(false);
    expect(result!.severity).toBe('blocker');
  });

  it('Azure NSG fails when port range includes 22', () => {
    const ctx = makeCtx('azurerm_network_security_group', {
      security_rule: [{
        direction: 'Inbound',
        access: 'Allow',
        source_address_prefix: '0.0.0.0/0',
        destination_port_range: '20-25',
        name: 'range-includes-ssh',
      }],
    });
    const result = networkSshRestricted.evaluate(ctx);
    expect(result!.passed).toBe(false);
  });

  it('GCP firewall passes when SSH restricted', () => {
    const ctx = makeCtx('google_compute_firewall', {
      direction: 'INGRESS',
      source_ranges: ['10.0.0.0/8'],
      allow: [{ protocol: 'tcp', ports: ['22'] }],
    });
    const result = networkSshRestricted.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });

  it('GCP firewall fails when SSH open to world', () => {
    const ctx = makeCtx('google_compute_firewall', {
      direction: 'INGRESS',
      source_ranges: ['0.0.0.0/0'],
      allow: [{ protocol: 'tcp', ports: ['22'] }],
    });
    const result = networkSshRestricted.evaluate(ctx);
    expect(result!.passed).toBe(false);
  });

  it('GCP firewall fails when protocol all from 0.0.0.0/0', () => {
    const ctx = makeCtx('google_compute_firewall', {
      direction: 'INGRESS',
      source_ranges: ['0.0.0.0/0'],
      allow: [{ protocol: 'all' }],
    });
    const result = networkSshRestricted.evaluate(ctx);
    expect(result!.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Network Public IP
// ---------------------------------------------------------------------------

describe('network_public_ip rule', () => {
  it('Azure passes with public_network_access_enabled = false', () => {
    const ctx = makeCtx('azurerm_storage_account', { public_network_access_enabled: false });
    const result = networkPublicIp.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });

  it('Azure fails with public_network_access_enabled = true', () => {
    const ctx = makeCtx('azurerm_storage_account', { public_network_access_enabled: true });
    const result = networkPublicIp.evaluate(ctx);
    expect(result!.passed).toBe(false);
    expect(result!.severity).toBe('blocker');
  });

  it('GCP SQL passes with ipv4_enabled = false', () => {
    const ctx = makeCtx('google_sql_database_instance', {
      settings: { ip_configuration: { ipv4_enabled: false } },
    });
    const result = networkPublicIp.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });

  it('GCP SQL fails with ipv4_enabled = true', () => {
    const ctx = makeCtx('google_sql_database_instance', {
      settings: { ip_configuration: { ipv4_enabled: true } },
    });
    const result = networkPublicIp.evaluate(ctx);
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain('ipv4_enabled');
  });

  it('GCP Redis passes with connect_mode = DIRECT_PEERING', () => {
    const ctx = makeCtx('google_redis_instance', { connect_mode: 'DIRECT_PEERING' });
    const result = networkPublicIp.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Logging Enabled
// ---------------------------------------------------------------------------

describe('logging_enabled rule', () => {
  it('Azure storage passes with diagnostic_setting', () => {
    const ctx = makeCtx('azurerm_storage_account', { diagnostic_setting: { id: 'ds1' } });
    const result = loggingEnabled.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });

  it('Azure storage fails without logging or diagnostic', () => {
    const ctx = makeCtx('azurerm_storage_account', {});
    const result = loggingEnabled.evaluate(ctx);
    expect(result!.passed).toBe(false);
    expect(result!.code).toBe(COMPLIANCE_CODES.LOGGING_ENABLED);
  });

  it('Azure storage passes with logging attribute', () => {
    const ctx = makeCtx('azurerm_storage_account', { logging: { read: true } });
    const result = loggingEnabled.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });

  it('GCP subnetwork passes with log_config', () => {
    const ctx = makeCtx('google_compute_subnetwork', { log_config: { aggregation_interval: 'INTERVAL_5_SEC' } });
    const result = loggingEnabled.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });

  it('GCP subnetwork fails without log_config', () => {
    const ctx = makeCtx('google_compute_subnetwork', {});
    const result = loggingEnabled.evaluate(ctx);
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain('VPC flow logs');
  });

  it('GCP firewall passes with log_config', () => {
    const ctx = makeCtx('google_compute_firewall', { log_config: { metadata: 'INCLUDE_ALL_METADATA' } });
    const result = loggingEnabled.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });

  it('GCP firewall fails without log_config', () => {
    const ctx = makeCtx('google_compute_firewall', {});
    const result = loggingEnabled.evaluate(ctx);
    expect(result!.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. IAM Admin Policy
// ---------------------------------------------------------------------------

describe('iam_admin_policy rule', () => {
  it('Azure role assignment passes with restricted role', () => {
    const ctx = makeCtx('azurerm_role_assignment', { role_definition_name: 'Reader' });
    const result = iamAdminPolicy.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });

  it('Azure role assignment fails with Owner role', () => {
    const ctx = makeCtx('azurerm_role_assignment', { role_definition_name: 'Owner' });
    const result = iamAdminPolicy.evaluate(ctx);
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain('Owner');
  });

  it('Azure role definition fails with wildcard actions', () => {
    const ctx = makeCtx('azurerm_role_definition', {
      permissions: [{ actions: ['*'] }],
    });
    const result = iamAdminPolicy.evaluate(ctx);
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain('wildcard');
  });

  it('GCP IAM binding fails with roles/owner', () => {
    const ctx = makeCtx('google_project_iam_binding', { role: 'roles/owner' });
    const result = iamAdminPolicy.evaluate(ctx);
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain('roles/owner');
  });

  it('GCP IAM member passes with restrictive role', () => {
    const ctx = makeCtx('google_project_iam_member', { role: 'roles/viewer' });
    const result = iamAdminPolicy.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. IAM MFA Required
// ---------------------------------------------------------------------------

describe('iam_mfa_required rule', () => {
  it('Azure conditional access passes with MFA in grant_controls', () => {
    const ctx = makeCtx('azurerm_conditional_access_policy', {
      grant_controls: { built_in_controls: ['mfa'] },
    });
    const result = iamMfaRequired.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });

  it('Azure conditional access fails without MFA', () => {
    const ctx = makeCtx('azurerm_conditional_access_policy', {
      grant_controls: { built_in_controls: ['block'] },
    });
    const result = iamMfaRequired.evaluate(ctx);
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain('MFA');
  });

  it('Azure conditional access fails with no grant_controls', () => {
    const ctx = makeCtx('azurerm_conditional_access_policy', {});
    const result = iamMfaRequired.evaluate(ctx);
    expect(result!.passed).toBe(false);
  });

  it('GCP org policy passes with boolean_policy set', () => {
    const ctx = makeCtx('google_organization_policy', {
      constraint: 'constraints/iam.disableServiceAccountKeyCreation',
      boolean_policy: { enforced: true },
    });
    const result = iamMfaRequired.evaluate(ctx);
    expect(result!.passed).toBe(true);
  });

  it('GCP org policy fails without enforcement', () => {
    const ctx = makeCtx('google_organization_policy', {
      constraint: 'constraints/iam.disableServiceAccountKeyCreation',
    });
    const result = iamMfaRequired.evaluate(ctx);
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain('not enforced');
  });

  it('GCP org policy returns null for non-MFA constraints', () => {
    const ctx = makeCtx('google_organization_policy', {
      constraint: 'constraints/compute.disableSerialPortAccess',
    });
    const result = iamMfaRequired.evaluate(ctx);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 10. Compliance Engine (Orchestrator)
// ---------------------------------------------------------------------------

describe('checkCompliance orchestrator', () => {
  it('returns 100 score for empty manifest', () => {
    const manifest = makeTranslationManifest([]);
    const report = checkCompliance(manifest, CIS_BASIC);
    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(0);
    expect(report.findings).toHaveLength(0);
    expect(report.summary.total).toBe(0);
    expect(report.summary.applicable).toBe(0);
  });

  it('CIS_BASIC profile has 5 rules', () => {
    expect(CIS_BASIC.rules).toHaveLength(5);
    expect(CIS_BASIC.name).toBe('cis-basic');
  });

  it('CIS_ADVANCED profile has all 8 rules', () => {
    expect(CIS_ADVANCED.rules).toHaveLength(8);
    expect(BUILT_IN_RULES).toHaveLength(8);
  });

  it('mixed results compute correct score', () => {
    const passingResource = makeTranslatedResource({
      targetType: 'azurerm_storage_account',
      attributes: { customer_managed_key: 'key-id' },
      sourceId: 'aws_s3.pass',
    });
    const failingResource = makeTranslatedResource({
      targetType: 'azurerm_storage_account',
      attributes: {},
      sourceId: 'aws_s3.fail',
    });

    // Use a single-rule profile for predictable scoring
    const singleRuleProfile: ComplianceProfile = {
      name: 'test-enc',
      description: 'test',
      rules: [encryptionAtRest],
    };

    const manifest = makeTranslationManifest([
      makeManifestEntry([passingResource], { sourceId: 'aws_s3.pass' }),
      makeManifestEntry([failingResource], { sourceId: 'aws_s3.fail' }),
    ]);

    const report = checkCompliance(manifest, singleRuleProfile);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(1);
    expect(report.summary.applicable).toBe(2);
    expect(report.score).toBe(50);
    expect(report.passed).toBe(false);
    expect(report.findings).toHaveLength(1); // only failures become findings
  });

  it('score calculation: all passing = 100, passed = true', () => {
    const resource = makeTranslatedResource({
      targetType: 'azurerm_storage_account',
      attributes: { customer_managed_key: 'k', https_only: true, diagnostic_setting: {} },
      sourceId: 'aws_s3.ok',
    });

    const profile: ComplianceProfile = {
      name: 'test',
      description: 'test',
      rules: [encryptionAtRest],
    };

    const manifest = makeTranslationManifest([
      makeManifestEntry([resource], { sourceId: 'aws_s3.ok' }),
    ]);

    const report = checkCompliance(manifest, profile);
    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
    expect(report.findings).toHaveLength(0);
  });

  it('never throws even if a rule throws', () => {
    const throwingRule: ComplianceRuleDefinition = {
      id: 'throwing-rule',
      description: 'always throws',
      severity: 'warning',
      evaluate(): never {
        throw new Error('boom');
      },
    };

    const profile: ComplianceProfile = {
      name: 'throw-test',
      description: 'test',
      rules: [throwingRule],
    };

    const resource = makeTranslatedResource({
      targetType: 'azurerm_storage_account',
      attributes: {},
      sourceId: 'aws_s3.err',
    });
    const manifest = makeTranslationManifest([
      makeManifestEntry([resource], { sourceId: 'aws_s3.err' }),
    ]);

    const report = checkCompliance(manifest, profile);
    // Should not throw — captured as ENGINE_ERROR
    expect(report.passed).toBe(false);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]!.code).toBe(COMPLIANCE_CODES.ENGINE_ERROR);
    expect(report.results[0]!.passed).toBe(false);
    expect(report.findings).toHaveLength(1);
  });

  it('skips resources not matched by any rule', () => {
    const resource = makeTranslatedResource({
      targetType: 'azurerm_virtual_network',
      attributes: {},
      sourceId: 'aws_vpc.main',
    });
    const manifest = makeTranslationManifest([
      makeManifestEntry([resource], { sourceId: 'aws_vpc.main' }),
    ]);

    const report = checkCompliance(manifest, CIS_ADVANCED);
    // virtual_network not in any dispatch table → 0 results
    expect(report.results).toHaveLength(0);
    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
  });
});
