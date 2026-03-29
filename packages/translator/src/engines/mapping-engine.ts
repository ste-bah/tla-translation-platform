import type { MappingType, CloudProvider } from '@tla/shared';
import type {
  IrResource,
  IrRelationship,
  CanonicalIR,
  RegistryEntry,
  TranslatedResource,
  TranslationFinding,
  TranslationPlan,
  CompilerOptions,
  TranslationContract,
} from '@tla/shared';
import type { RegistryApi } from '@tla/registry';

// ---------------------------------------------------------------------------
// Translation context passed to each engine
// ---------------------------------------------------------------------------

/**
 * Context provided to a mapping engine for translating a single resource.
 */
export interface TranslationContext {
  readonly targetProvider: CloudProvider;
  readonly resource: IrResource;
  readonly registryEntry: RegistryEntry;
  readonly relationships: readonly IrRelationship[];
  readonly siblingResources: readonly IrResource[];
  readonly ir: CanonicalIR;
  readonly registry: RegistryApi;
  readonly options: CompilerOptions;
}

// ---------------------------------------------------------------------------
// Engine result
// ---------------------------------------------------------------------------

/**
 * Result produced by a single mapping engine invocation.
 */
export interface EngineResult {
  readonly translated: TranslatedResource[];
  readonly findings: TranslationFinding[];
  readonly contracts?: readonly TranslationContract[];
}

// ---------------------------------------------------------------------------
// Mapping engine interface
// ---------------------------------------------------------------------------

/**
 * A mapping engine translates a single IR resource into target-provider resources.
 */
export interface MappingEngine {
  readonly mappingType: MappingType;
  translate(ctx: TranslationContext): EngineResult;
}

// ---------------------------------------------------------------------------
// Planner types
// ---------------------------------------------------------------------------

/**
 * Input to the translation planner.
 */
export interface PlannerInput {
  readonly ir: CanonicalIR;
  readonly registry: RegistryApi;
  readonly targetProvider: CloudProvider;
}

/**
 * Result of the planning phase.
 */
export interface PlannerResult {
  readonly plan: TranslationPlan;
  readonly findings: TranslationFinding[];
  readonly registryEntries: Map<string, RegistryEntry>;
}

// ---------------------------------------------------------------------------
// Assembly types
// ---------------------------------------------------------------------------

/**
 * Input to the file assembler.
 */
export interface AssemblyInput {
  readonly targetProvider: CloudProvider;
  readonly resources: readonly TranslatedResource[];
  readonly ir: CanonicalIR;
  readonly options: CompilerOptions;
}
