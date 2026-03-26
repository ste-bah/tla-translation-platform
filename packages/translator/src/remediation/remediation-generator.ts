import type { TranslationManifest, ManifestEntry } from '@tla/shared';
import type { CanonicalIR } from '@tla/shared';
import type {
  RemediationTask,
  RemediationTaskType,
  RemediationPriority,
  RemediationPack,
  RemediationSummary,
} from './remediation-types.js';

// ---------------------------------------------------------------------------
// Domain classification helpers
// ---------------------------------------------------------------------------

/** AWS source-type prefixes / categories that are considered critical domains. */
const CRITICAL_DOMAINS = new Set<string>([
  'identity',
  'security',
  'networking',
  'database',
]);

/** AWS source-type substrings that map to a critical domain. */
const CRITICAL_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/^aws_iam/i, 'identity'],
  [/^aws_cognito/i, 'identity'],
  [/^aws_kms/i, 'security'],
  [/^aws_acm/i, 'security'],
  [/^aws_waf/i, 'security'],
  [/^aws_guardduty/i, 'security'],
  [/^aws_security_group/i, 'security'],
  [/^aws_network_acl/i, 'security'],
  [/^aws_vpc/i, 'networking'],
  [/^aws_subnet/i, 'networking'],
  [/^aws_route/i, 'networking'],
  [/^aws_lb/i, 'networking'],
  [/^aws_alb/i, 'networking'],
  [/^aws_nlb/i, 'networking'],
  [/^aws_transit_gateway/i, 'networking'],
  [/^aws_privatelink/i, 'networking'],
  [/^aws_vpc_endpoint/i, 'networking'],
  [/^aws_rds/i, 'database'],
  [/^aws_db_/i, 'database'],
  [/^aws_dynamodb/i, 'database'],
  [/^aws_elasticache/i, 'database'],
  [/^aws_redshift/i, 'database'],
  [/^aws_docdb/i, 'database'],
];

/**
 * Derive the IrResource category string for a given source type by checking
 * patterns against known critical domain keywords.  Returns null if no
 * critical domain is matched.
 */
function getCriticalDomain(sourceType: string): string | null {
  for (const [pattern, domain] of CRITICAL_TYPE_PATTERNS) {
    if (pattern.test(sourceType)) {
      return domain;
    }
  }
  return null;
}

function isCriticalDomain(sourceType: string): boolean {
  return getCriticalDomain(sourceType) !== null;
}

// ---------------------------------------------------------------------------
// Task-type derivation
// ---------------------------------------------------------------------------

/**
 * Derive the primary task type from the entry status and source type.
 * - blocked + networking/security → security_review
 * - blocked + database → design_decision
 * - blocked + other → manual_migration
 * - advisory → configuration
 */
function deriveTaskType(
  status: 'blocked' | 'advisory',
  sourceType: string,
): RemediationTaskType {
  if (status === 'advisory') {
    return 'configuration';
  }
  const domain = getCriticalDomain(sourceType);
  if (domain === 'networking' || domain === 'security') {
    return 'security_review';
  }
  if (domain === 'database') {
    return 'design_decision';
  }
  return 'manual_migration';
}

// ---------------------------------------------------------------------------
// Priority derivation
// ---------------------------------------------------------------------------

function derivePriority(
  status: 'blocked' | 'advisory',
  sourceType: string,
): RemediationPriority {
  const critical = isCriticalDomain(sourceType);
  if (status === 'blocked') {
    return critical ? 'critical' : 'high';
  }
  // advisory
  return critical ? 'medium' : 'low';
}

// ---------------------------------------------------------------------------
// Effort estimation (rough heuristic by task type and priority)
// ---------------------------------------------------------------------------

