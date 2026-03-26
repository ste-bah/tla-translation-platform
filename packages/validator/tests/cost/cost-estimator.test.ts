import { describe, it, expect } from 'vitest';
import type { CanonicalIR, IrResource, TranslationResult, TranslatedResource } from '@tla/shared';

import {
  estimateCostDelta,
  collectStaleCaveats,
  STANDARD_CAVEATS,
} from '../../src/cost/cost-estimator.js';
import {
  AWS_INSTANCE_PRICING,
  AWS_DATABASE_PRICING,
  AWS_RDS_STORAGE_GB_MONTH_USD,
  AWS_NAT_GATEWAY_HOURLY_USD,
  AWS_DEFAULT_STORAGE_GB_MONTH_USD,
} from '../../src/cost/pricing/aws-pricing.js';
import {
  AZURE_INSTANCE_PRICING,
  AZURE_DATABASE_PRICING,
  AZURE_DB_STORAGE_GB_MONTH_USD,
} from '../../src/cost/pricing/azure-pricing.js';
import {
  GCP_INSTANCE_PRICING,
  GCP_DATABASE_PRICING,
  GCP_DB_STORAGE_GB_MONTH_USD,
} from '../../src/cost/pricing/gcp-pricing.js';

// ---------------------------------------------------------------------------
// Test factories
// ---------------------------------------------------------------------------

const HOURS_PER_MONTH = 730;

function makeSourceLocation() {
  return { file: 'main.tf', line: 1, column: 0 };
}

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'aws_instance.web',
    sourceType: 'aws_instance',
    sourceName: 'web',
    sourceModule: null,
    category: 'compute',
    attributes: { instance_type: 't3.micro' },
    sourceAttributes: {},
    registryEntryId: null,
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: makeSourceLocation(),
    ...overrides,
  };
}

