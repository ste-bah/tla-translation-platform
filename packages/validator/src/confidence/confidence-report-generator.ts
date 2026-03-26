// ---------------------------------------------------------------------------
// Confidence Report Generator  (TASK-VAL-006)
//
// Generates a human-readable Markdown report from a ConfidenceReport.
// Designed to be embedded in the translation manifest or emitted as a
// standalone file.
// ---------------------------------------------------------------------------

import type { ConfidenceReport, ResourceConfidence, ConfidenceBand } from './confidence-scorer.js';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function bandLabel(band: ConfidenceBand): string {
  switch (band) {
    case 'high':     return 'HIGH';
    case 'medium':   return 'MEDIUM';
    case 'low':      return 'LOW';
    case 'very_low': return 'VERY LOW';
  }
}

function bandEmoji(band: ConfidenceBand): string {
  switch (band) {
    case 'high':     return '✅';
    case 'medium':   return '⚠️';
    case 'low':      return '🔶';
    case 'very_low': return '🚫';
  }
}

function factorRow(label: string, value: number): string {
  return `| ${label.padEnd(28)} | ${pct(value).padStart(8)} |`;
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildHeader(report: ConfidenceReport): string {
  const escalationLine = report.escalationRequired
    ? '> **ESCALATION REQUIRED** — one or more resources have confidence < 60%. Human review is mandatory.\n'
    : '';

  return [
    '# Translation Confidence Report',
    '',
    escalationLine,
    `**Overall Confidence:** ${pct(report.overall)} — ${bandEmoji(report.overallBand)} ${bandLabel(report.overallBand)}`,
    '',
    '## Score Bands',
    '',
    '| Band      | Range        | Action                                            |',
    '|-----------|--------------|---------------------------------------------------|',
    '| HIGH      | ≥ 80%        | Auto-review eligible (subject to domain rules)    |',
    '| MEDIUM    | 60–79%       | Human review recommended                          |',
    '| LOW       | 40–59%       | Human review mandatory                            |',
    '| VERY LOW  | < 40%        | Advisory only — manual translation likely needed  |',
    '',
  ].join('\n');
}

function buildFactorsSection(report: ConfidenceReport): string {
  const f = report.factors;
  return [
    '## Stack-Level Factor Breakdown',
    '',
    '> Averages across all resources. Review-critical domains (security, identity,',
    '> networking) carry 1.5× weight in the overall stack score.',
    '',
    '| Factor                        |    Value |',
    '|-------------------------------|----------|',
    factorRow('Registry Confidence (avg)',   f.avgRegistryConfidence),
    factorRow('Validation Factor (avg)',      f.avgValidationFactor),
    factorRow('Semantic Factor (avg)',        f.avgSemanticFactor),
    factorRow('Policy Factor (avg)',          f.avgPolicyFactor),
    '',
  ].join('\n');
}

function buildFamilySection(report: ConfidenceReport): string {
  if (report.byFamily.size === 0) {
    return '## Confidence by Service Family\n\n_No resources to report._\n\n';
  }

  // Sort families by score ascending (worst first)
  const rows = [...report.byFamily.entries()]
    .sort(([, a], [, b]) => a - b)
    .map(([family, score]) => {
      const band = report.byResource.size > 0
        ? // derive band from score
          score >= 0.80 ? 'high' : score >= 0.60 ? 'medium' : score >= 0.40 ? 'low' : 'very_low'
        : 'very_low';
      return `| ${family.padEnd(20)} | ${pct(score).padStart(8)} | ${bandEmoji(band as ConfidenceBand)} ${bandLabel(band as ConfidenceBand)} |`;
    });

  return [
    '## Confidence by Service Family',
    '',
    '| Service Family       |    Score | Band           |',
    '|----------------------|----------|----------------|',
    ...rows,
    '',
  ].join('\n');
}

function buildLowestResourcesSection(
  report: ConfidenceReport,
  topN = 10,
): string {
  if (report.byResource.size === 0) {
    return '## Lowest-Confidence Resources\n\n_No resources to report._\n\n';
  }

  const sorted: ResourceConfidence[] = [...report.byResource.values()]
    .sort((a, b) => a.score - b.score)
    .slice(0, topN);

  const rows = sorted.map(rc => {
    const criticalMark = rc.reviewCritical ? ' ⭐' : '';
    return `| \`${rc.resourceId}\`${criticalMark} | ${rc.serviceFamily} | ${pct(rc.score).padStart(8)} | ${bandEmoji(rc.band)} ${bandLabel(rc.band)} |`;
  });

  const note = sorted.length < report.byResource.size
    ? `\n_Showing ${topN} of ${report.byResource.size} resources (sorted by score, lowest first). ⭐ = review-critical domain._\n`
    : '\n_⭐ = review-critical domain._\n';

  return [
    '## Lowest-Confidence Resources',
    '',
    '| Resource ID                        | Family               |    Score | Band           |',
    '|------------------------------------|----------------------|----------|----------------|',
    ...rows,
    note,
  ].join('\n');
}

function buildEscalationSection(report: ConfidenceReport): string {
  if (!report.escalationRequired) {
    return '## Escalation Status\n\n_No escalation required. All resources meet the 60% threshold._\n\n';
  }

  const ids = report.reviewRequired.map(id => `- \`${id}\``).join('\n');
  return [
    '## Escalation Status',
    '',
    '> **Action required:** The following resources have confidence < 60% and require',
    '> mandatory human review before proceeding with migration.',
    '',
    ids || '_See byResource map for details._',
    '',
  ].join('\n');
}

function buildFactorLegend(): string {
  return [
    '## Factor Definitions',
    '',
    '| Factor               | Value   | Meaning                                          |',
    '|----------------------|---------|--------------------------------------------------|',
    '| Registry Confidence  | 0.0–1.0 | Base confidence from the registry mapping entry  |',
    '| Validation Factor    | 1.0     | HCL validates cleanly                            |',
    '|                      | 0.5     | HCL has warnings                                 |',
    '|                      | 0.0     | HCL has errors (blockers)                        |',
    '| Semantic Factor      | 1.0     | Semantics fully preserved (equivalent)           |',
    '|                      | 0.8     | Semantics transformed (partial equivalence)      |',
    '|                      | 0.5     | Semantics partially preserved (degraded)         |',
    '|                      | 0.2     | Semantics missing                                |',
    '| Policy Factor        | ×0.9ⁿ   | Per warning (n = warning count)                  |',
    '|                      | ×0.7ᵐ   | Per failure (m = failure count)                  |',
    '',
    '**Formula:** `score = registry × validation × semantic × policy`',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateReportOptions {
  /** Maximum number of lowest-confidence resources to list. Default: 10. */
  readonly topN?: number;
  /** Report title override. */
  readonly title?: string;
}

/**
 * Generate a human-readable Markdown confidence report from a ConfidenceReport.
 *
 * The returned string is suitable for embedding in a translation manifest,
 * writing to a file, or displaying in a terminal.
 *
 * Never throws — returns an error-report string on unexpected failures.
 */
export function generateConfidenceReport(
  report: ConfidenceReport,
  options: GenerateReportOptions = {},
): string {
  try {
    const topN = options.topN ?? 10;

    const sections = [
      buildHeader(report),
      buildFactorsSection(report),
      buildFamilySection(report),
      buildLowestResourcesSection(report, topN),
      buildEscalationSection(report),
      buildFactorLegend(),
    ];

    return sections.join('\n');
  } catch (_err: unknown) {
    return '# Translation Confidence Report\n\n_Error generating report._\n';
  }
}