const EFFORT_TABLE: Record<RemediationTaskType, Record<RemediationPriority, string>> = {
  security_review: {
    critical: '3-5 days',
    high: '2-3 days',
    medium: '1-2 days',
    low: '4-8 hours',
  },
  design_decision: {
    critical: '3-5 days',
    high: '2-3 days',
    medium: '1-2 days',
    low: '4-8 hours',
  },
  manual_migration: {
    critical: '2-4 days',
    high: '1-2 days',
    medium: '4-8 hours',
    low: '2-4 hours',
  },
  configuration: {
    critical: '1-2 days',
    high: '4-8 hours',
    medium: '2-4 hours',
    low: '1-2 hours',
  },
  testing: {
    critical: '1-2 days',
    high: '4-8 hours',
    medium: '2-4 hours',
    low: '1-2 hours',
  },
};

function estimateEffort(
  taskType: RemediationTaskType,
  priority: RemediationPriority,
): string {
  return EFFORT_TABLE[taskType]?.[priority] ?? '2-4 hours';
}

// ---------------------------------------------------------------------------
// ID helpers
// ---------------------------------------------------------------------------

function makeTaskId(resourceId: string, taskType: RemediationTaskType): string {
  // Sanitise resourceId to be safe in an ID: replace non-alphanumeric with '_'
  const safe = resourceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `task-${safe}-${taskType}`;
}

// ---------------------------------------------------------------------------
// Kahn's toposort for dependency ordering
// ---------------------------------------------------------------------------

/**
 * Topologically sort resource IDs using Kahn's algorithm.
 * Edges: from → to means "from depends on to" (to must come first).
 * If a cycle is detected the affected nodes are appended at the end (no throw).
 *
 * @param ids     Set of resource IDs to order
 * @param edges   Map from resourceId → set of IDs it depends on (must precede it)
 */
