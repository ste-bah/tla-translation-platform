import type { RegistryEntry } from '@tla/shared';
import type { CatalogueItem, CompletenessReport, FamilyCoverage } from './types.js';

/**
 * Checks how well a set of registry entries covers a known service catalogue.
 *
 * This is a pure, synchronous function. It does not throw.
 *
 * @param entries - The loaded registry entries
 * @param catalogue - The known AWS services to check coverage against
 * @returns A CompletenessReport with covered, missing, unrecognised, and per-family breakdowns
 */
export function checkCompleteness(
  entries: ReadonlyArray<RegistryEntry>,
  catalogue: ReadonlyArray<CatalogueItem>,
): CompletenessReport {
  // Build a set of aws_service values from registry entries
  const registeredServices = new Set<string>();
  // Map from aws_service to aws_family for entries
  const entryFamilyMap = new Map<string, string>();
  for (const entry of entries) {
    registeredServices.add(entry.aws_service);
    entryFamilyMap.set(entry.aws_service, entry.aws_family);
  }

  // Build a set of catalogue services
  const catalogueServices = new Set<string>();
  // Map from family to catalogue services
  const catalogueByFamily = new Map<string, string[]>();
  for (const item of catalogue) {
    catalogueServices.add(item.awsService);
    const familyList = catalogueByFamily.get(item.family) ?? [];
    familyList.push(item.awsService);
    catalogueByFamily.set(item.family, familyList);
  }

  // Covered: in both registry and catalogue
  const covered: string[] = [];
  // Missing: in catalogue but not registry
  const missing: string[] = [];
  // Unrecognised: in registry but not catalogue
  const unrecognised: string[] = [];

  for (const svc of catalogueServices) {
    if (registeredServices.has(svc)) {
      covered.push(svc);
    } else {
      missing.push(svc);
    }
  }

  for (const svc of registeredServices) {
    if (!catalogueServices.has(svc)) {
      unrecognised.push(svc);
    }
  }

  // Sort for deterministic output
  covered.sort();
  missing.sort();
  unrecognised.sort();

  // Per-family breakdown
  const byFamily: FamilyCoverage[] = [];
  const allFamilies = new Set<string>();
  for (const item of catalogue) {
    allFamilies.add(item.family);
  }
  const sortedFamilies = [...allFamilies].sort();

  for (const family of sortedFamilies) {
    const familyServices = catalogueByFamily.get(family) ?? [];
    const familyCovered: string[] = [];
    const familyMissing: string[] = [];

    for (const svc of familyServices) {
      if (registeredServices.has(svc)) {
        familyCovered.push(svc);
      } else {
        familyMissing.push(svc);
      }
    }

    familyCovered.sort();
    familyMissing.sort();

    byFamily.push({
      family,
      covered: familyCovered,
      missing: familyMissing,
    });
  }

  return { covered, missing, unrecognised, byFamily };
}
