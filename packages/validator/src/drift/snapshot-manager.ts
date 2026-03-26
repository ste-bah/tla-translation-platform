// ---------------------------------------------------------------------------
// Snapshot Manager  (TASK-GAP-007)
//
// Persists and restores CanonicalIR snapshots used by the drift detector.
// Snapshots are written as JSON with additional metadata so that the origin
// of a snapshot (when it was taken, which tool version produced it) is
// preserved alongside the IR data.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'node:fs';
import { CanonicalIRSchema } from '@tla/shared';
import type { CanonicalIR } from '@tla/shared';

// ---------------------------------------------------------------------------
// Internal snapshot envelope
// ---------------------------------------------------------------------------

/** Metadata stored around the IR when it is snapshotted. */
interface SnapshotEnvelope {
  /** ISO-8601 timestamp of when the snapshot was taken. */
  snapshotAt: string;
  /** Version of the tool that produced the snapshot. */
  toolVersion: string;
  /** The full CanonicalIR payload. */
  ir: unknown;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialises `ir` to JSON and writes it to `outputPath`.
 *
 * The file format is a {@link SnapshotEnvelope} containing metadata plus the
 * full IR.  The metadata makes snapshots self-describing so that drift reports
 * can reference when each baseline was captured.
 *
 * @param ir          The CanonicalIR to snapshot.
 * @param outputPath  Absolute or relative filesystem path for the output file.
 * @param toolVersion Optional tool-version string embedded in the metadata.
 *                    Defaults to `"0.1.0"`.
 */
export function saveSnapshot(
  ir: CanonicalIR,
  outputPath: string,
  toolVersion = '0.1.0',
): void {
  const envelope: SnapshotEnvelope = {
    snapshotAt: new Date().toISOString(),
    toolVersion,
    ir,
  };
  writeFileSync(outputPath, JSON.stringify(envelope, null, 2), 'utf-8');
}

/**
 * Reads a snapshot file written by {@link saveSnapshot} and returns the
 * embedded {@link CanonicalIR}.
 *
 * Returns `null` when:
 * - The file cannot be read (I/O error).
 * - The file is not valid JSON.
 * - The `ir` field fails Zod validation against {@link CanonicalIRSchema}.
 *
 * This function never throws.
 */
export function loadSnapshot(path: string): CanonicalIR | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // Accept either a bare CanonicalIR or the SnapshotEnvelope format
  const candidate =
    parsed !== null &&
    typeof parsed === 'object' &&
    'ir' in (parsed as Record<string, unknown>)
      ? (parsed as SnapshotEnvelope).ir
      : parsed;

  const result = CanonicalIRSchema.safeParse(candidate);
  if (!result.success) {
    return null;
  }
  return result.data;
}
