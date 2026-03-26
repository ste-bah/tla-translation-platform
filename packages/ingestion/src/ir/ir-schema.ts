import {
  CanonicalIRSchema,
  IrResourceSchema,
  IrRelationshipSchema,
  IrModuleSchema,
  IrMetadataSchema,
  InfraIntentSchema,
  TranslationStatus,
  RelationshipType,
  ResourceCategory,
  ValidationError,
} from '@tla/shared';
import type { CanonicalIR } from '@tla/shared';

/**
 * Validate an unknown value against the CanonicalIR schema.
 * @throws {ValidationError} if the input does not conform.
 */
export function validateIr(ir: unknown): CanonicalIR {
  try {
    return CanonicalIRSchema.parse(ir);
  } catch (err) {
    throw new ValidationError(
      'Invalid Canonical IR structure',
      { zodError: err instanceof Error ? err.message : String(err) },
      err,
    );
  }
}

// Re-export schemas for external use
export {
  CanonicalIRSchema,
  IrResourceSchema,
  IrRelationshipSchema,
  IrModuleSchema,
  IrMetadataSchema,
  InfraIntentSchema,
  TranslationStatus,
  RelationshipType,
  ResourceCategory,
};
