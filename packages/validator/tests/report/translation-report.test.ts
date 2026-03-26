// ---------------------------------------------------------------------------
// Tests for TASK-GAP-005: Translation Report Generator
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { generateTranslationReport } from '../../src/report/translation-report.js';
import type { ReportInputs } from '../../src/report/translation-report.js';
import type {
  TranslationManifest,
  ManifestEntry,
  TranslationFinding,
} from '@tla/shared';
import type { EquivalenceReport } from '@tla/shared';
import type { AuditEvent } from '@tla/shared';
import type { ConfidenceReport } from '../../src/confidence/confidence-scorer.js';
import type { CostDeltaReport } from '../../src/cost/cost-estimator.js';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeManifestEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    sourceId: 'aws_instance.web',
    sourceType: 'aws_instance',
    status: 'translated',
    targetResources: [
      {
        targetType: 'azurerm_linux_virtual_machine',
        targetName: 'web',
        attributes: {},
        sourceId: 'aws_instance.web',
        traceability: {
          sourceId: 'aws_instance.web',
          sourceType: 'aws_instance',
          registryEntryId: 'compute/aws_instance',
          mappingType: 'direct',
          confidence: 0.9,
          engineUsed: 'direct-engine',
        },
      },
    ],
    confidence: 0.9,
    findings: [],
    ...overrides,
  };
}

function makeFinding(overrides: Partial<TranslationFinding> = {}): TranslationFinding {
  return {
    resourceId: 'aws_instance.web',
    severity: 'info',
    code: 'INFO_001',
    message: 'Test finding message',
    ...overrides,
  };
}

function makeManifest(overrides: Partial<TranslationManifest> = {}): TranslationManifest {
  return {
    version: '1.0.0',
    registryVersion: 'v2.1.0',
    target: 'azure',
    counts: {
      total: 3,
      translated: 2,
      expanded: 0,
      partial: 0,
      blocked: 0,
      advisory: 1,
    },
    entries: [
      makeManifestEntry(),
      makeManifestEntry({ sourceId: 'aws_s3_bucket.assets', sourceType: 'aws_s3_bucket', status: 'advisory' }),
      makeManifestEntry({ sourceId: 'aws_ecs_service.api', sourceType: 'aws_ecs_service', status: 'translated' }),
    ],
    findings: [],
    confidenceOverall: 0.87,
    ...overrides,
  };
}

function makeEmptyManifest(): TranslationManifest {
  return {
    version: '1.0.0',
    registryVersion: 'v2.1.0',
    target: 'gcp',
    counts: {
      total: 0,
      translated: 0,
      expanded: 0,
      partial: 0,
      blocked: 0,
      advisory: 0,
    },
    entries: [],
    findings: [],
    confidenceOverall: 0,
  };
}

function makeEquivalenceReport(): EquivalenceReport {
  return {
    overallScore: 0.82,
    classification: 'partial',
    records: [
      {
        resourceId: 'aws_instance.web',
        sourceType: 'aws_instance',
        classification: 'equivalent',
        overallScore: 0.95,
        dimensions: {},
        preClassification: null,
      },
      {
        resourceId: 'aws_s3_bucket.assets',
        sourceType: 'aws_s3_bucket',
        classification: 'partial',
        overallScore: 0.68,
        dimensions: {},
        preClassification: 'advisory',
      },
    ],
    summary: {
      total: 2,
      equivalent: 1,
      partial: 1,
      degraded: 0,
      missing: 0,
    },
  };
}

