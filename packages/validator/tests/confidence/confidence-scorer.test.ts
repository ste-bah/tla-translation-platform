// ---------------------------------------------------------------------------
// Tests for TASK-VAL-006: Confidence Scoring System
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  scoreConfidence,
  computePolicyFactor,
  classificationToSemanticStatus,
  scoreToBand,
  type ResourceConfidenceInput,
  type ConfidenceInputs,
} from '../../src/confidence/confidence-scorer.js';
import { generateConfidenceReport } from '../../src/confidence/confidence-report-generator.js';
import type { AwsServiceFamily } from '@tla/shared';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<ResourceConfidenceInput> = {}): ResourceConfidenceInput {
  return {
    resourceId: 'aws_instance.web',
    serviceFamily: 'compute' as AwsServiceFamily,
    registryConfidence: 0.9,
    validationStatus: 'clean',
    semanticStatus: 'preserved',
    policyWarnings: 0,
    policyFailures: 0,
    reviewCritical: false,
    ...overrides,
  };
}

function makeInputs(resources: ResourceConfidenceInput[]): ConfidenceInputs {
  return { resources };
}

// ---------------------------------------------------------------------------
// 1. computePolicyFactor
// ---------------------------------------------------------------------------

describe('computePolicyFactor', () => {
  it('returns 1.0 for zero warnings and failures', () => {
    expect(computePolicyFactor(0, 0)).toBe(1.0);
  });

  it('applies 0.9 per warning', () => {
    expect(computePolicyFactor(1, 0)).toBeCloseTo(0.9, 5);
    expect(computePolicyFactor(2, 0)).toBeCloseTo(0.81, 5);
  });

  it('applies 0.7 per failure', () => {
    expect(computePolicyFactor(0, 1)).toBeCloseTo(0.7, 5);
    expect(computePolicyFactor(0, 2)).toBeCloseTo(0.49, 5);
  });

  it('combines warnings and failures multiplicatively', () => {
    expect(computePolicyFactor(1, 1)).toBeCloseTo(0.9 * 0.7, 5);
    expect(computePolicyFactor(2, 1)).toBeCloseTo(0.81 * 0.7, 5);
  });

  it('clamps to [0.0, 1.0]', () => {
    // With very large counts the result trends toward 0, never negative
    const result = computePolicyFactor(100, 100);
    expect(result).toBeGreaterThanOrEqual(0.0);
    expect(result).toBeLessThanOrEqual(1.0);
  });
});

// ---------------------------------------------------------------------------
// 2. classificationToSemanticStatus
// ---------------------------------------------------------------------------

describe('classificationToSemanticStatus', () => {
  it('maps equivalent → preserved', () => {
    expect(classificationToSemanticStatus('equivalent')).toBe('preserved');
  });

  it('maps partial → transformed', () => {
    expect(classificationToSemanticStatus('partial')).toBe('transformed');
  });

  it('maps degraded → partial', () => {
    expect(classificationToSemanticStatus('degraded')).toBe('partial');
  });

  it('maps missing → missing', () => {
    expect(classificationToSemanticStatus('missing')).toBe('missing');
  });
});

// ---------------------------------------------------------------------------
// 3. scoreToBand
// ---------------------------------------------------------------------------

describe('scoreToBand', () => {
  it('returns high for score >= 0.80', () => {
    expect(scoreToBand(0.80)).toBe('high');
    expect(scoreToBand(1.0)).toBe('high');
    expect(scoreToBand(0.95)).toBe('high');
  });

  it('returns medium for 0.60 <= score < 0.80', () => {
    expect(scoreToBand(0.60)).toBe('medium');
    expect(scoreToBand(0.79)).toBe('medium');
    expect(scoreToBand(0.65)).toBe('medium');
  });

  it('returns low for 0.40 <= score < 0.60', () => {
    expect(scoreToBand(0.40)).toBe('low');
    expect(scoreToBand(0.59)).toBe('low');
    expect(scoreToBand(0.50)).toBe('low');
  });

  it('returns very_low for score < 0.40', () => {
    expect(scoreToBand(0.39)).toBe('very_low');
    expect(scoreToBand(0.0)).toBe('very_low');
    expect(scoreToBand(0.20)).toBe('very_low');
  });
});

