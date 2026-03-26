/**
 * Enhanced RDS translation tests covering:
 * - resolveParameterGroup (parameter mapping per engine)
 * - Oracle advisory gate
 * - publicly_accessible BLOCKER gate
 * - Multi-AZ handling (Azure + GCP)
 * - Backup + Encryption
 * - Engine dispatch (postgres/mysql/sqlserver Azure, postgres GCP)
 * - Edge cases (deletion_protection, tags, unknown instance class, COMPOUND_EXPANSION)
 *
 * @module tests/engines/rds-enhanced
 */

import { describe, it, expect, vi } from 'vitest';
import { translateRds } from '../../src/engines/compound/rds-mapping.js';
import { resolveParameterGroup } from '../../src/engines/compound/rds-parameter-group.js';
import type { TranslationContext } from '../../src/engines/mapping-engine.js';
import type {
  IrResource,
  RegistryEntry,
  CanonicalIR,
  CloudProvider,
  CompilerOptions,
} from '@tla/shared';
import type { RegistryApi } from '@tla/registry';

// ---------------------------------------------------------------------------
// Factory helpers (mirrored from compound-engine.test.ts)
// ---------------------------------------------------------------------------

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'res-rds-001',
    sourceType: 'aws_db_instance',
    sourceName: 'my_db',
    sourceModule: null,
    category: 'database',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: 'SER-DB-RDS-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-DB-RDS-001',
    aws_service: 'aws_db_instance',
    aws_family: 'database',
    azure_targets: ['azurerm_postgresql_flexible_server'],
    gcp_targets: ['google_sql_database_instance'],
    mapping_type: 'compound',
    output_mode: 'native_emit_only',
    band: 'P2',
    confidence: 0.9,
    portable_provider_candidate: false,
    behavioral_gaps: [],
    manual_review_required: false,
    review_domains: [],
    test_status: 'unit_tested',
    owner: 'team-infra',
    registry_version: '2025.03.01',
    last_updated: '2025-03-01T00:00:00Z',
    related_requirements: [],
    related_edge_cases: [],
    ...overrides,
  };
}

function makeMockRegistry(): RegistryApi {
  return {
    lookup: vi.fn().mockReturnValue(undefined),
    lookupMany: vi.fn().mockReturnValue(new Map()),
  } as unknown as RegistryApi;
}

