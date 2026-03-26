import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createComponentLogger,
  IngestionError,
  StateDataSchema,
} from '@tla/shared';
import type { StateData } from '@tla/shared';

const logger = createComponentLogger('ingestion');

/**
 * Parses a terraform state JSON file with automatic v3/v4 version detection.
 *
 * @param filePath - Path to the terraform.tfstate file
 * @returns Parsed and validated state data (v3 or v4)
 * @throws {IngestionError} When file cannot be read, is invalid JSON, or fails validation
 */
export async function parseStateJson(filePath: string): Promise<StateData> {
  const absolutePath = resolve(filePath);
  logger.info({ file: absolutePath }, 'Parsing terraform state JSON');

  let content: string;
  try {
    content = await readFile(absolutePath, 'utf-8');
  } catch (err) {
    throw new IngestionError(
      `Failed to read state file: ${absolutePath}`,
      { file: absolutePath },
      err,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new IngestionError(
      `Invalid JSON in state file: ${absolutePath}`,
      { file: absolutePath },
      err,
    );
  }

  if (typeof raw !== 'object' || raw === null || !('version' in raw)) {
    throw new IngestionError(
      `State file missing version field: ${absolutePath}`,
      { file: absolutePath },
    );
  }

  const version = (raw as Record<string, unknown>)['version'];
  if (version !== 3 && version !== 4) {
    throw new IngestionError(
      `Unsupported state file version: ${String(version)}`,
      { file: absolutePath, version },
    );
  }

  logger.info({ file: absolutePath, version }, 'Detected state version');

  try {
    return StateDataSchema.parse(raw);
  } catch (err) {
    throw new IngestionError(
      `State file failed schema validation: ${absolutePath}`,
      { file: absolutePath, version },
      err,
    );
  }
}
