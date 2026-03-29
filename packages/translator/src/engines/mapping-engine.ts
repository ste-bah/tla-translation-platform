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

export interface EngineResult {
  readonly translated: TranslatedResource[];
  readonly findings: TranslationFinding[];
  readonly contracts?: TranslationContract[];
}

export interface MappingEngine {
  readonly mappingType: MappingType;
  translate(ctx: TranslationContext): EngineResult;
}

export interface PlannerInput {
  readonly ir: CanonicalIR;
  readonly registry: RegistryApi;
  readonly targetProvider: CloudProvider;
}

export interface PlannerResult {
  readonly plan: TranslationPlan;
  readonly findings: TranslationFinding[];
  readonly registryEntries: Map<string, RegistryEntry>;
}

export interface AssemblyInput {
  readonly targetProvider: CloudProvider;
  readonly resources: readonly TranslatedResource[];
  readonly ir: CanonicalIR;
  readonly options: CompilerOptions;
}
