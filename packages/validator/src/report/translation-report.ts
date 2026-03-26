// ---------------------------------------------------------------------------
// Translation Report Generator  (TASK-GAP-005)
//
// Generates a human-readable Markdown report from a TranslationManifest and
// optional supplementary inputs (equivalence, confidence, audit log, cost).
//
// Design rules:
//   - Every section builder is isolated with its own try/catch
//   - Never throws — returns a partial report on any error
//   - Optional inputs: sections are skipped when inputs are not provided
// ---------------------------------------------------------------------------

import type { TranslationManifest, ManifestEntry, TranslationFinding } from '@tla/shared';
import type { EquivalenceReport } from '@tla/shared';
import type { AuditEvent } from '@tla/shared';
import type { ConfidenceReport } from '../confidence/confidence-scorer.js';
import type { CostDeltaReport } from '../cost/cost-estimator.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ReportInputs {
  readonly manifest: TranslationManifest;
  readonly equivalence?: EquivalenceReport;
  readonly confidence?: ConfidenceReport;
  readonly auditLog?: readonly AuditEvent[];
  readonly costDelta?: CostDeltaReport;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function statusEmoji(status: string): string {
  switch (status) {
    case 'translated':
    case 'expanded':
      return '✅';
    case 'blocked':
      return '❌';
    case 'advisory':
      return '⚠️';
    case 'partial':
      return '🔶';
    default:
      return '❓';
  }
}

function severityEmoji(severity: string): string {
  switch (severity) {
    case 'blocker': return '❌';
    case 'warning': return '⚠️';
    case 'info':    return 'ℹ️';
    default:        return '❓';
  }
}

function truncate(s: string, maxLen = 80): string {
  return s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s;
}

// ---------------------------------------------------------------------------
// Section 1: Executive Summary
// ---------------------------------------------------------------------------

function buildExecutiveSummary(manifest: TranslationManifest): string {
  try {
    const { counts, target, version, registryVersion, confidenceOverall } = manifest;
    const total = counts.total;
    const successCount = counts.translated + counts.expanded + counts.partial;
    const successRate = total > 0 ? pct(successCount / total) : 'N/A';
    const overallPct = pct(confidenceOverall);

    const lines = [
      '# Translation Report',
      '',
      '## Executive Summary',
      '',
      `| Field                 | Value                          |`,
      `|-----------------------|--------------------------------|`,
      `| Target Provider       | ${target}                      |`,
      `| Report Version        | ${version}                     |`,
      `| Registry Version      | ${registryVersion}             |`,
      `| Total Resources       | ${total}                       |`,
      `| Successfully Mapped   | ${successCount} (${successRate})|`,
      `| Blocked               | ${counts.blocked}              |`,
      `| Advisory              | ${counts.advisory}             |`,
      `| Overall Confidence    | ${overallPct}                  |`,
      '',
    ];

    if (counts.blocked > 0) {
      lines.push(
        '> **Action Required:** This translation contains blocked resources that must be resolved before migration can proceed.',
        '',
      );
    } else if (counts.advisory > 0) {
      lines.push(
        '> **Advisory Notice:** Some resources require manual review. See the Advisory Resources section for details.',
        '',
      );
    } else {
      lines.push('> All resources were translated successfully. Review confidence scores before proceeding.', '');
    }

    return lines.join('\n');
  } catch (_err) {
    return '## Executive Summary\n\n_Error generating section._\n\n';
  }
}

// ---------------------------------------------------------------------------
// Section 2: Resource Inventory
// ---------------------------------------------------------------------------

function buildResourceInventory(manifest: TranslationManifest): string {
  try {
    const { entries } = manifest;
    if (entries.length === 0) {
      return '## Resource Inventory\n\n_No resources in manifest._\n\n';
    }

    const rows = entries.map((e: ManifestEntry) => {
      const targetTypes = e.targetResources.map(r => r.targetType).join(', ') || '—';
      return `| \`${e.sourceId}\` | \`${e.sourceType}\` | ${statusEmoji(e.status)} ${e.status} | ${truncate(targetTypes, 40)} | ${pct(e.confidence)} |`;
    });

    return [
      '## Resource Inventory',
      '',
      '| Source ID | Source Type | Status | Target Type(s) | Confidence |',
      '|-----------|-------------|--------|----------------|------------|',
      ...rows,
      '',
    ].join('\n');
  } catch (_err) {
    return '## Resource Inventory\n\n_Error generating section._\n\n';
  }
}

