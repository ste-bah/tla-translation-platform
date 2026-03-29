import type { TranslationManifest } from '@tla/shared';

export interface SupportedUnattendedScenario {
  readonly id: string;
  readonly description: string;
}

export const SUPPORTED_UNATTENDED_SCENARIOS: readonly SupportedUnattendedScenario[] = [
  {
    id: 'single-s3-bucket',
    description: 'Single translated S3 bucket with no degraded or review-required behaviour.',
  },
  {
    id: 'single-private-ec2',
    description: 'Single translated EC2 instance with no public exposure and no degraded or review-required behaviour.',
  },
];

function cleanContract(entry: TranslationManifest['entries'][number]): boolean {
  const contract = entry.contract;
  if (!contract) return false;
  return contract.blockers.length === 0 && contract.degraded.length === 0 && contract.reviewRequired.length === 0;
}

/**
 * Classify whether a translation manifest matches a supported unattended scenario.
 *
 * Only single-resource manifests with clean contracts (zero blockers, degraded,
 * and review-required items) and confidence >= 0.85 are eligible. Currently
 * supports: single-s3-bucket, single-private-ec2.
 *
 * @returns The scenario ID string, or null if the manifest does not match any supported scenario.
 */
export function classifySupportedUnattendedScenario(manifest: TranslationManifest): string | null {
  if (manifest.entries.length !== 1) return null;
  if (manifest.counts.blocked > 0 || manifest.counts.advisory > 0 || manifest.counts.partial > 0) return null;

  const entry = manifest.entries[0]!;
  if (!cleanContract(entry) || entry.confidence < 0.85) return null;

  if (entry.sourceType === 'aws_s3_bucket') {
    return 'single-s3-bucket';
  }

  if (entry.sourceType === 'aws_instance') {
    const contractText = [
      ...(entry.contract?.transformed ?? []),
      ...(entry.contract?.confidenceFactors ?? []),
      ...(entry.contract?.preserved ?? []),
    ].join(' ').toLowerCase();

    if (contractText.includes('public')) return null;
    if (contractText.includes('ingress')) return null;
    return 'single-private-ec2';
  }

  return null;
}
