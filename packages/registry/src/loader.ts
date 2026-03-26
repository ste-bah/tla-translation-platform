import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { RegistryEntry } from '@tla/shared';
import { RegistryEntrySchema, createComponentLogger } from '@tla/shared';
import type { LoadError, LoadResult, LoadResultWithPaths } from './types.js';

const logger = createComponentLogger('registry-loader');

/**
 * Recursively collects all .yaml / .yml file paths under a directory.
 */
async function collectYamlFiles(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  const dirents = await readdir(dirPath, { withFileTypes: true });

  for (const dirent of dirents) {
    // Skip symlinks to prevent path-traversal attacks (P1 security fix)
    if (dirent.isSymbolicLink()) {
      continue;
    }

    const fullPath = join(dirPath, dirent.name);
    if (dirent.isDirectory()) {
      const nested = await collectYamlFiles(fullPath);
      results.push(...nested);
    } else if (dirent.isFile()) {
      const ext = extname(dirent.name).toLowerCase();
      if (ext === '.yaml' || ext === '.yml') {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Internal: parse YAML files and collect entries + errors + path mappings.
 */
async function loadEntriesFromFiles(
  dirPath: string,
): Promise<{
  entries: RegistryEntry[];
  errors: LoadError[];
  entryPaths: Map<string, string>;
}> {
  const entries: RegistryEntry[] = [];
  const errors: LoadError[] = [];
  const entryPaths = new Map<string, string>();

  let filePaths: string[];
  try {
    filePaths = await collectYamlFiles(dirPath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push({ filePath: dirPath, message: `Failed to read directory: ${message}` });
    return { entries, errors, entryPaths };
  }

  logger.info({ dirPath, fileCount: filePaths.length }, 'Loading registry files');

  for (const filePath of filePaths) {
    let rawContent: string;
    try {
      rawContent = await readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ filePath, message: `Failed to read file: ${message}` });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(rawContent);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ filePath, message: `YAML parse error: ${message}` });
      continue;
    }

    // Support both single objects and arrays of entries per file
    const items = Array.isArray(parsed) ? (parsed as unknown[]) : [parsed];

    for (const item of items) {
      const result = RegistryEntrySchema.safeParse(item);
      if (result.success) {
        entries.push(result.data);
        entryPaths.set(result.data.registry_entry_id, filePath);
      } else {
        const issues = result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
        errors.push({
          filePath,
          message: `Schema validation failed`,
          issues,
        });
      }
    }
  }

  logger.info(
    { entriesLoaded: entries.length, errorsEncountered: errors.length },
    'Registry loading complete',
  );

  return { entries, errors, entryPaths };
}

/**
 * Loads all registry entries from YAML files in the given directory (recursively).
 *
 * Never throws. All parse/validation failures are accumulated in `LoadResult.errors`.
 *
 * @param dirPath - Absolute path to the directory containing registry YAML files
 * @returns A LoadResult with valid entries and any errors encountered
 */
export async function loadRegistryFromDirectory(dirPath: string): Promise<LoadResult> {
  const { entries, errors } = await loadEntriesFromFiles(dirPath);
  return { entries, errors };
}

/**
 * Loads registry entries with file path tracking.
 *
 * Same as {@link loadRegistryFromDirectory} but additionally returns a map
 * from registry_entry_id to the source file path, enabling Rule 15 validation.
 *
 * @param dirPath - Absolute path to the directory containing registry YAML files
 * @returns A LoadResultWithPaths with entries, errors, and entryPaths map
 */
export async function loadRegistryWithPaths(dirPath: string): Promise<LoadResultWithPaths> {
  const { entries, errors, entryPaths } = await loadEntriesFromFiles(dirPath);
  return { entries, errors, entryPaths };
}