// ---------------------------------------------------------------------------
// 4. scoreConfidence — high confidence scenario
// ---------------------------------------------------------------------------

describe('scoreConfidence — high confidence', () => {
  it('produces a high-band score for a clean, fully-equivalent resource', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ registryConfidence: 0.95 }),
    ]));

    expect(report.overall).toBeCloseTo(0.95, 5);
    expect(report.overallBand).toBe('high');
    expect(report.escalationRequired).toBe(false);
    expect(report.reviewRequired).toHaveLength(0);
  });

  it('sets byResource entry with correct factors', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ resourceId: 'res-1', registryConfidence: 0.9 }),
    ]));

    const rc = report.byResource.get('res-1');
    expect(rc).toBeDefined();
    expect(rc!.score).toBeCloseTo(0.9, 5);
    expect(rc!.factors.registryConfidence).toBe(0.9);
    expect(rc!.factors.validationFactor).toBe(1.0);
    expect(rc!.factors.semanticFactor).toBe(1.0);
    expect(rc!.factors.policyFactor).toBe(1.0);
  });

  it('sets byFamily entry correctly', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ serviceFamily: 'compute', registryConfidence: 0.9 }),
    ]));

    expect(report.byFamily.get('compute')).toBeCloseTo(0.9, 5);
  });
});

// ---------------------------------------------------------------------------
// 5. scoreConfidence — validation factor
// ---------------------------------------------------------------------------

describe('scoreConfidence — validation factor', () => {
  it('applies factor 0.5 for warnings', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ registryConfidence: 1.0, validationStatus: 'warnings' }),
    ]));
    expect(report.overall).toBeCloseTo(0.5, 5);
    expect(report.overallBand).toBe('low');
  });

  it('applies factor 0.0 for errors → very_low band', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ registryConfidence: 1.0, validationStatus: 'errors' }),
    ]));
    expect(report.overall).toBeCloseTo(0.0, 5);
    expect(report.overallBand).toBe('very_low');
  });
});

// ---------------------------------------------------------------------------
// 6. scoreConfidence — semantic factor
// ---------------------------------------------------------------------------

describe('scoreConfidence — semantic factor', () => {
  it('applies factor 0.8 for transformed semantics', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ registryConfidence: 1.0, semanticStatus: 'transformed' }),
    ]));
    expect(report.overall).toBeCloseTo(0.8, 5);
  });

  it('applies factor 0.5 for partial semantics', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ registryConfidence: 1.0, semanticStatus: 'partial' }),
    ]));
    expect(report.overall).toBeCloseTo(0.5, 5);
  });

  it('applies factor 0.2 for missing semantics', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ registryConfidence: 1.0, semanticStatus: 'missing' }),
    ]));
    expect(report.overall).toBeCloseTo(0.2, 5);
  });
});

// ---------------------------------------------------------------------------
// 7. scoreConfidence — policy factor
// ---------------------------------------------------------------------------

describe('scoreConfidence — policy factor', () => {
  it('reduces score for policy warnings', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ registryConfidence: 1.0, policyWarnings: 2 }),
    ]));
    expect(report.overall).toBeCloseTo(Math.pow(0.9, 2), 5);
  });

  it('reduces score for policy failures', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ registryConfidence: 1.0, policyFailures: 1 }),
    ]));
    expect(report.overall).toBeCloseTo(0.7, 5);
  });

  it('combines warnings and failures', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ registryConfidence: 1.0, policyWarnings: 1, policyFailures: 1 }),
    ]));
    expect(report.overall).toBeCloseTo(0.9 * 0.7, 5);
  });
});

// ---------------------------------------------------------------------------
// 8. scoreConfidence — mixed confidence scenario
// ---------------------------------------------------------------------------

