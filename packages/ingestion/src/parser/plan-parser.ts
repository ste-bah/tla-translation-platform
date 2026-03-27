import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createComponentLogger,
  IngestionError,
  PlanDataSchema,
} from '@tla/shared';
import type { PlanData } from '@tla/shared';

const logger = createComponentLogger('ingestion');

/**
 * Parses a terraform plan JSON file and returns validated plan data.
 *
 * The input must be the JSON output of `terraform show -json <planfile>`.
 *
 * @param filePath - Path to the plan JSON file
 * @returns Parsed and validated plan data
 * @throws {IngestionError} When file cannot be read or fails validation
 */
export async function parsePlanJson(filePath: string): Promise<PlanData> {
  const absolutePath = resolve(filePath);
  logger.info({ file: absolutePath }, 'Parsing terraform plan JSON');

  let content: string;
  try {
    content = await readFile(absolutePath, 'utf-8');
  } catch (err) {
    throw new IngestionError(
      `Failed to read plan file: ${absolutePath}`,
      { file: absolutePath },
      err,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new IngestionError(
      `Invalid JSON in plan file: ${absolutePath}`,
      { file: absolutePath },
      err,
    );
  }

  try {
    return PlanDataSchema.parse(raw);
  } catch (err) {
    throw new IngestionError(
      `Plan file failed schema validation: ${absolutePath}`,
      { file: absolutePath },
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// Lightweight address extraction (no Zod validation)
// ---------------------------------------------------------------------------

/**
 * Recursively collects resource `address` fields from a module object.
 * Handles `resources` and nested `child_modules` arrays.
 */
function collectAddresses(module: unknown, out: Set<string>): void {
  if (module === null || typeof module !== 'object') return;

  const mod = module as Record<string, unknown>;

  // Collect addresses from resources array
  if (Array.isArray(mod['resources'])) {
    for (const resource of mod['resources']) {
      if (
        resource !== null &&
        typeof resource === 'object' &&
        typeof (resource as Record<string, unknown>)['address'] === 'string'
      ) {
        out.add((resource as Record<string, unknown>)['address'] as string);
      }
    }
  }

  // Recurse into child_modules
  if (Array.isArray(mod['child_modules'])) {
    for (const child of mod['child_modules']) {
      collectAddresses(child, out);
    }
  }
}

/**
 * Extracts all resource addresses from a terraform plan JSON file.
 *
 * Walks `planned_values.root_module.resources` and recursively walks
 * `child_modules` to collect every resource `address` field.
 *
 * This is a lightweight alternative to `parsePlanJson` — it does not
 * validate the full plan schema, only checks that `planned_values` exists.
 *
 * @param planJsonPath - Path to the plan JSON file
 * @returns Set of all resource addresses found in the plan
 * @throws {IngestionError} When file cannot be read, is invalid JSON, or
 *   lacks a `planned_values` top-level key
 */
export async function extractPlanAddresses(planJsonPath: string): Promise<Set<string>> {
  const absolutePath = resolve(planJsonPath);
  logger.info({ file: absolutePath }, 'Extracting resource addresses from plan JSON');

  let content: string;
  try {
    content = await readFile(absolutePath, 'utf-8');
  } catch (err) {
    throw new IngestionError(
      `Failed to read plan file: ${absolutePath}`,
      { file: absolutePath },
      err,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new IngestionError(
      `Invalid JSON in plan file: ${absolutePath}`,
      { file: absolutePath },
      err,
    );
  }

  if (raw === null || typeof raw !== 'object') {
    throw new IngestionError(
      `Plan file is not a JSON object: ${absolutePath}`,
      { file: absolutePath },
    );
  }

  const plan = raw as Record<string, unknown>;
  const plannedValues = plan['planned_values'];
  if (plannedValues === null || plannedValues === undefined || typeof plannedValues !== 'object') {
    throw new IngestionError(
      `Plan file missing planned_values: ${absolutePath}`,
      { file: absolutePath },
    );
  }

  const rootModule = (plannedValues as Record<string, unknown>)['root_module'];
  const addresses = new Set<string>();
  collectAddresses(rootModule, addresses);

  logger.info({ count: addresses.size }, 'Extracted plan addresses');
  return addresses;
}
