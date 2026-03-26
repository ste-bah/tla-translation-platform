import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Categories of auditable events in the translation pipeline.
 */
export const AuditEventKind = z.enum([
  'translation_start',
  'translation_complete',
  'translation_error',
  'engine_emit',
  'engine_error',
  'file_assembly',
  'manifest_build',
]);
export type AuditEventKind = z.infer<typeof AuditEventKind>;

// ---------------------------------------------------------------------------
// Core audit schemas
// ---------------------------------------------------------------------------

/**
 * A single immutable audit event record.
 *
 * The `hash` field contains a SHA-256 hex digest over the concatenation of:
 *   previousHash + kind + timestamp + JSON.stringify(payload)
 * forming a tamper-evident chain. The genesis entry uses the empty string
 * as its previousHash.
 */
export const AuditEventSchema = z.object({
  /** Sequential index within the current logger session (0-based). */
  seq: z.number().int().nonnegative(),
  /** ISO-8601 UTC timestamp at the moment of logging. */
  timestamp: z.string().datetime(),
  /** High-level event category. */
  kind: AuditEventKind,
  /** Arbitrary structured payload — content depends on `kind`. */
  payload: z.record(z.string(), z.unknown()),
  /** SHA-256 hex digest chaining this entry to its predecessor. */
  hash: z.string().length(64),
  /** Hash of the immediately preceding entry (empty string for seq=0). */
  previousHash: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/**
 * The result returned by `verifyChain`.
 */
export const ChainVerificationResultSchema = z.object({
  /** True if every entry's hash is consistent with its recorded previousHash. */
  valid: z.boolean(),
  /**
   * Index of the first broken link, or null when the chain is intact.
   * A value of 0 indicates the genesis entry itself failed to verify.
   */
  firstBrokenIndex: z.number().int().nonnegative().nullable(),
  /** Total number of entries examined. */
  entriesChecked: z.number().int().nonnegative(),
});
export type ChainVerificationResult = z.infer<typeof ChainVerificationResultSchema>;

/**
 * Options accepted by `AuditLogger.create`.
 */
export const AuditLoggerOptionsSchema = z.object({
  /**
   * Maximum number of events retained in memory.
   * Older entries are dropped from the in-memory buffer when the limit is
   * reached, but the hash-chain invariant is preserved through the retained
   * tail (the last emitted hash is always kept as the chain anchor).
   *
   * @default 10_000
   */
  maxBufferSize: z.number().int().positive().default(10_000),
});
export type AuditLoggerOptions = z.infer<typeof AuditLoggerOptionsSchema>;