describe('scoreConfidence — mixed confidence', () => {
  it('computes weighted family averages correctly', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ resourceId: 'res-1', serviceFamily: 'compute', registryConfidence: 1.0 }),
      makeInput({ resourceId: 'res-2', serviceFamily: 'compute', registryConfidence: 0.6 }),
      makeInput({ resourceId: 'res-3', serviceFamily: 'networking', registryConfidence: 0.8 }),
    ]));

    const computeScore = report.byFamily.get('compute')!;
    const netScore = report.byFamily.get('networking')!;

    // compute average = (1.0 + 0.6) / 2 = 0.8
    expect(computeScore).toBeCloseTo(0.8, 5);
    // networking = 0.8
    expect(netScore).toBeCloseTo(0.8, 5);
  });

  it('includes all resources in byResource map', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ resourceId: 'r1' }),
      makeInput({ resourceId: 'r2' }),
      makeInput({ resourceId: 'r3' }),
    ]));

    expect(report.byResource.size).toBe(3);
    expect(report.byResource.has('r1')).toBe(true);
    expect(report.byResource.has('r2')).toBe(true);
    expect(report.byResource.has('r3')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. scoreConfidence — escalation
// ---------------------------------------------------------------------------

describe('scoreConfidence — escalation', () => {
  it('sets escalationRequired=false when all resources >= 0.60', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ resourceId: 'r1', registryConfidence: 0.9 }),
      makeInput({ resourceId: 'r2', registryConfidence: 0.75 }),
    ]));

    expect(report.escalationRequired).toBe(false);
    expect(report.reviewRequired).toHaveLength(0);
  });

  it('sets escalationRequired=true when any resource < 0.60', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ resourceId: 'r1', registryConfidence: 0.9 }),
      makeInput({ resourceId: 'r2', registryConfidence: 1.0, validationStatus: 'errors' }),
    ]));

    expect(report.escalationRequired).toBe(true);
    expect(report.reviewRequired).toContain('r2');
  });

  it('includes all under-threshold resources in reviewRequired', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ resourceId: 'r1', registryConfidence: 1.0, validationStatus: 'errors' }),
      makeInput({ resourceId: 'r2', registryConfidence: 1.0, semanticStatus: 'missing' }),
      makeInput({ resourceId: 'r3', registryConfidence: 0.9 }),
    ]));

    expect(report.reviewRequired).toContain('r1');
    expect(report.reviewRequired).toContain('r2');
    expect(report.reviewRequired).not.toContain('r3');
    expect(report.escalationRequired).toBe(true);
  });

  it('triggers escalation at the exact 0.60 boundary — exactly 0.60 does NOT escalate', () => {
    // 0.60 / 1.0 / 1.0 / 1.0 = 0.60, which is >= 0.60 → no escalation
    const report = scoreConfidence(makeInputs([
      makeInput({ registryConfidence: 0.60 }),
    ]));
    expect(report.escalationRequired).toBe(false);
  });

  it('triggers escalation when score is just below 0.60', () => {
    // Use validation warnings to push just under the boundary
    // 0.60 * 0.5 = 0.30 < 0.60 → escalation
    const report = scoreConfidence(makeInputs([
      makeInput({ registryConfidence: 0.60, validationStatus: 'warnings' }),
    ]));
    expect(report.escalationRequired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. scoreConfidence — review-critical domain weighting
// ---------------------------------------------------------------------------

describe('scoreConfidence — review-critical weighting', () => {
  it('gives more weight to review-critical resources in overall score', () => {
    // Two resources: one high-score non-critical, one low-score critical
    // Without weighting: (0.9 + 0.3) / 2 = 0.6
    // With 1.5x for critical: (0.9 * 1.0 + 0.3 * 1.5) / (1.0 + 1.5) = (0.9 + 0.45) / 2.5 = 0.54
    const report = scoreConfidence(makeInputs([
      makeInput({ resourceId: 'r1', registryConfidence: 0.9, reviewCritical: false }),
      makeInput({ resourceId: 'r2', registryConfidence: 1.0, semanticStatus: 'missing', reviewCritical: true }),
    ]));

    const r2Score = 1.0 * 1.0 * 0.2 * 1.0; // 0.2
    const expected = (0.9 * 1.0 + r2Score * 1.5) / (1.0 + 1.5);
    expect(report.overall).toBeCloseTo(expected, 5);
  });

  it('uses standard weight 1.0 for non-critical resources', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ resourceId: 'r1', registryConfidence: 0.8, reviewCritical: false }),
      makeInput({ resourceId: 'r2', registryConfidence: 0.6, reviewCritical: false }),
    ]));

    // unweighted average
    expect(report.overall).toBeCloseTo((0.8 + 0.6) / 2, 5);
  });
});

// ---------------------------------------------------------------------------
// 11. scoreConfidence — factor breakdown
// ---------------------------------------------------------------------------

