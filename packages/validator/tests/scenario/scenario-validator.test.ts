import { describe, it, expect } from 'vitest';
import { validateScenarios } from '../../src/scenario/scenario-validator.js';
import type { ManifestEntry, TranslationManifest } from '@tla/shared';

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    sourceId: 'aws_instance.web',
    sourceType: 'aws_instance',
    status: 'translated',
    targetResources: [],
    confidence: 0.9,
    findings: [],
    contract: null,
    ...overrides,
  };
}

function makeManifest(entries: ManifestEntry[]): TranslationManifest {
  return {
    version: '1.0.0',
    registryVersion: 'v2.1.0',
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

describe('validateScenarios', () => {
  it('passes when there are no contracts', () => {
    const report = validateScenarios(makeManifest([makeEntry()]));
    expect(report.result).toBe('pass');
    expect(report.summary.total).toBe(0);
  });

  it('warns on exposure and encryption review scenarios', () => {
    const report = validateScenarios(
      makeManifest([
        makeEntry({
          contract: {
            sourceId: 'aws_instance.web',
            targetIds: ['web'],
            preserved: [],
            transformed: ['public IP exposure intent preserved'],
            degraded: ['root volume encryption posture not preserved automatically from unencrypted source'],
            blockers: [],
            reviewRequired: ['review public ingress posture after migration'],
            confidenceFactors: ['public exposure requires environment-specific validation'],
          },
        }),
      ]),
    );

    expect(report.result).toBe('warn');
    expect(report.summary.warnings).toBeGreaterThan(0);
    expect(report.findings.some((f) => f.code === 'SCENARIO_EXPOSURE_REVIEW')).toBe(true);
    expect(report.findings.some((f) => f.code === 'SCENARIO_ENCRYPTION_REVIEW')).toBe(true);
  });

  it('fails when the scenario contract is blocked', () => {
    const report = validateScenarios(
      makeManifest([
        makeEntry({
          contract: {
            sourceId: 'aws_instance.web',
            targetIds: [],
            preserved: [],
            transformed: [],
            degraded: [],
            blockers: ['public compute exposure not permitted'],
            reviewRequired: ['review public ingress posture after migration'],
            confidenceFactors: [],
          },
        }),
      ]),
    );

    expect(report.result).toBe('fail');
    expect(report.summary.blockers).toBeGreaterThan(0);
    expect(report.findings.some((f) => f.code === 'SCENARIO_EXPOSURE_BLOCKED')).toBe(true);
  });
});
