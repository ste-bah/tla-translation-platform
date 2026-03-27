/**
 * Post-translation topology validator.
 *
 * Validates that VPC + subnet + route-table + NAT + IGW resources form a
 * coherent network topology after translation.  Called after all per-resource
 * engines have run and before manifest assembly.
 *
 * @module topology-validator
 */

import type {
  CanonicalIR,
  TranslatedResource,
  TranslationFinding,
  IrResource,
  IrRelationship,
} from '@tla/shared';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SubnetIntent {
  subnetId: string;
  intent: 'public' | 'private' | 'unknown';
  reason: string;
}

export interface TopologyValidationResult {
  findings: TranslationFinding[];
  subnetIntents: SubnetIntent[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VPC_TYPE = 'aws_vpc';
const SUBNET_TYPE = 'aws_subnet';
const NAT_TYPE = 'aws_nat_gateway';
const IGW_TYPE = 'aws_internet_gateway';
const ROUTE_TABLE_TYPE = 'aws_route_table';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Validates topology cohesion across translated networking resources.
 * Called after translation, before manifest assembly.
 */
export function validateTopology(
  ir: CanonicalIR,
  translatedResources: TranslatedResource[],
): TopologyValidationResult {
  const findings: TranslationFinding[] = [];
  const subnetIntents: SubnetIntent[] = [];

  // 1. VPC presence — subnets referencing untranslated VPCs
  checkVpcPresence(ir, translatedResources, findings);

  // 2. Classify subnet intent (public / private / unknown)
  classifySubnetIntent(ir, subnetIntents, findings);

  // 3. NAT gateway without private subnets
  checkNatSubnetCohesion(ir, subnetIntents, findings);

  // 4. IGW presence for public subnets
  checkIgwPresence(ir, subnetIntents, findings);

  // 5. Orphan route tables
  checkRouteTableCohesion(ir, findings);

  return { findings, subnetIntents };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Collect IR resources by sourceType. */
function resourcesOfType(ir: CanonicalIR, type: string): IrResource[] {
  return ir.resources.filter((r) => r.sourceType === type);
}

/** Check whether a resource id has a translated counterpart. */
function isTranslated(
  resourceId: string,
  translatedResources: readonly TranslatedResource[],
): boolean {
  return translatedResources.some((tr) => tr.sourceId === resourceId);
}

/**
 * Find relationships where `fromId` is on either side, filtered by type.
 */
function relatedIds(
  ir: CanonicalIR,
  fromId: string,
  relType?: string,
): IrRelationship[] {
  return ir.relationships.filter((rel) => {
    const matchesSide = rel.from === fromId || rel.to === fromId;
    return relType ? matchesSide && rel.type === relType : matchesSide;
  });
}

/** Get the "other" end of a relationship given one known side. */
function otherEnd(rel: IrRelationship, knownId: string): string {
  return rel.from === knownId ? rel.to : rel.from;
}

// ---------------------------------------------------------------------------
// Check 1 — VPC presence
// ---------------------------------------------------------------------------

function checkVpcPresence(
  ir: CanonicalIR,
  translatedResources: readonly TranslatedResource[],
  findings: TranslationFinding[],
): void {
  const subnets = resourcesOfType(ir, SUBNET_TYPE);
  const vpcs = resourcesOfType(ir, VPC_TYPE);
  const vpcIds = new Set(vpcs.map((v) => v.id));
  const translatedSourceIds = new Set(translatedResources.map((t) => t.sourceId));

  for (const subnet of subnets) {
    // Find VPC referenced by this subnet via relationship or attribute
    const vpcRels = relatedIds(ir, subnet.id).filter((rel) => {
      const other = otherEnd(rel, subnet.id);
      return vpcIds.has(other);
    });

    for (const rel of vpcRels) {
      const vpcId = otherEnd(rel, subnet.id);
      if (!translatedSourceIds.has(vpcId)) {
        findings.push({
          resourceId: subnet.id,
          severity: 'warning',
          code: 'TOPOLOGY_VPC_MISSING',
          message: `Subnet "${subnet.sourceName}" references VPC "${vpcId}" which was not translated`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check 2 — Classify subnet intent
// ---------------------------------------------------------------------------

function classifySubnetIntent(
  ir: CanonicalIR,
  subnetIntents: SubnetIntent[],
  findings: TranslationFinding[],
): void {
  const subnets = resourcesOfType(ir, SUBNET_TYPE);
  const igwIds = new Set(resourcesOfType(ir, IGW_TYPE).map((r) => r.id));
  const natIds = new Set(resourcesOfType(ir, NAT_TYPE).map((r) => r.id));
  const routeTableIds = new Set(resourcesOfType(ir, ROUTE_TABLE_TYPE).map((r) => r.id));

  for (const subnet of subnets) {
    const intent = determineSubnetIntent(ir, subnet, routeTableIds, igwIds, natIds);
    subnetIntents.push(intent);

    findings.push({
      resourceId: subnet.id,
      severity: 'info',
      code: 'TOPOLOGY_SUBNET_INTENT',
      message: `Subnet "${subnet.sourceName}" classified as ${intent.intent}`,
      detail: intent.reason,
    });
  }
}

function determineSubnetIntent(
  ir: CanonicalIR,
  subnet: IrResource,
  routeTableIds: ReadonlySet<string>,
  igwIds: ReadonlySet<string>,
  natIds: ReadonlySet<string>,
): SubnetIntent {
  // Find route tables connected to this subnet
  const connectedRouteTables = relatedIds(ir, subnet.id)
    .map((rel) => otherEnd(rel, subnet.id))
    .filter((id) => routeTableIds.has(id));

  // For each connected route table, check if it references an IGW or NAT
  for (const rtId of connectedRouteTables) {
    const rtRels = relatedIds(ir, rtId);
    for (const rel of rtRels) {
      const target = otherEnd(rel, rtId);
      if (igwIds.has(target)) {
        return {
          subnetId: subnet.id,
          intent: 'public',
          reason: `Route table "${rtId}" has route to internet gateway "${target}"`,
        };
      }
    }
    for (const rel of rtRels) {
      const target = otherEnd(rel, rtId);
      if (natIds.has(target)) {
        return {
          subnetId: subnet.id,
          intent: 'private',
          reason: `Route table "${rtId}" has route to NAT gateway "${target}"`,
        };
      }
    }
  }

  return {
    subnetId: subnet.id,
    intent: 'unknown',
    reason: 'No route table association to IGW or NAT found',
  };
}

// ---------------------------------------------------------------------------
// Check 3 — NAT without private subnets
// ---------------------------------------------------------------------------

function checkNatSubnetCohesion(
  ir: CanonicalIR,
  subnetIntents: readonly SubnetIntent[],
  findings: TranslationFinding[],
): void {
  const nats = resourcesOfType(ir, NAT_TYPE);
  if (nats.length === 0) return;

  const hasPrivate = subnetIntents.some((s) => s.intent === 'private');
  if (!hasPrivate) {
    for (const nat of nats) {
      findings.push({
        resourceId: nat.id,
        severity: 'warning',
        code: 'TOPOLOGY_NAT_NO_PRIVATE_SUBNET',
        message: `NAT gateway "${nat.sourceName}" exists but no subnet is classified as private`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Check 4 — IGW presence for public subnets
// ---------------------------------------------------------------------------

function checkIgwPresence(
  ir: CanonicalIR,
  subnetIntents: readonly SubnetIntent[],
  findings: TranslationFinding[],
): void {
  const publicSubnets = subnetIntents.filter((s) => s.intent === 'public');
  if (publicSubnets.length === 0) return;

  const igws = resourcesOfType(ir, IGW_TYPE);
  if (igws.length === 0) {
    for (const ps of publicSubnets) {
      findings.push({
        resourceId: ps.subnetId,
        severity: 'warning',
        code: 'TOPOLOGY_IGW_MISSING',
        message: `Subnet "${ps.subnetId}" is classified as public but no internet gateway exists in the IR`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Check 5 — Orphan route tables
// ---------------------------------------------------------------------------

function checkRouteTableCohesion(
  ir: CanonicalIR,
  findings: TranslationFinding[],
): void {
  const routeTables = resourcesOfType(ir, ROUTE_TABLE_TYPE);
  const subnetIds = new Set(resourcesOfType(ir, SUBNET_TYPE).map((r) => r.id));

  for (const rt of routeTables) {
    const rels = relatedIds(ir, rt.id);
    const touchesSubnet = rels.some((rel) => {
      const other = otherEnd(rel, rt.id);
      return subnetIds.has(other);
    });

    if (!touchesSubnet) {
      findings.push({
        resourceId: rt.id,
        severity: 'info',
        code: 'TOPOLOGY_ROUTE_TABLE_ORPHAN',
        message: `Route table "${rt.sourceName}" has no relationship to any subnet`,
      });
    }
  }
}
