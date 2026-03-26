import { describe, it, expect } from 'vitest';
import type { CanonicalIR, IrResource } from '@tla/shared';

import { detectDrift } from '../../src/drift/drift-detector.js';
import type { DriftReport } from '../../src/drift/drift-types.js';

// ---------------------------------------------------------------------------
// Test factories
// ---------------------------------------------------------------------------

function makeSourceLocation() {
  return { file: 'main.tf', line: 1, column: 0 };
}

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'aws_instance.web',
    sourceType: 'aws_instance',
    sourceName: 'web',
    sourceModule: null,
    category: 'compute',
    attributes: { instance_type: 't3.micro' },
    sourceAttributes: {},
    registryEntryId: null,
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: makeSourceLocation(),
    ...overrides,
  };
}

function makeIR(resources: IrResource[] = []): CanonicalIR {
  return {
    version: '1.0.0',
    sourceProvider: 'aws',
    resources,
    relationships: [],
    modules: [],
    intents: [],
    metadata: {
      generatedAt: '2024-01-01T00:00:00.000Z',
      sourceFiles: ['main.tf'],
      toolVersion: '0.1.0',
      resourceCount: resources.length,
      relationshipCount: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('detectDrift', () => {
  // -------------------------------------------------------------------------
  // No drift
  // -------------------------------------------------------------------------

  it('returns empty drift when both IRs are identical', () => {
    const resource = makeIrResource();
    const ir = makeIR([resource]);
    const report: DriftReport = detectDrift(ir, ir);

    expect(report.added).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
    expect(report.modified).toHaveLength(0);
    expect(report.unchanged).toBe(1);
    expect(report.summary.driftPercent).toBe(0);
  });

  it('returns empty drift when comparing two structurally equal but distinct IR objects', () => {
    const resourceA = makeIrResource({ id: 'aws_s3_bucket.data', sourceType: 'aws_s3_bucket' });
    const resourceB = makeIrResource({ id: 'aws_s3_bucket.data', sourceType: 'aws_s3_bucket' });
    const current = makeIR([resourceA]);
    const baseline = makeIR([resourceB]);
    const report = detectDrift(current, baseline);

    expect(report.added).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
    expect(report.modified).toHaveLength(0);
    expect(report.unchanged).toBe(1);
    expect(report.summary.driftPercent).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Added resources
  // -------------------------------------------------------------------------

  it('detects a resource added in current that is absent from baseline', () => {
    const existing = makeIrResource({ id: 'aws_instance.web' });
    const newResource = makeIrResource({
      id: 'aws_s3_bucket.assets',
      sourceType: 'aws_s3_bucket',
      sourceName: 'assets',
      category: 'storage',
    });
    const current = makeIR([existing, newResource]);
    const baseline = makeIR([existing]);
    const report = detectDrift(current, baseline);

    expect(report.added).toHaveLength(1);
    expect(report.added[0]).toEqual({
      resourceId: 'aws_s3_bucket.assets',
      sourceType: 'aws_s3_bucket',
      category: 'storage',
    });
    expect(report.removed).toHaveLength(0);
    expect(report.modified).toHaveLength(0);
    expect(report.unchanged).toBe(1);
  });

  it('detects multiple added resources', () => {
    const r1 = makeIrResource({ id: 'aws_instance.a', sourceName: 'a' });
    const r2 = makeIrResource({ id: 'aws_instance.b', sourceName: 'b' });
    const r3 = makeIrResource({ id: 'aws_instance.c', sourceName: 'c' });
    const current = makeIR([r1, r2, r3]);
    const baseline = makeIR([r1]);
    const report = detectDrift(current, baseline);

    expect(report.added).toHaveLength(2);
    const addedIds = report.added.map((e) => e.resourceId).sort();
    expect(addedIds).toEqual(['aws_instance.b', 'aws_instance.c']);
  });

  // -------------------------------------------------------------------------
  // Removed resources
  // -------------------------------------------------------------------------

  it('detects a resource removed from current that was in baseline', () => {
    const kept = makeIrResource({ id: 'aws_instance.web' });
    const gone = makeIrResource({
      id: 'aws_rds_instance.db',
      sourceType: 'aws_rds_instance',
      sourceName: 'db',
      category: 'database',
    });
    const current = makeIR([kept]);
    const baseline = makeIR([kept, gone]);
    const report = detectDrift(current, baseline);

    expect(report.removed).toHaveLength(1);
    expect(report.removed[0]).toEqual({
      resourceId: 'aws_rds_instance.db',
      sourceType: 'aws_rds_instance',
      category: 'database',
    });
    expect(report.added).toHaveLength(0);
    expect(report.modified).toHaveLength(0);
    expect(report.unchanged).toBe(1);
  });

  it('detects multiple removed resources', () => {
    const r1 = makeIrResource({ id: 'aws_instance.a', sourceName: 'a' });
    const r2 = makeIrResource({ id: 'aws_instance.b', sourceName: 'b' });
    const r3 = makeIrResource({ id: 'aws_instance.c', sourceName: 'c' });
    const current = makeIR([r1]);
    const baseline = makeIR([r1, r2, r3]);
    const report = detectDrift(current, baseline);

    expect(report.removed).toHaveLength(2);
    const removedIds = report.removed.map((e) => e.resourceId).sort();
    expect(removedIds).toEqual(['aws_instance.b', 'aws_instance.c']);
  });

  // -------------------------------------------------------------------------
  // Modified attributes
  // -------------------------------------------------------------------------

  it('detects a changed attribute value', () => {
    const baseline = makeIrResource({ attributes: { instance_type: 't3.micro' } });
    const current = makeIrResource({ attributes: { instance_type: 'm5.large' } });
    const report = detectDrift(makeIR([current]), makeIR([baseline]));

    expect(report.modified).toHaveLength(1);
    const mod = report.modified[0];
    expect(mod.resourceId).toBe('aws_instance.web');
    expect(mod.sourceType).toBe('aws_instance');
    expect(mod.changes).toHaveLength(1);
    expect(mod.changes[0]).toEqual({ key: 'instance_type', action: 'changed' });
    expect(report.unchanged).toBe(0);
  });

  it('detects an attribute added in current', () => {
    const baseline = makeIrResource({ attributes: { instance_type: 't3.micro' } });
    const current = makeIrResource({
      attributes: { instance_type: 't3.micro', ami: 'ami-0123456789' },
    });
    const report = detectDrift(makeIR([current]), makeIR([baseline]));

    expect(report.modified).toHaveLength(1);
    const changes = report.modified[0].changes;
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ key: 'ami', action: 'added' });
  });

  it('detects an attribute removed in current', () => {
    const baseline = makeIrResource({
      attributes: { instance_type: 't3.micro', ami: 'ami-0123456789' },
    });
    const current = makeIrResource({ attributes: { instance_type: 't3.micro' } });
    const report = detectDrift(makeIR([current]), makeIR([baseline]));

    expect(report.modified).toHaveLength(1);
    const changes = report.modified[0].changes;
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ key: 'ami', action: 'removed' });
  });

  it('detects multiple attribute changes on the same resource', () => {
    const baseline = makeIrResource({
      attributes: { instance_type: 't3.micro', ami: 'ami-old', region: 'us-east-1' },
    });
    const current = makeIrResource({
      attributes: { instance_type: 'm5.large', ami: 'ami-old', zone: 'us-east-1a' },
    });
    const report = detectDrift(makeIR([current]), makeIR([baseline]));

    expect(report.modified).toHaveLength(1);
    const keys = report.modified[0].changes.map((c) => c.key).sort();
    expect(keys).toEqual(['instance_type', 'region', 'zone'].sort());
  });

  // -------------------------------------------------------------------------
  // Empty IR
  // -------------------------------------------------------------------------

  it('returns zero drift when both IRs are empty', () => {
    const report = detectDrift(makeIR([]), makeIR([]));

    expect(report.added).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
    expect(report.modified).toHaveLength(0);
    expect(report.unchanged).toBe(0);
    expect(report.summary.driftPercent).toBe(0);
  });

  it('handles current IR empty (all baseline resources removed)', () => {
    const r = makeIrResource();
    const report = detectDrift(makeIR([]), makeIR([r]));

    expect(report.removed).toHaveLength(1);
    expect(report.added).toHaveLength(0);
    expect(report.summary.driftPercent).toBe(100);
  });

  it('handles baseline IR empty (all current resources added)', () => {
    const r = makeIrResource();
    const report = detectDrift(makeIR([r]), makeIR([]));

    expect(report.added).toHaveLength(1);
    expect(report.removed).toHaveLength(0);
    expect(report.summary.driftPercent).toBe(100);
  });

  // -------------------------------------------------------------------------
  // driftPercent calculation
  // -------------------------------------------------------------------------

  it('computes driftPercent as fraction of max(totalCurrent, totalBaseline)', () => {
    const r1 = makeIrResource({ id: 'aws_instance.a', sourceName: 'a' });
    const r2 = makeIrResource({ id: 'aws_instance.b', sourceName: 'b' });
    const r3 = makeIrResource({ id: 'aws_instance.c', sourceName: 'c' });
    const r4 = makeIrResource({ id: 'aws_instance.d', sourceName: 'd' });
    // current has 4, baseline has 4; r3+r4 are added, r1 is kept, r2 is removed
    const rBaseline2 = makeIrResource({ id: 'aws_instance.e', sourceName: 'e' });
    const current = makeIR([r1, r3, r4]);
    const baseline = makeIR([r1, r2, rBaseline2]);
    const report = detectDrift(current, baseline);

    // r1 unchanged, r3+r4 added (2), r2+rBaseline2 removed (2) → drift=4, max=3
    // driftPercent = 4/3 * 100 ≈ 133.33 (capped only in display, not here)
    expect(report.summary.added).toBe(2);
    expect(report.summary.removed).toBe(2);
    expect(report.summary.unchanged).toBe(1);
    const expectedPercent = (4 / 3) * 100;
    expect(report.summary.driftPercent).toBeCloseTo(expectedPercent, 5);
  });

  it('returns driftPercent 0 when only unchanged resources exist', () => {
    const r1 = makeIrResource({ id: 'aws_instance.a', sourceName: 'a' });
    const r2 = makeIrResource({ id: 'aws_instance.a', sourceName: 'a' }); // same id+attrs
    const report = detectDrift(makeIR([r1]), makeIR([r2]));
    expect(report.summary.driftPercent).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Attribute values not exposed in output
  // -------------------------------------------------------------------------

  it('does not include attribute values in DriftEntry output', () => {
    const secret = makeIrResource({
      id: 'aws_secretsmanager_secret.key',
      sourceType: 'aws_secretsmanager_secret',
      attributes: { secret_string: 'super-secret-value' },
    });
    const report = detectDrift(makeIR([secret]), makeIR([]));

    const entry = report.added[0];
    expect(entry).not.toHaveProperty('attributes');
    expect(JSON.stringify(entry)).not.toContain('super-secret-value');
  });

  it('does not include attribute values in DriftModification output', () => {
    const baseline = makeIrResource({ attributes: { password: 'old-password' } });
    const current = makeIrResource({ attributes: { password: 'new-password' } });
    const report = detectDrift(makeIR([current]), makeIR([baseline]));

    const mod = report.modified[0];
    expect(JSON.stringify(mod)).not.toContain('old-password');
    expect(JSON.stringify(mod)).not.toContain('new-password');
    // But the key name IS present
    expect(mod.changes[0].key).toBe('password');
    expect(mod.changes[0].action).toBe('changed');
  });

  // -------------------------------------------------------------------------
  // Summary correctness
  // -------------------------------------------------------------------------

  it('populates summary with correct totals', () => {
    const r1 = makeIrResource({ id: 'aws_instance.a', sourceName: 'a' });
    const r2 = makeIrResource({ id: 'aws_instance.b', sourceName: 'b' });
    const r3 = makeIrResource({
      id: 'aws_instance.c',
      sourceName: 'c',
      attributes: { instance_type: 't3.micro' },
    });
    const r3Modified = makeIrResource({
      id: 'aws_instance.c',
      sourceName: 'c',
      attributes: { instance_type: 'm5.large' },
    });
    const r4 = makeIrResource({ id: 'aws_instance.d', sourceName: 'd' });

    // current: r1, r3Modified, r4 (r2 removed, r4 added, r3 modified)
    const current = makeIR([r1, r3Modified, r4]);
    const baseline = makeIR([r1, r2, r3]);
    const report = detectDrift(current, baseline);

    expect(report.summary.totalCurrent).toBe(3);
    expect(report.summary.totalBaseline).toBe(3);
    expect(report.summary.added).toBe(1);   // r4
    expect(report.summary.removed).toBe(1); // r2
    expect(report.summary.modified).toBe(1); // r3
    expect(report.summary.unchanged).toBe(1); // r1
    // driftPercent = (1+1+1)/max(3,3)*100 = 100
    expect(report.summary.driftPercent).toBeCloseTo(100, 5);
  });
});
