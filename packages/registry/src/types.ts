import type {
  AwsServiceFamily,
  MappingType,
  RegistryEntry,
  TestStatus,
  TranslationBand,
} from '@tla/shared';

/**
 * Describes an error encountered while loading a registry file.
 */
export interface LoadError {
  readonly filePath: string;
  readonly message: string;
  readonly issues?: ReadonlyArray<{ readonly path: string; readonly message: string }>;
}

/**
 * Result of loading registry entries from a directory.
 */
export interface LoadResult {
  readonly entries: ReadonlyArray<RegistryEntry>;
  readonly errors: ReadonlyArray<LoadError>;
}

/**
 * A single validation finding for a registry entry.
 */
export interface ValidationResult {
  readonly entryId: string;
  readonly rule: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly field?: string;
}

/**
 * Extended load result that includes a map of entry IDs to their source file paths.
 */
export interface LoadResultWithPaths extends LoadResult {
  readonly entryPaths: ReadonlyMap<string, string>;
}

/**
 * Coverage of a single AWS service family.
 */
export interface FamilyCoverage {
  readonly family: string;
  readonly covered: ReadonlyArray<string>;
  readonly missing: ReadonlyArray<string>;
}

/**
 * Report of how well registry entries cover a known service catalogue.
 */
export interface CompletenessReport {
  readonly covered: ReadonlyArray<string>;
  readonly missing: ReadonlyArray<string>;
  readonly unrecognised: ReadonlyArray<string>;
  readonly byFamily: ReadonlyArray<FamilyCoverage>;
}

/**
 * An item in a service catalogue used for completeness checking.
 */
export interface CatalogueItem {
  readonly awsService: string;
  readonly family: string;
}

/**
 * A single entry that was modified between two registry versions.
 */
export interface ModifiedEntry {
  readonly entryId: string;
  readonly changedFields: ReadonlyArray<string>;
}

/**
 * A breaking change detected between two registry versions.
 */
export interface BreakingChange {
  readonly entryId: string;
  readonly reason: string;
}

/**
 * Summary statistics for a registry diff.
 */
export interface DiffSummary {
  readonly addedCount: number;
  readonly removedCount: number;
  readonly modifiedCount: number;
  readonly unchangedCount: number;
  readonly breakingChangeCount: number;
}

/**
 * Complete diff result between two registry versions.
 */
export interface RegistryDiff {
  readonly added: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
  readonly modified: ReadonlyArray<ModifiedEntry>;
  readonly unchanged: ReadonlyArray<string>;
  readonly breakingChanges: ReadonlyArray<BreakingChange>;
  readonly summary: DiffSummary;
}

/**
 * Options for registry diff operation.
 */
export interface RegistryDiffOptions {
  readonly confidenceDropThreshold?: number;
}

/**
 * Query object for searching registry entries.
 * All fields are optional; multiple fields are combined with AND logic.
 */
export interface RegistrySearchQuery {
  readonly family?: AwsServiceFamily;
  readonly band?: TranslationBand | ReadonlyArray<TranslationBand>;
  readonly mappingType?: MappingType | ReadonlyArray<MappingType>;
  readonly minConfidence?: number;
  readonly maxConfidence?: number;
  readonly reviewRequired?: boolean;
  readonly portableCandidate?: boolean;
  readonly testStatus?: TestStatus | ReadonlyArray<TestStatus>;
}

/**
 * Statistics about registry completeness.
 */
export interface RegistryCompleteness {
  readonly totalEntries: number;
  readonly byFamily: Record<string, number>;
  readonly byBand: Record<string, number>;
  readonly byMappingType: Record<string, number>;
  readonly untested: number;
  readonly reviewRequired: number;
  readonly averageConfidence: number;
}

/**
 * Function signature for loading registry entries from a directory.
 */
export type RegistryLoader = (dirPath: string) => Promise<LoadResult>;

/**
 * Function signature for validating an array of registry entries.
 */
export type RegistryValidator = (entries: ReadonlyArray<RegistryEntry>) => ValidationResult[];
