// ---------------------------------------------------------------------------
// Network Topology Summary Generator  (TASK-GAP-008b)
//
// Generates a human-readable Markdown report section + Mermaid diagram
// describing the networking resources captured in a CanonicalIR.
//
// Design rules:
//   - Every section builder is isolated with its own try/catch
//   - Never throws — returns a partial/degraded string on any error
//   - No networking resources → returns graceful "no networking" message
//   - Mermaid diagram capped at MAX_MERMAID_NODES nodes
// ---------------------------------------------------------------------------

import type { CanonicalIR, IrResource } from '@tla/shared';
import type { TranslationManifest, TranslationFinding } from '@tla/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MERMAID_NODES = 50;

// Mapping from sourceType prefix → human-readable group label
const SOURCE_TYPE_GROUP: ReadonlyArray<[RegExp, string]> = [
  [/^aws_vpc(?:$|_(?!endpoint|peering))/, 'VPC'],
  [/^aws_subnet/, 'Subnet'],
  [/^aws_security_group/, 'SG'],
  [/^aws_(?:lb|alb|elb)/, 'LB'],
  [/^aws_nat_gateway/, 'NAT'],
  [/^aws_route53/, 'DNS'],
  [/^aws_vpc_peering/, 'Peering'],
  [/^aws_ec2_transit_gateway/, 'Transit'],
  [/^aws_vpc_endpoint/, 'PrivateLink'],
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function classifyResource(sourceType: string): string | null {
  for (const [pattern, label] of SOURCE_TYPE_GROUP) {
    if (pattern.test(sourceType)) return label;
  }
  return null;
}

function groupNetworkResources(
  netResources: IrResource[],
): Map<string, IrResource[]> {
  const groups = new Map<string, IrResource[]>();
  for (const r of netResources) {
    const label = classifyResource(r.sourceType) ?? 'Other';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(r);
  }
  return groups;
}

function attr(resource: IrResource, key: string): string {
  const v = resource.attributes[key] ?? resource.sourceAttributes[key];
  return v != null ? String(v) : '';
}

function truncate(s: string, maxLen = 40): string {
  return s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s;
}

// Safe Mermaid node ID: letters, digits, underscores only
function safeMermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildNetworkOverview(groups: Map<string, IrResource[]>): string {
  try {
    const rows = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, resources]) => `| ${label} | ${resources.length} |`);

    const total = [...groups.values()].reduce((s, v) => s + v.length, 0);

    return [
      '## Network Overview',
      '',
      `**Total networking resources:** ${total}`,
      '',
      '| Resource Group | Count |',
      '|----------------|-------|',
      ...rows,
      '',
    ].join('\n');
  } catch (_err) {
    return '## Network Overview\n\n_Error generating section._\n\n';
  }
}

function buildVpcTopology(groups: Map<string, IrResource[]>): string {
  try {
    const vpcs = groups.get('VPC') ?? [];
    const subnets = groups.get('Subnet') ?? [];

    if (vpcs.length === 0) {
      return '## VPC/VNet Topology\n\n_No VPC resources detected._\n\n';
    }

    const rows = vpcs.map(vpc => {
      const cidr = attr(vpc, 'cidr_block') || attr(vpc, 'cidr') || '—';
      // Count subnets that reference this VPC by sourceId in their attributes
      const subnetCount = subnets.filter(s => {
        const vpcRef = attr(s, 'vpc_id');
        return vpcRef === vpc.id || vpcRef === vpc.sourceName || vpcRef === `${vpc.sourceType}.${vpc.sourceName}.id`;
      }).length;
      return `| \`${vpc.sourceName}\` | ${cidr} | ${subnetCount} |`;
    });

    return [
      '## VPC/VNet Topology',
      '',
      '| VPC Name | CIDR Block | Subnet Count |',
      '|----------|------------|--------------|',
      ...rows,
      '',
    ].join('\n');
  } catch (_err) {
    return '## VPC/VNet Topology\n\n_Error generating section._\n\n';
  }
}

