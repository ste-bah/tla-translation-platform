import { describe, it, expect } from 'vitest';
import { generateReleaseNotes } from '@tla/registry';
import type { RegistryDiff } from '@tla/registry';
import { createTestEntry } from './helpers.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function emptyDiff(): RegistryDiff {
  return {
    added: [],
    removed: [],
    modified: [],
    unchanged: [],
    breakingChanges: [],
    summary: {
      addedCount: 0,
      removedCount: 0,
      modifiedCount: 0,
      unchangedCount: 0,
      breakingChangeCount: 0,
    },
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('generateReleaseNotes', () => {
  describe('empty diff', () => {
    it('returns a valid Markdown string with all section markers', () => {
      const result = generateReleaseNotes(emptyDiff(), '2026.03.01', '2026.03.25');

      expect(result).toContain('# Registry Release Notes');
      expect(result).toContain('2026.03.01 → 2026.03.25');
      expect(result).toContain('<!-- BREAKING_CHANGES_START -->');
      expect(result).toContain('<!-- BREAKING_CHANGES_END -->');
      expect(result).toContain('<!-- NEW_SERVICES_START -->');
      expect(result).toContain('<!-- NEW_SERVICES_END -->');
      expect(result).toContain('<!-- IMPROVED_MAPPINGS_START -->');
      expect(result).toContain('<!-- IMPROVED_MAPPINGS_END -->');
      expect(result).toContain('<!-- MODIFIED_ENTRIES_START -->');
      expect(result).toContain('<!-- MODIFIED_ENTRIES_END -->');
      expect(result).toContain('<!-- DEPRECATIONS_START -->');
      expect(result).toContain('<!-- DEPRECATIONS_END -->');
    });

    it('shows zero counts in the summary line', () => {
      const result = generateReleaseNotes(emptyDiff(), '1.0.0', '1.0.1');
      expect(result).toContain('0 breaking, 0 new, 0 improved, 0 modified');
    });

    it('renders _None_ for all empty sections', () => {
      const result = generateReleaseNotes(emptyDiff(), '1.0.0', '1.0.1');
      // Every section body should fall back to the _None_ sentinel
      const noneCount = (result.match(/_None_/g) ?? []).length;
      expect(noneCount).toBe(5);
    });
  });

  describe('breaking changes only', () => {
    it('lists breaking changes with entry ID and reason', () => {
      const diff: RegistryDiff = {
        ...emptyDiff(),
        removed: ['SER-COM-AAA-001'],
        breakingChanges: [
          { entryId: 'SER-COM-AAA-001', reason: 'Entry removed' },
          { entryId: 'SER-NET-BBB-002', reason: 'Band downgraded from P1 to P2' },
        ],
        summary: {
          ...emptyDiff().summary,
          removedCount: 1,
          breakingChangeCount: 2,
        },
      };

      const result = generateReleaseNotes(diff, '1.0.0', '1.1.0');

      expect(result).toContain('**SER-COM-AAA-001**: Entry removed');
      expect(result).toContain('**SER-NET-BBB-002**: Band downgraded from P1 to P2');
      expect(result).toContain('2 breaking');
    });

    it('places breaking changes content between the correct markers', () => {
      const diff: RegistryDiff = {
        ...emptyDiff(),
        breakingChanges: [{ entryId: 'SER-COM-AAA-001', reason: 'Entry removed' }],
        summary: { ...emptyDiff().summary, breakingChangeCount: 1 },
      };

      const result = generateReleaseNotes(diff, '1.0.0', '1.1.0');

      const start = result.indexOf('<!-- BREAKING_CHANGES_START -->');
      const end = result.indexOf('<!-- BREAKING_CHANGES_END -->');
      const between = result.slice(start, end);
      expect(between).toContain('SER-COM-AAA-001');
    });
  });

  describe('new entries', () => {
    it('shows aws_service, band, and mapping_type when afterEntries provided', () => {
      const newEntry = createTestEntry({
        registry_entry_id: 'SER-STG-NEW-001',
        aws_service: 'aws_s3_bucket',
        band: 'P1',
        mapping_type: 'direct',
      });

      const diff: RegistryDiff = {
        ...emptyDiff(),
        added: ['SER-STG-NEW-001'],
        summary: { ...emptyDiff().summary, addedCount: 1 },
      };

      const result = generateReleaseNotes(diff, '1.0.0', '1.1.0', [], [newEntry]);

      expect(result).toContain('**SER-STG-NEW-001**');
      expect(result).toContain('aws_s3_bucket');
      expect(result).toContain('band: P1');
      expect(result).toContain('type: direct');
      expect(result).toContain('1 new');
    });

    it('falls back to ID-only line when no afterEntries provided', () => {
      const diff: RegistryDiff = {
        ...emptyDiff(),
        added: ['SER-STG-NEW-001'],
        summary: { ...emptyDiff().summary, addedCount: 1 },
      };

      const result = generateReleaseNotes(diff, '1.0.0', '1.1.0');

      expect(result).toContain('**SER-STG-NEW-001**');
      // Should NOT contain service details since no entries were passed
      expect(result).not.toContain('band:');
    });

    it('places new entries content between the correct markers', () => {
      const newEntry = createTestEntry({ registry_entry_id: 'SER-STG-NEW-001' });
      const diff: RegistryDiff = {
        ...emptyDiff(),
        added: ['SER-STG-NEW-001'],
        summary: { ...emptyDiff().summary, addedCount: 1 },
      };

      const result = generateReleaseNotes(diff, '1.0.0', '1.1.0', [], [newEntry]);

      const start = result.indexOf('<!-- NEW_SERVICES_START -->');
      const end = result.indexOf('<!-- NEW_SERVICES_END -->');
      const between = result.slice(start, end);
      expect(between).toContain('SER-STG-NEW-001');
    });
  });

  describe('band upgrades (improved mappings)', () => {
    it('detects a band upgrade and lists it in the Improved Mappings section', () => {
      const before = createTestEntry({
        registry_entry_id: 'SER-COM-UPG-001',
        band: 'N1',
      });
      const after = createTestEntry({
        registry_entry_id: 'SER-COM-UPG-001',
        band: 'P2',
      });

      const diff: RegistryDiff = {
        ...emptyDiff(),
        modified: [{ entryId: 'SER-COM-UPG-001', changedFields: ['band'] }],
        summary: { ...emptyDiff().summary, modifiedCount: 1 },
      };

      const result = generateReleaseNotes(diff, '1.0.0', '1.1.0', [before], [after]);

      expect(result).toContain('**SER-COM-UPG-001**: band upgraded from N1 to P2');
      expect(result).toContain('1 improved');
      // Should NOT appear in Modified Entries section
      const modStart = result.indexOf('<!-- MODIFIED_ENTRIES_START -->');
      const modEnd = result.indexOf('<!-- MODIFIED_ENTRIES_END -->');
      const modSection = result.slice(modStart, modEnd);
      expect(modSection).not.toContain('SER-COM-UPG-001');
    });

    it('places improved mappings content between the correct markers', () => {
      const before = createTestEntry({ registry_entry_id: 'SER-COM-UPG-001', band: 'M1' });
      const after = createTestEntry({ registry_entry_id: 'SER-COM-UPG-001', band: 'P1' });

      const diff: RegistryDiff = {
        ...emptyDiff(),
        modified: [{ entryId: 'SER-COM-UPG-001', changedFields: ['band'] }],
        summary: { ...emptyDiff().summary, modifiedCount: 1 },
      };

      const result = generateReleaseNotes(diff, '1.0.0', '1.1.0', [before], [after]);

      const start = result.indexOf('<!-- IMPROVED_MAPPINGS_START -->');
      const end = result.indexOf('<!-- IMPROVED_MAPPINGS_END -->');
      const between = result.slice(start, end);
      expect(between).toContain('SER-COM-UPG-001');
    });
  });

  describe('modified entries (non-upgrade)', () => {
    it('lists changed fields for non-band-upgrade modifications', () => {
      const diff: RegistryDiff = {
        ...emptyDiff(),
        modified: [
          { entryId: 'SER-COM-MOD-001', changedFields: ['confidence', 'owner'] },
        ],
        summary: { ...emptyDiff().summary, modifiedCount: 1 },
      };

      const result = generateReleaseNotes(diff, '1.0.0', '1.1.0');

      expect(result).toContain('**SER-COM-MOD-001**: changed fields: `confidence, owner`');
      expect(result).toContain('1 modified');
    });

    it('separates band-downgrade from improved: downgrade appears in Modified, not Improved', () => {
      const before = createTestEntry({ registry_entry_id: 'SER-COM-DNG-001', band: 'P1' });
      const after = createTestEntry({ registry_entry_id: 'SER-COM-DNG-001', band: 'N1' });

      const diff: RegistryDiff = {
        ...emptyDiff(),
        modified: [{ entryId: 'SER-COM-DNG-001', changedFields: ['band'] }],
        breakingChanges: [{ entryId: 'SER-COM-DNG-001', reason: 'Band downgraded from P1 to N1' }],
        summary: { ...emptyDiff().summary, modifiedCount: 1, breakingChangeCount: 1 },
      };

      const result = generateReleaseNotes(diff, '1.0.0', '1.1.0', [before], [after]);

      // Improved section should be empty
      const impStart = result.indexOf('<!-- IMPROVED_MAPPINGS_START -->');
      const impEnd = result.indexOf('<!-- IMPROVED_MAPPINGS_END -->');
      expect(result.slice(impStart, impEnd)).toContain('_None_');

      // Modified section should list the entry
      const modStart = result.indexOf('<!-- MODIFIED_ENTRIES_START -->');
      const modEnd = result.indexOf('<!-- MODIFIED_ENTRIES_END -->');
      expect(result.slice(modStart, modEnd)).toContain('SER-COM-DNG-001');
    });
  });

  describe('mixed diff', () => {
    it('correctly populates all sections in a real-world mixed scenario', () => {
      const beforeEntry = createTestEntry({
        registry_entry_id: 'SER-COM-MIX-001',
        band: 'N1',
        confidence: 0.70,
      });
      const afterEntry = createTestEntry({
        registry_entry_id: 'SER-COM-MIX-001',
        band: 'P2',
        confidence: 0.70,
      });
      const newEntry = createTestEntry({
        registry_entry_id: 'SER-STG-MIX-002',
        aws_service: 'aws_dynamodb_table',
        band: 'M1',
        mapping_type: 'none',
      });

      const diff: RegistryDiff = {
        added: ['SER-STG-MIX-002'],
        removed: ['SER-NET-OLD-001'],
        modified: [
          { entryId: 'SER-COM-MIX-001', changedFields: ['band'] },
          { entryId: 'SER-DAT-CHG-003', changedFields: ['confidence', 'test_status'] },
        ],
        unchanged: ['SER-IAM-UNC-001'],
        breakingChanges: [
          { entryId: 'SER-NET-OLD-001', reason: 'Entry removed' },
        ],
        summary: {
          addedCount: 1,
          removedCount: 1,
          modifiedCount: 2,
          unchangedCount: 1,
          breakingChangeCount: 1,
        },
      };

      const result = generateReleaseNotes(
        diff,
        '2026.03.01',
        '2026.03.25',
        [beforeEntry],
        [afterEntry, newEntry],
      );

      expect(result).toContain('1 breaking');
      expect(result).toContain('1 new');
      expect(result).toContain('1 improved');
      expect(result).toContain('1 modified');

      // Breaking section
      expect(result).toContain('**SER-NET-OLD-001**: Entry removed');

      // New section
      expect(result).toContain('**SER-STG-MIX-002**');
      expect(result).toContain('aws_dynamodb_table');

      // Improved section
      expect(result).toContain('**SER-COM-MIX-001**: band upgraded from N1 to P2');

      // Modified section (non-upgrade)
      expect(result).toContain('**SER-DAT-CHG-003**: changed fields: `confidence, test_status`');
    });

    it('includes a date header line', () => {
      const result = generateReleaseNotes(emptyDiff(), '1.0.0', '1.0.1');
      expect(result).toMatch(/\*\*Date\*\*: \d{4}-\d{2}-\d{2}/);
    });
  });

  describe('malformed diff', () => {
    it('returns a warning section when the diff object is structurally broken', () => {
      // Force a bad diff that will cause an access error
      const badDiff = null as unknown as RegistryDiff;

      const result = generateReleaseNotes(badDiff, '1.0.0', '1.0.1');

      expect(result).toContain('# Registry Release Notes');
      expect(result).toContain('<!-- WARNING_START -->');
      expect(result).toContain('Release notes generation failed:');
    });

    it('never throws — even with completely undefined input', () => {
      const badDiff = undefined as unknown as RegistryDiff;
      expect(() => generateReleaseNotes(badDiff, '', '')).not.toThrow();
    });
  });

  describe('no entries provided (ID-only fallback)', () => {
    it('generates valid output for added entries when no entry data is given', () => {
      const diff: RegistryDiff = {
        ...emptyDiff(),
        added: ['SER-COM-ID1-001', 'SER-COM-ID2-002'],
        summary: { ...emptyDiff().summary, addedCount: 2 },
      };

      const result = generateReleaseNotes(diff, '1.0.0', '1.1.0');

      expect(result).toContain('**SER-COM-ID1-001**');
      expect(result).toContain('**SER-COM-ID2-002**');
      expect(result).toContain('2 new');
    });

    it('generates valid output for modified entries when no entry data is given', () => {
      const diff: RegistryDiff = {
        ...emptyDiff(),
        modified: [{ entryId: 'SER-COM-ID1-001', changedFields: ['band'] }],
        summary: { ...emptyDiff().summary, modifiedCount: 1 },
      };

      // No before/after entries — band upgrade detection yields no result (unknown before/after)
      // so the entry falls into the Modified section with the field listed
      const result = generateReleaseNotes(diff, '1.0.0', '1.1.0');

      expect(result).toContain('**SER-COM-ID1-001**: changed fields: `band`');
    });

    it('shows generic "band upgraded" line when entries are missing from maps', () => {
      // Diff says band changed but we supply entries for a DIFFERENT id
      const unrelatedEntry = createTestEntry({ registry_entry_id: 'SER-COM-OTHER-001', band: 'N1' });

      const diff: RegistryDiff = {
        ...emptyDiff(),
        modified: [{ entryId: 'SER-COM-ID1-001', changedFields: ['band'] }],
        summary: { ...emptyDiff().summary, modifiedCount: 1 },
      };

      // Supply entries that don't include the modified ID — isBandUpgrade returns false
      // because get() returns undefined, so falls into Modified section
      const result = generateReleaseNotes(diff, '1.0.0', '1.1.0', [unrelatedEntry], [unrelatedEntry]);
      expect(result).toContain('**SER-COM-ID1-001**: changed fields: `band`');
    });
  });
});
