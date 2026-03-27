/**
 * report-writer.ts — Builds a human-readable Markdown translation report.
 *
 * Called after translation writes .tf files and manifest.json to disk.
 * Both the MCP handler and CLI command import this function.
 */

import type {
  TranslationResult,
  TranslationFinding,
  ManifestEntry,
} from '@tla/shared';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds a Markdown translation report from a completed translation result.
 *
 * @param result    - The full TranslationResult from TranslationCompiler
 * @param source    - The original source path or description
 * @param target    - The target cloud provider ('azure' | 'gcp')
 * @param outputDir - The directory where generated files were written
 * @returns A complete Markdown document as a string
 */
export function buildTranslationReport(
  result: TranslationResult,
  source: string,
  target: string,
  outputDir: string,
): string {
  const lines: string[] = [];

  // Header
  lines.push('# Translation Report');
  lines.push('');
  lines.push(`**Target:** ${target}`);
  lines.push(`**Source:** ${source}`);
  lines.push(`**Date:** ${new Date().toISOString()}`);
  lines.push(`**Registry Version:** ${result.manifest.registryVersion}`);
  lines.push(
    `**Overall Confidence:** ${String(Math.round(result.manifest.confidenceOverall * 100))}%`,
  );
  lines.push('');

  // Summary table
  appendSummaryTable(lines, result);

  // Resources grouped by status
  appendResourceSections(lines, result);

  // Findings grouped by severity
  appendFindingsSections(lines, result);

  // Files generated
  appendFilesGenerated(lines, result, outputDir);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function appendSummaryTable(lines: string[], result: TranslationResult): void {
  const c = result.manifest.counts;
  lines.push('## Summary');
  lines.push('');
  lines.push('| Status | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Translated | ${String(c.translated)} |`);
  lines.push(`| Expanded | ${String(c.expanded)} |`);
  lines.push(`| Partial | ${String(c.partial)} |`);
  lines.push(`| Blocked | ${String(c.blocked)} |`);
  lines.push(`| Advisory | ${String(c.advisory)} |`);
  lines.push(`| **Total** | **${String(c.total)}** |`);
  lines.push('');
}

function appendResourceSections(lines: string[], result: TranslationResult): void {
  lines.push('## Resources');
  lines.push('');

  const entries = result.manifest.entries;

  // Translated
  const translated = entries.filter((e) => e.status === 'translated');
  if (translated.length > 0) {
    lines.push('### Translated');
    for (const entry of translated) {
      lines.push(formatResourceLine(entry));
    }
    lines.push('');
  }

  // Expanded
  const expanded = entries.filter((e) => e.status === 'expanded');
  if (expanded.length > 0) {
    lines.push('### Expanded');
    for (const entry of expanded) {
      lines.push(formatResourceLine(entry));
    }
    lines.push('');
  }

  // Partial
  const partial = entries.filter((e) => e.status === 'partial');
  if (partial.length > 0) {
    lines.push('### Partial');
    for (const entry of partial) {
      lines.push(formatResourceLine(entry));
    }
    lines.push('');
  }

  // Blocked
  const blocked = entries.filter((e) => e.status === 'blocked');
  if (blocked.length > 0) {
    lines.push('### Blocked');
    for (const entry of blocked) {
      const reason = findBlockerReason(entry);
      lines.push(
        `- ${entry.sourceType}.${entry.sourceId}${reason ? ` \u2014 ${reason}` : ''} (BLOCKER)`,
      );
    }
    lines.push('');
  }

  // Advisory
  const advisory = entries.filter((e) => e.status === 'advisory');
  if (advisory.length > 0) {
    lines.push('### Advisory');
    for (const entry of advisory) {
      const reason = findAdvisoryReason(entry);
      lines.push(
        `- ${entry.sourceType}.${entry.sourceId}${reason ? ` \u2014 ${reason}` : ''}`,
      );
    }
    lines.push('');
  }
}

function appendFindingsSections(lines: string[], result: TranslationResult): void {
  const findings = result.findings;
  const blockers = findings.filter((f) => f.severity === 'blocker');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const infos = findings.filter((f) => f.severity === 'info');

  lines.push('## Findings');
  lines.push('');

  lines.push(`### Blockers (${String(blockers.length)})`);
  if (blockers.length === 0) {
    lines.push('None');
  } else {
    for (const f of blockers) {
      lines.push(formatFindingLine(f));
    }
  }
  lines.push('');

  lines.push(`### Warnings (${String(warnings.length)})`);
  if (warnings.length === 0) {
    lines.push('None');
  } else {
    for (const f of warnings) {
      lines.push(formatFindingLine(f));
    }
  }
  lines.push('');

  lines.push(`### Info (${String(infos.length)})`);
  if (infos.length === 0) {
    lines.push('None');
  } else {
    for (const f of infos) {
      lines.push(formatFindingLine(f));
    }
  }
  lines.push('');
}

function appendFilesGenerated(
  lines: string[],
  result: TranslationResult,
  _outputDir: string,
): void {
  const fileNames = [...Object.keys(result.files), 'manifest.json', 'translation-report.md', 'confidence-report.json'].sort();
  lines.push('## Files Generated');
  for (const name of fileNames) {
    lines.push(`- ${name}`);
  }
  lines.push('');
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatResourceLine(entry: ManifestEntry): string {
  const targetNames = entry.targetResources
    .map((r) => `${r.targetType}.${r.targetName}`)
    .join(', ');
  const conf = entry.confidence.toFixed(2);
  const hasFallback = entry.targetResources.some(
    (r) => r.traceability.translationPath === 'generic-fallback',
  );
  const suffix = hasFallback ? ' (generic fallback)' : '';
  return `- ${entry.sourceType}.${entry.sourceId} \u2192 ${targetNames} (confidence: ${conf})${suffix}`;
}

function formatFindingLine(f: TranslationFinding): string {
  return `- [${f.code}] ${f.resourceId}: ${f.message}`;
}

function findBlockerReason(entry: ManifestEntry): string | undefined {
  const blocker = entry.findings.find((f) => f.severity === 'blocker');
  return blocker?.message;
}

function findAdvisoryReason(entry: ManifestEntry): string | undefined {
  const advisory = entry.findings.find(
    (f) => f.severity === 'warning' || f.severity === 'info',
  );
  return advisory?.message ?? 'No safe automatic equivalent';
}
