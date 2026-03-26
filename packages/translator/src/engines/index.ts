import { TranslationError } from '@tla/shared';
import type { MappingType } from '@tla/shared';
import type { MappingEngine } from './mapping-engine.js';
import { directEngine } from './direct-engine.js';
import { parametricEngine } from './parametric-engine.js';
import { compoundEngine } from './compound-engine.js';
import { structuralEngine } from './structural-engine.js';
import { advisoryEngine } from './advisory-engine.js';

// ---------------------------------------------------------------------------
// Engine registry
// ---------------------------------------------------------------------------

const mutableRegistry = new Map<MappingType, MappingEngine>([
  ['direct', directEngine],
  ['parametric', parametricEngine],
  ['compound', compoundEngine],
  ['structural', structuralEngine],
  ['none', advisoryEngine],
]);

/**
 * Read-only map of all registered mapping engines.
 */
export const engineRegistry: ReadonlyMap<MappingType, MappingEngine> =
  mutableRegistry;

/**
 * Retrieves a mapping engine by type.
 *
 * @throws {TranslationError} If the mapping type is not registered.
 */
export function getEngine(type: MappingType): MappingEngine {
  const engine = engineRegistry.get(type);
  if (!engine) {
    throw new TranslationError(`No engine registered for mapping type: ${type}`, {
      mappingType: type,
    });
  }
  return engine;
}

// Re-export types for convenience
export type {
  MappingEngine,
  TranslationContext,
  EngineResult,
  PlannerInput,
  PlannerResult,
  AssemblyInput,
} from './mapping-engine.js';
