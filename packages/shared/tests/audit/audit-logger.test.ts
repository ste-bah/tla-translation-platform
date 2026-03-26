import { describe, it, expect, beforeEach } from 'vitest';
import { AuditLogger } from '../../src/audit/audit-logger.js';
import type { AuditEvent } from '../../src/audit/audit-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(maxBufferSize?: number): AuditLogger {
  return AuditLogger.create(maxBufferSize !== undefined ? { maxBufferSize } : undefined);
}

// ---------------------------------------------------------------------------
// AuditLogger.create
// ---------------------------------------------------------------------------

describe('AuditLogger.create', () => {
  it('creates an instance with default options', () => {
    const audit = AuditLogger.create();
    expect(audit).toBeInstanceOf(AuditLogger);
    expect(audit.size).toBe(0);
  });

  it('creates an instance with explicit maxBufferSize', () => {
    const audit = AuditLogger.create({ maxBufferSize: 5 });
    expect(audit).toBeInstanceOf(AuditLogger);
  });

  it('throws on invalid maxBufferSize (zero)', () => {
    expect(() => AuditLogger.create({ maxBufferSize: 0 })).toThrow();
  });

  it('throws on invalid maxBufferSize (negative)', () => {
    expect(() => AuditLogger.create({ maxBufferSize: -1 })).toThrow();
  });

  it('throws on non-integer maxBufferSize', () => {
    expect(() => AuditLogger.create({ maxBufferSize: 1.5 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// log
// ---------------------------------------------------------------------------

describe('AuditLogger.log', () => {
  let audit: AuditLogger;

  beforeEach(() => {
    audit = makeLogger();
  });

  it('appends an event and increments size', () => {
    audit.log('translation_start', { foo: 'bar' });
    expect(audit.size).toBe(1);
  });

  it('event has correct kind and payload', () => {
    audit.log('engine_emit', { resourceId: 'r1' });
    const events = audit.getEvents();
    expect(events[0]!.kind).toBe('engine_emit');
    expect(events[0]!.payload).toEqual({ resourceId: 'r1' });
  });

  it('seq starts at 0 and increments', () => {
    audit.log('translation_start', {});
    audit.log('engine_emit', {});
    audit.log('translation_complete', {});
    const events = audit.getEvents();
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it('timestamp is a valid ISO-8601 UTC string', () => {
    audit.log('translation_start', {});
    const ts = audit.getEvents()[0]!.timestamp;
    expect(() => new Date(ts)).not.toThrow();
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it('genesis entry has empty previousHash', () => {
    audit.log('translation_start', {});
    expect(audit.getEvents()[0]!.previousHash).toBe('');
  });

  it('second entry previousHash matches first entry hash', () => {
    audit.log('translation_start', {});
    audit.log('engine_emit', {});
    const [first, second] = audit.getEvents() as [AuditEvent, AuditEvent];
    expect(second.previousHash).toBe(first.hash);
  });

  it('hash is 64 hex characters (SHA-256)', () => {
    audit.log('translation_start', {});
    const hash = audit.getEvents()[0]!.hash;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different payloads produce different hashes', () => {
    audit.log('engine_emit', { resourceId: 'r1' });
    audit.log('engine_emit', { resourceId: 'r2' });
    const [e1, e2] = audit.getEvents() as [AuditEvent, AuditEvent];
    expect(e1.hash).not.toBe(e2.hash);
  });

  it('accepts all defined AuditEventKind values', () => {
    const kinds = [
      'translation_start',
      'translation_complete',
      'translation_error',
      'engine_emit',
      'engine_error',
      'file_assembly',
      'manifest_build',
    ] as const;

    for (const kind of kinds) {
      audit.log(kind, {});
    }

    const events = audit.getEvents();
    expect(events.map((e) => e.kind)).toEqual(kinds);
  });

  it('payload can contain nested objects', () => {
    const payload = { nested: { a: 1, b: [2, 3] } };
    audit.log('translation_start', payload);
    expect(audit.getEvents()[0]!.payload).toEqual(payload);
  });

  it('payload can be an empty object', () => {
    audit.log('translation_complete', {});
    expect(audit.getEvents()[0]!.payload).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// getEvents
// ---------------------------------------------------------------------------

describe('AuditLogger.getEvents', () => {
  it('returns a copy — mutations do not affect the internal buffer', () => {
    const audit = makeLogger();
    audit.log('translation_start', {});
    const snapshot = audit.getEvents() as AuditEvent[];
    snapshot.splice(0, snapshot.length); // clear the copy
    expect(audit.size).toBe(1);
    expect(audit.getEvents()).toHaveLength(1);
  });

  it('returns events in insertion order', () => {
    const audit = makeLogger();
    audit.log('translation_start', { n: 0 });
    audit.log('engine_emit', { n: 1 });
    audit.log('translation_complete', { n: 2 });
    const events = audit.getEvents();
    expect(events[0]!.payload['n']).toBe(0);
    expect(events[1]!.payload['n']).toBe(1);
    expect(events[2]!.payload['n']).toBe(2);
  });

  it('returns an empty array on a fresh logger', () => {
    const audit = makeLogger();
    expect(audit.getEvents()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// size
// ---------------------------------------------------------------------------

describe('AuditLogger.size', () => {
  it('is 0 on creation', () => {
    expect(makeLogger().size).toBe(0);
  });

  it('increases with each log call', () => {
    const audit = makeLogger();
    audit.log('translation_start', {});
    expect(audit.size).toBe(1);
    audit.log('engine_emit', {});
    expect(audit.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Buffer eviction (maxBufferSize)
// ---------------------------------------------------------------------------

describe('AuditLogger buffer eviction', () => {
  it('does not evict below the limit', () => {
    const audit = makeLogger(3);
    audit.log('translation_start', {});
    audit.log('engine_emit', {});
    audit.log('translation_complete', {});
    expect(audit.size).toBe(3);
  });

  it('evicts oldest entry when limit is exceeded', () => {
    const audit = makeLogger(2);
    audit.log('translation_start', { seq: 0 });
    audit.log('engine_emit', { seq: 1 });
    audit.log('translation_complete', { seq: 2 });
    // buffer should hold entries at seq 1 and 2
    expect(audit.size).toBe(2);
    const events = audit.getEvents();
    expect(events[0]!.seq).toBe(1);
    expect(events[1]!.seq).toBe(2);
  });

  it('keeps the hash chain anchor after eviction', () => {
    const audit = makeLogger(2);
    audit.log('translation_start', {});
    audit.log('engine_emit', {});
    // This push causes eviction of seq=0
    audit.log('translation_complete', {});
    // After eviction the surviving oldest entry's previousHash must still
    // match the now-evicted entry's hash — we verify the chain is intact
    // within the retained window.
    const result = audit.verifyChain();
    expect(result.valid).toBe(true);
  });

  it('continues logging beyond the buffer limit without error', () => {
    const audit = makeLogger(3);
    for (let i = 0; i < 10; i++) {
      audit.log('engine_emit', { i });
    }
    expect(audit.size).toBe(3);
    // The last 3 events should be seq 7, 8, 9
    const events = audit.getEvents();
    expect(events[0]!.seq).toBe(7);
    expect(events[2]!.seq).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// verifyChain
// ---------------------------------------------------------------------------

describe('AuditLogger.verifyChain', () => {
  it('returns valid=true and entriesChecked=0 on empty logger', () => {
    const audit = makeLogger();
    const result = audit.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.firstBrokenIndex).toBeNull();
    expect(result.entriesChecked).toBe(0);
  });

  it('verifies a single-entry chain', () => {
    const audit = makeLogger();
    audit.log('translation_start', {});
    const result = audit.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.firstBrokenIndex).toBeNull();
    expect(result.entriesChecked).toBe(1);
  });

  it('verifies a multi-entry chain', () => {
    const audit = makeLogger();
    for (let i = 0; i < 5; i++) {
      audit.log('engine_emit', { i });
    }
    const result = audit.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.firstBrokenIndex).toBeNull();
    expect(result.entriesChecked).toBe(5);
  });

  it('detects a tampered hash at index 0', () => {
    const audit = makeLogger();
    audit.log('translation_start', {});
    // Directly corrupt the first event's hash via the snapshot
    // (the internal array is accessed through the object reference)
    const internal = (audit as unknown as { events: AuditEvent[] }).events;
    internal[0] = { ...internal[0]!, hash: 'a'.repeat(64) };

    const result = audit.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.firstBrokenIndex).toBe(0);
    expect(result.entriesChecked).toBe(1);
  });

  it('detects a tampered hash in the middle of the chain', () => {
    const audit = makeLogger();
    audit.log('translation_start', {});
    audit.log('engine_emit', {});
    audit.log('translation_complete', {});

    const internal = (audit as unknown as { events: AuditEvent[] }).events;
    // Tamper entry at index 1 (seq=1)
    internal[1] = { ...internal[1]!, hash: 'b'.repeat(64) };

    const result = audit.verifyChain();
    expect(result.valid).toBe(false);
    // index 1 itself recomputes incorrectly → detected there
    expect(result.firstBrokenIndex).toBe(1);
  });

  it('detects a tampered previousHash linkage', () => {
    const audit = makeLogger();
    audit.log('translation_start', {});
    audit.log('engine_emit', {});

    const internal = (audit as unknown as { events: AuditEvent[] }).events;
    // Break the previousHash of entry 1 without changing its stored hash
    internal[1] = { ...internal[1]!, previousHash: 'c'.repeat(64) };

    const result = audit.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.firstBrokenIndex).toBe(1);
  });

  it('detects a tampered payload (hash no longer matches recomputed value)', () => {
    const audit = makeLogger();
    audit.log('translation_start', { resourceId: 'original' });

    const internal = (audit as unknown as { events: AuditEvent[] }).events;
    // Tamper payload but leave the stored hash unchanged
    internal[0] = {
      ...internal[0]!,
      payload: { resourceId: 'TAMPERED' },
    };

    const result = audit.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.firstBrokenIndex).toBe(0);
  });

  it('reports entriesChecked equal to the index+1 of the broken link', () => {
    const audit = makeLogger();
    audit.log('translation_start', {});
    audit.log('engine_emit', {});
    audit.log('translation_complete', {});

    const internal = (audit as unknown as { events: AuditEvent[] }).events;
    internal[1] = { ...internal[1]!, hash: 'd'.repeat(64) };

    const result = audit.verifyChain();
    expect(result.entriesChecked).toBe(2); // stopped at index 1
  });

  it('correctly verifies a chain after buffer eviction', () => {
    const audit = makeLogger(3);
    for (let i = 0; i < 5; i++) {
      audit.log('engine_emit', { i });
    }
    const result = audit.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(3);
  });
});