function makeConfidenceReport(): ConfidenceReport {
  const byFamily = new Map<string, number>();
  byFamily.set('compute', 0.91);
  byFamily.set('storage', 0.75);

  const byResource = new Map<string, import('../../src/confidence/confidence-scorer.js').ResourceConfidence>();
  byResource.set('aws_instance.web', {
    resourceId: 'aws_instance.web',
    serviceFamily: 'compute' as import('@tla/shared').AwsServiceFamily,
    score: 0.91,
    band: 'high',
    reviewCritical: false,
    factors: {
      registryConfidence: 0.9,
      validationFactor: 1.0,
      semanticFactor: 1.0,
      policyFactor: 1.0,
    },
  });

  return {
    overall: 0.87,
    overallBand: 'high',
    byFamily,
    byResource,
    reviewRequired: [],
    escalationRequired: false,
    factors: {
      avgRegistryConfidence: 0.88,
      avgValidationFactor: 0.95,
      avgSemanticFactor: 0.90,
      avgPolicyFactor: 1.0,
    },
  };
}

function makeAuditLog(): AuditEvent[] {
  return [
    {
      seq: 0,
      timestamp: '2025-01-01T00:00:00.000Z',
      kind: 'translation_start',
      payload: { sourceFile: 'main.tf', target: 'azure' },
      hash: 'a'.repeat(64),
      previousHash: '',
    },
    {
      seq: 1,
      timestamp: '2025-01-01T00:00:05.000Z',
      kind: 'engine_emit',
      payload: { resourceId: 'aws_instance.web', engine: 'direct' },
      hash: 'b'.repeat(64),
      previousHash: 'a'.repeat(64),
    },
    {
      seq: 2,
      timestamp: '2025-01-01T00:00:10.000Z',
      kind: 'translation_complete',
      payload: { durationMs: 10000, total: 3 },
      hash: 'c'.repeat(64),
      previousHash: 'b'.repeat(64),
    },
  ];
}

function makeCostDeltaReport(): CostDeltaReport {
  return {
    sourceEstimate: {
      totalMonthlyUsd: 250.00,
      lineItems: [
        { label: 'EC2 t3.medium', monthlyUsd: 200.00, basis: 'on-demand' },
        { label: 'S3 storage', monthlyUsd: 50.00, basis: 'estimated' },
      ],
    },
    targetEstimate: {
      totalMonthlyUsd: 230.00,
      lineItems: [
        { label: 'Azure VM Standard_B2s', monthlyUsd: 185.00, basis: 'on-demand' },
        { label: 'Azure Blob Storage', monthlyUsd: 45.00, basis: 'estimated' },
      ],
    },
    delta: -20.00,
    deltaPercent: -8.0,
    perResource: [
      {
        sourceId: 'aws_instance.web',
        sourceType: 'aws_instance',
        targetTypes: ['azurerm_linux_virtual_machine'],
        sourceMonthlyUsd: 200.00,
        targetMonthlyUsd: 185.00,
        deltaUsd: -15.00,
      },
    ],
    caveats: ['Based on on-demand pricing', 'Estimates are approximate'],
    reviewRequired: true,
  };
}

// ---------------------------------------------------------------------------
// 1. Full report (all inputs)
// ---------------------------------------------------------------------------

describe('generateTranslationReport — full report', () => {
  it('returns a string', () => {
    const inputs: ReportInputs = {
      manifest: makeManifest(),
      equivalence: makeEquivalenceReport(),
      confidence: makeConfidenceReport(),
      auditLog: makeAuditLog(),
      costDelta: makeCostDeltaReport(),
    };
    const report = generateTranslationReport(inputs);
    expect(typeof report).toBe('string');
    expect(report.length).toBeGreaterThan(100);
  });

  it('includes all 11 section headers', () => {
    const inputs: ReportInputs = {
      manifest: makeManifest(),
      equivalence: makeEquivalenceReport(),
      confidence: makeConfidenceReport(),
      auditLog: makeAuditLog(),
      costDelta: makeCostDeltaReport(),
    };
    const report = generateTranslationReport(inputs);
    expect(report).toContain('## Executive Summary');
    expect(report).toContain('## Resource Inventory');
    expect(report).toContain('## Blocked Resources');
    expect(report).toContain('## Advisory Resources');
    expect(report).toContain('## Equivalence Analysis');
    expect(report).toContain('## Confidence Breakdown');
    expect(report).toContain('## Policy & Compliance');
    expect(report).toContain('## Cost Estimate');
    expect(report).toContain('## Manual Tasks');
    expect(report).toContain('## Audit Trail');
    expect(report).toContain('## Findings Appendix');
  });

  it('includes manifest metadata in executive summary', () => {
    const manifest = makeManifest();
    const report = generateTranslationReport({ manifest });
    expect(report).toContain('azure');
    expect(report).toContain('1.0.0');
    expect(report).toContain('v2.1.0');
  });

  it('reflects resource counts', () => {
    const manifest = makeManifest();
    const report = generateTranslationReport({ manifest });
    expect(report).toContain('3');
  });
});