// ---------------------------------------------------------------------------
// Section 3: Blocked Resources
// ---------------------------------------------------------------------------

function buildBlockedResources(manifest: TranslationManifest): string {
  try {
    const blocked = manifest.entries.filter(e => e.status === 'blocked');
    if (blocked.length === 0) {
      return '## Blocked Resources\n\n_No blocked resources._\n\n';
    }

    const rows = blocked.map((e: ManifestEntry) => {
      const blockerFindings = e.findings.filter(f => f.severity === 'blocker');
      const reason = blockerFindings.length > 0
        ? truncate(blockerFindings[0].message, 70)
        : 'No blocker message recorded';
      const codes = blockerFindings.map(f => f.code).join(', ') || '—';
      return `| \`${e.sourceId}\` | \`${e.sourceType}\` | ${reason} | ${codes} |`;
    });

    return [
      '## Blocked Resources',
      '',
      '> ❌ The following resources could not be translated. Manual intervention is required.',
      '',
      '| Source ID | Source Type | Reason | Finding Code(s) |',
      '|-----------|-------------|--------|-----------------|',
      ...rows,
      '',
    ].join('\n');
  } catch (_err) {
    return '## Blocked Resources\n\n_Error generating section._\n\n';
  }
}

// ---------------------------------------------------------------------------
// Section 4: Advisory Resources
// ---------------------------------------------------------------------------

function buildAdvisoryResources(manifest: TranslationManifest): string {
  try {
    const advisory = manifest.entries.filter(e => e.status === 'advisory');
    if (advisory.length === 0) {
      return '## Advisory Resources\n\n_No advisory resources._\n\n';
    }

    const rows = advisory.map((e: ManifestEntry) => {
      const advisoryFindings = e.findings.filter(f => f.severity === 'warning');
      const summary = advisoryFindings.length > 0
        ? truncate(advisoryFindings[0].message, 70)
        : 'Manual review recommended';
      const codes = advisoryFindings.map(f => f.code).join(', ') || '—';
      return `| \`${e.sourceId}\` | \`${e.sourceType}\` | ${summary} | ${codes} |`;
    });

    return [
      '## Advisory Resources',
      '',
      '> ⚠️ The following resources have been translated with advisory findings. Manual review is recommended.',
      '',
      '| Source ID | Source Type | Advisory Summary | Finding Code(s) |',
      '|-----------|-------------|-----------------|-----------------|',
      ...rows,
      '',
    ].join('\n');
  } catch (_err) {
    return '## Advisory Resources\n\n_Error generating section._\n\n';
  }
}

// ---------------------------------------------------------------------------
// Section 5: Equivalence Analysis
// ---------------------------------------------------------------------------

function buildEquivalenceAnalysis(equivalence: EquivalenceReport): string {
  try {
    const { overallScore, classification, summary } = equivalence;

    const classEmoji = classification === 'equivalent' ? '✅'
      : classification === 'partial' ? '🔶'
      : classification === 'degraded' ? '⚠️'
      : '❌';

    const rows = equivalence.records
      .sort((a, b) => a.overallScore - b.overallScore)
      .slice(0, 20)
      .map(r => {
        const classIcon = r.classification === 'equivalent' ? '✅'
          : r.classification === 'partial' ? '🔶'
          : r.classification === 'degraded' ? '⚠️'
          : '❌';
        return `| \`${r.resourceId}\` | \`${r.sourceType}\` | ${classIcon} ${r.classification} | ${pct(r.overallScore)} |`;
      });

    const showingNote = equivalence.records.length > 20
      ? `\n_Showing 20 of ${equivalence.records.length} resources (sorted by score, lowest first)._\n`
      : '';

    return [
      '## Equivalence Analysis',
      '',
      `**Overall:** ${classEmoji} ${classification.toUpperCase()} — ${pct(overallScore)}`,
      '',
      '| Classification | Count |',
      '|----------------|-------|',
      `| ✅ Equivalent   | ${summary.equivalent} |`,
      `| 🔶 Partial      | ${summary.partial} |`,
      `| ⚠️ Degraded     | ${summary.degraded} |`,
      `| ❌ Missing      | ${summary.missing} |`,
      `| **Total**      | **${summary.total}** |`,
      '',
      '### Per-Resource Equivalence',
      '',
      '| Resource ID | Source Type | Classification | Score |',
      '|-------------|-------------|----------------|-------|',
      ...rows,
      showingNote,
    ].join('\n');
  } catch (_err) {
    return '## Equivalence Analysis\n\n_Error generating section._\n\n';
  }
}

