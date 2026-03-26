// ---------------------------------------------------------------------------
// Drift Detection Types  (TASK-GAP-007)
// ---------------------------------------------------------------------------

/**
 * A resource that was added or removed between two IR snapshots.
 * Attribute values are intentionally omitted — only identity is recorded.
 */
export interface DriftEntry {
  /** Composite ID from IrResource (e.g. "aws_instance.web") */
  resourceId: string;
  /** Source type string (e.g. "aws_instance") */
  sourceType: string;
  /** Resource category (e.g. "compute") */
  category: string;
}

/**
 * A single attribute-level change within a modified resource.
 * Values are NOT stored — only the key name and the kind of change.
 */
export interface AttributeChange {
  /** Attribute key name */
  key: string;
  /** Whether the key was added, removed, or its value was changed */
  action: 'added' | 'removed' | 'changed';
}

/**
 * A resource that exists in both IRs but whose attributes differ.
 */
export interface DriftModification {
  /** Composite ID from IrResource */
  resourceId: string;
  /** Source type string */
  sourceType: string;
  /** Per-key changes between current and baseline */
  changes: AttributeChange[];
}

/**
 * High-level numeric summary of a drift comparison.
 */
export interface DriftSummary {
  /** Number of resources in the current IR */
  totalCurrent: number;
  /** Number of resources in the baseline IR */
  totalBaseline: number;
  /** Count of resources present in current but not baseline */
  added: number;
  /** Count of resources present in baseline but not current */
  removed: number;
  /** Count of resources present in both IRs but with attribute differences */
  modified: number;
  /** Count of resources present in both IRs with identical attributes */
  unchanged: number;
  /**
   * Percentage of resources that drifted.
   * driftPercent = (added + removed + modified) / max(totalCurrent, totalBaseline) * 100
   * Returns 0 when both IRs are empty.
   */
  driftPercent: number;
}

/**
 * Full result of comparing a current IR against a baseline IR snapshot.
 */
export interface DriftReport {
  /** Resources present in current IR but absent from baseline */
  added: DriftEntry[];
  /** Resources present in baseline but absent from current IR */
  removed: DriftEntry[];
  /** Resources whose attributes changed between baseline and current */
  modified: DriftModification[];
  /** Count of resources that are identical in both IRs */
  unchanged: number;
  /** Aggregate numeric summary */
  summary: DriftSummary;
}
