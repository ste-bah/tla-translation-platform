import type {
  BehavioralGap,
  RegistryEntry,
  ReviewDomain,
} from '@tla/shared';
import { createComponentLogger, RegistryError } from '@tla/shared';
import type {
  LoadResult,
  RegistryCompleteness,
  RegistryLoader,
  RegistrySearchQuery,
  RegistryValidator,
  ValidationResult,
} from './types.js';

const logger = createComponentLogger('registry-api');

/**
 * Checks whether a value matches a single item or is included in a readonly array.
 */
function matchesSingleOrArray<T>(value: T, filter: T | ReadonlyArray<T>): boolean {
  if (Array.isArray(filter)) {
    return (filter as ReadonlyArray<T>).includes(value);
  }
  return value === filter;
}

/**
 * High-level API for querying the service translation registry.
 *
 * Provides O(1) lookups by AWS service, search with multi-field AND filtering,
 * gap analysis, and completeness statistics.
 */
export class RegistryApi {
  private initialized = false;
  private readonly byId = new Map<string, RegistryEntry>();
  private readonly byAwsService = new Map<string, RegistryEntry>();
  private readonly byFamily = new Map<string, RegistryEntry[]>();
  private readonly byBand = new Map<string, RegistryEntry[]>();
  private allEntries: ReadonlyArray<RegistryEntry> = [];

  constructor(
    private readonly dirPath: string,
    private readonly loader: RegistryLoader,
    private readonly validator: RegistryValidator,
  ) {}

  /**
   * Loads entries from disk and builds internal lookup maps.
   * Must be called before any query methods.
   */
  async init(): Promise<LoadResult> {
    const result = await this.loader(this.dirPath);
    this.buildMaps(result.entries);

    if (result.errors.length > 0) {
      logger.warn(
        { errorCount: result.errors.length },
        'Registry loaded with errors',
      );
    }

    logger.info(
      { entryCount: result.entries.length },
      'Registry initialized',
    );

    this.initialized = true;
    return result;
  }

  /**
   * Reloads entries from disk, atomically replacing internal state.
   */
  async reload(): Promise<LoadResult> {
    const result = await this.loader(this.dirPath);
    this.buildMaps(result.entries);

    this.initialized = true;
    logger.info({ entryCount: result.entries.length }, 'Registry reloaded');

    return result;
  }

  /**
   * O(1) lookup of a registry entry by AWS service/resource type.
   */
  lookup(awsResourceType: string): RegistryEntry | undefined {
    this.ensureInitialized();
    return this.byAwsService.get(awsResourceType);
  }

  /**
   * Looks up multiple AWS resource types at once.
   * Returns a Map of found entries (missing types are omitted).
   */
  lookupMany(types: ReadonlyArray<string>): Map<string, RegistryEntry> {
    this.ensureInitialized();
    const result = new Map<string, RegistryEntry>();
    for (const t of types) {
      const entry = this.byAwsService.get(t);
      if (entry) {
        result.set(t, entry);
      }
    }
    return result;
  }

  /**
   * Searches entries with AND logic across all query fields.
   * Results are sorted by registry_entry_id.
   */
  search(query: RegistrySearchQuery): RegistryEntry[] {
    this.ensureInitialized();

    let candidates: ReadonlyArray<RegistryEntry>;

    // Optimize: if filtering by family, start from that subset
    if (query.family !== undefined) {
      candidates = this.byFamily.get(query.family) ?? [];
    } else {
      candidates = this.allEntries;
    }

    const results: RegistryEntry[] = [];

    for (const entry of candidates) {
      if (query.band !== undefined && !matchesSingleOrArray(entry.band, query.band)) {
        continue;
      }
      if (
        query.mappingType !== undefined &&
        !matchesSingleOrArray(entry.mapping_type, query.mappingType)
      ) {
        continue;
      }
      if (query.minConfidence !== undefined && entry.confidence < query.minConfidence) {
        continue;
      }
      if (query.maxConfidence !== undefined && entry.confidence > query.maxConfidence) {
        continue;
      }
      if (query.reviewRequired !== undefined && entry.manual_review_required !== query.reviewRequired) {
        continue;
      }
      if (
        query.portableCandidate !== undefined &&
        entry.portable_provider_candidate !== query.portableCandidate
      ) {
        continue;
      }
      if (
        query.testStatus !== undefined &&
        !matchesSingleOrArray(entry.test_status, query.testStatus)
      ) {
        continue;
      }
      results.push(entry);
    }

    results.sort((a, b) => a.registry_entry_id.localeCompare(b.registry_entry_id));
    return results;
  }

  /**
   * Returns the behavioral gaps for a specific registry entry.
   */
  getGaps(entryId: string): ReadonlyArray<BehavioralGap> {
    this.ensureInitialized();
    const entry = this.byId.get(entryId);
    return entry?.behavioral_gaps ?? [];
  }

  /**
   * Returns all behavioral gaps from entries whose review_domains include the given domain.
   */
  getGapsByDomain(domain: ReviewDomain): ReadonlyArray<BehavioralGap> {
    this.ensureInitialized();
    const gaps: BehavioralGap[] = [];
    for (const entry of this.allEntries) {
      if (entry.review_domains.includes(domain)) {
        gaps.push(...entry.behavioral_gaps);
      }
    }
    return gaps;
  }

  /**
   * Computes statistics about registry completeness.
   */
  getCompleteness(): RegistryCompleteness {
    this.ensureInitialized();

    const byFamily: Record<string, number> = {};
    const byBand: Record<string, number> = {};
    const byMappingType: Record<string, number> = {};
    let untested = 0;
    let reviewRequired = 0;
    let totalConfidence = 0;

    for (const entry of this.allEntries) {
      byFamily[entry.aws_family] = (byFamily[entry.aws_family] ?? 0) + 1;
      byBand[entry.band] = (byBand[entry.band] ?? 0) + 1;
      byMappingType[entry.mapping_type] = (byMappingType[entry.mapping_type] ?? 0) + 1;

      if (entry.test_status === 'untested') {
        untested++;
      }
      if (entry.manual_review_required) {
        reviewRequired++;
      }
      totalConfidence += entry.confidence;
    }

    const totalEntries = this.allEntries.length;
    const averageConfidence = totalEntries > 0 ? totalConfidence / totalEntries : 0;

    return {
      totalEntries,
      byFamily,
      byBand,
      byMappingType,
      untested,
      reviewRequired,
      averageConfidence,
    };
  }

  /**
   * Runs the validator function against all loaded entries.
   */
  validate(): ValidationResult[] {
    this.ensureInitialized();
    return this.validator([...this.allEntries]);
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new RegistryError('RegistryApi not initialized. Call init() first.', {
        dirPath: this.dirPath,
      });
    }
  }

  private buildMaps(entries: ReadonlyArray<RegistryEntry>): void {
    this.byId.clear();
    this.byAwsService.clear();
    this.byFamily.clear();
    this.byBand.clear();
    this.allEntries = entries;

    for (const entry of entries) {
      this.byId.set(entry.registry_entry_id, entry);
      this.byAwsService.set(entry.aws_service, entry);

      const familyList = this.byFamily.get(entry.aws_family) ?? [];
      familyList.push(entry);
      this.byFamily.set(entry.aws_family, familyList);

      const bandList = this.byBand.get(entry.band) ?? [];
      bandList.push(entry);
      this.byBand.set(entry.band, bandList);
    }
  }
}