describe('scoreConfidence — factor breakdown', () => {
  it('exposes per-resource factor details', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({
        resourceId: 'res',
        registryConfidence: 0.8,
        validationStatus: 'warnings',
        semanticStatus: 'transformed',
        policyWarnings: 1,
        policyFailures: 0,
      }),
    ]));

    const rc = report.byResource.get('res')!;
    expect(rc.factors.registryConfidence).toBe(0.8);
    expect(rc.factors.validationFactor).toBe(0.5);
    expect(rc.factors.semanticFactor).toBe(0.8);
    expect(rc.factors.policyFactor).toBeCloseTo(0.9, 5);
    expect(rc.score).toBeCloseTo(0.8 * 0.5 * 0.8 * 0.9, 5);
  });

  it('exposes stack-level factor averages', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ registryConfidence: 0.8, validationStatus: 'clean' }),
      makeInput({ resourceId: 'r2', registryConfidence: 0.6, validationStatus: 'warnings' }),
    ]));

    expect(report.factors.avgRegistryConfidence).toBeCloseTo((0.8 + 0.6) / 2, 5);
    expect(report.factors.avgValidationFactor).toBeCloseTo((1.0 + 0.5) / 2, 5);
  });
});

// ---------------------------------------------------------------------------
// 12. scoreConfidence — empty inputs
// ---------------------------------------------------------------------------

describe('scoreConfidence — empty inputs', () => {
  it('returns zero overall score for empty resource list', () => {
    const report = scoreConfidence(makeInputs([]));
    expect(report.overall).toBe(0);
    expect(report.overallBand).toBe('very_low');
    expect(report.byResource.size).toBe(0);
    expect(report.byFamily.size).toBe(0);
    expect(report.escalationRequired).toBe(false);
    expect(report.reviewRequired).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 13. scoreConfidence — determinism
// ---------------------------------------------------------------------------

describe('scoreConfidence — determinism', () => {
  it('produces identical results on repeated calls with same inputs', () => {
    const inputs: ConfidenceInputs = makeInputs([
      makeInput({ resourceId: 'r1', registryConfidence: 0.85, policyWarnings: 1 }),
      makeInput({ resourceId: 'r2', registryConfidence: 0.70, validationStatus: 'warnings', semanticStatus: 'partial' }),
    ]);

    const result1 = scoreConfidence(inputs);
    const result2 = scoreConfidence(inputs);

    expect(result1.overall).toBe(result2.overall);
    expect(result1.overallBand).toBe(result2.overallBand);
    expect(result1.escalationRequired).toBe(result2.escalationRequired);
    expect(result1.byResource.get('r1')!.score).toBe(result2.byResource.get('r1')!.score);
    expect(result1.byResource.get('r2')!.score).toBe(result2.byResource.get('r2')!.score);
  });
});

// ---------------------------------------------------------------------------
// 14. generateConfidenceReport
// ---------------------------------------------------------------------------

describe('generateConfidenceReport', () => {
  it('generates a non-empty Markdown string', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ resourceId: 'res-1', registryConfidence: 0.9 }),
    ]));
    const md = generateConfidenceReport(report);
    expect(typeof md).toBe('string');
    expect(md.length).toBeGreaterThan(0);
    expect(md).toContain('# Translation Confidence Report');
  });

  it('includes overall band in the report', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ registryConfidence: 0.9 }),
    ]));
    const md = generateConfidenceReport(report);
    expect(md).toContain('HIGH');
  });

  it('includes escalation warning when escalation is required', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ resourceId: 'r1', registryConfidence: 1.0, validationStatus: 'errors' }),
    ]));
    const md = generateConfidenceReport(report);
    expect(md).toContain('ESCALATION REQUIRED');
  });

  it('does not include escalation warning when not required', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ registryConfidence: 0.9 }),
    ]));
    const md = generateConfidenceReport(report);
    expect(md).not.toContain('ESCALATION REQUIRED');
  });

  it('includes service family section', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ serviceFamily: 'compute' }),
    ]));
    const md = generateConfidenceReport(report);
    expect(md).toContain('Service Family');
    expect(md).toContain('compute');
  });

  it('includes factor definitions legend', () => {
    const report = scoreConfidence(makeInputs([makeInput()]));
    const md = generateConfidenceReport(report);
    expect(md).toContain('Factor Definitions');
    expect(md).toContain('Registry Confidence');
    expect(md).toContain('Validation Factor');
    expect(md).toContain('Semantic Factor');
    expect(md).toContain('Policy Factor');
  });

  it('includes lowest-confidence resources section', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ resourceId: 'r1', registryConfidence: 0.5, validationStatus: 'warnings' }),
      makeInput({ resourceId: 'r2', registryConfidence: 0.9 }),
    ]));
    const md = generateConfidenceReport(report);
    expect(md).toContain('Lowest-Confidence Resources');
    expect(md).toContain('r1');
  });

  it('handles empty report without throwing', () => {
    const report = scoreConfidence(makeInputs([]));
    expect(() => generateConfidenceReport(report)).not.toThrow();
  });

  it('respects topN option', () => {
    const resources = Array.from({ length: 15 }, (_, i) =>
      makeInput({ resourceId: `res-${i}`, registryConfidence: 0.5 + i * 0.02 })
    );
    const report = scoreConfidence(makeInputs(resources));
    const md = generateConfidenceReport(report, { topN: 5 });
    // Should mention 5 of 15
    expect(md).toContain('5 of 15');
  });

  it('includes stack-level factor breakdown', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ registryConfidence: 0.8, policyWarnings: 1 }),
    ]));
    const md = generateConfidenceReport(report);
    expect(md).toContain('Stack-Level Factor Breakdown');
    expect(md).toContain('Registry Confidence (avg)');
  });

  it('marks review-critical resources in lowest-confidence list', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ resourceId: 'critical-sg', reviewCritical: true, registryConfidence: 0.5 }),
    ]));
    const md = generateConfidenceReport(report);
    // Review-critical resources are marked with ⭐
    expect(md).toContain('critical-sg');
  });
});