function makeCompilerOptions(overrides: Partial<CompilerOptions> = {}): CompilerOptions {
  return {
    targetProvider: 'azure',
    registryVersion: '2025.03.01',
    emitComments: true,
    sortKeys: true,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<TranslationContext> = {}): TranslationContext {
  const resource = overrides.resource ?? makeIrResource({ attributes: { engine: 'postgres' } });
  const entry = overrides.registryEntry ?? makeRegistryEntry();
  return {
    targetProvider: 'azure' as CloudProvider,
    resource,
    registryEntry: entry,
    relationships: [],
    siblingResources: [],
    ir: {
      version: '1.0.0',
      sourceProvider: 'aws',
      resources: [resource],
      relationships: [],
      modules: [],
      intents: [],
      metadata: {
        generatedAt: new Date().toISOString(),
        sourceFiles: ['main.tf'],
        toolVersion: '0.1.0',
      },
    } as CanonicalIR,
    registry: makeMockRegistry(),
    options: makeCompilerOptions(),
    ...overrides,
  };
}

function makeRdsResource(attrs: Record<string, unknown> = {}): IrResource {
  return makeIrResource({
    sourceType: 'aws_db_instance',
    sourceName: 'my_db',
    attributes: { engine: 'postgres', ...attrs },
  });
}

// Helper to extract attributes from a translated resource
function attrsOf(result: ReturnType<typeof translateRds>, index = 0): Record<string, unknown> {
  return result.translated[index]!.attributes as Record<string, unknown>;
}

// Helper to check if a finding with a given code exists
function hasFinding(result: ReturnType<typeof translateRds>, code: string): boolean {
  return result.findings.some((f) => f.code === code);
}

function findingByCode(result: ReturnType<typeof translateRds>, code: string) {
  return result.findings.find((f) => f.code === code);
}

// ===========================================================================
// resolveParameterGroup
// ===========================================================================

describe('resolveParameterGroup', () => {
  it('should map known postgres param (max_connections) to azure equivalent', () => {
    const result = resolveParameterGroup('res-001', 'postgres', 'azure', {
      max_connections: '200',
    });
    expect(result.mappedParameters).toEqual({ max_connections: '200' });
    expect(result.findings).toHaveLength(0);
  });

  it('should map known postgres param (max_connections) to gcp equivalent', () => {
    const result = resolveParameterGroup('res-001', 'postgres', 'gcp', {
      max_connections: '200',
    });
    expect(result.mappedParameters).toEqual({ max_connections: '200' });
    expect(result.findings).toHaveLength(0);
  });

  it('should emit UNMAPPED info for unknown postgres param', () => {
    const result = resolveParameterGroup('res-001', 'postgres', 'azure', {
      some_exotic_param: 'value',
    });
    expect(result.mappedParameters).toEqual({});
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.code).toBe('RDS_PARAMETER_UNMAPPED');
    expect(result.findings[0]!.severity).toBe('info');
    expect(result.findings[0]!.message).toContain('some_exotic_param');
  });

  it('should map known mysql params', () => {
    const result = resolveParameterGroup('res-001', 'mysql', 'azure', {
      innodb_buffer_pool_size: '1073741824',
      slow_query_log: '1',
    });
    expect(result.mappedParameters).toEqual({
      innodb_buffer_pool_size: '1073741824',
      slow_query_log: '1',
    });
    expect(result.findings).toHaveLength(0);
  });

  it('should map known sqlserver params with azure-specific name', () => {
    // max_server_memory maps to max_server_memory_(mb) on azure
    const result = resolveParameterGroup('res-001', 'sqlserver', 'azure', {
      max_server_memory: '4096',
    });
    expect(result.mappedParameters).toEqual({ 'max_server_memory_(mb)': '4096' });
    expect(result.findings).toHaveLength(0);
  });

  it('should map sqlserver params for gcp target', () => {
    const result = resolveParameterGroup('res-001', 'sqlserver', 'gcp', {
      max_server_memory: '4096',
    });
    expect(result.mappedParameters).toEqual({ max_server_memory: '4096' });
    expect(result.findings).toHaveLength(0);
  });

  it('should normalise sqlserver-ee to sqlserver engine base', () => {
    const result = resolveParameterGroup('res-001', 'sqlserver-ee', 'azure', {
      max_degree_of_parallelism: '4',
    });
    expect(result.mappedParameters).toEqual({ max_degree_of_parallelism: '4' });
    expect(result.findings).toHaveLength(0);
  });

  it('should emit UNKNOWN_ENGINE warning for unrecognised engine', () => {
    const result = resolveParameterGroup('res-001', 'db2', 'azure', {
      max_connections: '100',
    });
    expect(result.mappedParameters).toEqual({});
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.code).toBe('RDS_PARAMETER_GROUP_UNKNOWN_ENGINE');
    expect(result.findings[0]!.severity).toBe('warning');
    expect(result.findings[0]!.message).toContain('db2');
  });

  it('should return empty results for empty parameters', () => {
    const result = resolveParameterGroup('res-001', 'postgres', 'azure', {});
    expect(result.mappedParameters).toEqual({});
    expect(result.findings).toHaveLength(0);
  });

  it('should handle mixed mapped and unmapped params', () => {
    const result = resolveParameterGroup('res-001', 'postgres', 'azure', {
      max_connections: '200',
      unknown_param: 'val',
      shared_buffers: '256MB',
    });
    expect(result.mappedParameters).toEqual({
      max_connections: '200',
      shared_buffers: '256MB',
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.code).toBe('RDS_PARAMETER_UNMAPPED');
  });

  it('should use mariadb with mysql param table', () => {
    const result = resolveParameterGroup('res-001', 'mariadb', 'azure', {
      innodb_buffer_pool_size: '512MB',
    });
    expect(result.mappedParameters).toEqual({ innodb_buffer_pool_size: '512MB' });
    expect(result.findings).toHaveLength(0);
  });
});

// ===========================================================================
// translateRds — Oracle Advisory Gate
// ===========================================================================