// ---------------------------------------------------------------------------
// Section 6: Confidence Breakdown
// ---------------------------------------------------------------------------

function buildConfidenceBreakdown(confidence: ConfidenceReport): string {
  try {
    const bandLabel = (b: string) => b === 'high' ? 'HIGH' : b === 'medium' ? 'MEDIUM' : b === 'low' ? 'LOW' : 'VERY LOW';
    const bandEmoji = (b: string) => b === 'high' ? '✅' : b === 'medium' ? '⚠️' : b === 'low' ? '🔶' : '❌';

    const escalationNote = confidence.escalationRequired
      ? '> **ESCALATION REQUIRED** — one or more resources have confidence < 60%. Human review is mandatory.\n\n'
      : '';

    const familyRows = [...confidence.byFamily.entries()]
      .sort(([, a], [, b]) => a - b)
      .map(([family, score]) => {
        const band = score >= 0.80 ? 'high' : score >= 0.60 ? 'medium' : score >= 0.40 ? 'low' : 'very_low';
        return `| ${family} | ${pct(score)} | ${bandEmoji(band)} ${bandLabel(band)} |`;
      });

    const f = confidence.factors;

    return [
      '## Confidence Breakdown',
      '',
      escalationNote,
      `**Overall Confidence:** ${bandEmoji(confidence.overallBand)} ${pct(confidence.overall)} — ${bandLabel(confidence.overallBand)}`,
      '',
      '### Stack-Level Factors',
      '',
      '| Factor | Value |',
      '|--------|-------|',
      `| Registry Confidence (avg) | ${pct(f.avgRegistryConfidence)} |`,
      `| Validation Factor (avg) | ${pct(f.avgValidationFactor)} |`,
      `| Semantic Factor (avg) | ${pct(f.avgSemanticFactor)} |`,
      `| Policy Factor (avg) | ${pct(f.avgPolicyFactor)} |`,
      '',
      ...(familyRows.length > 0 ? [
        '### Confidence by Service Family',
        '',
        '| Service Family | Score | Band |',
        '|----------------|-------|------|',
        ...familyRows,
        '',
      ] : []),
    ].join('\n');
  } catch (_err) {
    return '## Confidence Breakdown\n\n_Error generating section._\n\n';
  }
}

// ---------------------------------------------------------------------------
// Section 7: Policy & Compliance
// ---------------------------------------------------------------------------

function buildPolicyCompliance(manifest: TranslationManifest): string {
  try {
    const policyFindings = manifest.findings.filter(
      f => f.code.startsWith('POLICY_') || f.code.startsWith('COMPLIANCE_'),
    );

    if (policyFindings.length === 0) {
      return '## Policy & Compliance\n\n_No policy or compliance findings recorded._\n\n';
    }

    const blockers = policyFindings.filter(f => f.severity === 'blocker');
    const warnings = policyFindings.filter(f => f.severity === 'warning');
    const infos    = policyFindings.filter(f => f.severity === 'info');

    const rows = policyFindings.slice(0, 30).map((f: TranslationFinding) => {
      return `| \`${f.resourceId}\` | ${severityEmoji(f.severity)} ${f.severity} | \`${f.code}\` | ${truncate(f.message, 60)} |`;
    });

    const showNote = policyFindings.length > 30
      ? `\n_Showing 30 of ${policyFindings.length} findings._\n`
      : '';

    return [
      '## Policy & Compliance',
      '',
      `**Summary:** ${blockers.length} blocker(s), ${warnings.length} warning(s), ${infos.length} info(s)`,
      '',
      '| Resource ID | Severity | Code | Message |',
      '|-------------|----------|------|---------|',
      ...rows,
      showNote,
    ].join('\n');
  } catch (_err) {
    return '## Policy & Compliance\n\n_Error generating section._\n\n';
  }
}

