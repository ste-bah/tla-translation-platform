import { describe, it, expect } from 'vitest';
import { generateRemediationPack } from '../../src/remediation/remediation-generator.js';
import type {
  TranslationManifest,
  ManifestEntry,
  CanonicalIR,
  IrRelationship,
} from '@tla/shared';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeManifest(
  entries: ManifestEntry[],
  overrides: Partial<TranslationManifest> = {},
): TranslationManifest {
  const counts = {
    total: entries.length,
    translated: entries.filter((e) => e.status === 'translated').length,
    expanded: entries.filter((e) => e.status === 'expanded').length,
    partial: entries.filter((e) => e.status === 'partial').length,
    blocked: entries.filter((e) => e.status === 'blocked').length,
    advisory: entries.filter((e) => e.status === 'advisory').length,
  };
  return {
    version: '1.0.0',
    registryVersion: '2025.03.01',
    target: 'azure',
    counts,
    entries,
    findings: [],
    confidenceOverall: 0.8,
    ...overrides,
  };
}

function makeEntry(
  id: string,
  sourceType: string,
  status: ManifestEntry['status'],
  findingMessage?: string,
): ManifestEntry {
  return {
    sourceId: id,
    sourceType,
    status,
    targetResources: [],
    confidence: status === 'blocked' ? 0 : 0.5,
    findings: findingMessage
      ? [
          {
            resourceId: id,
            severity: status === 'blocked' ? 'blocker' : 'warning',
            code: 'TEST_CODE',
            message: findingMessage,
          },
        ]
      : [],
  };
}

