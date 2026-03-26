/**
 * Normalizes HCL resource attributes for the Canonical IR.
 *
 * Responsibilities:
 * - Extract `tags` from the attribute bag into a separate Record<string, string>
 * - Coerce string booleans ("true"/"false") to native booleans
 * - Pass remaining attributes through unchanged
 */

/**
 * Result of attribute normalization.
 */
export interface NormalizedAttributes {
  /** Attributes with boolean coercion applied and tags removed. */
  attributes: Record<string, unknown>;
  /** Extracted tags as string-to-string map. */
  tags: Record<string, string>;
}

/**
 * Normalize HCL attributes for IR emission.
 *
 * 1. Extracts `tags` (and `tags_all`) from the attribute bag.
 *    Both keys are merged into a single tags map. `tags_all` is processed
 *    after `tags`, so its values win on key collisions — this mirrors
 *    Terraform's semantics where `tags_all` is a superset of `tags` plus
 *    provider-default tags.
 * 2. Coerces string `"true"` / `"false"` values to native booleans.
 * 3. Returns the cleaned attributes and extracted tags separately.
 */
export function normalizeAttributes(
  attrs: Record<string, unknown>,
): NormalizedAttributes {
  const tags: Record<string, string> = {};
  const attributes: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(attrs)) {
    // Extract tags and tags_all into the tags map
    if ((key === 'tags' || key === 'tags_all') && isStringRecord(value)) {
      for (const [tagKey, tagVal] of Object.entries(value)) {
        tags[tagKey] = tagVal;
      }
      continue;
    }

    // Coerce string booleans
    attributes[key] = coerceValue(value);
  }

  return { attributes, tags };
}

/**
 * Recursively coerce string booleans to native booleans.
 */
function coerceValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(coerceValue);
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = coerceValue(v);
    }
    return result;
  }

  return value;
}

/**
 * Type guard: value is a Record<string, string>.
 */
function isStringRecord(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (typeof v !== 'string') return false;
  }
  return true;
}
