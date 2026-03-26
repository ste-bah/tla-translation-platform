import { basename, dirname } from 'node:path';
import type { RegistryEntry } from '@tla/shared';
import type { ValidationResult } from './types.js';

/**
 * Validates an array of registry entries against 15 business rules.
 *
 * This is a pure, synchronous function. It does not throw.
 *
 * Rules:
 *  1.  no-duplicate-ids - registry_entry_id must be unique
 *  2.  no-duplicate-aws-service - aws_service must be unique
 *  3.  valid-requirement-refs - related_requirements format (warning)
 *  4.  valid-edge-case-refs - related_edge_cases format (warning)
 *  5.  confidence-in-range - confidence in [0, 1] (belt-and-suspenders)
 *  6.  p1-confidence-threshold - P1 band requires confidence >= 0.80
 *  7.  m1-requires-review - M1 band requires manual_review_required = true
 *  8.  none-requires-m1 - mapping_type 'none' requires band M1
 *  9.  non-m1-requires-targets - Non-M1 entries need azure_targets OR gcp_targets
 *  10. p2-confidence-range - P2 band requires 0.50 <= confidence < 0.90
 *  11. n1-confidence-range - N1 band requires 0.30 <= confidence < 0.80
 *  12. m1-confidence-ceiling - M1 band requires confidence < 0.50
 *  13. gap-id-uniqueness - gap_id values must be unique within an entry
 *  14. blocker-gap-warning - warn on P1/P2 entries with blocker-severity gaps
 *
 * Rule 15 (family-directory) requires file path context; see {@link validateRegistryWithPaths}.
 *
 * @param entries - The registry entries to validate
 * @returns Array of validation findings
 */
