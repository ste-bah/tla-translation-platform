// ---------------------------------------------------------------------------
// Remediation task and pack types
// ---------------------------------------------------------------------------

/**
 * Category of work required to address a translation gap.
 */
export type RemediationTaskType =
  | 'manual_migration'
  | 'design_decision'
  | 'security_review'
  | 'configuration'
  | 'testing';

/**
 * Priority tier for a remediation task.
 */
export type RemediationPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * A single actionable remediation task derived from a translation finding.
 */
export interface RemediationTask {
  /** Unique stable identifier (e.g. "task-<resourceId>-<taskType>"). */
  id: string;
  /** ID of the source IR resource this task addresses. */
  resourceId: string;
  /** AWS resource type of the source resource (e.g. "aws_security_group"). */
  sourceType: string;
  /** Category of work required. */
  taskType: RemediationTaskType;
  /** Human-readable description of what must be done. */
  description: string;
  /** Urgency/effort tier. */
  priority: RemediationPriority;
  /** IDs of tasks that must be completed before this one. */
  prerequisites: string[];
  /** Rough effort estimate (e.g. "2-4 hours", "1-2 days"). */
  estimatedEffort: string;
}

/**
 * Summary counts by priority tier.
 */
export interface RemediationSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

/**
 * A complete remediation pack for a translation result.
 */
export interface RemediationPack {
  tasks: RemediationTask[];
  summary: RemediationSummary;
  estimatedTotalEffort: string;
}
