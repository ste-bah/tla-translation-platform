import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildConfidenceReport,
  type ConfidenceBreakdown,
  type ConfidenceReport,
  type ResourceConfidence,
} from '../../src/compiler/confidence-report.js';
import type {
  TranslationResult,
  ManifestEntry,
  TranslationFinding,
} from '@tla/shared';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<TranslationFinding> = {}): TranslationFinding {
  return {
    resourceId: 'res-001',
    severity: 'info',
    code: 'TEST_INFO',
    message: 'Test info message',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    sourceId: 'res-001',
    sourceType: 'aws_instance',
    status: 'translated',
    targetResources: [],
    confidence: 0.9,
    findings: [],
    ...overrides,
  };
}

function makeResult(
  entries: ManifestEntry[] = [],
  findings: TranslationFinding[] = [],
  overrides: Partial<TranslationResult> = {},
): TranslationResult {
  return {
    target: 'azure',
    resources: [],
    files: {},
    manifest: {
      registryVersion: '1.0.0',
      counts: {
        total: entries.length,
        translated: entries.filter((e) => e.status === 'translated').length,
        expanded: entries.filter((e) => e.status === 'expanded').length,
        partial: entries.filter((e) => e.status === 'partial').length,
        blocked: entries.filter((e) => e.status === 'blocked').length,
        advisory: entries.filter((e) => e.status === 'advisory').length,
      },
      entries,
      findings,
      confidenceOverall: 0.85,
    },
    findings,
    stats: {
      totalResources: entries.length,
      durationMs: 100,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildConfidenceReport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-27T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns correct structure for empty entries', () => {
    const result = makeResult([], []);
    const report = buildConfidenceReport(result);

    expect(report.totalResources).toBe(0);
    expect(report.escalationCount).toBe(0);
    expect(report.resources).toEqual([]);
    expect(report.statusBreakdown).toEqual({});
    expect(report.confidenceBands).toEqual({ high: 0, medium: 0, low: 0 });
  });

  it('passes through confidenceOverall from manifest', () => {
    const result = makeResult([], [], {
      manifest: {
        registryVersion: '1.0.0',
        counts: { total: 0, translated: 0, expanded: 0, partial: 0, blocked: 0, advisory: 0 },
        entries: [],
        findings: [],
        confidenceOverall: 0.72,
      },
    });
    const report = buildConfidenceReport(result);
    expect(report.confidenceOverall).toBe(0.72);
  });

  it('sets generatedAt to ISO-8601', () => {
    const result = makeResult([]);
    const report = buildConfidenceReport(result);
    expect(report.generatedAt).toBe('2026-03-27T12:00:00.000Z');
  });

  it('sets target from result', () => {
    const result = makeResult([], [], { target: 'gcp' });
    const report = buildConfidenceReport(result);
    expect(report.target).toBe('gcp');
  });

  it('classifies confidence bands correctly', () => {
    const entries = [
      makeEntry({ sourceId: 'high', confidence: 0.9 }),
      makeEntry({ sourceId: 'high2', confidence: 0.8 }),
      makeEntry({ sourceId: 'med', confidence: 0.6 }),
      makeEntry({ sourceId: 'med2', confidence: 0.5 }),
      makeEntry({ sourceId: 'low', confidence: 0.3 }),
    ];
    const result = makeResult(entries);
    const report = buildConfidenceReport(result);

    expect(report.confidenceBands.high).toBe(2);
    expect(report.confidenceBands.medium).toBe(2);
    expect(report.confidenceBands.low).toBe(1);
  });

  it('marks escalation for blocked status', () => {
    const entry = makeEntry({ sourceId: 'blk', status: 'blocked', confidence: 0.9 });
    const result = makeResult([entry]);
    const report = buildConfidenceReport(result);

    expect(report.resources[0].escalationRequired).toBe(true);
    expect(report.escalationCount).toBe(1);
  });

  it('marks escalation for confidence below 0.5', () => {
    const entry = makeEntry({ sourceId: 'low', status: 'translated', confidence: 0.4 });
    const result = makeResult([entry]);
    const report = buildConfidenceReport(result);

    expect(report.resources[0].escalationRequired).toBe(true);
    expect(report.escalationCount).toBe(1);
  });

  it('does not mark escalation for high-confidence translated entry', () => {
    const entry = makeEntry({ sourceId: 'ok', status: 'translated', confidence: 0.8 });
    const result = makeResult([entry]);
    const report = buildConfidenceReport(result);

    expect(report.resources[0].escalationRequired).toBe(false);
    expect(report.escalationCount).toBe(0);
  });

  it('includes blocker and warning messages in factors', () => {
    const entry = makeEntry({
      sourceId: 'res-001',
      confidence: 0.3,
      findings: [
        makeFinding({ severity: 'blocker', code: 'BLK_1', message: 'Unsupported resource' }),
        makeFinding({ severity: 'warning', code: 'WARN_1', message: 'Deprecated attribute' }),
        makeFinding({ severity: 'info', code: 'INFO_1', message: 'Note about naming' }),
      ],
    });
    const result = makeResult([entry]);
    const report = buildConfidenceReport(result);

    expect(report.resources[0].factors).toContain('Blocker: Unsupported resource');
    expect(report.resources[0].factors).toContain('Warning: Deprecated attribute');
    // info findings are NOT included
    expect(report.resources[0].factors).not.toContain('Note about naming');
  });

  it('includes global findings not already on the entry', () => {
    const entry = makeEntry({
      sourceId: 'res-001',
      confidence: 0.5,
      findings: [
        makeFinding({ severity: 'warning', code: 'WARN_LOCAL', message: 'Local warning' }),
      ],
    });
    const globalFindings: TranslationFinding[] = [
      makeFinding({ resourceId: 'res-001', severity: 'blocker', code: 'BLK_GLOBAL', message: 'Global blocker' }),
      // Same code as local — should be deduplicated
      makeFinding({ resourceId: 'res-001', severity: 'warning', code: 'WARN_LOCAL', message: 'Duplicate' }),
      // Different resource — should be excluded
      makeFinding({ resourceId: 'res-002', severity: 'blocker', code: 'BLK_OTHER', message: 'Other resource' }),
    ];
    const result = makeResult([entry], globalFindings);
    const report = buildConfidenceReport(result);

    expect(report.resources[0].factors).toContain('Warning: Local warning');
    expect(report.resources[0].factors).toContain('Blocker: Global blocker');
    // Deduplicated by code
    expect(report.resources[0].factors).not.toContain('Duplicate');
    // Wrong resource
    expect(report.resources[0].factors).not.toContain('Other resource');
  });

  it('adds advisory factor for advisory status', () => {
    const entry = makeEntry({ status: 'advisory', confidence: 0.2 });
    const result = makeResult([entry]);
    const report = buildConfidenceReport(result);

    expect(report.resources[0].factors).toContain('No automated translation available');
  });

  it('adds partial factor for partial status', () => {
    const entry = makeEntry({ status: 'partial', confidence: 0.6 });
    const result = makeResult([entry]);
    const report = buildConfidenceReport(result);

    expect(report.resources[0].factors).toContain(
      'Partial translation — manual review required',
    );
  });

  it('computes statusBreakdown correctly', () => {
    const entries = [
      makeEntry({ sourceId: 'a', status: 'translated' }),
      makeEntry({ sourceId: 'b', status: 'translated' }),
      makeEntry({ sourceId: 'c', status: 'blocked' }),
      makeEntry({ sourceId: 'd', status: 'advisory' }),
    ];
    const result = makeResult(entries);
    const report = buildConfidenceReport(result);

    expect(report.statusBreakdown).toEqual({
      translated: 2,
      blocked: 1,
      advisory: 1,
    });
  });

  it('sets totalResources to the number of manifest entries', () => {
    const entries = [
      makeEntry({ sourceId: 'a' }),
      makeEntry({ sourceId: 'b' }),
      makeEntry({ sourceId: 'c' }),
    ];
    const result = makeResult(entries);
    const report = buildConfidenceReport(result);

    expect(report.totalResources).toBe(3);
  });

  // -----------------------------------------------------------------------
  // Confidence breakdown tests
  // -----------------------------------------------------------------------

  it('includes breakdown with mapping, topology, policy, translationPath', () => {
    const entry = makeEntry({ sourceId: 'r1', confidence: 0.85 });
    const result = makeResult([entry]);
    const report = buildConfidenceReport(result);

    const bd = report.resources[0].breakdown;
    expect(bd).toBeDefined();
    expect(bd.mapping).toBe(0.85);
    expect(bd.topology).toBe(1.0);
    expect(bd.policy).toBe(1.0);
    expect(bd.translationPath).toBe(1.0);
  });

  it('topology factor reduced by TOPOLOGY_ findings', () => {
    const entry = makeEntry({ sourceId: 'r1', confidence: 0.9 });
    const findings: TranslationFinding[] = [
      makeFinding({ resourceId: 'r1', severity: 'warning', code: 'TOPOLOGY_ORPHAN', message: 'Orphaned subnet' }),
      makeFinding({ resourceId: 'r1', severity: 'warning', code: 'TOPOLOGY_LOOP', message: 'Loop detected' }),
    ];
    const result = makeResult([entry], findings);
    const report = buildConfidenceReport(result);

    // 1.0 - 2 * 0.15 = 0.7
    expect(report.resources[0].breakdown.topology).toBeCloseTo(0.7, 5);
    expect(report.resources[0].factors).toContain('Topology issues detected (0.7x)');
  });

  it('topology factor floors at 0.5', () => {
    const entry = makeEntry({ sourceId: 'r1', confidence: 0.9 });
    const findings: TranslationFinding[] = Array.from({ length: 10 }, (_, i) =>
      makeFinding({ resourceId: 'r1', severity: 'info', code: `TOPOLOGY_${i}`, message: `Issue ${i}` }),
    );
    const result = makeResult([entry], findings);
    const report = buildConfidenceReport(result);

    expect(report.resources[0].breakdown.topology).toBe(0.5);
  });

  it('policy factor reduced by blocker and warning findings', () => {
    const entry = makeEntry({
      sourceId: 'r1',
      confidence: 0.8,
      findings: [
        makeFinding({ severity: 'blocker', code: 'BLK_1', message: 'Blocked' }),
        makeFinding({ severity: 'warning', code: 'WARN_1', message: 'Warn 1' }),
        makeFinding({ severity: 'warning', code: 'WARN_2', message: 'Warn 2' }),
      ],
    });
    const result = makeResult([entry]);
    const report = buildConfidenceReport(result);

    // 1.0 - 1*0.5 - 2*0.1 = 0.3
    expect(report.resources[0].breakdown.policy).toBeCloseTo(0.3, 5);
  });

  it('policy factor floors at 0', () => {
    const entry = makeEntry({
      sourceId: 'r1',
      confidence: 0.2,
      findings: [
        makeFinding({ severity: 'blocker', code: 'BLK_1', message: 'a' }),
        makeFinding({ severity: 'blocker', code: 'BLK_2', message: 'b' }),
        makeFinding({ severity: 'blocker', code: 'BLK_3', message: 'c' }),
      ],
    });
    const result = makeResult([entry]);
    const report = buildConfidenceReport(result);

    expect(report.resources[0].breakdown.policy).toBe(0);
  });

  it('translationPath factor is 0.6 for generic-fallback', () => {
    const entry = makeEntry({
      sourceId: 'r1',
      confidence: 0.7,
      targetResources: [{
        targetType: 'azurerm_resource',
        targetName: 'r1',
        attributes: {},
        sourceId: 'r1',
        traceability: {
          sourceId: 'r1',
          sourceType: 'aws_instance',
          registryEntryId: null,
          mappingType: 'direct',
          confidence: 0.7,
          engineUsed: 'direct',
          translationPath: 'generic-fallback',
        },
      }],
    });
    const result = makeResult([entry]);
    const report = buildConfidenceReport(result);

    expect(report.resources[0].breakdown.translationPath).toBe(0.6);
    expect(report.resources[0].factors).toContain('Translation via generic fallback (0.6x)');
  });

  it('translationPath factor is 0.3 for advisory', () => {
    const entry = makeEntry({
      sourceId: 'r1',
      confidence: 0.3,
      status: 'advisory',
      targetResources: [{
        targetType: 'manual_resource',
        targetName: 'r1',
        attributes: {},
        sourceId: 'r1',
        traceability: {
          sourceId: 'r1',
          sourceType: 'aws_dynamodb_table',
          registryEntryId: null,
          mappingType: 'none',
          confidence: 0.3,
          engineUsed: 'advisory',
          translationPath: 'advisory',
        },
      }],
    });
    const result = makeResult([entry]);
    const report = buildConfidenceReport(result);

    expect(report.resources[0].breakdown.translationPath).toBe(0.3);
    expect(report.resources[0].factors).toContain('Translation via generic fallback (0.3x)');
  });

  it('overallBreakdown averages sub-components', () => {
    const entry1 = makeEntry({ sourceId: 'a', confidence: 0.8 });
    const entry2 = makeEntry({
      sourceId: 'b',
      confidence: 0.6,
      findings: [
        makeFinding({ severity: 'blocker', code: 'BLK_1', message: 'blocked' }),
      ],
    });
    const findings: TranslationFinding[] = [
      makeFinding({ resourceId: 'b', severity: 'info', code: 'TOPOLOGY_X', message: 'Topo issue' }),
    ];
    const result = makeResult([entry1, entry2], findings);
    const report = buildConfidenceReport(result);

    expect(report.overallBreakdown).toBeDefined();
    // mapping: avg(0.8, 0.6) = 0.7
    expect(report.overallBreakdown!.avgMapping).toBeCloseTo(0.7, 5);
    // topology: avg(1.0, 0.85) = 0.925
    expect(report.overallBreakdown!.avgTopology).toBeCloseTo(0.925, 5);
    // policy: avg(1.0, 0.5) = 0.75
    expect(report.overallBreakdown!.avgPolicy).toBeCloseTo(0.75, 5);
    // translationPath: avg(1.0, 1.0) = 1.0
    expect(report.overallBreakdown!.avgTranslationPath).toBeCloseTo(1.0, 5);
  });

  it('overallBreakdown is undefined for empty entries', () => {
    const result = makeResult([], []);
    const report = buildConfidenceReport(result);
    expect(report.overallBreakdown).toBeUndefined();
  });
});
