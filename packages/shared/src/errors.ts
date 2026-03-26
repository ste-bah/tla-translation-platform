/**
 * Base error class for the TLA platform.
 * All domain-specific errors extend this class.
 */
export class TlaError extends Error {
  public readonly code: string;
  public readonly context: Record<string, unknown> | undefined;

  constructor(
    message: string,
    code: string,
    context?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'TlaError';
    this.code = code;
    this.context = context;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      cause: this.cause instanceof Error
        ? { name: this.cause.name, message: this.cause.message }
        : this.cause,
    };
  }
}

/**
 * Error originating from registry operations (loading, lookup, search).
 */
export class RegistryError extends TlaError {
  constructor(
    message: string,
    context?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(message, 'REGISTRY_ERROR', context, cause);
    this.name = 'RegistryError';
  }
}

/**
 * Error originating from the ingestion pipeline.
 */
export class IngestionError extends TlaError {
  constructor(
    message: string,
    context?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(message, 'INGESTION_ERROR', context, cause);
    this.name = 'IngestionError';
  }
}

/**
 * Error originating from the translation engine.
 */
export class TranslationError extends TlaError {
  constructor(
    message: string,
    context?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(message, 'TRANSLATION_ERROR', context, cause);
    this.name = 'TranslationError';
  }
}

/**
 * Error originating from validation operations.
 */
export class ValidationError extends TlaError {
  constructor(
    message: string,
    context?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(message, 'VALIDATION_ERROR', context, cause);
    this.name = 'ValidationError';
  }
}

/**
 * Type guard to check if an unknown value is a TlaError.
 */
export function isTlaError(err: unknown): err is TlaError {
  return err instanceof TlaError;
}