// ---------------------------------------------------------------------------
// 15. End-to-end: all-green scenario
// ---------------------------------------------------------------------------

describe('scoreConfidence — end-to-end all-green', () => {
  it('all resources high-confidence → no escalation, high band', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({ resourceId: 'r1', registryConfidence: 0.95, serviceFamily: 'compute' }),
      makeInput({ resourceId: 'r2', registryConfidence: 0.90, serviceFamily: 'storage' }),
      makeInput({ resourceId: 'r3', registryConfidence: 0.85, serviceFamily: 'networking', reviewCritical: true }),
    ]));

    expect(report.escalationRequired).toBe(false);
    expect(report.reviewRequired).toHaveLength(0);
    expect(report.overallBand).toBe('high');
    expect(report.byFamily.has('compute')).toBe(true);
    expect(report.byFamily.has('storage')).toBe(true);
    expect(report.byFamily.has('networking')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 16. End-to-end: low-confidence scenario with multiple issues
// ---------------------------------------------------------------------------

describe('scoreConfidence — end-to-end low confidence', () => {
  it('multiple degraded resources → escalation, very_low possible', () => {
    const report = scoreConfidence(makeInputs([
      makeInput({
        resourceId: 'sg-1',
        serviceFamily: 'security',
        registryConfidence: 0.7,
        validationStatus: 'errors',
        semanticStatus: 'missing',
        policyFailures: 2,
        reviewCritical: true,
      }),
      makeInput({
        resourceId: 'vm-1',
        serviceFamily: 'compute',
        registryConfidence: 0.5,
        validationStatus: 'warnings',
        semanticStatus: 'partial',
        policyWarnings: 3,
      }),
    ]));

    expect(report.escalationRequired).toBe(true);
    expect(report.reviewRequired.length).toBeGreaterThanOrEqual(1);
    expect(['low', 'very_low']).toContain(report.overallBand);

    const sg = report.byResource.get('sg-1')!;
    expect(sg.score).toBeCloseTo(0, 1); // errors → validation_factor = 0 → score = 0
    expect(sg.band).toBe('very_low');

    const vm = report.byResource.get('vm-1')!;
    // 0.5 * 0.5 * 0.5 * 0.9^3 ≈ 0.0911
    expect(vm.score).toBeCloseTo(0.5 * 0.5 * 0.5 * Math.pow(0.9, 3), 4);
    expect(vm.band).toBe('very_low');
  });
});