describe('translateRds — Oracle advisory gate', () => {
  it('should return advisory stub for oracle-ee on Azure', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'oracle-ee' }),
    });
    const result = translateRds(ctx);
    expect(result.translated).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.code).toBe('RDS_ORACLE_ADVISORY');
    expect(result.findings[0]!.severity).toBe('warning');
    expect(result.findings[0]!.message).toContain('oracle-ee');
    // Detail should contain Azure alternatives
    const detail = result.findings[0]!.detail;
    expect(detail).toBeDefined();
    const parsed = JSON.parse(detail!);
    expect(parsed.alternatives).toContain('Azure Database for PostgreSQL');
  });

  it('should return advisory stub for oracle-se2 on GCP', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'oracle-se2' }),
    });
    const result = translateRds(ctx);
    expect(result.translated).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.code).toBe('RDS_ORACLE_ADVISORY');
    const parsed = JSON.parse(result.findings[0]!.detail!);
    expect(parsed.alternatives).toContain('Cloud SQL for PostgreSQL');
  });

  it('should NOT return advisory for non-oracle engine', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'postgres' }),
    });
    const result = translateRds(ctx);
    expect(result.translated.length).toBeGreaterThan(0);
    expect(hasFinding(result, 'RDS_ORACLE_ADVISORY')).toBe(false);
  });

  it('should return advisory for oracle-se on Azure', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'oracle-se' }),
    });
    const result = translateRds(ctx);
    expect(result.translated).toHaveLength(0);
    expect(hasFinding(result, 'RDS_ORACLE_ADVISORY')).toBe(true);
  });
});

// ===========================================================================
// translateRds — publicly_accessible BLOCKER
// ===========================================================================

describe('translateRds — publicly_accessible BLOCKER', () => {
  it('should block translation when publicly_accessible=true', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'postgres', publicly_accessible: true }),
    });
    const result = translateRds(ctx);
    expect(result.translated).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.code).toBe('RDS_PUBLICLY_ACCESSIBLE');
    expect(result.findings[0]!.severity).toBe('blocker');
  });

  it('should continue translation when publicly_accessible=false', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'postgres', publicly_accessible: false }),
    });
    const result = translateRds(ctx);
    expect(result.translated.length).toBeGreaterThan(0);
    expect(hasFinding(result, 'RDS_PUBLICLY_ACCESSIBLE')).toBe(false);
  });

  it('should continue translation when publicly_accessible is absent', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'postgres' }),
    });
    const result = translateRds(ctx);
    expect(result.translated.length).toBeGreaterThan(0);
    expect(hasFinding(result, 'RDS_PUBLICLY_ACCESSIBLE')).toBe(false);
  });
});

// ===========================================================================
// translateRds — Multi-AZ
// ===========================================================================

describe('translateRds — Multi-AZ', () => {
  it('should add high_availability block for postgres Azure when multi_az=true', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'postgres', multi_az: true }),
    });
    const result = translateRds(ctx);
    expect(result.translated).toHaveLength(1);
    const attrs = attrsOf(result);
    expect(attrs['high_availability']).toEqual({ mode: 'ZoneRedundant' });
  });

  it('should NOT add high_availability block for postgres Azure when multi_az=false', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'postgres', multi_az: false }),
    });
    const result = translateRds(ctx);
    const attrs = attrsOf(result);
    expect(attrs['high_availability']).toBeUndefined();
  });

  it('should emit warning for sqlserver Azure when multi_az=true', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'sqlserver-ee', multi_az: true }),
    });
    const result = translateRds(ctx);
    expect(hasFinding(result, 'RDS_SQLSERVER_MULTI_AZ')).toBe(true);
    const finding = findingByCode(result, 'RDS_SQLSERVER_MULTI_AZ');
    expect(finding!.severity).toBe('warning');
    expect(finding!.message).toContain('failover groups');
  });

  it('should NOT emit sqlserver multi_az warning when multi_az=false', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'sqlserver-ee', multi_az: false }),
    });
    const result = translateRds(ctx);
    expect(hasFinding(result, 'RDS_SQLSERVER_MULTI_AZ')).toBe(false);
  });

  it('should set availability_type=REGIONAL for GCP when multi_az=true', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'postgres', multi_az: true }),
    });
    const result = translateRds(ctx);
    const settings = attrsOf(result)['settings'] as Record<string, unknown>;
    expect(settings['availability_type']).toBe('REGIONAL');
  });

  it('should set availability_type=ZONAL for GCP when multi_az=false', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'postgres', multi_az: false }),
    });
    const result = translateRds(ctx);
    const settings = attrsOf(result)['settings'] as Record<string, unknown>;
    expect(settings['availability_type']).toBe('ZONAL');
  });
});

// ===========================================================================
// translateRds — Backup + Encryption
// ===========================================================================

