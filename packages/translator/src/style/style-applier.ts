import type { TranslatedResource } from '@tla/shared/types/translation.js';
import type { StyleProfile } from './style-profile.js';

// ---------------------------------------------------------------------------
// Case-conversion helpers
// ---------------------------------------------------------------------------

/**
 * Split an identifier into tokens, regardless of its current case style.
 * Handles snake_case, kebab-case, camelCase, PascalCase, and mixed input.
 */
function tokenize(name: string): string[] {
  return name
    // Insert a boundary before uppercase letters that follow a lowercase letter
    // (camelCase / PascalCase split).
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Insert a boundary before sequences of uppercase letters followed by a
    // lowercase letter (e.g. "XMLParser" → "XML Parser").
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // Replace separators (underscore, hyphen, space) with a single space.
    .replace(/[_\-\s]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .filter(Boolean);
}

/** Convert an identifier to snake_case. */
export function toSnakeCase(name: string): string {
  return tokenize(name).join('_');
}

/** Convert an identifier to kebab-case. */
export function toKebabCase(name: string): string {
  return tokenize(name).join('-');
}

/** Convert an identifier to camelCase. */
export function toCamelCase(name: string): string {
  const tokens = tokenize(name);
  if (tokens.length === 0) return '';
  return (
    tokens[0] +
    tokens
      .slice(1)
      .map(t => t.charAt(0).toUpperCase() + t.slice(1))
      .join('')
  );
}

// ---------------------------------------------------------------------------
// Core transformer
// ---------------------------------------------------------------------------

/**
 * Apply a naming rule to a single resource name.
 *
 * Order of operations:
 *   1. Convert to the target caseStyle.
 *   2. Prepend resourcePrefix (if any).
 *   3. Append resourceSuffix (if any).
 *   4. Truncate to maxLength (if set).
 */
function applyNaming(name: string, profile: StyleProfile): string {
  const { naming } = profile;

  // 1. Case conversion.
  let result: string;
  switch (naming.caseStyle) {
    case 'snake_case':
      result = toSnakeCase(name);
      break;
    case 'kebab-case':
      result = toKebabCase(name);
      break;
    case 'camelCase':
      result = toCamelCase(name);
      break;
    default: {
      // Exhaustiveness guard.
      const _: never = naming.caseStyle;
      result = name;
    }
  }

  // 2 & 3. Prefix / suffix.
  if (naming.resourcePrefix) {
    result = `${naming.resourcePrefix}${result}`;
  }
  if (naming.resourceSuffix) {
    result = `${result}${naming.resourceSuffix}`;
  }

  // 4. Max-length truncation.
  if (naming.maxLength !== undefined && result.length > naming.maxLength) {
    result = result.slice(0, naming.maxLength);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply a {@link StyleProfile} to an array of translated resources.
 *
 * - Only `targetName` is transformed; `targetType` and `attributes` are
 *   left untouched (immutability of semantics).
 * - Returns a **new array** — the input is never mutated.
 */
export function applyStyle(
  resources: TranslatedResource[],
  profile: StyleProfile,
): TranslatedResource[] {
  return resources.map(resource => ({
    ...resource,
    targetName: applyNaming(resource.targetName, profile),
  }));
}
