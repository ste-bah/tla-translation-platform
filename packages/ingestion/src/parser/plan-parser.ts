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