function toposort(ids: string[], edges: Map<string, Set<string>>): string[] {
  // Build in-degree count and adjacency list (who comes after whom)
  const inDegree = new Map<string, number>();
  const successors = new Map<string, string[]>(); // dependency → [dependents that need it first]

  for (const id of ids) {
    inDegree.set(id, 0);
    successors.set(id, []);
  }

  for (const [dependent, deps] of edges) {
    if (!inDegree.has(dependent)) continue;
    for (const dep of deps) {
      if (!inDegree.has(dep)) continue; // dep not in our set, skip
      inDegree.set(dependent, (inDegree.get(dependent) ?? 0) + 1);
      successors.get(dep)!.push(dependent);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const succ of (successors.get(node) ?? [])) {
      const newDeg = (inDegree.get(succ) ?? 0) - 1;
      inDegree.set(succ, newDeg);
      if (newDeg === 0) {
        queue.push(succ);
      }
    }
  }

  // Any remaining nodes are in a cycle — append them at the end (cycle detection, no throw)
  for (const id of ids) {
    if (!result.includes(id)) {
      result.push(id);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Effort aggregation
// ---------------------------------------------------------------------------

/**
 * Parse a rough effort string like "2-4 hours" or "1-2 days" into hours.
 * Returns the midpoint in hours for aggregation.
 */
function parseEffortHours(effort: string): number {
  const m = effort.match(/(\d+)-(\d+)\s+(hour|day)/i);
  if (!m) return 2;
  const lo = parseInt(m[1], 10);
  const hi = parseInt(m[2], 10);
  const mid = (lo + hi) / 2;
  const unit = m[3].toLowerCase();
  return unit.startsWith('day') ? mid * 8 : mid;
}

function formatTotalEffort(hours: number): string {
  if (hours < 8) return `${Math.round(hours)}-${Math.round(hours * 1.5)} hours`;
  const days = Math.round(hours / 8);
  return `${days}-${Math.round(days * 1.25)} days`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a prioritised, dependency-ordered remediation pack from a
 * translation manifest and the source canonical IR.
 *
 * Never throws — returns an empty pack on any unexpected error.
 */
export function generateRemediationPack(
  manifest: TranslationManifest,
  ir: CanonicalIR,
): RemediationPack {
  try {
    return _generate(manifest, ir);
  } catch {
    return {
      tasks: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
      estimatedTotalEffort: '0 hours',
    };
  }
}

function _generate(
  manifest: TranslationManifest,
  ir: CanonicalIR,
): RemediationPack {
  // Collect entries that need remediation
  const actionable = manifest.entries.filter(
    (e): e is ManifestEntry & { status: 'blocked' | 'advisory' } =>
      e.status === 'blocked' || e.status === 'advisory',
  );

  if (actionable.length === 0) {
    return {
      tasks: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
      estimatedTotalEffort: '0 hours',
    };
  }

  // Build a quick lookup for IR resources
  const irById = new Map(ir.resources.map((r) => [r.id, r]));

  // Build dependency edges from IR relationships for the blocked/advisory set
  const actionableIds = new Set(actionable.map((e) => e.sourceId));
  // edges[resourceId] = set of dependency IDs that must be processed first
  const depEdges = new Map<string, Set<string>>();

  for (const rel of ir.relationships) {
    if (
      (rel.type === 'depends_on' || rel.type === 'references') &&
      actionableIds.has(rel.from) &&
      actionableIds.has(rel.to)
    ) {
      if (!depEdges.has(rel.from)) depEdges.set(rel.from, new Set());
      depEdges.get(rel.from)!.add(rel.to);
    }
  }

  // Toposort the actionable resource IDs
  const sortedIds = toposort(
    actionable.map((e) => e.sourceId),
    depEdges,
  );

  // Build a map from sourceId → entry for quick access
  const entryById = new Map(actionable.map((e) => [e.sourceId, e]));

  // First pass: create primary tasks (one per entry), keyed by resourceId
  const primaryTaskById = new Map<string, RemediationTask>();

  for (const resourceId of sortedIds) {
    const entry = entryById.get(resourceId);
    if (!entry) continue;

    const status = entry.status as 'blocked' | 'advisory';
    const sourceType =
      irById.get(resourceId)?.sourceType ?? entry.sourceType;

    const taskType = deriveTaskType(status, sourceType);
    const priority = derivePriority(status, sourceType);
    const id = makeTaskId(resourceId, taskType);
    const effort = estimateEffort(taskType, priority);

    // Derive a description from findings or a default
    const topFinding = entry.findings.find(
      (f) => f.severity === 'blocker' || f.severity === 'warning',
    );
    const description = topFinding?.message
      ?? (status === 'blocked'
        ? `Manually migrate ${sourceType} resource: no automated translation available.`
        : `Review and configure ${sourceType} resource: advisory gap detected.`);

    primaryTaskById.set(resourceId, {
      id,
      resourceId,
      sourceType,
      taskType,
      priority,
      description,
      prerequisites: [],
      estimatedEffort: effort,
    });
  }

  // Second pass: wire prerequisites using dependency order
  // For each resource, its prerequisites are the primary task IDs of resources
  // it depends on (per depEdges / toposort).
  for (const [resourceId, deps] of depEdges) {
    const task = primaryTaskById.get(resourceId);
    if (!task) continue;
    const prereqs: string[] = [];
    for (const dep of deps) {
      const depTask = primaryTaskById.get(dep);
      if (depTask) prereqs.push(depTask.id);
    }
    task.prerequisites = prereqs;
  }

  // Third pass: add a testing task for every primary task
  const allTasks: RemediationTask[] = [];

  for (const resourceId of sortedIds) {
    const primary = primaryTaskById.get(resourceId);
    if (!primary) continue;

    allTasks.push(primary);

    const testingId = makeTaskId(resourceId, 'testing');
    const testingPriority: RemediationPriority =
      primary.priority === 'critical' || primary.priority === 'high'
        ? primary.priority
        : 'low';

    allTasks.push({
      id: testingId,
      resourceId,
      sourceType: primary.sourceType,
      taskType: 'testing',
      priority: testingPriority,
      description: `Validate ${primary.sourceType} resource migration with integration and smoke tests.`,
      prerequisites: [primary.id],
      estimatedEffort: estimateEffort('testing', testingPriority),
    });
  }

  // Build summary
  const summary: RemediationSummary = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    total: allTasks.length,
  };
  let totalHours = 0;
  for (const task of allTasks) {
    summary[task.priority]++;
    totalHours += parseEffortHours(task.estimatedEffort);
  }

  return {
    tasks: allTasks,
    summary,
    estimatedTotalEffort: formatTotalEffort(totalHours),
  };
}
