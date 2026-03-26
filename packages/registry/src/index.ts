// Loader
export { loadRegistryFromDirectory, loadRegistryWithPaths } from './loader.js';

// Validator
export { validateRegistryEntries, validateRegistryWithPaths } from './validator.js';

// Completeness checker
export { checkCompleteness } from './completeness-checker.js';

// Diff
export { diffRegistries } from './diff.js';

// Release Notes
export { generateReleaseNotes } from './release-notes.js';

// API
export { RegistryApi } from './api.js';

// Types
export type {
  LoadError,
  LoadResult,
  LoadResultWithPaths,
  ValidationResult,
  RegistrySearchQuery,
  RegistryCompleteness,
  RegistryLoader,
  RegistryValidator,
  FamilyCoverage,
  CompletenessReport,
  CatalogueItem,
  ModifiedEntry,
  BreakingChange,
  DiffSummary,
  RegistryDiff,
  RegistryDiffOptions,
} from './types.js';
