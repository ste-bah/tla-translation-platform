import type {
  IrRelationship,
  IrResource,
  RegistryEntry,
  TranslationFinding,
  TranslationPlanItem,
} from '@tla/shared';
import type { TranslationItemStatus } from '@tla/shared';
import { createComponentLogger, resolveRegistryKey } from '@tla/shared';
import type { PlannerInput, PlannerResult } from '../engines/mapping-engine.js';

const logger = createComponentLogger('translation-planner');

// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm)
// ---------------------------------------------------------------------------

/**
 * Topologically sorts resource IDs based on relationship edges.
 * Falls back to localeCompare for unordered resources (determinism).
 */
function topoSort(
  resourceIds: readonly string[],
  relationships: readonly IrRelationship[],
): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const idSet = new Set(resourceIds);

  for (const id of resourceIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const rel of relationships) {
    if (!idSet.has(rel.from) || !idSet.has(rel.to)) continue;
    if (rel.type !== 'depends_on' && rel.type !== 'references') continue;

    // rel.from depends_on/references rel.to → rel.to must come first.
    // Edge goes from dependency (rel.to) to dependent (rel.from).
    adjacency.get(rel.to)!.push(rel.from);
    inDegree.set(rel.from, (inDegree.get(rel.from) ?? 0) + 1);
  }

  // Seed queue with zero-indegree nodes, sorted for determinism
  const queue = resourceIds
    .filter((id) => (inDegree.get(id) ?? 0) === 0)
    .slice()
    .sort((a, b) => a.localeCompare(b));

  const sorted: string[] = [];

  while (queue.length > 0) {
    // Sort queue each iteration for deterministic output
    queue.sort((a, b) => a.localeCompare(b));
    const node = queue.shift()!;
    sorted.push(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      const degree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, degree);
      if (degree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If cycle detected, append remaining nodes sorted alphabetically
  if (sorted.length < resourceIds.length) {
    const sortedSet = new Set(sorted);
    const remaining = resourceIds
      .filter((id) => !sortedSet.has(id))
      .slice()
      .sort((a, b) => a.localeCompare(b));
    sorted.push(...remaining);
  }

  return sorted;
}

// ---------------------------------------------------------------------------
// Compound grouping
// ---------------------------------------------------------------------------

/**
 * Groups resources that share the same compound/structural registry entry.
 */
function buildCompoundGroups(
  resources: readonly IrResource[],
  entries: ReadonlyMap<string, RegistryEntry>,
): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const resource of resources) {
    const entry = entries.get(resource.sourceType);
    if (!entry) continue;
    if (entry.mapping_type !== 'compound' && entry.mapping_type !== 'structural') {
      continue;
    }

    const groupId = `group-${entry.registry_entry_id}`;
    const list = groups.get(groupId) ?? [];
    list.push(resource.id);
    groups.set(groupId, list);
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Status classification
// ---------------------------------------------------------------------------

/**
 * Determines the plan item status based on the resource and its registry entry.
 */
function classifyPlanStatus(
  _resource: IrResource,
  entry: RegistryEntry | undefined,
): { status: TranslationItemStatus; blockerReason: string | null } {
  if (!entry) {
    return { status: 'blocked', blockerReason: 'No registry entry found' };
  }

  if (entry.mapping_type === 'none') {
    return {
      status: 'advisory',
      blockerReason: 'Mapping type is none; manual intervention required',
    };
  }

  if (entry.band === 'M1') {
    return {
      status: 'advisory',
      blockerReason: 'Manual-only band (M1)',
    };
  }

  if (entry.mapping_type === 'compound' || entry.mapping_type === 'structural') {
    return { status: 'expanded', blockerReason: null };
  }

  return { status: 'translated', blockerReason: null };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds an ordered translation plan from the IR and registry.
 *
 * Steps:
 * 1. Look up each resource in the registry.
 * 2. Topologically sort by dependency relationships.
 * 3. Classify each resource into a plan status.
 * 4. Group compound/structural resources.
 */
export function buildTranslationPlan(input: PlannerInput): PlannerResult {
  const { ir, registry, targetProvider } = input;
  const findings: TranslationFinding[] = [];

  // 1. Resolve registry entries
  //    FIX: registry.lookup() expects short aws_service keys (e.g. 'vpc')
  //    not full Terraform types (e.g. 'aws_vpc'). Use resolveRegistryKey()
  //    to bridge the two namespaces. Falls back to raw sourceType for
  //    types not in the map (e.g. made-up test types).
  const registryEntries = new Map<string, RegistryEntry>();
  for (const resource of ir.resources) {
    const lookupKey = resolveRegistryKey(resource.sourceType) ?? resource.sourceType;
    const entry = registry.lookup(lookupKey);
    if (entry) {
      registryEntries.set(resource.sourceType, entry);
    } else {
      findings.push({
        resourceId: resource.id,
        severity: 'warning',
        code: 'REGISTRY_MISS',
        message: `No registry entry for source type: ${resource.sourceType}`,
      });
    }
  }

  logger.info(
    {
      resourceCount: ir.resources.length,
      resolvedCount: registryEntries.size,
      targetProvider,
    },
    'Registry resolution complete',
  );

  // 2. Topological sort
  const resourceIds = ir.resources.map((r) => r.id);
  const sortedIds = topoSort(resourceIds, ir.relationships);

  // Build id->resource lookup
  const resourceById = new Map<string, IrResource>();
  for (const r of ir.resources) {
    resourceById.set(r.id, r);
  }

  // 3. Build compound groups
  const groups = buildCompoundGroups(ir.resources, registryEntries);
  const resourceToGroup = new Map<string, string>();
  for (const [groupId, memberIds] of groups) {
    for (const memberId of memberIds) {
      resourceToGroup.set(memberId, groupId);
    }
  }

  // 4. Build plan items
  let blockedCount = 0;
  const items: TranslationPlanItem[] = [];

  for (let order = 0; order < sortedIds.length; order++) {
    const id = sortedIds[order]!;
    const resource = resourceById.get(id);
    if (!resource) continue;

    const entry = registryEntries.get(resource.sourceType);
    const { status, blockerReason } = classifyPlanStatus(resource, entry);

    if (status === 'blocked') {
      blockedCount++;
    }

    items.push({
      resourceId: id,
      registryEntryId: entry?.registry_entry_id ?? null,
      mappingType: entry?.mapping_type ?? 'none',
      order,
      groupId: resourceToGroup.get(id) ?? null,
      status,
      blockerReason,
    });
  }

  logger.info(
    { itemCount: items.length, blockedCount, groupCount: groups.size },
    'Translation plan built',
  );

  return {
    plan: {
      items,
      blockedCount,
      groupCount: groups.size,
    },
    findings,
    registryEntries,
  };
}