// ---------------------------------------------------------------------------
// Section 8: Cost Estimate
// ---------------------------------------------------------------------------

function buildCostEstimate(costDelta: CostDeltaReport): string {
  try {
    const { sourceEstimate, targetEstimate, delta, deltaPercent, perResource, caveats } = costDelta;

    const deltaSign = delta >= 0 ? '+' : '';
    const deltaLabel = `${deltaSign}${usd(delta)} (${deltaSign}${deltaPercent.toFixed(1)}%)`;
    const trendEmoji = delta < 0 ? '✅' : delta > 0 ? '⚠️' : '➡️';

    const perResourceRows = perResource.slice(0, 20).map(r => {
      const d = r.deltaUsd;
      const sign = d >= 0 ? '+' : '';
      return `| \`${r.sourceId}\` | \`${r.sourceType}\` | ${usd(r.sourceMonthlyUsd)} | ${usd(r.targetMonthlyUsd)} | ${sign}${usd(d)} |`;
    });

    const showNote = perResource.length > 20
      ? `\n_Showing 20 of ${perResource.length} resources._\n`
      : '';

    const caveatLines = caveats.map(c => `- ${c}`).join('\n');

    return [
      '## Cost Estimate',
      '',
      '> ⚠️ **Informational only.** All figures are approximate. Verify against current cloud pricing calculators.',
      '',
      '| | Source (AWS) | Target |',
      '|-|-------------|--------|',
      `| Monthly Total | ${usd(sourceEstimate.totalMonthlyUsd)} | ${usd(targetEstimate.totalMonthlyUsd)} |`,
      `| Delta | | ${trendEmoji} ${deltaLabel} |`,
      '',
      '### Per-Resource Cost Comparison',
      '',
      '| Source ID | Source Type | Source/mo | Target/mo | Delta |',
      '|-----------|-------------|-----------|-----------|-------|',
      ...perResourceRows,
      showNote,
      '### Caveats',
      '',
      caveatLines,
      '',
    ].join('\n');
  } catch (_err) {
    return '## Cost Estimate\n\n_Error generating section._\n\n';
  }
}

// ---------------------------------------------------------------------------
// Section 9: Manual Tasks
// ---------------------------------------------------------------------------

function buildManualTasks(manifest: TranslationManifest): string {
  try {
    // Manual tasks are advisory-severity info findings with MANUAL_ prefix or
    // those referencing advisory resources
    const manualFindings = manifest.findings.filter(
      f => f.code.startsWith('MANUAL_') || f.code.includes('ADVISORY'),
    );

    // Also collect per-entry advisory findings
    const entryAdvisoryFindings: TranslationFinding[] = [];
    for (const entry of manifest.entries) {
      if (entry.status === 'advisory') {
        entryAdvisoryFindings.push(...entry.findings.filter(f => f.severity !== 'blocker'));
      }
    }

    const allManual = [...manualFindings, ...entryAdvisoryFindings];
    if (allManual.length === 0) {
      return '## Manual Tasks\n\n_No manual tasks identified._\n\n';
    }

    const rows = allManual.slice(0, 20).map((f: TranslationFinding) => {
      const detail = f.detail ? truncate(f.detail, 60) : '—';
      return `| \`${f.resourceId}\` | \`${f.code}\` | ${truncate(f.message, 60)} | ${detail} |`;
    });

    const showNote = allManual.length > 20
      ? `\n_Showing 20 of ${allManual.length} manual tasks._\n`
      : '';

    return [
      '## Manual Tasks',
      '',
      '> The following items require manual implementation or review before migration can complete.',
      '',
      '| Resource ID | Code | Task Description | Detail |',
      '|-------------|------|-----------------|--------|',
      ...rows,
      showNote,
    ].join('\n');
  } catch (_err) {
    return '## Manual Tasks\n\n_Error generating section._\n\n';
  }
}

// ---------------------------------------------------------------------------
// Section 10: Audit Trail
// ---------------------------------------------------------------------------