describe('translateRds — Backup and Encryption', () => {
  it('should set backup_retention_days for Azure postgres', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'postgres', backup_retention_period: 14 }),
    });
    const result = translateRds(ctx);
    const attrs = attrsOf(result);
    expect(attrs['backup_retention_days']).toBe(14);
  });

  it('should default backup_retention_days to 7 for Azure when absent', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'postgres' }),
    });
    const result = translateRds(ctx);
    expect(attrsOf(result)['backup_retention_days']).toBe(7);
  });

  it('should set backup_configuration block for GCP', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'postgres', backup_retention_period: 14 }),
    });
    const result = translateRds(ctx);
    const settings = attrsOf(result)['settings'] as Record<string, unknown>;
    const backup = settings['backup_configuration'] as Record<string, unknown>;
    expect(backup['enabled']).toBe(true);
    expect(backup['transaction_log_retention_days']).toBe(14);
  });

  it('should enable binary_log for mysql GCP backup', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'mysql', backup_retention_period: 7 }),
    });
    const result = translateRds(ctx);
    const settings = attrsOf(result)['settings'] as Record<string, unknown>;
    const backup = settings['backup_configuration'] as Record<string, unknown>;
    expect(backup['binary_log_enabled']).toBe(true);
  });

  it('should NOT enable binary_log for postgres GCP backup', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'postgres', backup_retention_period: 7 }),
    });
    const result = translateRds(ctx);
    const settings = attrsOf(result)['settings'] as Record<string, unknown>;
    const backup = settings['backup_configuration'] as Record<string, unknown>;
    expect(backup['binary_log_enabled']).toBe(false);
  });

  it('should emit TDE info finding for sqlserver Azure when storage_encrypted=true', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'sqlserver-ee', storage_encrypted: true }),
    });
    const result = translateRds(ctx);
    expect(hasFinding(result, 'RDS_SQLSERVER_TDE')).toBe(true);
    const finding = findingByCode(result, 'RDS_SQLSERVER_TDE');
    expect(finding!.severity).toBe('info');
    expect(finding!.message).toContain('TDE');
  });

  it('should NOT emit TDE finding when storage_encrypted is absent', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'sqlserver-ee' }),
    });
    const result = translateRds(ctx);
    expect(hasFinding(result, 'RDS_SQLSERVER_TDE')).toBe(false);
  });
});

// ===========================================================================
// translateRds — Engine Dispatch
// ===========================================================================

describe('translateRds — Engine dispatch', () => {
  it('should emit azurerm_postgresql_flexible_server for postgres Azure', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'postgres' }),
    });
    const result = translateRds(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_postgresql_flexible_server');
  });

  it('should emit azurerm_mysql_flexible_server for mysql Azure', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'mysql' }),
    });
    const result = translateRds(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_mysql_flexible_server');
  });

  it('should emit 2 resources for sqlserver Azure (mssql_server + mssql_database)', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'sqlserver-ee', db_name: 'myapp' }),
    });
    const result = translateRds(ctx);
    expect(result.translated).toHaveLength(2);
    expect(result.translated[0]!.targetType).toBe('azurerm_mssql_server');
    expect(result.translated[1]!.targetType).toBe('azurerm_mssql_database');
    // Database name propagated
    const dbAttrs = result.translated[1]!.attributes as Record<string, unknown>;
    expect(dbAttrs['name']).toBe('myapp');
    // Server reference in database
    expect(dbAttrs['server_id']).toContain('azurerm_mssql_server');
  });

  it('should emit 3 resources for postgres GCP (instance + database + user)', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({
        engine: 'postgres',
        db_name: 'mydb',
        username: 'dbadmin',
        password: 'secret',
      }),
    });
    const result = translateRds(ctx);
    expect(result.translated).toHaveLength(3);
    expect(result.translated[0]!.targetType).toBe('google_sql_database_instance');
    expect(result.translated[1]!.targetType).toBe('google_sql_database');
    expect(result.translated[2]!.targetType).toBe('google_sql_user');
    // Database name and user propagated
    const dbAttrs = result.translated[1]!.attributes as Record<string, unknown>;
    expect(dbAttrs['name']).toBe('mydb');
    const userAttrs = result.translated[2]!.attributes as Record<string, unknown>;
    expect(userAttrs['name']).toBe('dbadmin');
    expect(userAttrs['password']).toBe('secret');
  });

  it('should emit 3 resources for mysql GCP', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'mysql' }),
    });
    const result = translateRds(ctx);
    expect(result.translated).toHaveLength(3);
    expect(result.translated[0]!.targetType).toBe('google_sql_database_instance');
    const instanceAttrs = attrsOf(result);
    expect(instanceAttrs['database_version']).toBe('MYSQL_8_0');
  });

  it('should emit unknown engine warning for Azure with fallback type', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'custom_engine' }),
    });
    const result = translateRds(ctx);
    // Falls through to flexible server path (not sqlserver)
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_postgresql_flexible_server');
    expect(hasFinding(result, 'RDS_UNKNOWN_ENGINE_AZURE')).toBe(true);
  });

  it('should emit unknown engine warning for GCP with fallback version', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'custom_engine' }),
    });
    const result = translateRds(ctx);
    expect(result.translated).toHaveLength(3);
    expect(hasFinding(result, 'RDS_UNKNOWN_ENGINE_GCP')).toBe(true);
  });
});