function buildSecurityBoundaries(
  groups: Map<string, IrResource[]>,
  manifest: TranslationManifest,
): string {
  try {
    const sgs = groups.get('SG') ?? [];

    // Collect BLOCKER findings that relate to any networking resource
    const allNetIds = new Set([...groups.values()].flat().map(r => r.id));
    const blockerFindings: TranslationFinding[] = [];

    for (const entry of manifest.entries) {
      if (allNetIds.has(entry.sourceId)) {
        blockerFindings.push(
          ...entry.findings.filter(f => f.severity === 'blocker'),
        );
      }
    }
    // Also check manifest-level findings
    for (const f of manifest.findings) {
      if (f.severity === 'blocker' && allNetIds.has(f.resourceId)) {
        blockerFindings.push(f);
      }
    }

    const blockerRows = blockerFindings.slice(0, 10).map(f =>
      `| \`${f.resourceId}\` | \`${f.code}\` | ${truncate(f.message, 60)} |`,
    );

    const blockerSection =
      blockerFindings.length > 0
        ? [
            '',
            '> ❌ **BLOCKER findings** detected in networking resources — migration cannot proceed.',
            '',
            '| Resource | Code | Message |',
            '|----------|------|---------|',
            ...blockerRows,
            blockerFindings.length > 10
              ? `\n_Showing 10 of ${blockerFindings.length} blocker findings._\n`
              : '',
          ].join('\n')
        : '';

    return [
      '## Security Boundaries',
      '',
      `**Security Groups:** ${sgs.length}`,
      blockerSection,
      '',
    ].join('\n');
  } catch (_err) {
    return '## Security Boundaries\n\n_Error generating section._\n\n';
  }
}

function buildLoadBalancing(groups: Map<string, IrResource[]>): string {
  try {
    const lbs = groups.get('LB') ?? [];

    if (lbs.length === 0) {
      return '## Load Balancing\n\n_No load balancer resources detected._\n\n';
    }

    const rows = lbs.map(lb => {
      const lbType = attr(lb, 'load_balancer_type') || attr(lb, 'internal') === 'true' ? 'internal' : attr(lb, 'load_balancer_type') || '—';
      const targetGroup = attr(lb, 'target_group_arn') || attr(lb, 'target_group') || '—';
      return `| \`${lb.sourceName}\` | \`${lb.sourceType}\` | ${lbType} | ${truncate(targetGroup)} |`;
    });

    return [
      '## Load Balancing',
      '',
      '| Name | Source Type | LB Type | Target Info |',
      '|------|-------------|---------|-------------|',
      ...rows,
      '',
    ].join('\n');
  } catch (_err) {
    return '## Load Balancing\n\n_Error generating section._\n\n';
  }
}

function buildConnectivity(groups: Map<string, IrResource[]>): string {
  try {
    const peerings = groups.get('Peering') ?? [];
    const transits = groups.get('Transit') ?? [];
    const privateLinks = groups.get('PrivateLink') ?? [];
    const nats = groups.get('NAT') ?? [];

    const lines: string[] = [
      '## Connectivity',
      '',
      '| Component | Count | Notes |',
      '|-----------|-------|-------|',
      `| VPC Peering | ${peerings.length} | ${peerings.length > 0 ? peerings.map(r => r.sourceName).join(', ') : '—'} |`,
      `| Transit Gateway | ${transits.length} | ${transits.length > 0 ? transits.map(r => r.sourceName).join(', ') : '—'} |`,
      `| PrivateLink / VPC Endpoint | ${privateLinks.length} | ${privateLinks.length > 0 ? privateLinks.map(r => r.sourceName).join(', ') : '—'} |`,
      `| NAT Gateway | ${nats.length} | ${nats.length > 0 ? nats.map(r => r.sourceName).join(', ') : '—'} |`,
      '',
    ];

    return lines.join('\n');
  } catch (_err) {
    return '## Connectivity\n\n_Error generating section._\n\n';
  }
}

function buildDns(groups: Map<string, IrResource[]>): string {
  try {
    const dnsResources = groups.get('DNS') ?? [];

    if (dnsResources.length === 0) {
      return '## DNS\n\n_No Route 53 / DNS resources detected._\n\n';
    }

    // Zones are typically aws_route53_zone, records are aws_route53_record
    const zones = dnsResources.filter(r => r.sourceType.includes('zone'));
    const records = dnsResources.filter(r => r.sourceType.includes('record'));
    const other = dnsResources.filter(
      r => !r.sourceType.includes('zone') && !r.sourceType.includes('record'),
    );

    return [
      '## DNS',
      '',
      `| Resource Type | Count |`,
      `|---------------|-------|`,
      `| Zones | ${zones.length} |`,
      `| Records | ${records.length} |`,
      ...(other.length > 0 ? [`| Other DNS | ${other.length} |`] : []),
      '',
    ].join('\n');
  } catch (_err) {
    return '## DNS\n\n_Error generating section._\n\n';
  }
}

