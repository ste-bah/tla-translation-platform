import { describe, it, expect } from 'vitest';
import { generateTranslationReport } from '../../src/report/translation-report.js';
import type { ManifestEntry, TranslationManifest } from '@tla/shared';

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
          mappingType: 'compound',
          confidence: 0.9,
          engineUsed: 'compound/ec2',
        },
      },
    ],
    confidence: 0.9,
    findings: [],
    contract: null,
    ...overrides,
  };
}

function makeManifest(entry: ManifestEntry): TranslationManifest {
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
    entries: [entry],
    findings: [],
    confidenceOverall: 0.9,
  };
}

describe('behavior contract report section', () => {
  it('shows an empty-state message when no contracts exist', () => {
    const report = generateTranslationReport({
      manifest: makeManifest(makeManifestEntry({ contract: null })),
    });

    expect(report).toContain('## Behaviour Contract Summary');
    expect(report).toContain('No behaviour contracts recorded');
  });

  it('renders preserved, transformed, degraded, blockers, and review-required lists', () => {
    const report = generateTranslationReport({
      manifest: makeManifest(
        makeManifestEntry({
          contract: {
            sourceId: 'aws_instance.web',
            targetIds: ['web'],
            preserved: ['guest OS family inferred and mapped'],
            transformed: ['AMI-to-image mapping replaced with target image selection'],
            degraded: ['security group associations require manual target-side wiring'],
            blockers: ['public compute exposure not permitted'],
            reviewRequired: ['review public ingress posture after migration'],
            confidenceFactors: ['public exposure requires environment-specific validation'],
          },
        }),
      ),
    });

    expect(report).toContain('## Behaviour Contract Summary');
    expect(report).toContain('aws_instance.web');
    expect(report).toContain('**Preserved**');
    expect(report).toContain('guest OS family inferred and mapped');
    expect(report).toContain('**Transformed**');
    expect(report).toContain('AMI-to-image mapping replaced with target image selection');
    expect(report).toContain('**Degraded**');
    expect(report).toContain('security group associations require manual target-side wiring');
    expect(report).toContain('**Blockers**');
    expect(report).toContain('public compute exposure not permitted');
    expect(report).toContain('**Review required**');
    expect(report).toContain('review public ingress posture after migration');
    expect(report).toContain('**Confidence factors**');
    expect(report).toContain('public exposure requires environment-specific validation');
  });
});
