import type { TranslationManifest, ManifestEntry, TranslationFinding } from '@tla/shared';

export type ScenarioValidationSeverity = 'blocker' | 'warning' | 'info';
export type ScenarioValidationResult = 'pass' | 'warn' | 'fail';

export interface ScenarioValidationFinding {
  readonly scenario: string;
  readonly resourceId: string;
  readonly severity: ScenarioValidationSeverity;
  readonly code: string;
  readonly message: string;
}

export interface ScenarioValidationSummary {
  readonly total: number;
  readonly blockers: number;
  readonly warnings: number;
  readonly infos: number;
}

export interface ScenarioValidationReport {
  readonly result: ScenarioValidationResult;
  readonly findings: ScenarioValidationFinding[];
  readonly summary: ScenarioValidationSummary;
}

function hasText(items: readonly string[] | undefined, patterns: RegExp[]): boolean {
  if (!items || items.length === 0) return false;
  const text = items.join(' ').toLowerCase();
  return patterns.some((pattern) => pattern.test(text));
}

function contractTexts(entry: ManifestEntry): string[] {
  const contract = entry.contract;
  if (!contract) return [];
  return [
    ...contract.preserved,
    ...contract.transformed,
    ...contract.degraded,
    ...contract.blockers,
    ...contract.reviewRequired,
    ...contract.confidenceFactors,
  ];
}

function pushFinding(
  findings: ScenarioValidationFinding[],
  scenario: string,
  resourceId: string,
  severity: ScenarioValidationSeverity,
  code: string,
  message: string,
): void {
  findings.push({ scenario, resourceId, severity, code, message });
}

function evaluateEntry(findings: ScenarioValidationFinding[], entry: ManifestEntry): void {
  const contract = entry.contract;
  if (!contract) return;

  const allTexts = contractTexts(entry);

  if (hasText(allTexts, [/public/, /ingress/, /internet-facing/, /website hosting/])) {
    const severity: ScenarioValidationSeverity = contract.blockers.length > 0 ? 'blocker' : 'warning';
    pushFinding(
      findings,
      'exposure-posture',
      entry.sourceId,
      severity,
      severity === 'blocker' ? 'SCENARIO_EXPOSURE_BLOCKED' : 'SCENARIO_EXPOSURE_REVIEW',
      severity === 'blocker'
        ? 'Public or ingress-sensitive workload shape is blocked and not eligible for automated progression.'
        : 'Public or ingress-sensitive workload shape requires review before migration proceeds.',
    );
  }

  if (hasText(allTexts, [/encrypt/, /kms/, /unencrypted/])) {
    const severity: ScenarioValidationSeverity = hasText(contract.degraded, [/unencrypted/]) ? 'warning' : 'info';
    pushFinding(
      findings,
      'encryption-posture',
      entry.sourceId,
      severity,
      severity === 'warning' ? 'SCENARIO_ENCRYPTION_REVIEW' : 'SCENARIO_ENCRYPTION_NOTE',
      severity === 'warning'
        ? 'Encryption posture is degraded or requires review in the translated scenario.'
        : 'Encryption posture was transformed and should be verified in the target cloud.',
    );
  }

  if (hasText(allTexts, [/replication/, /retention/, /object lock/, /immutable/])) {
    pushFinding(
      findings,
      'durability-retention',
      entry.sourceId,
      'warning',
      'SCENARIO_DURABILITY_REVIEW',
      'Durability, retention, or replication semantics require scenario-level review.',
    );
  }

  if (hasText(allTexts, [/manual target-side wiring/, /firewall/, /security group semantics/])) {
    pushFinding(
      findings,
      'network-boundary',
      entry.sourceId,
      'warning',
      'SCENARIO_NETWORK_BOUNDARY_REVIEW',
      'Network boundary behaviour is only partially automated and requires scenario review.',
    );
  }
}

/**
 * Evaluate scenario-level validation across all manifest entries.
 *
 * Examines contract data (preserved, transformed, degraded, blockers,
 * reviewRequired, confidenceFactors) to detect cross-cutting risk patterns:
 * exposure posture, encryption posture, durability/retention, and network
 * boundary behaviour.
 *
 * @param manifest - The translation manifest containing entries with contracts.
 * @returns A scenario validation report with findings and pass/warn/fail result.
 */
export function validateScenarios(manifest: TranslationManifest): ScenarioValidationReport {
  const findings: ScenarioValidationFinding[] = [];

  for (const entry of manifest.entries) {
    evaluateEntry(findings, entry);
  }

  const summary: ScenarioValidationSummary = {
    total: findings.length,
    blockers: findings.filter((f) => f.severity === 'blocker').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
    infos: findings.filter((f) => f.severity === 'info').length,
  };

  const result: ScenarioValidationResult =
    summary.blockers > 0 ? 'fail' : summary.warnings > 0 ? 'warn' : 'pass';

  return { result, findings, summary };
}