export function validateRegistryEntries(
  entries: ReadonlyArray<RegistryEntry>,
): ValidationResult[] {
  const results: ValidationResult[] = [];

  // Rule 1: no-duplicate-ids
  const seenIds = new Map<string, number>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === undefined) continue;
    const prevIndex = seenIds.get(entry.registry_entry_id);
    if (prevIndex !== undefined) {
      results.push({
        entryId: entry.registry_entry_id,
        rule: 'no-duplicate-ids',
        severity: 'error',
        message: `Duplicate registry_entry_id "${entry.registry_entry_id}" (first seen at index ${String(prevIndex)})`,
        field: 'registry_entry_id',
      });
    } else {
      seenIds.set(entry.registry_entry_id, i);
    }
  }

  // Rule 2: no-duplicate-aws-service
  const seenServices = new Map<string, string>();
  for (const entry of entries) {
    const existing = seenServices.get(entry.aws_service);
    if (existing !== undefined) {
      results.push({
        entryId: entry.registry_entry_id,
        rule: 'no-duplicate-aws-service',
        severity: 'error',
        message: `Duplicate aws_service "${entry.aws_service}" (also in ${existing})`,
        field: 'aws_service',
      });
    } else {
      seenServices.set(entry.aws_service, entry.registry_entry_id);
    }
  }

  const reqPattern = /^REQ-[A-Z]+-\d{3}$/;
  const ecPattern = /^EC-\d{3}$/;

  for (const entry of entries) {
    // Rule 3: valid-requirement-refs
    for (const ref of entry.related_requirements) {
      if (!reqPattern.test(ref)) {
        results.push({
          entryId: entry.registry_entry_id,
          rule: 'valid-requirement-refs',
          severity: 'warning',
          message: `Invalid requirement reference format: "${ref}"`,
          field: 'related_requirements',
        });
      }
    }

    // Rule 4: valid-edge-case-refs
    for (const ref of entry.related_edge_cases) {
      if (!ecPattern.test(ref)) {
        results.push({
          entryId: entry.registry_entry_id,
          rule: 'valid-edge-case-refs',
          severity: 'warning',
          message: `Invalid edge case reference format: "${ref}"`,
          field: 'related_edge_cases',
        });
      }
    }

    // Rule 5: confidence-in-range (belt-and-suspenders; Zod already checks this)
    if (entry.confidence < 0 || entry.confidence > 1) {
      results.push({
        entryId: entry.registry_entry_id,
        rule: 'confidence-in-range',
        severity: 'error',
        message: `Confidence ${String(entry.confidence)} is outside [0, 1]`,
        field: 'confidence',
      });
    }

    // Rule 6: p1-confidence-threshold
    if (entry.band === 'P1' && entry.confidence < 0.80) {
      results.push({
        entryId: entry.registry_entry_id,
        rule: 'p1-confidence-threshold',
        severity: 'error',
        message: `P1 band requires confidence >= 0.80, got ${String(entry.confidence)}`,
        field: 'confidence',
      });
    }

    // Rule 7: m1-requires-review
    if (entry.band === 'M1' && !entry.manual_review_required) {
      results.push({
        entryId: entry.registry_entry_id,
        rule: 'm1-requires-review',
        severity: 'error',
        message: 'M1 band requires manual_review_required to be true',
        field: 'manual_review_required',
      });
    }

    // Rule 8: none-requires-m1
    if (entry.mapping_type === 'none' && entry.band !== 'M1') {
      results.push({
        entryId: entry.registry_entry_id,
        rule: 'none-requires-m1',
        severity: 'error',
        message: `mapping_type "none" requires band M1, got "${entry.band}"`,
        field: 'band',
      });
    }

    // Rule 9: non-m1-requires-targets
    if (
      entry.band !== 'M1' &&
      entry.azure_targets.length === 0 &&
      entry.gcp_targets.length === 0
    ) {
      results.push({
        entryId: entry.registry_entry_id,
        rule: 'non-m1-requires-targets',
        severity: 'error',
        message: 'Non-M1 entries must have at least one azure_target or gcp_target',
        field: 'azure_targets',
      });
    }

    // Rule 10: p2-confidence-range (P2: 0.50 <= conf < 0.90)
    if (entry.band === 'P2' && (entry.confidence < 0.50 || entry.confidence >= 0.90)) {
      results.push({
        entryId: entry.registry_entry_id,
        rule: 'p2-confidence-range',
        severity: 'error',
        message: `P2 band requires 0.50 <= confidence < 0.90, got ${String(entry.confidence)}`,
        field: 'confidence',
      });
    }

    // Rule 11: n1-confidence-range (N1: 0.30 <= conf < 0.80)
    if (entry.band === 'N1' && (entry.confidence < 0.30 || entry.confidence >= 0.80)) {
      results.push({
        entryId: entry.registry_entry_id,
        rule: 'n1-confidence-range',
        severity: 'error',
        message: `N1 band requires 0.30 <= confidence < 0.80, got ${String(entry.confidence)}`,
        field: 'confidence',
      });
    }

    // Rule 12: m1-confidence-ceiling (M1: conf < 0.50)
    if (entry.band === 'M1' && entry.confidence >= 0.50) {
      results.push({
        entryId: entry.registry_entry_id,
        rule: 'm1-confidence-ceiling',
        severity: 'error',
        message: `M1 band requires confidence < 0.50, got ${String(entry.confidence)}`,
        field: 'confidence',
      });
    }

    // Rule 13: gap-id-uniqueness (within entry)
    const seenGapIds = new Set<string>();
    for (const gap of entry.behavioral_gaps) {
      if (seenGapIds.has(gap.gap_id)) {
        results.push({
          entryId: entry.registry_entry_id,
          rule: 'gap-id-uniqueness',
          severity: 'error',
          message: `Duplicate gap_id "${gap.gap_id}" within entry`,
          field: 'behavioral_gaps',
        });
      } else {
        seenGapIds.add(gap.gap_id);
      }
    }

    // Rule 14: blocker-gap-warning (warn on P1/P2 with blocker gap)
    if (entry.band === 'P1' || entry.band === 'P2') {
      for (const gap of entry.behavioral_gaps) {
        if (gap.severity === 'blocker') {
          results.push({
            entryId: entry.registry_entry_id,
            rule: 'blocker-gap-warning',
            severity: 'warning',
            message: `${entry.band} entry has blocker-severity gap "${gap.gap_id}"`,
            field: 'behavioral_gaps',
          });
        }
      }
    }
  }

  return results;
}

/**
 * Map from aws_family value to expected directory name.
 */
const FAMILY_TO_DIR: Record<string, string> = {
  compute: 'compute',
  storage: 'storage',
  database: 'database',
  networking: 'networking',
  security: 'security',
  serverless: 'serverless',
  messaging: 'messaging',
  observability: 'observability',
  containers: 'containers',
  identity: 'identity',
};

/**
 * Validates registry entries with file path context, enabling Rule 15.
 *
 * Runs all rules from {@link validateRegistryEntries} plus:
 *  15. family-directory - YAML file must reside in a directory matching aws_family
 *
 * @param entries - The registry entries to validate
 * @param pathMap - Map from registry_entry_id to the absolute file path
 * @returns Array of validation findings
 */
export function validateRegistryWithPaths(
  entries: ReadonlyArray<RegistryEntry>,
  pathMap: ReadonlyMap<string, string>,
): ValidationResult[] {
  const results = validateRegistryEntries(entries);

  // Rule 15: family-directory
  for (const entry of entries) {
    const filePath = pathMap.get(entry.registry_entry_id);
    if (filePath === undefined) continue;

    const expectedDir = FAMILY_TO_DIR[entry.aws_family];
    if (expectedDir === undefined) continue;

    const parentDir = basename(dirname(filePath));
    if (parentDir !== expectedDir) {
      results.push({
        entryId: entry.registry_entry_id,
        rule: 'family-directory',
        severity: 'warning',
        message: `Entry with aws_family "${entry.aws_family}" is in directory "${parentDir}", expected "${expectedDir}"`,
        field: 'aws_family',
      });
    }
  }

  return results;
}
