import { createHash } from 'node:crypto';
import { createComponentLogger } from '../utils/logger.js';
import type {
  AuditEvent,
  AuditEventKind,
  AuditLoggerOptions,
  ChainVerificationResult,
} from './audit-types.js';
import { AuditLoggerOptionsSchema } from './audit-types.js';

const logger = createComponentLogger('audit-logger');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Computes a SHA-256 hex digest used to link audit entries into a chain.
 *
 * The digest covers:
 *   previousHash + kind + timestamp + JSON.stringify(payload)
 *
 * The order and separator-free concatenation is intentional: each field is
 * deterministic in length or content, so a separator would be redundant and
 * could itself be spoofed.
 */
function computeHash(
  previousHash: string,
  kind: AuditEventKind,
  timestamp: string,
  payload: Record<string, unknown>,
): string {
  const content = previousHash + kind + timestamp + JSON.stringify(payload);
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// AuditLogger
// ---------------------------------------------------------------------------

/**
 * An in-memory, append-only audit logger that maintains a tamper-evident
 * hash chain over translation pipeline events.
 *
 * The chain is useful for detecting post-hoc tampering with the event
 * buffer.  It is NOT a substitute for cryptographic signing or persistent
 * storage — both are intentionally out of scope for this component.
 *
 * @example
 * ```ts
 * const audit = AuditLogger.create();
 * audit.log('translation_start', { sourceId: ir.metadata.sourceId });
 * const events = audit.getEvents();
 * const result = audit.verifyChain();
 * console.log(result.valid); // true
 * ```
 */
export class AuditLogger {
  private readonly events: AuditEvent[] = [];
  /** The hash of the most recently appended entry (chain anchor). */
  private lastHash = '';
  private seq = 0;
  private readonly maxBufferSize: number;

  private constructor(options: Required<AuditLoggerOptions>) {
    this.maxBufferSize = options.maxBufferSize;
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  /**
   * Creates a new `AuditLogger` instance with validated options.
   *
   * @param options - Optional configuration (all fields have safe defaults).
   */
  static create(options?: Partial<AuditLoggerOptions>): AuditLogger {
    const parsed = AuditLoggerOptionsSchema.parse(options ?? {});
    return new AuditLogger(parsed as Required<AuditLoggerOptions>);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Appends an immutable event to the audit trail.
   *
   * The event is linked into the hash chain and emitted to the component
   * logger at `debug` level so operators can correlate audit events with
   * structured logs without needing the in-memory buffer.
   *
   * @param kind - The event category.
   * @param payload - Arbitrary structured data; must be JSON-serialisable.
   */
  log(kind: AuditEventKind, payload: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const hash = computeHash(this.lastHash, kind, timestamp, payload);

    const event: AuditEvent = {
      seq: this.seq,
      timestamp,
      kind,
      payload,
      hash,
      previousHash: this.lastHash,
    };

    // Enforce buffer size limit: drop the oldest entry but keep lastHash
    // intact so the chain continues unbroken from the surviving tail.
    if (this.events.length >= this.maxBufferSize) {
      this.events.shift();
    }

    this.events.push(event);
    this.lastHash = hash;
    this.seq++;

    logger.debug({ seq: event.seq, kind, hash }, 'audit event logged');
  }

  /**
   * Returns a shallow copy of the current in-memory event buffer.
   *
   * The returned array is safe to iterate and inspect but mutations do
   * not affect the internal buffer.
   */
  getEvents(): readonly AuditEvent[] {
    return this.events.slice();
  }

  /**
   * Returns the number of events currently held in the buffer.
   */
  get size(): number {
    return this.events.length;
  }

  /**
   * Verifies the hash chain over all buffered events.
   *
   * Each entry's `hash` is recomputed from its fields and compared to the
   * stored value.  Additionally, each entry's `previousHash` must match the
   * `hash` of its predecessor.
   *
   * @returns A `ChainVerificationResult` describing validity and the index
   *          of the first broken link (if any).
   */
  verifyChain(): ChainVerificationResult {
    if (this.events.length === 0) {
      return { valid: true, firstBrokenIndex: null, entriesChecked: 0 };
    }

    let runningPreviousHash = this.events[0]!.previousHash;

    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i]!;

      // Check that previousHash linkage is consistent.
      if (event.previousHash !== runningPreviousHash) {
        logger.warn(
          { seq: event.seq, index: i },
          'audit chain broken: previousHash mismatch',
        );
        return { valid: false, firstBrokenIndex: i, entriesChecked: i + 1 };
      }

      // Recompute hash and compare.
      const expected = computeHash(
        event.previousHash,
        event.kind,
        event.timestamp,
        event.payload,
      );

      if (event.hash !== expected) {
        logger.warn(
          { seq: event.seq, index: i, stored: event.hash, expected },
          'audit chain broken: hash mismatch',
        );
        return { valid: false, firstBrokenIndex: i, entriesChecked: i + 1 };
      }

      runningPreviousHash = event.hash;
    }

    return {
      valid: true,
      firstBrokenIndex: null,
      entriesChecked: this.events.length,
    };
  }
}