// ---------------------------------------------------------------------------
// 2. Minimal report (manifest only)
// ---------------------------------------------------------------------------

describe('generateTranslationReport — minimal (manifest only)', () => {
  it('returns a report without optional sections', () => {
    const report = generateTranslationReport({ manifest: makeManifest() });
    expect(report).toContain('## Executive Summary');
    expect(report).toContain('## Resource Inventory');
    expect(report).not.toContain('## Equivalence Analysis');
    expect(report).not.toContain('## Confidence Breakdown');
    expect(report).not.toContain('## Audit Trail');
    expect(report).not.toContain('## Cost Estimate');
  });

  it('still includes policy & compliance, manual tasks, findings appendix', () => {
    const report = generateTranslationReport({ manifest: makeManifest() });
    expect(report).toContain('## Policy & Compliance');
    expect(report).toContain('## Manual Tasks');
    expect(report).toContain('## Findings Appendix');
  });
});

// ---------------------------------------------------------------------------
// 3. Empty manifest
// ---------------------------------------------------------------------------

describe('generateTranslationReport — empty manifest', () => {
  it('handles empty entries without throwing', () => {
    const report = generateTranslationReport({ manifest: makeEmptyManifest() });
    expect(report).toBeTruthy();
    expect(report).toContain('## Resource Inventory');
    expect(report).toContain('No resources in manifest');
  });

  it('shows no blocked resources message', () => {
    const report = generateTranslationReport({ manifest: makeEmptyManifest() });
    expect(report).toContain('No blocked resources');
  });

  it('shows no advisory resources message', () => {
    const report = generateTranslationReport({ manifest: makeEmptyManifest() });
    expect(report).toContain('No advisory resources');
  });
});

// ---------------------------------------------------------------------------
// 4. Each optional input missing individually
// ---------------------------------------------------------------------------

describe('generateTranslationReport — optional inputs missing individually', () => {
  it('omits Equivalence Analysis when equivalence is absent', () => {
    const inputs: ReportInputs = {
      manifest: makeManifest(),
      confidence: makeConfidenceReport(),
      auditLog: makeAuditLog(),
      costDelta: makeCostDeltaReport(),
    };
    const report = generateTranslationReport(inputs);
    expect(report).not.toContain('## Equivalence Analysis');
  });

  it('omits Confidence Breakdown when confidence is absent', () => {
    const inputs: ReportInputs = {
      manifest: makeManifest(),
      equivalence: makeEquivalenceReport(),
      auditLog: makeAuditLog(),
      costDelta: makeCostDeltaReport(),
    };
    const report = generateTranslationReport(inputs);
    expect(report).not.toContain('## Confidence Breakdown');
  });

  it('omits Audit Trail when auditLog is absent', () => {
    const inputs: ReportInputs = {
      manifest: makeManifest(),
      equivalence: makeEquivalenceReport(),
      confidence: makeConfidenceReport(),
      costDelta: makeCostDeltaReport(),
    };
    const report = generateTranslationReport(inputs);
    expect(report).not.toContain('## Audit Trail');
  });

  it('omits Cost Estimate when costDelta is absent', () => {
    const inputs: ReportInputs = {
      manifest: makeManifest(),
      equivalence: makeEquivalenceReport(),
      confidence: makeConfidenceReport(),
      auditLog: makeAuditLog(),
    };
    const report = generateTranslationReport(inputs);
    expect(report).not.toContain('## Cost Estimate');
  });
});

