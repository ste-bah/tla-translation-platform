/**
 * Immutable audit trail entry for a single TLA translation run.
 * One entry per `tla translate` invocation, serialized as JSONL.
 */
export interface AuditEntry {
  /** ISO-8601 timestamp of the translation run */
  timestamp: string;
  /** Unique run ID (UUIDv4) */
  runId: string;
  /** Source path or description */
  source: string;
  /** Target cloud provider */
  target: 'azure' | 'gcp';
  /** Registry version used */
  registryVersion: string;
  /** Number of source resources processed */
  resourceCount: number;
  /** Manifest summary counts */
  counts: {
    translated: number;
    expanded: number;
    partial: number;
    blocked: number;
    advisory: number;
    total: number;
  };
  /** Overall confidence score (0-1) */
  confidenceOverall: number;
  /** SHA-256 hash of manifest.json content for tamper detection */
  manifestHash: string;
  /** Number of findings by severity */
  findingCounts: {
    blocker: number;
    warning: number;
    info: number;
  };
  /** Duration in milliseconds */
  durationMs: number;
}