function makeIr(
  resources: Array<{ id: string; sourceType: string; category?: string }>,
  relationships: IrRelationship[] = [],
): CanonicalIR {
  return {
    version: '1.0.0',
    sourceProvider: 'aws',
    resources: resources.map((r) => ({
      id: r.id,
      sourceType: r.sourceType,
      sourceName: r.id,
      sourceModule: null,
      category: (r.category as CanonicalIR['resources'][0]['category']) ?? 'compute',
      attributes: {},
      sourceAttributes: {},
      registryEntryId: null,
      translationStatus: 'pending',
      confidence: 0,
      tags: {},
      sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    })),
    relationships,
    modules: [],
    intents: [],
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceFiles: ['main.tf'],
      toolVersion: '1.0.0',
      resourceCount: resources.length,
      relationshipCount: relationships.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateRemediationPack', () => {
  // -------------------------------------------------------------------------
  // Empty / no-op cases
  // -------------------------------------------------------------------------

  it('returns empty pack for empty manifest', () => {
    const pack = generateRemediationPack(makeManifest([]), makeIr([]));
    expect(pack.tasks).toHaveLength(0);
    expect(pack.summary.total).toBe(0);
    expect(pack.estimatedTotalEffort).toBe('0 hours');
  });

  it('returns empty pack when all entries are translated', () => {
    const entries = [
      makeEntry('res-001', 'aws_instance', 'translated'),
      makeEntry('res-002', 'aws_s3_bucket', 'expanded'),
    ];
    const pack = generateRemediationPack(makeManifest(entries), makeIr([
      { id: 'res-001', sourceType: 'aws_instance' },
      { id: 'res-002', sourceType: 'aws_s3_bucket' },
    ]));
    expect(pack.tasks).toHaveLength(0);
    expect(pack.summary.total).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Blocked resource → task
  // -------------------------------------------------------------------------

  it('creates a primary task and a testing task for a blocked resource', () => {
    const entries = [makeEntry('sg-001', 'aws_security_group', 'blocked', 'Broad ingress rule blocked')];
    const pack = generateRemediationPack(
      makeManifest(entries),
      makeIr([{ id: 'sg-001', sourceType: 'aws_security_group' }]),
    );

    // 2 tasks: primary (security_review) + testing
    expect(pack.tasks).toHaveLength(2);
    const primary = pack.tasks.find((t) => t.taskType === 'security_review');
    const testing = pack.tasks.find((t) => t.taskType === 'testing');

    expect(primary).toBeDefined();
    expect(primary!.resourceId).toBe('sg-001');
    expect(primary!.sourceType).toBe('aws_security_group');
    expect(primary!.description).toBe('Broad ingress rule blocked');

    expect(testing).toBeDefined();
    expect(testing!.prerequisites).toContain(primary!.id);
  });

  it('creates a design_decision task for a blocked database resource', () => {
    const entries = [makeEntry('db-001', 'aws_db_instance', 'blocked')];
    const pack = generateRemediationPack(
      makeManifest(entries),
      makeIr([{ id: 'db-001', sourceType: 'aws_db_instance' }]),
    );
    const primary = pack.tasks.find((t) => t.taskType !== 'testing');
    expect(primary?.taskType).toBe('design_decision');
  });

  it('creates a manual_migration task for a blocked non-critical resource', () => {
    const entries = [makeEntry('lambda-001', 'aws_lambda_function', 'blocked')];
    const pack = generateRemediationPack(
      makeManifest(entries),
      makeIr([{ id: 'lambda-001', sourceType: 'aws_lambda_function' }]),
    );
    const primary = pack.tasks.find((t) => t.taskType !== 'testing');
    expect(primary?.taskType).toBe('manual_migration');
  });

  // -------------------------------------------------------------------------
  // Advisory resource → task
  // -------------------------------------------------------------------------

  it('creates a configuration task for an advisory resource', () => {
    const entries = [makeEntry('s3-001', 'aws_s3_bucket', 'advisory')];
    const pack = generateRemediationPack(
      makeManifest(entries),
      makeIr([{ id: 's3-001', sourceType: 'aws_s3_bucket' }]),
    );
    const primary = pack.tasks.find((t) => t.taskType === 'configuration');
    expect(primary).toBeDefined();
    expect(primary!.resourceId).toBe('s3-001');
    // testing task should exist too
    const testing = pack.tasks.find((t) => t.taskType === 'testing');
    expect(testing).toBeDefined();
    expect(testing!.prerequisites).toContain(primary!.id);
  });

  // -------------------------------------------------------------------------
  // Priority assignment
  // -------------------------------------------------------------------------

  it('assigns critical priority to blocked security/networking resource', () => {
    const entries = [makeEntry('vpc-001', 'aws_vpc', 'blocked')];
    const pack = generateRemediationPack(
      makeManifest(entries),
      makeIr([{ id: 'vpc-001', sourceType: 'aws_vpc' }]),
    );
    const primary = pack.tasks.find((t) => t.taskType !== 'testing')!;
    expect(primary.priority).toBe('critical');
    expect(pack.summary.critical).toBeGreaterThan(0);
  });

  it('assigns high priority to blocked non-critical resource', () => {
    const entries = [makeEntry('fn-001', 'aws_lambda_function', 'blocked')];
    const pack = generateRemediationPack(
      makeManifest(entries),
      makeIr([{ id: 'fn-001', sourceType: 'aws_lambda_function' }]),
    );
    const primary = pack.tasks.find((t) => t.taskType !== 'testing')!;
    expect(primary.priority).toBe('high');
  });

  it('assigns medium priority to advisory security resource', () => {
    const entries = [makeEntry('sg-002', 'aws_security_group', 'advisory')];
    const pack = generateRemediationPack(
      makeManifest(entries),
      makeIr([{ id: 'sg-002', sourceType: 'aws_security_group' }]),
    );
    const primary = pack.tasks.find((t) => t.taskType !== 'testing')!;
    expect(primary.priority).toBe('medium');
  });

  it('assigns low priority to advisory non-critical resource', () => {
    const entries = [makeEntry('sqs-001', 'aws_sqs_queue', 'advisory')];
    const pack = generateRemediationPack(
      makeManifest(entries),
      makeIr([{ id: 'sqs-001', sourceType: 'aws_sqs_queue' }]),
    );
    const primary = pack.tasks.find((t) => t.taskType !== 'testing')!;
    expect(primary.priority).toBe('low');
  });

  // -------------------------------------------------------------------------
  // Dependency ordering (Kahn's algorithm)
  // -------------------------------------------------------------------------

  it('orders tasks so dependency prerequisites come first', () => {
    const entries = [
      makeEntry('sg-10', 'aws_security_group', 'blocked'),
      makeEntry('ec2-10', 'aws_instance', 'blocked'),
    ];
    // ec2-10 depends on sg-10
    const relationships: IrRelationship[] = [
      { from: 'ec2-10', to: 'sg-10', type: 'depends_on' },
    ];
    const pack = generateRemediationPack(
      makeManifest(entries),
      makeIr(
        [
          { id: 'sg-10', sourceType: 'aws_security_group' },
          { id: 'ec2-10', sourceType: 'aws_instance' },
        ],
        relationships,
      ),
    );

    // Find the primary tasks
    const sgTask = pack.tasks.find(
      (t) => t.resourceId === 'sg-10' && t.taskType !== 'testing',
    );
    const ec2Task = pack.tasks.find(
      (t) => t.resourceId === 'ec2-10' && t.taskType !== 'testing',
    );
    expect(sgTask).toBeDefined();
    expect(ec2Task).toBeDefined();

    // ec2Task should have sgTask as a prerequisite
    expect(ec2Task!.prerequisites).toContain(sgTask!.id);

    // sgTask should appear before ec2Task in the tasks array
    const sgIndex = pack.tasks.indexOf(sgTask!);
    const ec2Index = pack.tasks.indexOf(ec2Task!);
    expect(sgIndex).toBeLessThan(ec2Index);
  });

  it('prerequisite wiring: primary task prerequisites use task IDs not resource IDs', () => {
    const entries = [
      makeEntry('kms-01', 'aws_kms_key', 'blocked'),
      makeEntry('rds-01', 'aws_rds_cluster', 'blocked'),
    ];
    const relationships: IrRelationship[] = [
      { from: 'rds-01', to: 'kms-01', type: 'references' },
    ];
    const pack = generateRemediationPack(
      makeManifest(entries),
      makeIr(
        [
          { id: 'kms-01', sourceType: 'aws_kms_key' },
          { id: 'rds-01', sourceType: 'aws_rds_cluster' },
        ],
        relationships,
      ),
    );

    const kmsTask = pack.tasks.find(
      (t) => t.resourceId === 'kms-01' && t.taskType !== 'testing',
    );
    const rdsTask = pack.tasks.find(
      (t) => t.resourceId === 'rds-01' && t.taskType !== 'testing',
    );
    expect(rdsTask!.prerequisites).toContain(kmsTask!.id);
    // IDs should start with 'task-' not be bare resource IDs
    for (const prereqId of rdsTask!.prerequisites) {
      expect(prereqId).toMatch(/^task-/);
    }
  });

  // -------------------------------------------------------------------------
  // Circular dependency detection — no throw
  // -------------------------------------------------------------------------

  it('handles circular dependencies without throwing', () => {
    const entries = [
      makeEntry('a-01', 'aws_instance', 'blocked'),
      makeEntry('b-01', 'aws_instance', 'blocked'),
    ];
    const relationships: IrRelationship[] = [
      { from: 'a-01', to: 'b-01', type: 'depends_on' },
      { from: 'b-01', to: 'a-01', type: 'depends_on' },
    ];
    expect(() =>
      generateRemediationPack(
        makeManifest(entries),
        makeIr(
          [
            { id: 'a-01', sourceType: 'aws_instance' },
            { id: 'b-01', sourceType: 'aws_instance' },
          ],
          relationships,
        ),
      ),
    ).not.toThrow();

    const pack = generateRemediationPack(
      makeManifest(entries),
      makeIr(
        [
          { id: 'a-01', sourceType: 'aws_instance' },
          { id: 'b-01', sourceType: 'aws_instance' },
        ],
        relationships,
      ),
    );
    // Both resources should still produce tasks despite the cycle
    expect(pack.tasks.length).toBeGreaterThan(0);
    const resourceIds = new Set(pack.tasks.map((t) => t.resourceId));
    expect(resourceIds.has('a-01')).toBe(true);
    expect(resourceIds.has('b-01')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Summary counts
  // -------------------------------------------------------------------------

  it('summary counts reflect all tasks including testing tasks', () => {
    const entries = [
      makeEntry('sg-a', 'aws_security_group', 'blocked'),  // critical primary + critical testing
      makeEntry('fn-a', 'aws_lambda_function', 'advisory'), // low primary + low testing
    ];
    const pack = generateRemediationPack(
      makeManifest(entries),
      makeIr([
        { id: 'sg-a', sourceType: 'aws_security_group' },
        { id: 'fn-a', sourceType: 'aws_lambda_function' },
      ]),
    );

    expect(pack.summary.total).toBe(pack.tasks.length);
    const counted =
      pack.summary.critical +
      pack.summary.high +
      pack.summary.medium +
      pack.summary.low;
    expect(counted).toBe(pack.summary.total);
  });

  // -------------------------------------------------------------------------
  // Estimated effort is a non-empty string
  // -------------------------------------------------------------------------

  it('estimatedTotalEffort is a non-empty string when tasks exist', () => {
    const entries = [makeEntry('iam-01', 'aws_iam_role', 'blocked')];
    const pack = generateRemediationPack(
      makeManifest(entries),
      makeIr([{ id: 'iam-01', sourceType: 'aws_iam_role' }]),
    );
    expect(typeof pack.estimatedTotalEffort).toBe('string');
    expect(pack.estimatedTotalEffort.length).toBeGreaterThan(0);
    expect(pack.estimatedTotalEffort).not.toBe('0 hours');
  });

  // -------------------------------------------------------------------------
  // Never-throw contract
  // -------------------------------------------------------------------------

  it('does not throw when manifest or ir is structurally unexpected', () => {
    // Pass a manifest with a partial/pending entry to verify only blocked/advisory are processed
    const entries = [makeEntry('res-x', 'aws_something', 'partial' as ManifestEntry['status'])];
    expect(() =>
      generateRemediationPack(makeManifest(entries), makeIr([])),
    ).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Multiple resources mixed statuses
  // -------------------------------------------------------------------------

  it('processes multiple mixed-status entries correctly', () => {
    const entries = [
      makeEntry('vpc-x', 'aws_vpc', 'blocked'),
      makeEntry('rds-x', 'aws_rds_cluster', 'blocked'),
      makeEntry('s3-x', 'aws_s3_bucket', 'advisory'),
      makeEntry('ok-x', 'aws_instance', 'translated'),
    ];
    const pack = generateRemediationPack(
      makeManifest(entries),
      makeIr([
        { id: 'vpc-x', sourceType: 'aws_vpc' },
        { id: 'rds-x', sourceType: 'aws_rds_cluster' },
        { id: 's3-x', sourceType: 'aws_s3_bucket' },
        { id: 'ok-x', sourceType: 'aws_instance' },
      ]),
    );

    // ok-x is translated, should produce no tasks
    const translatedTask = pack.tasks.find((t) => t.resourceId === 'ok-x');
    expect(translatedTask).toBeUndefined();

    // Should have primary + testing tasks for each actionable resource (3 × 2 = 6)
    expect(pack.tasks).toHaveLength(6);
  });

  // -------------------------------------------------------------------------
  // Task IDs are unique
  // -------------------------------------------------------------------------

  it('all task IDs are unique', () => {
    const entries = [
      makeEntry('r1', 'aws_security_group', 'blocked'),
      makeEntry('r2', 'aws_rds_cluster', 'blocked'),
      makeEntry('r3', 'aws_sqs_queue', 'advisory'),
    ];
    const pack = generateRemediationPack(
      makeManifest(entries),
      makeIr([
        { id: 'r1', sourceType: 'aws_security_group' },
        { id: 'r2', sourceType: 'aws_rds_cluster' },
        { id: 'r3', sourceType: 'aws_sqs_queue' },
      ]),
    );
    const ids = pack.tasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