// ---------------------------------------------------------------------------
// 5. Section header presence
// ---------------------------------------------------------------------------

describe('section headers present', () => {
  it('h1 report title is present', () => {
    const report = generateTranslationReport({ manifest: makeManifest() });
    expect(report).toContain('# Translation Report');
  });

  it('blocked resources section renders blocked entries', () => {
    const blockedManifest = makeManifest({
      counts: { total: 1, translated: 0, expanded: 0, partial: 0, blocked: 1, advisory: 0 },
      entries: [
        makeManifestEntry({
          sourceId: 'aws_ecs_cluster.prod',
          sourceType: 'aws_ecs_cluster',
          status: 'blocked',
          findings: [makeFinding({ severity: 'blocker', code: 'BLOCKER_EC007', message: 'Security group broadening detected' })],
        }),
      ],
    });
    const report = generateTranslationReport({ manifest: blockedManifest });
    expect(report).toContain('## Blocked Resources');
    expect(report).toContain('aws_ecs_cluster.prod');
    expect(report).toContain('BLOCKER_EC007');
  });

  it('advisory resources section renders advisory entries', () => {
    const advisoryManifest = makeManifest({
      counts: { total: 1, translated: 0, expanded: 0, partial: 0, blocked: 0, advisory: 1 },
      entries: [
        makeManifestEntry({
          sourceId: 'aws_dynamodb_table.events',
          sourceType: 'aws_dynamodb_table',
          status: 'advisory',
          findings: [makeFinding({ severity: 'warning', code: 'DYNAMODB_ADVISORY', message: 'DynamoDB requires manual migration' })],
        }),
      ],
    });
    const report = generateTranslationReport({ manifest: advisoryManifest });
    expect(report).toContain('## Advisory Resources');
    expect(report).toContain('aws_dynamodb_table.events');
    expect(report).toContain('DYNAMODB_ADVISORY');
  });

  it('equivalence section shows classification', () => {
    const report = generateTranslationReport({
      manifest: makeManifest(),
      equivalence: makeEquivalenceReport(),
    });
    expect(report).toContain('## Equivalence Analysis');
    expect(report).toContain('PARTIAL');
  });

  it('confidence section shows escalation warning when required', () => {
    const escalationReport = makeConfidenceReport();
    const escalatingConfidence: ConfidenceReport = {
      ...escalationReport,
      escalationRequired: true,
      reviewRequired: ['aws_s3_bucket.assets'],
      overall: 0.45,
      overallBand: 'low',
    };
    const report = generateTranslationReport({
      manifest: makeManifest(),
      confidence: escalatingConfidence,
    });
    expect(report).toContain('ESCALATION REQUIRED');
  });

  it('audit trail section shows event kinds', () => {
    const report = generateTranslationReport({
      manifest: makeManifest(),
      auditLog: makeAuditLog(),
    });
    expect(report).toContain('## Audit Trail');
    expect(report).toContain('translation_start');
    expect(report).toContain('translation_complete');
  });

  it('findings appendix aggregates manifest-level and entry-level findings', () => {
    const manifestWithFindings = makeManifest({
      findings: [makeFinding({ code: 'MANIFEST_LEVEL', severity: 'info', message: 'Manifest-level finding' })],
      entries: [
        makeManifestEntry({
          findings: [makeFinding({ code: 'ENTRY_LEVEL', severity: 'warning', message: 'Entry-level finding' })],
        }),
      ],
    });
    const report = generateTranslationReport({ manifest: manifestWithFindings });
    expect(report).toContain('## Findings Appendix');
    expect(report).toContain('MANIFEST_LEVEL');
    expect(report).toContain('ENTRY_LEVEL');
  });
});

// ---------------------------------------------------------------------------
// 6. Table formatting
// ---------------------------------------------------------------------------

