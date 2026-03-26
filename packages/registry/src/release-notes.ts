import type { RegistryEntry, TranslationBand } from '@tla/shared';
import type { BreakingChange, ModifiedEntry, RegistryDiff } from './types.js';

/**
 * Numeric rank for translation bands (higher = more confident).
 * Mirrors BAND_RANK from diff.ts — kept local to avoid coupling.
 */
const BAND_RANK: Record<TranslationBand, number> = {
  P1: 4,
  P2: 3,
  N1: 2,
  M1: 1,
};

/**
 * Format today's date as YYYY-MM-DD (UTC) for the release notes header.
 */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Detect whether a modified entry represents a band upgrade.
 *
 * Returns true when the 'band' field changed and the afterEntry band rank
 * is strictly higher than the beforeEntry band rank.
 */
function isBandUpgrade(
  modEntry: ModifiedEntry,
  beforeMap: ReadonlyMap<string, RegistryEntry>,
  afterMap: ReadonlyMap<string, RegistryEntry>,
): boolean {
  if (!modEntry.changedFields.includes('band')) return false;
  const before = beforeMap.get(modEntry.entryId);
  const after = afterMap.get(modEntry.entryId);
  if (before === undefined || after === undefined) return false;
  return BAND_RANK[after.band] > BAND_RANK[before.band];
}

/**
 * Build an O(1) lookup map from an array of registry entries keyed by entry ID.
 */
function buildEntryMap(
  entries: ReadonlyArray<RegistryEntry> | undefined,
): Map<string, RegistryEntry> {
  const map = new Map<string, RegistryEntry>();
  if (entries === undefined) return map;
  for (const entry of entries) {
    map.set(entry.registry_entry_id, entry);
  }
  return map;
}

/**
 * Render a machine-parseable section with start/end markers.
 */
function section(
  markerKey: string,
  heading: string,
  lines: string[],
): string {
  const start = `<!-- ${markerKey}_START -->`;
  const end = `<!-- ${markerKey}_END -->`;
  const body = lines.length > 0 ? lines.join('\n') : '_None_';
  return `${start}\n## ${heading}\n\n${body}\n${end}`;
}

/**
 * Generate a Markdown release notes document from a RegistryDiff.
 *
 * @param diff           - The diff produced by `diffRegistries`.
 * @param fromVersion    - The base/previous registry version string.
 * @param toVersion      - The new/current registry version string.
 * @param beforeEntries  - Optional full entry list for the previous version (enables rich lookup).
 * @param afterEntries   - Optional full entry list for the new version (enables rich lookup).
 * @returns A Markdown string. Never throws — catches all errors and returns a warning block.
 */
export function generateReleaseNotes(
  diff: RegistryDiff,
  fromVersion: string,
  toVersion: string,
  beforeEntries?: ReadonlyArray<RegistryEntry>,
  afterEntries?: ReadonlyArray<RegistryEntry>,
): string {
  try {
    const beforeMap = buildEntryMap(beforeEntries);
    const afterMap = buildEntryMap(afterEntries);

    // ── Breaking Changes ──────────────────────────────────────────────────────
    const breakingLines = diff.breakingChanges.map((bc: BreakingChange) => {
      return `- **${bc.entryId}**: ${bc.reason}`;
    });

    // ── New Services ──────────────────────────────────────────────────────────
    const newLines = diff.added.map((id: string) => {
      const entry = afterMap.get(id);
      if (entry !== undefined) {
        return `- **${id}** — \`${entry.aws_service}\` (band: ${entry.band}, type: ${entry.mapping_type})`;
      }
      return `- **${id}**`;
    });

    // ── Improved Mappings (band upgrades) ─────────────────────────────────────
    const improvedEntries = diff.modified.filter((mod: ModifiedEntry) =>
      isBandUpgrade(mod, beforeMap, afterMap),
    );
    const improvedLines = improvedEntries.map((mod: ModifiedEntry) => {
      const before = beforeMap.get(mod.entryId);
      const after = afterMap.get(mod.entryId);
      if (before !== undefined && after !== undefined) {
        return `- **${mod.entryId}**: band upgraded from ${before.band} to ${after.band}`;
      }
      return `- **${mod.entryId}**: band upgraded`;
    });

    // ── Modified Entries (non-upgrade modifications) ───────────────────────────
    const improvedIds = new Set(improvedEntries.map((m) => m.entryId));
    const otherModified = diff.modified.filter(
      (mod: ModifiedEntry) => !improvedIds.has(mod.entryId),
    );
    const modifiedLines = otherModified.map((mod: ModifiedEntry) => {
      const fields = mod.changedFields.join(', ');
      return `- **${mod.entryId}**: changed fields: \`${fields}\``;
    });

    // ── Deprecations ──────────────────────────────────────────────────────────
    // No deprecation mechanism exists yet — emit empty section.
    const deprecationLines: string[] = [];

    // ── Count summary ─────────────────────────────────────────────────────────
    const summary = [
      `${diff.breakingChanges.length} breaking`,
      `${diff.added.length} new`,
      `${improvedEntries.length} improved`,
      `${otherModified.length} modified`,
    ].join(', ');

    const header = [
      `# Registry Release Notes`,
      ``,
      `**Date**: ${todayUtc()}`,
      `**Version**: ${fromVersion} → ${toVersion}`,
      ``,
      `> **Summary**: ${summary}`,
    ].join('\n');

    const sections = [
      section('BREAKING_CHANGES', 'Breaking Changes', breakingLines),
      section('NEW_SERVICES', 'New Services', newLines),
      section('IMPROVED_MAPPINGS', 'Improved Mappings', improvedLines),
      section('MODIFIED_ENTRIES', 'Modified Entries', modifiedLines),
      section('DEPRECATIONS', 'Deprecations', deprecationLines),
    ];

    return [header, '', ...sections].join('\n\n');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return [
      `# Registry Release Notes`,
      ``,
      `<!-- WARNING_START -->`,
      `## Warning`,
      ``,
      `Release notes generation failed: ${message}`,
      `<!-- WARNING_END -->`,
    ].join('\n');
  }
}