function buildAuditTrail(auditLog: readonly AuditEvent[]): string {
  try {
    if (auditLog.length === 0) {
      return '## Audit Trail\n\n_No audit events recorded._\n\n';
    }

    const display = auditLog.slice(0, 30);
    const rows = display.map(e => {
      const ts = e.timestamp.replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace('Z', ' UTC');
      const payloadSummary = truncate(JSON.stringify(e.payload), 50);
      return `| ${e.seq} | ${ts} | \`${e.kind}\` | ${payloadSummary} |`;
    });

    const showNote = auditLog.length > 30
      ? `\n_Showing 30 of ${auditLog.length} events._\n`
      : '';

    return [
      '## Audit Trail',
      '',
      '| Seq | Timestamp | Event Kind | Payload Summary |',
      '|-----|-----------|------------|-----------------|',
      ...rows,
      showNote,
    ].join('\n');
  } catch (_err) {
    return '## Audit Trail\n\n_Error generating section._\n\n';
  }
}

// ---------------------------------------------------------------------------
// Section 11: Findings Appendix
// ---------------------------------------------------------------------------

function buildFindingsAppendix(manifest: TranslationManifest): string {
  try {
    const allFindings: TranslationFinding[] = [...manifest.findings];
    for (const entry of manifest.entries) {
      allFindings.push(...entry.findings);
    }

    if (allFindings.length === 0) {
      return '## Findings Appendix\n\n_No findings recorded._\n\n';
    }

    // Group by severity
    const blockers = allFindings.filter(f => f.severity === 'blocker');
    const warnings = allFindings.filter(f => f.severity === 'warning');
    const infos    = allFindings.filter(f => f.severity === 'info');

    function renderGroup(label: string, emoji: string, items: TranslationFinding[]): string[] {
      if (items.length === 0) return [];
      const rows = items.slice(0, 50).map(f => {
        const detail = f.detail ? truncate(f.detail, 50) : '—';
        return `| \`${f.resourceId}\` | \`${f.code}\` | ${truncate(f.message, 60)} | ${detail} |`;
      });
      const note = items.length > 50 ? [`\n_Showing 50 of ${items.length} ${label} findings._\n`] : [];
      return [
        `### ${emoji} ${label} (${items.length})`,
        '',
        '| Resource ID | Code | Message | Detail |',
        '|-------------|------|---------|--------|',
        ...rows,
        ...note,
        '',
      ];
    }

    return [
      '## Findings Appendix',
      '',
      `**Total findings:** ${allFindings.length} (${blockers.length} blockers, ${warnings.length} warnings, ${infos.length} info)`,
      '',
      ...renderGroup('Blockers', '❌', blockers),
      ...renderGroup('Warnings', '⚠️', warnings),
      ...renderGroup('Info', 'ℹ️', infos),
    ].join('\n');
  } catch (_err) {
    return '## Findings Appendix\n\n_Error generating section._\n\n';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable Markdown translation report.
 *
 * Includes up to 11 sections depending on which optional inputs are provided.
 * Never throws — returns a partial report string on any unexpected error.
 *
 * @param inputs - Required manifest plus optional supplementary reports.
 * @returns Markdown string suitable for writing to a file or displaying in a terminal.
 */
export function generateTranslationReport(inputs: ReportInputs): string {
  try {
    const { manifest, equivalence, confidence, auditLog, costDelta } = inputs;

    const sections: string[] = [
      buildExecutiveSummary(manifest),
      buildResourceInventory(manifest),
      buildBlockedResources(manifest),
      buildAdvisoryResources(manifest),
    ];

    if (equivalence !== undefined) {
      sections.push(buildEquivalenceAnalysis(equivalence));
    }

    if (confidence !== undefined) {
      sections.push(buildConfidenceBreakdown(confidence));
    }

    sections.push(buildPolicyCompliance(manifest));

    if (costDelta !== undefined) {
      sections.push(buildCostEstimate(costDelta));
    }

    sections.push(buildManualTasks(manifest));

    if (auditLog !== undefined) {
      sections.push(buildAuditTrail(auditLog));
    }

    sections.push(buildFindingsAppendix(manifest));

    return sections.join('\n');
  } catch (_err: unknown) {
    return '# Translation Report\n\n_Fatal error generating report._\n';
  }
}
