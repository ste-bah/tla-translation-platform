import type { CanonicalIR } from '@tla/shared';
import { IngestionError } from '@tla/shared';
import { validateIr } from './ir-schema.js';

/**
 * Serialize a CanonicalIR to a deterministic JSON string with sorted keys.
 */
export function serializeIr(ir: CanonicalIR): string {
  return JSON.stringify(ir, sortedReplacer, 2);
}

/**
 * Deserialize a JSON string to a validated CanonicalIR.
 * @throws {ValidationError} if the JSON does not conform to the schema.
 */
export function deserializeIr(json: string): CanonicalIR {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new IngestionError(
      'Failed to parse IR JSON',
      { jsonLength: json.length },
      err,
    );
  }
  return validateIr(raw);
}

/**
 * JSON replacer that sorts object keys alphabetically for deterministic output.
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      sorted[k] = obj[k];
    }
    return sorted;
  }
  return value;
}