describe('table formatting', () => {
  it('resource inventory table has correct headers', () => {
    const report = generateTranslationReport({ manifest: makeManifest() });
    expect(report).toContain('| Source ID |');
    expect(report).toContain('| Source Type |');
    expect(report).toContain('| Status |');
    expect(report).toContain('| Target Type(s) |');
    expect(report).toContain('| Confidence |');
  });

  it('resource inventory rows contain source IDs', () => {
    const report = generateTranslationReport({ manifest: makeManifest() });
    expect(report).toContain('aws_instance.web');
    expect(report).toContain('aws_s3_bucket.assets');
  });

  it('cost estimate table contains usd values', () => {
    const report = generateTranslationReport({
      manifest: makeManifest(),
      costDelta: makeCostDeltaReport(),
    });
    expect(report).toContain('$250.00');
    expect(report).toContain('$230.00');
    expect(report).toContain('$-20.00');
  });

  it('confidence table has factor rows', () => {
    const report = generateTranslationReport({
      manifest: makeManifest(),
      confidence: makeConfidenceReport(),
    });
    expect(report).toContain('Registry Confidence (avg)');
    expect(report).toContain('Validation Factor (avg)');
    expect(report).toContain('Semantic Factor (avg)');
    expect(report).toContain('Policy Factor (avg)');
  });

  it('equivalence table has summary breakdown', () => {
    const report = generateTranslationReport({
      manifest: makeManifest(),
      equivalence: makeEquivalenceReport(),
    });
    expect(report).toContain('Equivalent');
    expect(report).toContain('Partial');
    expect(report).toContain('Degraded');
    expect(report).toContain('Missing');
  });

  it('status emojis appear in resource inventory', () => {
    const report = generateTranslationReport({ manifest: makeManifest() });
    // translated = checkmark, advisory = warning
    expect(report).toContain('✅');
    expect(report).toContain('⚠️');
  });
});

// ---------------------------------------------------------------------------
// 7. Never-throw guarantee
// ---------------------------------------------------------------------------

describe('generateTranslationReport — never throws', () => {
  it('does not throw on a valid minimal input', () => {
    expect(() => generateTranslationReport({ manifest: makeManifest() })).not.toThrow();
  });

  it('returns a string even with an empty manifest', () => {
    const result = generateTranslationReport({ manifest: makeEmptyManifest() });
    expect(typeof result).toBe('string');
  });

  it('handles all optional inputs simultaneously without throwing', () => {
    expect(() => generateTranslationReport({
      manifest: makeManifest(),
      equivalence: makeEquivalenceReport(),
      confidence: makeConfidenceReport(),
      auditLog: makeAuditLog(),
      costDelta: makeCostDeltaReport(),
    })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 8. Action-required notices in executive summary
// ---------------------------------------------------------------------------

describe('executive summary action notices', () => {
  it('shows action required notice when blocked resources exist', () => {
    const manifest = makeManifest({
      counts: { total: 2, translated: 1, expanded: 0, partial: 0, blocked: 1, advisory: 0 },
      entries: [
        makeManifestEntry(),
        makeManifestEntry({ status: 'blocked', sourceId: 'aws_ecs_cluster.prod', sourceType: 'aws_ecs_cluster' }),
      ],
    });
    const report = generateTranslationReport({ manifest });
    expect(report).toContain('Action Required');
  });

  it('shows advisory notice when only advisory resources exist', () => {
    const manifest = makeManifest({
      counts: { total: 2, translated: 1, expanded: 0, partial: 0, blocked: 0, advisory: 1 },
    });
    const report = generateTranslationReport({ manifest });
    expect(report).toContain('Advisory Notice');
  });

  it('shows success message when no blocked or advisory', () => {
    const manifest = makeManifest({
      counts: { total: 2, translated: 2, expanded: 0, partial: 0, blocked: 0, advisory: 0 },
      entries: [makeManifestEntry(), makeManifestEntry({ sourceId: 'aws_s3_bucket.data', sourceType: 'aws_s3_bucket' })],
    });
    const report = generateTranslationReport({ manifest });
    expect(report).toContain('successfully');
  });
});