function buildNetworkingWarnings(
  groups: Map<string, IrResource[]>,
  manifest: TranslationManifest,
): string {
  try {
    const allNetIds = new Set([...groups.values()].flat().map(r => r.id));
    const warnings: TranslationFinding[] = [];

    for (const entry of manifest.entries) {
      if (allNetIds.has(entry.sourceId)) {
        warnings.push(...entry.findings.filter(f => f.severity === 'warning'));
      }
    }
    for (const f of manifest.findings) {
      if (f.severity === 'warning' && allNetIds.has(f.resourceId)) {
        warnings.push(f);
      }
    }

    if (warnings.length === 0) {
      return '## Warnings\n\n_No networking warnings._\n\n';
    }

    const rows = warnings.slice(0, 20).map(f =>
      `| \`${f.resourceId}\` | \`${f.code}\` | ${truncate(f.message, 70)} |`,
    );
    const showNote =
      warnings.length > 20
        ? `\n_Showing 20 of ${warnings.length} warnings._\n`
        : '';

    return [
      '## Warnings',
      '',
      '| Resource | Code | Message |',
      '|----------|------|---------|',
      ...rows,
      showNote,
    ].join('\n');
  } catch (_err) {
    return '## Warnings\n\n_Error generating section._\n\n';
  }
}

// ---------------------------------------------------------------------------
// Mermaid diagram builder
// ---------------------------------------------------------------------------

function buildMermaidDiagram(
  groups: Map<string, IrResource[]>,
  ir: CanonicalIR,
): string {
  try {
    // Collect all networking resource ids for relationship filtering
    const allNetResources = [...groups.values()].flat();
    const netIdSet = new Set(allNetResources.map(r => r.id));

    // Build node list — apply cap
    const nodes = allNetResources.slice(0, MAX_MERMAID_NODES);
    const truncated = allNetResources.length > MAX_MERMAID_NODES;
    const truncatedCount = allNetResources.length - MAX_MERMAID_NODES;
    const includedIdSet = new Set(nodes.map(r => r.id));

    // Generate node declarations
    const nodeLines = nodes.map(r => {
      const safeId = safeMermaidId(r.id);
      const label = classifyResource(r.sourceType) ?? 'Net';
      const name = truncate(r.sourceName, 20);
      return `    ${safeId}["${label}: ${name}"]`;
    });

    // Generate edges from relationships between included nodes
    const edgeLines: string[] = [];
    for (const rel of ir.relationships) {
      if (
        netIdSet.has(rel.from) &&
        netIdSet.has(rel.to) &&
        includedIdSet.has(rel.from) &&
        includedIdSet.has(rel.to)
      ) {
        const fromId = safeMermaidId(rel.from);
        const toId = safeMermaidId(rel.to);
        const relLabel = rel.type === 'contains'
          ? ' -->|contains|'
          : rel.type === 'secures'
          ? ' -->|secures|'
          : rel.type === 'routes_to'
          ? ' -->|routes|'
          : ' -->';
        edgeLines.push(`    ${fromId}${relLabel} ${toId}`);
      }
    }

    const truncationNote = truncated
      ? `\n    TRUNC["... and ${truncatedCount} more"]`
      : '';

    return [
      '## Topology Diagram',
      '',
      '```mermaid',
      'graph TD',
      ...nodeLines,
      ...edgeLines,
      truncationNote,
      '```',
      '',
    ].join('\n');
  } catch (_err) {
    return '## Topology Diagram\n\n_Error generating diagram._\n\n';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable Markdown network topology summary.
 *
 * Filters IR resources where category === 'networking' and groups them by
 * sourceType pattern (VPC, Subnet, SG, LB, NAT, DNS, Peering, Transit,
 * PrivateLink). Includes a Mermaid `graph TD` diagram capped at 50 nodes.
 *
 * Never throws — returns a graceful degraded string on any unexpected error.
 *
 * @param manifest - TranslationManifest for findings (blockers, warnings).
 * @param ir - CanonicalIR to source resource and relationship data from.
 * @returns Markdown string.
 */
export function generateTopologySummary(
  manifest: TranslationManifest,
  ir: CanonicalIR,
): string {
  try {
    // Filter networking resources
    const netResources = ir.resources.filter(r => r.category === 'networking');

    if (netResources.length === 0) {
      return [
        '# Network Topology Summary',
        '',
        '_No networking resources translated._',
        '',
      ].join('\n');
    }

    const groups = groupNetworkResources(netResources);

    const sections: string[] = [
      '# Network Topology Summary',
      '',
      buildNetworkOverview(groups),
      buildVpcTopology(groups),
      buildSecurityBoundaries(groups, manifest),
      buildLoadBalancing(groups),
      buildConnectivity(groups),
      buildDns(groups),
      buildNetworkingWarnings(groups, manifest),
      buildMermaidDiagram(groups, ir),
    ];

    return sections.join('\n');
  } catch (_err: unknown) {
    return '# Network Topology Summary\n\n_Fatal error generating topology summary._\n';
  }
}
