/**
 * Configurable style profiles for translated resource naming and formatting.
 */

// ---------------------------------------------------------------------------
// Rule types
// ---------------------------------------------------------------------------

export interface NamingRules {
  /** Optional string prepended to every resource name. */
  resourcePrefix?: string;
  /** Optional string appended to every resource name. */
  resourceSuffix?: string;
  /** Target case style for resource names. */
  caseStyle: 'snake_case' | 'kebab-case' | 'camelCase';
  /** If set, names are truncated to this length AFTER prefix/suffix are applied. */
  maxLength?: number;
  /** Word separator used during case conversion (defaults to the style's natural separator). */
  separator?: string;
}

export interface ModuleRules {
  /** When true, resources are wrapped inside a Terraform module block. */
  wrapInModule: boolean;
  /** Optional prefix for the generated module label. */
  modulePrefix?: string;
  /** When true, each resource is emitted in its own file. */
  oneFilePerResource: boolean;
}

export interface FormattingRules {
  /** Sort attributes alphabetically within each resource block. */
  sortAttributes: boolean;
  /** Group output resources by their targetType before emitting. */
  groupByResourceType: boolean;
  /** Emit inline comments describing traceability / mapping metadata. */
  includeComments: boolean;
}

export interface StyleProfile {
  naming: NamingRules;
  modules: ModuleRules;
  formatting: FormattingRules;
}

// ---------------------------------------------------------------------------
// Built-in profiles
// ---------------------------------------------------------------------------

/**
 * DEFAULT_PROFILE — no-op baseline.
 * snake_case names, no prefix/suffix, no module wrapping, comments enabled.
 */
export const DEFAULT_PROFILE: StyleProfile = {
  naming: {
    caseStyle: 'snake_case',
  },
  modules: {
    wrapInModule: false,
    oneFilePerResource: false,
  },
  formatting: {
    sortAttributes: false,
    groupByResourceType: false,
    includeComments: true,
  },
};

/**
 * ENTERPRISE_PROFILE — suitable for large, multi-team environments.
 * snake_case names with configurable prefix, sorted attributes, grouped output.
 * Set `naming.resourcePrefix` at call-site to activate the prefix.
 */
export const ENTERPRISE_PROFILE: StyleProfile = {
  naming: {
    caseStyle: 'snake_case',
  },
  modules: {
    wrapInModule: false,
    oneFilePerResource: false,
  },
  formatting: {
    sortAttributes: true,
    groupByResourceType: true,
    includeComments: true,
  },
};

/**
 * MINIMAL_PROFILE — compact output with no comments and no grouping.
 */
export const MINIMAL_PROFILE: StyleProfile = {
  naming: {
    caseStyle: 'snake_case',
  },
  modules: {
    wrapInModule: false,
    oneFilePerResource: false,
  },
  formatting: {
    sortAttributes: false,
    groupByResourceType: false,
    includeComments: false,
  },
};
