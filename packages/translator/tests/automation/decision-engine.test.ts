import { describe, it, expect } from 'vitest';
import { evaluateAutomationDecision } from '../../src/automation/decision-engine.js';
import type { TranslationManifest } from '@tla/shared';

function makeManifest(overrides: Partial<TranslationManifest> = {}): TranslationManifest {
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
              mappingType: 'compound',
              confidence: 0.9,
              engineUsed: 'compound/ec2',
              translationPath: 'specialized',
            },
          },
        ],
        confidence: 0.9,
        findings: [],
        contract: null,
      },
    ],
    findings: [],
    confidenceOverall: 0.9,
    ...overrides,
  };
}

describe('evaluateAutomationDecision', () => {
  it('approves assisted mode', () => {
    const decision = evaluateAutomationDecision({ mode: 'assisted', manifest: makeManifest() });
    expect(decision.status).toBe('approved');
  });

  it('requires approval for degraded guarded automation output', () => {
    const manifest = makeManifest({
      entries: [{
        ...makeManifest().entries[0],
        contract: {
          sourceId: 'aws_instance.web',
          targetIds: ['web'],
          preserved: [],
          transformed: [],
          degraded: ['network boundary changed'],
          blockers: [],
          reviewRequired: ['review ingress'],
          confidenceFactors: [],
        },
      }],
    });

    const decision = evaluateAutomationDecision({ mode: 'guarded-auto', manifest });
    expect(decision.status).toBe('approval_required');
    expect(decision.reasons).toContain('contract_review_required');
  });

  it('blocks when manifest blockers exist', () => {
    const manifest = makeManifest({
      counts: { ...makeManifest().counts, blocked: 1, translated: 0 },
    });
    const decision = evaluateAutomationDecision({ mode: 'guarded-auto', manifest });
    expect(decision.status).toBe('blocked');
    expect(decision.reasons).toContain('manifest_blockers');
  });

  it('marks unattended mode as not eligible when review gates remain', () => {
    const manifest = makeManifest({ confidenceOverall: 0.6 });
    const decision = evaluateAutomationDecision({ mode: 'unattended', manifest });
    expect(decision.status).toBe('not_eligible');
    expect(decision.reasons).toContain('confidence_below_threshold');
  });
});
