// ---------------------------------------------------------------------------
// Migration pack Markdown renderer
// ---------------------------------------------------------------------------

import type { RemediationPack, RemediationTask, RemediationPriority } from './remediation-types.js';

const PRIORITY_ORDER: readonly RemediationPriority[] = ['critical', 'high', 'medium', 'low'] as const;

/**
 * Renders a RemediationPack as a human-readable Markdown document.
 * Only produces content when there are blocked or advisory resources.
 * Returns null when the pack has no tasks (no migration-pack.md needed).
 */
export function buildMigrationPack(pack: RemediationPack): string | null {
  if (pack.tasks.length === 0) return null;

  const lines: string[] = [];
  lines.push('# Migration Pack');
  lines.push('');
  appendSummarySection(lines, pack);
  for (const priority of PRIORITY_ORDER) {
    appendPrioritySection(lines, pack.tasks, priority);
  }
  appendSequenceSection(lines, pack.tasks);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers (each < 50 lines)
// ---------------------------------------------------------------------------

function appendSummarySection(lines: string[], pack: RemediationPack): void {
  lines.push('## Summary');
  lines.push('');
  lines.push('| Priority | Count |');
  lines.push('|----------|-------|');
  for (const p of PRIORITY_ORDER) {
    const count = pack.summary[p];
    if (count > 0) {
      lines.push(`| ${capitalize(p)} | ${String(count)} |`);
    }
  }
  lines.push(`| **Total** | **${String(pack.summary.total)}** |`);
  lines.push('');
  lines.push(`**Estimated total effort:** ${pack.estimatedTotalEffort}`);
  lines.push('');
}

function appendPrioritySection(
  lines: string[],
  tasks: readonly RemediationTask[],
  priority: RemediationPriority,
): void {
  const filtered = tasks.filter((t) => t.priority === priority);
  if (filtered.length === 0) return;

  lines.push(`## ${capitalize(priority)} Priority Tasks`);
  lines.push('');
  for (const task of filtered) {
    lines.push(`- **[${task.id}]** \`${task.sourceType}\`: ${task.description} *(effort: ${task.estimatedEffort})*`);
    const prereqs = task.prerequisites.length > 0 ? task.prerequisites.join(', ') : 'None';
    lines.push(`  - Prerequisites: ${prereqs}`);
  }
  lines.push('');
}

function appendSequenceSection(lines: string[], tasks: readonly RemediationTask[]): void {
  lines.push('## Recommended Sequence');
  lines.push('');
  for (const [i, task] of tasks.entries()) {
    lines.push(`${String(i + 1)}. **[${task.id}]** ${task.description}`);
  }
  lines.push('');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