// ===========================================================================
// translateRds — Edge Cases
// ===========================================================================

describe('translateRds — Edge cases', () => {
  it('should emit deletion_protection warning for Azure', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'postgres', deletion_protection: true }),
    });
    const result = translateRds(ctx);
    expect(hasFinding(result, 'RDS_DELETION_PROTECTION')).toBe(true);
    const finding = findingByCode(result, 'RDS_DELETION_PROTECTION');
    expect(finding!.severity).toBe('warning');
    expect(finding!.message).toContain('manual lock');
  });

  it('should set deletion_protection_enabled=true for GCP', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'postgres', deletion_protection: true }),
    });
    const result = translateRds(ctx);
    const attrs = attrsOf(result);
    expect(attrs['deletion_protection_enabled']).toBe(true);
  });

  it('should set deletion_protection_enabled=false for GCP when absent', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'postgres' }),
    });
    const result = translateRds(ctx);
    const attrs = attrsOf(result);
    expect(attrs['deletion_protection_enabled']).toBe(false);
  });

  it('should include COMPOUND_EXPANSION finding for Azure postgres (1 resource)', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'postgres' }),
    });
    const result = translateRds(ctx);
    expect(hasFinding(result, 'COMPOUND_EXPANSION')).toBe(true);
    const finding = findingByCode(result, 'COMPOUND_EXPANSION');
    expect(finding!.message).toContain('1 azure resources');
  });

  it('should include COMPOUND_EXPANSION finding for Azure sqlserver (2 resources)', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'sqlserver-ee' }),
    });
    const result = translateRds(ctx);
    expect(hasFinding(result, 'COMPOUND_EXPANSION')).toBe(true);
    const finding = findingByCode(result, 'COMPOUND_EXPANSION');
    expect(finding!.message).toContain('2 azure resources');
  });

  it('should include COMPOUND_EXPANSION finding for GCP (3 resources)', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'postgres' }),
    });
    const result = translateRds(ctx);
    expect(hasFinding(result, 'COMPOUND_EXPANSION')).toBe(true);
    const finding = findingByCode(result, 'COMPOUND_EXPANSION');
    expect(finding!.message).toContain('3 gcp resources');
  });

  it('should propagate tags for Azure', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'postgres', tags: { env: 'prod', team: 'infra' } }),
    });
    const result = translateRds(ctx);
    const attrs = attrsOf(result);
    expect(attrs['tags']).toBeDefined();
  });

  it('should propagate labels for GCP', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'postgres', tags: { env: 'prod' } }),
    });
    const result = translateRds(ctx);
    const attrs = attrsOf(result);
    expect(attrs['labels']).toBeDefined();
  });

  it('should emit UNKNOWN_INSTANCE_CLASS warning for unmapped instance class', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'postgres', instance_class: 'db.x99.mega' }),
    });
    const result = translateRds(ctx);
    expect(hasFinding(result, 'UNKNOWN_INSTANCE_CLASS')).toBe(true);
    const finding = findingByCode(result, 'UNKNOWN_INSTANCE_CLASS');
    expect(finding!.severity).toBe('warning');
    expect(finding!.message).toContain('db.x99.mega');
    // Should still use default SKU
    const attrs = attrsOf(result);
    expect(attrs['sku_name']).toBe('B_Standard_B1ms');
  });

  it('should emit UNKNOWN_INSTANCE_CLASS for GCP with default tier', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'postgres', instance_class: 'db.z1.custom' }),
    });
    const result = translateRds(ctx);
    expect(hasFinding(result, 'UNKNOWN_INSTANCE_CLASS')).toBe(true);
    const settings = attrsOf(result)['settings'] as Record<string, unknown>;
    expect(settings['tier']).toBe('db-f1-micro');
  });

  it('should map known instance class to correct Azure SKU', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'postgres', instance_class: 'db.m5.large' }),
    });
    const result = translateRds(ctx);
    expect(attrsOf(result)['sku_name']).toBe('GP_Standard_D2ds_v4');
    expect(hasFinding(result, 'UNKNOWN_INSTANCE_CLASS')).toBe(false);
  });

  it('should map known instance class to correct GCP tier', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'postgres', instance_class: 'db.m5.large' }),
    });
    const result = translateRds(ctx);
    const settings = attrsOf(result)['settings'] as Record<string, unknown>;
    expect(settings['tier']).toBe('db-custom-2-8192');
  });

  it('should convert allocated_storage to storage_mb for Azure (x1024)', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'postgres', allocated_storage: 100 }),
    });
    const result = translateRds(ctx);
    expect(attrsOf(result)['storage_mb']).toBe(100 * 1024);
  });

  it('should set disk_size for GCP from allocated_storage', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'postgres', allocated_storage: 50 }),
    });
    const result = translateRds(ctx);
    const settings = attrsOf(result)['settings'] as Record<string, unknown>;
    expect(settings['disk_size']).toBe(50);
  });

  it('should set sourceId on all translated resources', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'postgres' }),
    });
    const result = translateRds(ctx);
    for (const tr of result.translated) {
      expect(tr.sourceId).toBe('res-rds-001');
    }
  });
});