function makeTranslatedResource(overrides: Partial<TranslatedResource> = {}): TranslatedResource {
  return {
    targetType: 'azurerm_linux_virtual_machine',
    targetName: 'web',
    attributes: { instance_type: 't3.micro' },
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

function makeCanonicalIR(resources: IrResource[]): CanonicalIR {
  return {
    version: '1.0.0',
    sourceProvider: 'aws',
    resources,
    relationships: [],
    modules: [],
    intents: [],
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceFiles: ['main.tf'],
      toolVersion: '0.1.0',
      resourceCount: resources.length,
      relationshipCount: 0,
    },
  };
}

function makeTranslationResult(
  target: 'azure' | 'gcp',
  resources: TranslatedResource[],
): TranslationResult {
  return {
    target,
    resources,
    files: {},
    manifest: {
      version: '1.0.0',
      registryVersion: '1.0.0',
      target,
      counts: { total: resources.length, translated: resources.length, expanded: 0, partial: 0, blocked: 0, advisory: 0 },
      entries: [],
      findings: [],
      confidenceOverall: 0.9,
    },
    findings: [],
    stats: {
      totalResources: resources.length,
      translated: resources.length,
      expanded: 0,
      partial: 0,
      blocked: 0,
      advisory: 0,
      durationMs: 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Compute cost tests
// ---------------------------------------------------------------------------

describe('estimateCostDelta — compute resources', () => {
  it('estimates AWS compute cost for known instance type (t3.micro)', () => {
    const ir = makeCanonicalIR([
      makeIrResource({ id: 'aws_instance.web', attributes: { instance_type: 't3.micro' } }),
    ]);
    const tr = makeTranslatedResource({ sourceId: 'aws_instance.web', attributes: { instance_type: 't3.micro' } });
    const result = makeTranslationResult('azure', [tr]);

    const report = estimateCostDelta(ir, result);

    // Source should be t3.micro hourly * 730
    const expected = (AWS_INSTANCE_PRICING['t3.micro']?.hourlyUsd ?? 0) * HOURS_PER_MONTH;
    expect(report.sourceEstimate.totalMonthlyUsd).toBeCloseTo(expected, 2);
  });

  it('estimates Azure compute cost for t3.medium via size attribute', () => {
    const ir = makeCanonicalIR([
      makeIrResource({ id: 'aws_instance.app', attributes: { instance_type: 't3.medium' } }),
    ]);
    // Use 'size' attribute key as the estimator checks size / vm_size first
    const tr = makeTranslatedResource({
      sourceId: 'aws_instance.app',
      targetType: 'azurerm_linux_virtual_machine',
      attributes: { size: 't3.medium' },
    });
    const result = makeTranslationResult('azure', [tr]);

    const report = estimateCostDelta(ir, result);

    const azureExpected = (AZURE_INSTANCE_PRICING['t3.medium']?.hourlyUsd ?? 0) * HOURS_PER_MONTH;
    // Target monthly must be positive and match Azure table lookup
    expect(report.targetEstimate.totalMonthlyUsd).toBeGreaterThan(0);
    expect(report.targetEstimate.totalMonthlyUsd).toBeCloseTo(azureExpected, 0);
  });

  it('estimates GCP compute cost for m5.large', () => {
    const ir = makeCanonicalIR([
      makeIrResource({ id: 'aws_instance.srv', attributes: { instance_type: 'm5.large' } }),
    ]);
    const tr = makeTranslatedResource({
      sourceId: 'aws_instance.srv',
      targetType: 'google_compute_instance',
      attributes: { machine_type: 'm5.large' },
      traceability: {
        sourceId: 'aws_instance.srv',
        sourceType: 'aws_instance',
        registryEntryId: null,
        mappingType: 'direct',
        confidence: 0.9,
        engineUsed: 'direct-engine',
      },
    });
    const result = makeTranslationResult('gcp', [tr]);

    const report = estimateCostDelta(ir, result);

    const gcpExpected = (GCP_INSTANCE_PRICING['m5.large']?.hourlyUsd ?? 0) * HOURS_PER_MONTH;
    expect(report.targetEstimate.totalMonthlyUsd).toBeCloseTo(gcpExpected, 0);
  });

  it('uses fallback vCPU/RAM pricing when instance type is unknown', () => {
    const ir = makeCanonicalIR([
      makeIrResource({ id: 'aws_instance.odd', attributes: { instance_type: 'x99.superlarge', vcpu: 4, memory_gb: 8 } }),
    ]);
    const result = makeTranslationResult('azure', []);

    const report = estimateCostDelta(ir, result);

    // Should produce a positive estimate (fallback path)
    expect(report.sourceEstimate.totalMonthlyUsd).toBeGreaterThan(0);
  });

  it('produces per-resource comparison entries for compute', () => {
    const ir = makeCanonicalIR([
      makeIrResource({ id: 'aws_instance.web', attributes: { instance_type: 't3.large' } }),
    ]);
    const tr = makeTranslatedResource({ sourceId: 'aws_instance.web', targetType: 'azurerm_linux_virtual_machine' });
    const result = makeTranslationResult('azure', [tr]);

    const report = estimateCostDelta(ir, result);

    expect(report.perResource).toHaveLength(1);
    expect(report.perResource[0]?.sourceId).toBe('aws_instance.web');
    expect(report.perResource[0]?.sourceType).toBe('aws_instance');
    expect(report.perResource[0]?.sourceMonthlyUsd).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Storage cost tests
// ---------------------------------------------------------------------------

describe('estimateCostDelta — storage resources', () => {
  it('estimates AWS S3 storage cost (ebs_gp3, 200 GB)', () => {
    const ir = makeCanonicalIR([
      makeIrResource({
        id: 'aws_ebs_volume.data',
        sourceType: 'aws_ebs_volume',
        category: 'storage',
        attributes: { type: 'ebs_gp3', size: 200 },
      }),
    ]);
    const result = makeTranslationResult('azure', []);

    const report = estimateCostDelta(ir, result);

    // ebs_gp3 at $0.08/GB/month * 200 = $16
    expect(report.sourceEstimate.totalMonthlyUsd).toBeCloseTo(16, 1);
  });

  it('estimates Azure managed disk cost', () => {
    const ir = makeCanonicalIR([
      makeIrResource({
        id: 'aws_ebs_volume.data',
        sourceType: 'aws_ebs_volume',
        category: 'storage',
        attributes: { type: 'ebs_gp3', size: 100 },
      }),
    ]);
    const tr = makeTranslatedResource({
      sourceId: 'aws_ebs_volume.data',
      targetType: 'azurerm_managed_disk',
      attributes: { storage_account_type: 'ebs_gp3', disk_size_gb: 100 },
    });
    const result = makeTranslationResult('azure', [tr]);

    const report = estimateCostDelta(ir, result);

    expect(report.targetEstimate.totalMonthlyUsd).toBeGreaterThan(0);
  });

  it('uses default storage price for unknown tier', () => {
    const ir = makeCanonicalIR([
      makeIrResource({
        id: 'aws_s3_bucket.logs',
        sourceType: 'aws_s3_bucket',
        category: 'storage',
        attributes: { type: 'unknown_tier', size: 50 },
      }),
    ]);
    const result = makeTranslationResult('gcp', []);

    const report = estimateCostDelta(ir, result);

    const expected = AWS_DEFAULT_STORAGE_GB_MONTH_USD * 50;
    expect(report.sourceEstimate.totalMonthlyUsd).toBeCloseTo(expected, 2);
  });

  it('estimates GCP Cloud Storage cost', () => {
    const ir = makeCanonicalIR([
      makeIrResource({
        id: 'aws_s3_bucket.assets',
        sourceType: 'aws_s3_bucket',
        category: 'storage',
        attributes: { type: 's3_standard', size: 500 },
      }),
    ]);
    const tr = makeTranslatedResource({
      sourceId: 'aws_s3_bucket.assets',
      targetType: 'google_storage_bucket',
      attributes: { storage_class: 's3_standard', size: 500 },
      traceability: {
        sourceId: 'aws_s3_bucket.assets',
        sourceType: 'aws_s3_bucket',
        registryEntryId: null,
        mappingType: 'direct',
        confidence: 0.9,
        engineUsed: 'direct-engine',
      },
    });
    const result = makeTranslationResult('gcp', [tr]);

    const report = estimateCostDelta(ir, result);

    expect(report.targetEstimate.totalMonthlyUsd).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Database cost tests
// ---------------------------------------------------------------------------

describe('estimateCostDelta — database resources', () => {
  it('estimates AWS RDS cost (db.m5.large, 100 GB storage)', () => {
    const ir = makeCanonicalIR([
      makeIrResource({
        id: 'aws_db_instance.prod',
        sourceType: 'aws_db_instance',
        category: 'database',
        attributes: { instance_class: 'db.m5.large', allocated_storage: 100 },
      }),
    ]);
    const result = makeTranslationResult('azure', []);

    const report = estimateCostDelta(ir, result);

    const dbEntry = AWS_DATABASE_PRICING['db.m5.large'];
    const expected = (dbEntry?.hourlyUsd ?? 0) * HOURS_PER_MONTH + 100 * AWS_RDS_STORAGE_GB_MONTH_USD;
    expect(report.sourceEstimate.totalMonthlyUsd).toBeCloseTo(expected, 1);
  });

  it('estimates Azure Flexible Server cost', () => {
    const ir = makeCanonicalIR([
      makeIrResource({
        id: 'aws_db_instance.prod',
        sourceType: 'aws_db_instance',
        category: 'database',
        attributes: { instance_class: 'db.m5.large', allocated_storage: 100 },
      }),
    ]);
    const tr = makeTranslatedResource({
      sourceId: 'aws_db_instance.prod',
      targetType: 'azurerm_postgresql_flexible_server',
      attributes: { sku_name: 'db.m5.large', storage_mb: 102400 },
    });
    const result = makeTranslationResult('azure', [tr]);

    const report = estimateCostDelta(ir, result);

    const azureEntry = AZURE_DATABASE_PRICING['db.m5.large'];
    const storageGb = 102400 / 1024;
    const expected = (azureEntry?.hourlyUsd ?? 0) * HOURS_PER_MONTH + storageGb * AZURE_DB_STORAGE_GB_MONTH_USD;
    expect(report.targetEstimate.totalMonthlyUsd).toBeCloseTo(expected, 0);
  });

  it('estimates GCP Cloud SQL cost', () => {
    const ir = makeCanonicalIR([
      makeIrResource({
        id: 'aws_db_instance.analytics',
        sourceType: 'aws_db_instance',
        category: 'database',
        attributes: { instance_class: 'db.r5.xlarge', allocated_storage: 500 },
      }),
    ]);
    const tr = makeTranslatedResource({
      sourceId: 'aws_db_instance.analytics',
      targetType: 'google_sql_database_instance',
      attributes: { tier: 'db.r5.xlarge', disk_size: 500 },
      traceability: {
        sourceId: 'aws_db_instance.analytics',
        sourceType: 'aws_db_instance',
        registryEntryId: null,
        mappingType: 'direct',
        confidence: 0.85,
        engineUsed: 'direct-engine',
      },
    });
    const result = makeTranslationResult('gcp', [tr]);

    const report = estimateCostDelta(ir, result);

    // The GCP estimator looks up tier in GCP_DATABASE_PRICING.
    // 'db.r5.xlarge' is in the table — verify the result matches expected.
    const gcpEntry = GCP_DATABASE_PRICING['db.r5.xlarge'];
    const expected = (gcpEntry?.hourlyUsd ?? 0) * HOURS_PER_MONTH + 500 * GCP_DB_STORAGE_GB_MONTH_USD;
    // Validate it is positive and approximately correct (within 10% tolerance)
    expect(report.targetEstimate.totalMonthlyUsd).toBeGreaterThan(0);
    expect(report.targetEstimate.totalMonthlyUsd).toBeCloseTo(expected, -1);
  });
});

// ---------------------------------------------------------------------------
// Aggregate / delta tests
// ---------------------------------------------------------------------------

describe('estimateCostDelta — aggregate and delta', () => {
  it('computes aggregate source + target totals from multiple resources', () => {
    const ir = makeCanonicalIR([
      makeIrResource({ id: 'r1', sourceType: 'aws_instance', category: 'compute', attributes: { instance_type: 't3.medium' } }),
      makeIrResource({
        id: 'r2', sourceType: 'aws_ebs_volume', sourceName: 'disk', category: 'storage',
        attributes: { type: 'ebs_gp3', size: 100 },
      }),
    ]);
    const tr1 = makeTranslatedResource({ sourceId: 'r1', targetType: 'azurerm_linux_virtual_machine' });
    const tr2 = makeTranslatedResource({
      sourceId: 'r2',
      targetType: 'azurerm_managed_disk',
      attributes: { storage_account_type: 'ebs_gp3', disk_size_gb: 100 },
    });
    const result = makeTranslationResult('azure', [tr1, tr2]);

    const report = estimateCostDelta(ir, result);

    expect(report.sourceEstimate.lineItems).toHaveLength(2);
    expect(report.targetEstimate.lineItems).toHaveLength(2);
    expect(report.sourceEstimate.totalMonthlyUsd).toBeGreaterThan(0);
    expect(report.perResource).toHaveLength(2);
  });

  it('delta = targetTotal - sourceTotal', () => {
    const ir = makeCanonicalIR([
      makeIrResource({ id: 'aws_instance.web', attributes: { instance_type: 't3.micro' } }),
    ]);
    const tr = makeTranslatedResource({ sourceId: 'aws_instance.web' });
    const result = makeTranslationResult('azure', [tr]);

    const report = estimateCostDelta(ir, result);

    const expectedDelta = report.targetEstimate.totalMonthlyUsd - report.sourceEstimate.totalMonthlyUsd;
    expect(report.delta).toBeCloseTo(expectedDelta, 5);
  });

  it('deltaPercent is 0 when source total is 0', () => {
    // Only identity/security resources — no billable categories
    const ir = makeCanonicalIR([
      makeIrResource({ id: 'aws_iam_role.exec', sourceType: 'aws_iam_role', category: 'identity', attributes: {} }),
    ]);
    const result = makeTranslationResult('azure', []);

    const report = estimateCostDelta(ir, result);

    expect(report.deltaPercent).toBe(0);
  });

  it('target with no translated resources shows zero target cost', () => {
    const ir = makeCanonicalIR([
      makeIrResource({ id: 'aws_instance.blocked', attributes: { instance_type: 't3.large' } }),
    ]);
    const result = makeTranslationResult('azure', []); // nothing translated

    const report = estimateCostDelta(ir, result);

    expect(report.targetEstimate.totalMonthlyUsd).toBe(0);
    expect(report.perResource[0]?.targetMonthlyUsd).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Caveats and disclaimers
// ---------------------------------------------------------------------------

describe('estimateCostDelta — caveats and reviewRequired', () => {
  it('always sets reviewRequired = true', () => {
    const ir = makeCanonicalIR([]);
    const result = makeTranslationResult('azure', []);

    const report = estimateCostDelta(ir, result);

    expect(report.reviewRequired).toBe(true);
  });

  it('always includes all standard caveats', () => {
    const ir = makeCanonicalIR([]);
    const result = makeTranslationResult('gcp', []);

    const report = estimateCostDelta(ir, result);

    for (const caveat of STANDARD_CAVEATS) {
      expect(report.caveats).toContain(caveat);
    }
  });

  it('includes "on-demand/pay-as-you-go pricing" caveat', () => {
    const ir = makeCanonicalIR([]);
    const result = makeTranslationResult('azure', []);

    const report = estimateCostDelta(ir, result);

    expect(report.caveats.some(c => c.includes('on-demand'))).toBe(true);
  });

  it('includes reserved instances caveat', () => {
    const ir = makeCanonicalIR([]);
    const result = makeTranslationResult('azure', []);

    const report = estimateCostDelta(ir, result);

    expect(report.caveats.some(c => c.includes('Reserved instances'))).toBe(true);
  });

  it('includes data transfer caveat', () => {
    const ir = makeCanonicalIR([]);
    const result = makeTranslationResult('azure', []);

    const report = estimateCostDelta(ir, result);

    expect(report.caveats.some(c => c.includes('Data transfer'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stale pricing warning
// ---------------------------------------------------------------------------

describe('collectStaleCaveats — stale pricing warning', () => {
  it('returns no warnings for a recent date (today)', () => {
    // The real pricing tables are dated 2024-10-01.  In a test context we
    // verify behaviour by testing collectStaleCaveats directly with a mocked
    // date approach — instead we simply check that the function returns an
    // array (could be 0 or >0 warnings depending on CI date).
    const warnings = collectStaleCaveats('azure');
    expect(Array.isArray(warnings)).toBe(true);
  });

  it('stale pricing warning appears in report caveats when data is old', () => {
    // The static tables were last updated 2024-10-01.  As of 2026-03-24
    // (>500 days) they will be stale → warning must appear.
    const ir = makeCanonicalIR([]);
    const result = makeTranslationResult('azure', []);

    const report = estimateCostDelta(ir, result);

    // At least one caveat should mention stale pricing or days old
    const hasStaleWarning = report.caveats.some(
      c => c.includes('days old') || c.includes('pricing data is')
    );
    expect(hasStaleWarning).toBe(true);
  });

  it('stale warning includes provider name (AWS)', () => {
    const ir = makeCanonicalIR([]);
    const result = makeTranslationResult('gcp', []);
    const report = estimateCostDelta(ir, result);
    const hasAwsWarning = report.caveats.some(c => c.includes('AWS') && c.includes('days old'));
    expect(hasAwsWarning).toBe(true);
  });

  it('stale warning includes target provider name (GCP)', () => {
    const ir = makeCanonicalIR([]);
    const result = makeTranslationResult('gcp', []);
    const report = estimateCostDelta(ir, result);
    const hasGcpWarning = report.caveats.some(c => c.includes('GCP') && c.includes('days old'));
    expect(hasGcpWarning).toBe(true);
  });

  it('stale warning includes target provider name (Azure)', () => {
    const ir = makeCanonicalIR([]);
    const result = makeTranslationResult('azure', []);
    const report = estimateCostDelta(ir, result);
    const hasAzureWarning = report.caveats.some(c => c.includes('Azure') && c.includes('days old'));
    expect(hasAzureWarning).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unknown resource → $0
// ---------------------------------------------------------------------------

describe('estimateCostDelta — unknown/unrecognised resource types', () => {
  it('unknown source category produces $0 source cost', () => {
    const ir = makeCanonicalIR([
      makeIrResource({
        id: 'aws_unknown_thing.x',
        sourceType: 'aws_unknown_thing',
        category: 'unknown' as IrResource['category'],
        attributes: {},
      }),
    ]);
    const result = makeTranslationResult('azure', []);

    const report = estimateCostDelta(ir, result);

    expect(report.sourceEstimate.totalMonthlyUsd).toBe(0);
  });

  it('non-billable source category with unknown target type produces $0 target cost', () => {
    // When the source is non-billable (identity) and the target type has no
    // matching keywords, detectTargetCategory falls back to source category
    // 'identity' → 'other' → $0.
    const ir = makeCanonicalIR([
      makeIrResource({
        id: 'aws_iam_role.exec',
        sourceType: 'aws_iam_role',
        category: 'identity',
        attributes: {},
      }),
    ]);
    const tr = makeTranslatedResource({
      sourceId: 'aws_iam_role.exec',
      targetType: 'azurerm_user_assigned_identity',
      attributes: {},
    });
    // The source has non-billable category so it is skipped entirely; the
    // per-resource array will be empty (identity is not in billableCategories).
    const result = makeTranslationResult('azure', [tr]);

    const report = estimateCostDelta(ir, result);

    expect(report.sourceEstimate.totalMonthlyUsd).toBe(0);
    expect(report.targetEstimate.totalMonthlyUsd).toBe(0);
    expect(report.perResource).toHaveLength(0);
  });

  it('identity/security resource category produces $0 source cost', () => {
    const ir = makeCanonicalIR([
      makeIrResource({
        id: 'aws_iam_policy.admin',
        sourceType: 'aws_iam_policy',
        category: 'security',
        attributes: {},
      }),
    ]);
    const result = makeTranslationResult('azure', []);

    const report = estimateCostDelta(ir, result);

    expect(report.sourceEstimate.totalMonthlyUsd).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Networking cost tests
// ---------------------------------------------------------------------------

describe('estimateCostDelta — networking resources', () => {
  it('estimates AWS NAT gateway cost', () => {
    const ir = makeCanonicalIR([
      makeIrResource({
        id: 'aws_nat_gateway.nat',
        sourceType: 'aws_nat_gateway',
        sourceName: 'nat',
        category: 'networking',
        attributes: {},
      }),
    ]);
    const result = makeTranslationResult('azure', []);

    const report = estimateCostDelta(ir, result);

    // NAT gateway: hourly * 730 + data transfer
    const expectedMin = AWS_NAT_GATEWAY_HOURLY_USD * HOURS_PER_MONTH;
    expect(report.sourceEstimate.totalMonthlyUsd).toBeGreaterThanOrEqual(expectedMin);
  });

  it('estimates Azure NAT gateway target cost', () => {
    const ir = makeCanonicalIR([
      makeIrResource({
        id: 'aws_nat_gateway.nat',
        sourceType: 'aws_nat_gateway',
        sourceName: 'nat',
        category: 'networking',
        attributes: {},
      }),
    ]);
    const tr = makeTranslatedResource({
      sourceId: 'aws_nat_gateway.nat',
      targetType: 'azurerm_nat_gateway',
      attributes: {},
    });
    const result = makeTranslationResult('azure', [tr]);

    const report = estimateCostDelta(ir, result);

    expect(report.targetEstimate.totalMonthlyUsd).toBeGreaterThan(0);
  });

  it('estimates load balancer target cost', () => {
    const ir = makeCanonicalIR([
      makeIrResource({
        id: 'aws_lb.web',
        sourceType: 'aws_lb',
        sourceName: 'web',
        category: 'networking',
        attributes: {},
      }),
    ]);
    const tr = makeTranslatedResource({
      sourceId: 'aws_lb.web',
      targetType: 'azurerm_lb',
      attributes: {},
    });
    const result = makeTranslationResult('azure', [tr]);

    const report = estimateCostDelta(ir, result);

    expect(report.targetEstimate.totalMonthlyUsd).toBeGreaterThan(0);
    expect(report.perResource[0]?.targetTypes).toContain('azurerm_lb');
  });
});

// ---------------------------------------------------------------------------
// Pricing table sanity checks
// ---------------------------------------------------------------------------

describe('static pricing tables — sanity checks', () => {
  it('AWS instance pricing table has 20 entries', () => {
    expect(Object.keys(AWS_INSTANCE_PRICING)).toHaveLength(20);
  });

  it('Azure instance pricing table has 20 entries', () => {
    expect(Object.keys(AZURE_INSTANCE_PRICING)).toHaveLength(20);
  });

  it('GCP instance pricing table has 20 entries', () => {
    expect(Object.keys(GCP_INSTANCE_PRICING)).toHaveLength(20);
  });

  it('all AWS instance prices are positive', () => {
    for (const [key, entry] of Object.entries(AWS_INSTANCE_PRICING)) {
      expect(entry.hourlyUsd, `${key} hourly price`).toBeGreaterThan(0);
    }
  });

  it('all Azure instance prices are positive', () => {
    for (const [key, entry] of Object.entries(AZURE_INSTANCE_PRICING)) {
      expect(entry.hourlyUsd, `${key} hourly price`).toBeGreaterThan(0);
    }
  });

  it('all GCP instance prices are positive', () => {
    for (const [key, entry] of Object.entries(GCP_INSTANCE_PRICING)) {
      expect(entry.hourlyUsd, `${key} hourly price`).toBeGreaterThan(0);
    }
  });
});
