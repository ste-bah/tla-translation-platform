import { describe, it, expect } from 'vitest';
import { diffRegistries } from '@tla/registry';
import { createTestEntry } from './helpers.js';

describe('diffRegistries', () => {
  it('returns empty diff for identical registries', () => {
    const entries = [
      createTestEntry({ registry_entry_id: 'SER-COM-AAA-001', aws_service: 'svc-a' }),
    ];

    const diff = diffRegistries(entries, entries);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.modified).toEqual([]);
    expect(diff.unchanged).toEqual(['SER-COM-AAA-001']);
    expect(diff.breakingChanges).toEqual([]);
    expect(diff.summary.unchangedCount).toBe(1);
  });

  it('returns empty diff for two empty registries', () => {
    const diff = diffRegistries([], []);
    expect(diff.summary.addedCount).toBe(0);
    expect(diff.summary.removedCount).toBe(0);
    expect(diff.summary.modifiedCount).toBe(0);
    expect(diff.summary.unchangedCount).toBe(0);
  });

  it('detects added entries', () => {
    const before = [
      createTestEntry({ registry_entry_id: 'SER-COM-AAA-001', aws_service: 'svc-a' }),
    ];
    const after = [
      createTestEntry({ registry_entry_id: 'SER-COM-AAA-001', aws_service: 'svc-a' }),
      createTestEntry({ registry_entry_id: 'SER-COM-BBB-001', aws_service: 'svc-b' }),
    ];

    const diff = diffRegistries(before, after);
    expect(diff.added).toEqual(['SER-COM-BBB-001']);
    expect(diff.summary.addedCount).toBe(1);
  });

  it('detects removed entries and flags as breaking change', () => {
    const before = [
      createTestEntry({ registry_entry_id: 'SER-COM-AAA-001', aws_service: 'svc-a' }),
      createTestEntry({ registry_entry_id: 'SER-COM-BBB-001', aws_service: 'svc-b' }),
    ];
    const after = [
      createTestEntry({ registry_entry_id: 'SER-COM-AAA-001', aws_service: 'svc-a' }),
    ];

    const diff = diffRegistries(before, after);
    expect(diff.removed).toEqual(['SER-COM-BBB-001']);
    expect(diff.summary.removedCount).toBe(1);
    expect(diff.breakingChanges).toContainEqual({
      entryId: 'SER-COM-BBB-001',
      reason: 'Entry removed',
    });
  });

  it('detects modified entries', () => {
    const before = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        confidence: 0.90,
      }),
    ];
    const after = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        confidence: 0.85,
      }),
    ];

    const diff = diffRegistries(before, after);
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0]!.entryId).toBe('SER-COM-AAA-001');
    expect(diff.modified[0]!.changedFields).toContain('confidence');
    expect(diff.summary.modifiedCount).toBe(1);
  });

  it('detects band downgrade as breaking change', () => {
    const before = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        band: 'P1',
        confidence: 0.90,
      }),
    ];
    const after = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        band: 'P2',
        confidence: 0.70,
      }),
    ];

    const diff = diffRegistries(before, after);
    const bandBreaking = diff.breakingChanges.filter((bc) =>
      bc.reason.includes('Band downgraded'),
    );
    expect(bandBreaking).toHaveLength(1);
    expect(bandBreaking[0]!.reason).toContain('P1');
    expect(bandBreaking[0]!.reason).toContain('P2');
  });

  it('does not flag band upgrade as breaking change', () => {
    const before = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        band: 'N1',
        confidence: 0.50,
      }),
    ];
    const after = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        band: 'P1',
        confidence: 0.90,
      }),
    ];

    const diff = diffRegistries(before, after);
    const bandBreaking = diff.breakingChanges.filter((bc) =>
      bc.reason.includes('Band downgraded'),
    );
    expect(bandBreaking).toHaveLength(0);
  });

  it('detects confidence drop > threshold as breaking change', () => {
    const before = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        confidence: 0.90,
      }),
    ];
    const after = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        confidence: 0.75,
      }),
    ];

    const diff = diffRegistries(before, after);
    const confBreaking = diff.breakingChanges.filter((bc) =>
      bc.reason.includes('Confidence dropped'),
    );
    expect(confBreaking).toHaveLength(1);
  });

  it('does not flag small confidence drop as breaking change', () => {
    const before = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        confidence: 0.90,
      }),
    ];
    const after = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        confidence: 0.85,
      }),
    ];

    const diff = diffRegistries(before, after);
    const confBreaking = diff.breakingChanges.filter((bc) =>
      bc.reason.includes('Confidence dropped'),
    );
    expect(confBreaking).toHaveLength(0);
  });

  it('respects custom confidence drop threshold', () => {
    const before = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        confidence: 0.90,
      }),
    ];
    const after = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        confidence: 0.85,
      }),
    ];

    // With threshold of 0.03, a 0.05 drop IS breaking
    const diff = diffRegistries(before, after, { confidenceDropThreshold: 0.03 });
    const confBreaking = diff.breakingChanges.filter((bc) =>
      bc.reason.includes('Confidence dropped'),
    );
    expect(confBreaking).toHaveLength(1);
  });

  it('detects mapping_type change as breaking change', () => {
    const before = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        mapping_type: 'direct',
      }),
    ];
    const after = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        mapping_type: 'parametric',
      }),
    ];

    const diff = diffRegistries(before, after);
    const typeBreaking = diff.breakingChanges.filter((bc) =>
      bc.reason.includes('mapping_type changed'),
    );
    expect(typeBreaking).toHaveLength(1);
    expect(typeBreaking[0]!.reason).toContain('direct');
    expect(typeBreaking[0]!.reason).toContain('parametric');
  });

  it('sorts all output arrays by entry ID', () => {
    const before = [
      createTestEntry({ registry_entry_id: 'SER-COM-ZZZ-001', aws_service: 'svc-z' }),
      createTestEntry({ registry_entry_id: 'SER-COM-AAA-001', aws_service: 'svc-a' }),
      createTestEntry({ registry_entry_id: 'SER-COM-MMM-001', aws_service: 'svc-m' }),
    ];
    const after = [
      createTestEntry({ registry_entry_id: 'SER-COM-AAA-001', aws_service: 'svc-a' }),
      createTestEntry({ registry_entry_id: 'SER-COM-NNN-001', aws_service: 'svc-n' }),
    ];

    const diff = diffRegistries(before, after);
    // Removed should be sorted
    expect(diff.removed).toEqual(['SER-COM-MMM-001', 'SER-COM-ZZZ-001']);
    // Added should be sorted
    expect(diff.added).toEqual(['SER-COM-NNN-001']);
    // Unchanged should be sorted
    expect(diff.unchanged).toEqual(['SER-COM-AAA-001']);
  });

  it('handles multiple breaking changes on same entry', () => {
    const before = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        band: 'P1',
        confidence: 0.95,
        mapping_type: 'direct',
      }),
    ];
    const after = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        band: 'N1',
        confidence: 0.50,
        mapping_type: 'compound',
      }),
    ];

    const diff = diffRegistries(before, after);
    const bcForEntry = diff.breakingChanges.filter((bc) => bc.entryId === 'SER-COM-AAA-001');
    // Band downgrade, confidence drop, mapping_type change = 3
    expect(bcForEntry).toHaveLength(3);
  });

  it('ignores metadata fields (last_updated, registry_version)', () => {
    const before = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        last_updated: '2026-01-01T00:00:00Z',
        registry_version: '2026.01.01',
      }),
    ];
    const after = [
      createTestEntry({
        registry_entry_id: 'SER-COM-AAA-001',
        aws_service: 'svc-a',
        last_updated: '2026-03-14T00:00:00Z',
        registry_version: '2026.03.14',
      }),
    ];

    const diff = diffRegistries(before, after);
    expect(diff.unchanged).toEqual(['SER-COM-AAA-001']);
    expect(diff.modified).toEqual([]);
  });
});