// ===========================================================================
// translateRds — Parameter Group Integration
// ===========================================================================

describe('translateRds — Parameter group integration', () => {
  it('should add server_configuration for Azure postgres with parameters', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({
        engine: 'postgres',
        parameters: { max_connections: '200', work_mem: '4MB' },
      }),
    });
    const result = translateRds(ctx);
    const attrs = attrsOf(result);
    expect(attrs['server_configuration']).toEqual({
      max_connections: '200',
      work_mem: '4MB',
    });
  });

  it('should add database_flags for GCP with parameters', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({
        engine: 'postgres',
        parameters: { max_connections: '200' },
      }),
    });
    const result = translateRds(ctx);
    const settings = attrsOf(result)['settings'] as Record<string, unknown>;
    const flags = settings['database_flags'] as Array<{ name: string; value: string }>;
    expect(flags).toEqual([{ name: 'max_connections', value: '200' }]);
  });

  it('should include parameter findings in result', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({
        engine: 'postgres',
        parameters: { exotic_param: 'val' },
      }),
    });
    const result = translateRds(ctx);
    expect(hasFinding(result, 'RDS_PARAMETER_UNMAPPED')).toBe(true);
  });

  it('should NOT add server_configuration when no parameters', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({ engine: 'postgres' }),
    });
    const result = translateRds(ctx);
    const attrs = attrsOf(result);
    expect(attrs['server_configuration']).toBeUndefined();
  });

  it('should NOT add server_configuration when all params unmapped', () => {
    const ctx = makeCtx({
      targetProvider: 'azure',
      resource: makeRdsResource({
        engine: 'postgres',
        parameters: { unknown1: 'v1', unknown2: 'v2' },
      }),
    });
    const result = translateRds(ctx);
    const attrs = attrsOf(result);
    expect(attrs['server_configuration']).toBeUndefined();
  });
});

// ===========================================================================
// translateRds — GCP version mapping
// ===========================================================================

describe('translateRds — GCP version mapping', () => {
  it('should use POSTGRES_15 for postgres engine', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'postgres' }),
    });
    const result = translateRds(ctx);
    expect(attrsOf(result)['database_version']).toBe('POSTGRES_15');
  });

  it('should use MYSQL_8_0 for mysql engine', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'mysql' }),
    });
    const result = translateRds(ctx);
    expect(attrsOf(result)['database_version']).toBe('MYSQL_8_0');
  });

  it('should use SQLSERVER_2019_ENTERPRISE for sqlserver-ee', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'sqlserver-ee' }),
    });
    const result = translateRds(ctx);
    expect(attrsOf(result)['database_version']).toBe('SQLSERVER_2019_ENTERPRISE');
  });

  it('should use MYSQL_8_0 for mariadb engine', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'mariadb' }),
    });
    const result = translateRds(ctx);
    expect(attrsOf(result)['database_version']).toBe('MYSQL_8_0');
  });

  it('should enable disk_autoresize for GCP', () => {
    const ctx = makeCtx({
      targetProvider: 'gcp',
      resource: makeRdsResource({ engine: 'postgres' }),
    });
    const result = translateRds(ctx);
    const settings = attrsOf(result)['settings'] as Record<string, unknown>;
    expect(settings['disk_autoresize']).toBe(true);
  });
});
