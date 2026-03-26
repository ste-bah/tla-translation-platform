import { resolve } from 'node:path';
import type { Command } from 'commander';
import { loadRegistryFromDirectory, validateRegistryEntries } from '@tla/registry';
import type { RegistryEntry } from '@tla/shared';

/**
 * Computes registry metrics from a set of entries.
 */
function computeMetrics(entries: ReadonlyArray<RegistryEntry>) {
  const bandDistribution: Record<string, number> = {};
  const familyDistribution: Record<string, number> = {};
  let totalConfidence = 0;
  let untestedCount = 0;
  let reviewCount = 0;

  for (const entry of entries) {
    bandDistribution[entry.band] = (bandDistribution[entry.band] ?? 0) + 1;
    familyDistribution[entry.aws_family] = (familyDistribution[entry.aws_family] ?? 0) + 1;
    totalConfidence += entry.confidence;

    if (entry.test_status === 'untested') {
      untestedCount++;
    }
    if (entry.manual_review_required) {
      reviewCount++;
    }
  }

  const avgConfidence = entries.length > 0 ? totalConfidence / entries.length : 0;

  return {
    totalEntries: entries.length,
    bandDistribution,
    familyDistribution,
    averageConfidence: Math.round(avgConfidence * 1000) / 1000,
    untestedCount,
    reviewCount,
  };
}

/**
 * Formats metrics as plain text.
 */
function formatText(metrics: ReturnType<typeof computeMetrics>, validationErrorCount: number): string {
  const lines: string[] = [];
  lines.push('Registry Report');
  lines.push('===============');
  lines.push('');
  lines.push(`Total entries: ${String(metrics.totalEntries)}`);
  lines.push(`Average confidence: ${String(metrics.averageConfidence)}`);
  lines.push(`Untested: ${String(metrics.untestedCount)}`);
  lines.push(`Requiring review: ${String(metrics.reviewCount)}`);
  lines.push(`Validation errors: ${String(validationErrorCount)}`);
  lines.push('');
  lines.push('Band distribution:');
  for (const [band, count] of Object.entries(metrics.bandDistribution).sort()) {
    lines.push(`  ${band}: ${String(count)}`);
  }
  lines.push('');
  lines.push('Family distribution:');
  for (const [family, count] of Object.entries(metrics.familyDistribution).sort()) {
    lines.push(`  ${family}: ${String(count)}`);
  }
  return lines.join('\n');
}

/**
 * Formats metrics as Markdown.
 */
function formatMarkdown(metrics: ReturnType<typeof computeMetrics>, validationErrorCount: number): string {
  const lines: string[] = [];
  lines.push('# Registry Report');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Total entries | ${String(metrics.totalEntries)} |`);
  lines.push(`| Average confidence | ${String(metrics.averageConfidence)} |`);
  lines.push(`| Untested | ${String(metrics.untestedCount)} |`);
  lines.push(`| Requiring review | ${String(metrics.reviewCount)} |`);
  lines.push(`| Validation errors | ${String(validationErrorCount)} |`);
  lines.push('');
  lines.push('## Band Distribution');
  lines.push('');
  lines.push('| Band | Count |');
  lines.push('| --- | --- |');
  for (const [band, count] of Object.entries(metrics.bandDistribution).sort()) {
    lines.push(`| ${band} | ${String(count)} |`);
  }
  lines.push('');
  lines.push('## Family Distribution');
  lines.push('');
  lines.push('| Family | Count |');
  lines.push('| --- | --- |');
  for (const [family, count] of Object.entries(metrics.familyDistribution).sort()) {
    lines.push(`| ${family} | ${String(count)} |`);
  }
  return lines.join('\n');
}

/**
 * Registers the registry-report command on a Commander program.
 */
export function registerRegistryReport(program: Command): void {
  program
    .command('registry-report')
    .description('Generate a summary report of registry contents')
    .argument('<dir>', 'Path to registry data directory')
    .option('-f, --format <format>', 'Output format: json, text, or markdown', 'text')
    .action(async (dir: string, opts: { format: string }) => {
      const dirPath = resolve(dir);
      const loadResult = await loadRegistryFromDirectory(dirPath);
      const validationResults = validateRegistryEntries(loadResult.entries);
      const validationErrorCount = validationResults.filter((r) => r.severity === 'error').length;
      const metrics = computeMetrics(loadResult.entries);

      if (opts.format === 'json') {
        const output = { ...metrics, validationErrorCount, loadErrors: loadResult.errors.length };
        process.stdout.write(JSON.stringify(output, null, 2) + '\n');
      } else if (opts.format === 'markdown') {
        process.stdout.write(formatMarkdown(metrics, validationErrorCount) + '\n');
      } else {
        process.stdout.write(formatText(metrics, validationErrorCount) + '\n');
      }
    });
}
