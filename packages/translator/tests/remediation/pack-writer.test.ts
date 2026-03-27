import { describe, it, expect } from 'vitest';
import { buildMigrationPack } from '../../src/remediation/pack-writer.js';
import type { RemediationPack, RemediationTask } from '../../src/remediation/remediation-types.js';

function makeTask(overrides: Partial<RemediationTask> = {}): RemediationTask {
  return {
    id: 'task-sg-001-manual_migration',
    resourceId: 'sg-001',
    sourceType: 'aws_security_group',
    taskType: 'manual_migration',
    description: 'Migrate security group rules manually',
    priority: 'high',
    prerequisites: [],
    estimatedEffort: '2-4 hours',
    ...overrides,
  };
}

function makePack(tasks: RemediationTask[]): RemediationPack {
  const critical = tasks.filter((t) => t.priority === 'critical').length;
  const high = tasks.filter((t) => t.priority === 'high').length;
  const medium = tasks.filter((t) => t.priority === 'medium').length;
  const low = tasks.filter((t) => t.priority === 'low').length;
  return {
    tasks,
    summary: { critical, high, medium, low, total: tasks.length },
    estimatedTotalEffort: '1-2 days',
  };
}

describe('buildMigrationPack', () => {
  it('returns null when pack has no tasks', () => {
    const pack = makePack([]);
    expect(buildMigrationPack(pack)).toBeNull();
  });

  it('produces valid Markdown with all sections', () => {
    const pack = makePack([
      makeTask({ id: 'task-1', priority: 'critical', description: 'Fix IAM' }),
      makeTask({ id: 'task-2', priority: 'high', description: 'Migrate SG' }),
      makeTask({ id: 'task-3', priority: 'medium', description: 'Update VPC' }),
      makeTask({ id: 'task-4', priority: 'low', description: 'Review tags' }),
    ]);
    const md = buildMigrationPack(pack);
    expect(md).not.toBeNull();
    expect(md).toContain('# Migration Pack');
    expect(md).toContain('## Summary');
    expect(md).toContain('## Critical Priority Tasks');
    expect(md).toContain('## High Priority Tasks');
    expect(md).toContain('## Medium Priority Tasks');
    expect(md).toContain('## Low Priority Tasks');
    expect(md).toContain('## Recommended Sequence');
  });

  it('orders critical tasks before low priority in the document', () => {
    const pack = makePack([
      makeTask({ id: 'task-low', priority: 'low', description: 'Low prio' }),
      makeTask({ id: 'task-crit', priority: 'critical', description: 'Critical prio' }),
    ]);
    const md = buildMigrationPack(pack)!;
    const critIdx = md.indexOf('## Critical Priority Tasks');
    const lowIdx = md.indexOf('## Low Priority Tasks');
    expect(critIdx).toBeLessThan(lowIdx);
  });

  it('lists prerequisites for each task', () => {
    const pack = makePack([
      makeTask({ id: 'task-a', prerequisites: [] }),
      makeTask({ id: 'task-b', prerequisites: ['task-a', 'task-c'] }),
    ]);
    const md = buildMigrationPack(pack)!;
    expect(md).toContain('Prerequisites: None');
    expect(md).toContain('Prerequisites: task-a, task-c');
  });

  it('summary table includes counts and total effort', () => {
    const pack = makePack([
      makeTask({ priority: 'critical' }),
      makeTask({ priority: 'critical' }),
      makeTask({ priority: 'medium' }),
    ]);
    const md = buildMigrationPack(pack)!;
    expect(md).toContain('| Critical | 2 |');
    expect(md).toContain('| Medium | 1 |');
    expect(md).toContain('| **Total** | **3** |');
    expect(md).toContain('**Estimated total effort:** 1-2 days');
  });

  it('omits priority sections with zero tasks', () => {
    const pack = makePack([makeTask({ priority: 'critical' })]);
    const md = buildMigrationPack(pack)!;
    expect(md).toContain('## Critical Priority Tasks');
    expect(md).not.toContain('## High Priority Tasks');
    expect(md).not.toContain('## Low Priority Tasks');
  });
});
