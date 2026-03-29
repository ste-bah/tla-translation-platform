import { describe, it, expect } from 'vitest';
import { classifySupportedUnattendedScenario } from '../../src/automation/unattended-catalogue.js';
import { evaluateAutomationDecision } from '../../src/automation/decision-engine.js';
import type { TranslationManifest } from '@tla/shared';

function makeManifest(sourceType: string, overrides: Partial<TranslationManifest> = {}): TranslationManifest {
  return {
    version: '1.0.0',
    registryVersion: 'v2.1.0',
    target: 'azure',
    counts: {
      total: 1,
      translated: 1,
      expanded: 0,
      partial: 0,
      blocked: 0,
      advisory: 0,
    },
    entries: [
      {
        sourceId: `${sourceType}.example`,
        sourceType,
        status: 'translated',
        targetResources: [],
        confidence: 0.9,
        findings: [],
        contract: {
          sourceId: `${sourceType}.example`,
          targetIds: ['target'],
          preserved: ['mapped'],
          transformed: [],
          degraded: [],
          blockers: [],
          reviewRequired: [],
          confidenceFactors: [],
        },
      },
    ],
    findings: [],
    confidenceOverall: 0.9,
    ...overrides,
  };
}

describe('unattended scenario catalogue', () => {
  it('classifies a simple S3 bucket as supported', () => {
    const scenario = classifySupportedUnattendedScenario(makeManifest('aws_s3_bucket'));
    expect(scenario).toBe('single-s3-bucket');
  });

  it('rejects EC2 scenarios that mention public exposure', () => {
    const scenario = classifySupportedUnattendedScenario(
      makeManifest('aws_instance', {
        entries: [{
          ...makeManifest('aws_instance').entries[0],
          contract: {
            sourceId: 'aws_instance.example',
            targetIds: ['target'],
            preserved: [],
            transformed: ['public IP exposure intent preserved'],
            degraded: [],
            blockers: [],
            reviewRequired: [],
            confidenceFactors: [],
          },
        }],
      }),
    );
    expect(scenario).toBeNull();
  });

  it('marks unsupported unattended scenarios as not eligible', () => {
    const decision = evaluateAutomationDecision({
      mode: 'unattended',
      manifest: makeManifest('aws_lambda_function'),
    });
    expect(decision.status).toBe('not_eligible');
    expect(decision.reasons).toContain('unsupported_unattended_scenario');
  });
});
