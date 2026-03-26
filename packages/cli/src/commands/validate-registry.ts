import { resolve } from 'node:path';
import type { Command } from 'commander';
import {
  loadRegistryFromDirectory,
  loadRegistryWithPaths,
  validateRegistryEntries,
  validateRegistryWithPaths,
} from '@tla/registry';
import type { ValidationResult } from '@tla/registry';

/**
 * Formats validation results as plain text.
 */
function formatText(results: ValidationResult[], loadErrorCount: number): string {
  const lines: string[] = [];

  if (loadErrorCount > 0) {
    lines.push(`Load errors: ${String(loadErrorCount)}`);
    lines.push('');
  }

  if (results.length === 0) {
    lines.push('No validation issues found.');
    return lines.join('\n');
  }

  const errors = results.filter((r) => r.severity === 'error');
  const warnings = results.filter((r) => r.severity === 'warning');
  const infos = results.filter((r) => r.severity === 'info');

  lines.push(`Validation results: ${String(errors.length)} error(s), ${String(warnings.length)} warning(s), ${String(infos.length)} info(s)`);
  lines.push('');

  for (const result of results) {
    const fieldPart = result.field ? ` [${result.field}]` : '';
    lines.push(`  ${result.severity.toUpperCase()} (${result.rule}) ${result.entryId}${fieldPart}: ${result.message}`);
  }

  return lines.join('\n');
}

/**
 * Registers the validate-registry command on a Commander program.
 */
export function registerValidateRegistry(program: Command): void {
  program
    .command('validate-registry')
    .description('Validate registry entries against business rules')
    .argument('<dir>', 'Path to registry data directory')
    .option('-f, --format <format>', 'Output format: json or text', 'text')
    .option('--strict', 'Treat warnings as errors (exit 1)', false)
    .option('--with-paths', 'Enable Rule 15 (family-directory) validation', false)
    .action(async (dir: string, opts: { format: string; strict: boolean; withPaths: boolean }) => {
      const dirPath = resolve(dir);

      let results: ValidationResult[];
      let loadErrorCount = 0;

      if (opts.withPaths) {
        const loadResult = await loadRegistryWithPaths(dirPath);
        loadErrorCount = loadResult.errors.length;
        results = validateRegistryWithPaths(loadResult.entries, loadResult.entryPaths);
      } else {
        const loadResult = await loadRegistryFromDirectory(dirPath);
        loadErrorCount = loadResult.errors.length;
        results = validateRegistryEntries(loadResult.entries);
      }

      if (opts.format === 'json') {
        const output = { loadErrorCount, results };
        process.stdout.write(JSON.stringify(output, null, 2) + '\n');
      } else {
        process.stdout.write(formatText(results, loadErrorCount) + '\n');
      }

      const hasErrors = results.some((r) => r.severity === 'error');
      const hasWarnings = results.some((r) => r.severity === 'warning');

      if (hasErrors || (opts.strict && hasWarnings)) {
        process.exitCode = 1;
      }
    });
}
