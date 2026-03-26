// ---------------------------------------------------------------------------
// Cost-Delta Estimator  (TASK-VAL-004)
//
// Produces INFORMATIONAL, approximate cost comparisons between a source AWS
// architecture and a translated Azure/GCP architecture.
//
// Per PRD EC-011: do NOT claim precision. All results include caveats and
// are flagged for capacity-planning review.
// ---------------------------------------------------------------------------

import type { CanonicalIR, IrResource, TranslationResult, TranslatedResource } from '@tla/shared';

import {
  AWS_PRICING_LAST_UPDATED,
  AWS_INSTANCE_PRICING,
  AWS_DEFAULT_VCPU_HOURLY_USD,
  AWS_DEFAULT_RAM_GB_HOURLY_USD,
  AWS_STORAGE_PRICING,
  AWS_DEFAULT_STORAGE_GB_MONTH_USD,
  AWS_DATABASE_PRICING,
  AWS_RDS_STORAGE_GB_MONTH_USD,
  AWS_DEFAULT_DB_HOURLY_USD,
  AWS_NAT_GATEWAY_HOURLY_USD,
  AWS_NAT_GATEWAY_PER_GB_USD,
  AWS_ALB_HOURLY_USD,
  AWS_NLB_HOURLY_USD,
  AWS_DATA_TRANSFER_OUT_USD,
  AWS_ASSUMED_DATA_TRANSFER_GB,
} from './pricing/aws-pricing.js';

import {
  AZURE_PRICING_LAST_UPDATED,
  AZURE_INSTANCE_PRICING,
  AZURE_DEFAULT_VCPU_HOURLY_USD,
  AZURE_DEFAULT_RAM_GB_HOURLY_USD,
  AZURE_STORAGE_PRICING,
  AZURE_DEFAULT_STORAGE_GB_MONTH_USD,
  AZURE_DATABASE_PRICING,
  AZURE_DB_STORAGE_GB_MONTH_USD,
  AZURE_DEFAULT_DB_HOURLY_USD,
  AZURE_NAT_GATEWAY_HOURLY_USD,
  AZURE_NAT_GATEWAY_PER_GB_USD,
  AZURE_LB_HOURLY_USD,
  AZURE_DATA_TRANSFER_OUT_USD,
  AZURE_ASSUMED_DATA_TRANSFER_GB,
} from './pricing/azure-pricing.js';

import {
  GCP_PRICING_LAST_UPDATED,
  GCP_INSTANCE_PRICING,
  GCP_DEFAULT_VCPU_HOURLY_USD,
  GCP_DEFAULT_RAM_GB_HOURLY_USD,
  GCP_STORAGE_PRICING,
  GCP_DEFAULT_STORAGE_GB_MONTH_USD,
  GCP_DATABASE_PRICING,
  GCP_DB_STORAGE_GB_MONTH_USD,
  GCP_DEFAULT_DB_HOURLY_USD,
  GCP_NAT_GATEWAY_HOURLY_USD,
  GCP_NAT_GATEWAY_PER_GB_USD,
  GCP_LB_HOURLY_USD,
  GCP_DATA_TRANSFER_OUT_USD,
  GCP_ASSUMED_DATA_TRANSFER_GB,
} from './pricing/gcp-pricing.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Breakdown of a single cost line. */
export interface CostLineItem {
  readonly label: string;
  /** USD per month */
  readonly monthlyUsd: number;
  /** Free-text explanation of how the figure was derived. */
  readonly basis: string;
}

/** Aggregate cost estimate for one cloud side (source or target). */
export interface CostEstimate {
  readonly totalMonthlyUsd: number;
  readonly lineItems: CostLineItem[];
}

/** Per-resource cost comparison between source and target. */
export interface ResourceCostComparison {
  readonly sourceId: string;
  readonly sourceType: string;
  /** Matched target resource type(s), or null when untranslated. */
  readonly targetTypes: string[];
  readonly sourceMonthlyUsd: number;
  readonly targetMonthlyUsd: number;
  /** Positive = target more expensive. */
  readonly deltaUsd: number;
}

/** Top-level cost-delta report produced by `estimateCostDelta`. */
export interface CostDeltaReport {
  readonly sourceEstimate: CostEstimate;
  readonly targetEstimate: CostEstimate;
  /** Positive = target more expensive. */
  readonly delta: number;
  readonly deltaPercent: number;
  readonly perResource: ResourceCostComparison[];
  readonly caveats: string[];
  /** Always true — all cost comparisons require capacity-planning review (EC-011). */
  readonly reviewRequired: true;
}

// ---------------------------------------------------------------------------
// Standard caveats (always included)
// ---------------------------------------------------------------------------

export const STANDARD_CAVEATS: readonly string[] = [
  'Based on on-demand/pay-as-you-go pricing',
  'Reserved instances, savings plans, and committed use discounts not included',
  'Data transfer costs are estimated based on assumed inter-AZ/region traffic',
  'Actual costs depend on usage patterns, reserved capacity, and negotiated pricing',
  'Prices are approximate and sourced from static tables — verify against current cloud pricing calculators',
];

// ---------------------------------------------------------------------------
// Pricing staleness check
// ---------------------------------------------------------------------------

/** How many days before we emit a stale-pricing warning. */
const STALE_PRICING_DAYS = 90;
const MS_PER_DAY = 86_400_000;

function staleCaveat(lastUpdated: string, provider: string): string | null {
  const updatedMs = Date.parse(lastUpdated);
  if (Number.isNaN(updatedMs)) {
    return `${provider} pricing table has an unparseable lastUpdated date ('${lastUpdated}') — treat estimates as approximate`;
  }
  const ageDays = (Date.now() - updatedMs) / MS_PER_DAY;
  if (ageDays > STALE_PRICING_DAYS) {
    const daysRounded = Math.round(ageDays);
    return `${provider} pricing data is ${daysRounded} days old (limit: ${STALE_PRICING_DAYS} days) — costs may have changed`;
  }
  return null;
}

export function collectStaleCaveats(target: 'azure' | 'gcp'): string[] {
  const warnings: string[] = [];

  const awsWarning = staleCaveat(AWS_PRICING_LAST_UPDATED, 'AWS');
  if (awsWarning !== null) warnings.push(awsWarning);

  if (target === 'azure') {
    const azureWarning = staleCaveat(AZURE_PRICING_LAST_UPDATED, 'Azure');
    if (azureWarning !== null) warnings.push(azureWarning);
  } else {
    const gcpWarning = staleCaveat(GCP_PRICING_LAST_UPDATED, 'GCP');
    if (gcpWarning !== null) warnings.push(gcpWarning);
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Hours per month constant
// ---------------------------------------------------------------------------

const HOURS_PER_MONTH = 730;

// ---------------------------------------------------------------------------
// AWS source cost estimation helpers
// ---------------------------------------------------------------------------

function estimateAwsComputeMonthly(resource: IrResource): number {
  const instanceType = String(resource.attributes['instance_type'] ?? '').toLowerCase();
  const entry = AWS_INSTANCE_PRICING[instanceType];
  if (entry !== undefined) {
    return entry.hourlyUsd * HOURS_PER_MONTH;
  }
  // Fallback: extract vCPU/RAM from the instance type string pattern (e.g. c5.2xlarge)
  const vcpu = Number(resource.attributes['vcpu'] ?? 2);
  const ramGb = Number(resource.attributes['memory_gb'] ?? 4);
  return (vcpu * AWS_DEFAULT_VCPU_HOURLY_USD + ramGb * AWS_DEFAULT_RAM_GB_HOURLY_USD) * HOURS_PER_MONTH;
}

function estimateAwsStorageMonthly(resource: IrResource): number {
  const storageType = String(resource.attributes['type'] ?? resource.attributes['storage_type'] ?? 'ebs_gp3').toLowerCase();
  const sizeGb = Number(resource.attributes['size'] ?? resource.attributes['allocated_storage'] ?? 100);
  const tierKey = storageType.replace(/[^a-z0-9_]/g, '_');
  const tier = AWS_STORAGE_PRICING[tierKey];
  const gbRate = tier?.gbMonthUsd ?? AWS_DEFAULT_STORAGE_GB_MONTH_USD;
  return gbRate * sizeGb;
}

function estimateAwsDatabaseMonthly(resource: IrResource): number {
  const instanceClass = String(resource.attributes['instance_class'] ?? '').toLowerCase();
  const entry = AWS_DATABASE_PRICING[instanceClass];
  const storageGb = Number(resource.attributes['allocated_storage'] ?? 20);
  const hourly = entry?.hourlyUsd ?? AWS_DEFAULT_DB_HOURLY_USD;
  return hourly * HOURS_PER_MONTH + storageGb * AWS_RDS_STORAGE_GB_MONTH_USD;
}

function estimateAwsNetworkingMonthly(resource: IrResource): number {
  const srcType = resource.sourceType.toLowerCase();
  if (srcType.includes('nat_gateway')) {
    const dataGb = Number(resource.attributes['estimated_data_gb'] ?? AWS_ASSUMED_DATA_TRANSFER_GB);
    return AWS_NAT_GATEWAY_HOURLY_USD * HOURS_PER_MONTH + dataGb * AWS_NAT_GATEWAY_PER_GB_USD;
  }
  if (srcType.includes('alb') || srcType.includes('lb')) {
    return AWS_ALB_HOURLY_USD * HOURS_PER_MONTH;
  }
  if (srcType.includes('nlb')) {
    return AWS_NLB_HOURLY_USD * HOURS_PER_MONTH;
  }
  // Generic data-transfer estimate
  const dataGb = Number(resource.attributes['estimated_data_gb'] ?? AWS_ASSUMED_DATA_TRANSFER_GB);
  return dataGb * AWS_DATA_TRANSFER_OUT_USD;
}

function estimateAwsResourceMonthly(resource: IrResource): number {
  const cat = resource.category;
  switch (cat) {
    case 'compute':    return estimateAwsComputeMonthly(resource);
    case 'storage':    return estimateAwsStorageMonthly(resource);
    case 'database':   return estimateAwsDatabaseMonthly(resource);
    case 'networking': return estimateAwsNetworkingMonthly(resource);
    default:           return 0;
  }
}

// ---------------------------------------------------------------------------
// Azure target cost estimation helpers
// ---------------------------------------------------------------------------

function estimateAzureComputeMonthly(targetResource: TranslatedResource): number {
  const sourceType = targetResource.traceability.sourceType.toLowerCase();
  // Derive a canonical AWS-like instance key from attributes or source type
  const instanceType = String(targetResource.attributes['size'] ?? targetResource.attributes['vm_size'] ?? '').toLowerCase();
  const mappedEntry = AZURE_INSTANCE_PRICING[instanceType];
  if (mappedEntry !== undefined) {
    return mappedEntry.hourlyUsd * HOURS_PER_MONTH;
  }
  // Try reverse-lookup from sourceType → instance key via the source attributes
  const srcInstanceEntry = Object.entries(AZURE_INSTANCE_PRICING).find(([k]) =>
    sourceType.includes(k.split('.')[0] ?? '')
  );
  if (srcInstanceEntry !== undefined) {
    return srcInstanceEntry[1].hourlyUsd * HOURS_PER_MONTH;
  }
  const vcpu = Number(targetResource.attributes['vcpu'] ?? 2);
  const ramGb = Number(targetResource.attributes['memory_gb'] ?? 4);
  return (vcpu * AZURE_DEFAULT_VCPU_HOURLY_USD + ramGb * AZURE_DEFAULT_RAM_GB_HOURLY_USD) * HOURS_PER_MONTH;
}

function estimateAzureStorageMonthly(targetResource: TranslatedResource): number {
  const storageType = String(targetResource.attributes['account_tier'] ?? targetResource.attributes['storage_account_type'] ?? 'ebs_gp3').toLowerCase();
  const sizeGb = Number(targetResource.attributes['disk_size_gb'] ?? targetResource.attributes['size_gb'] ?? 100);
  const tierKey = storageType.replace(/[^a-z0-9_]/g, '_');
  const tier = AZURE_STORAGE_PRICING[tierKey];
  const gbRate = tier?.gbMonthUsd ?? AZURE_DEFAULT_STORAGE_GB_MONTH_USD;
  return gbRate * sizeGb;
}

function estimateAzureDatabaseMonthly(targetResource: TranslatedResource): number {
  const skuName = String(targetResource.attributes['sku_name'] ?? '').toLowerCase();
  const entry = AZURE_DATABASE_PRICING[skuName];
  const storageGb = Number(targetResource.attributes['storage_mb'] != null
    ? Number(targetResource.attributes['storage_mb']) / 1024
    : 20);
  const hourly = entry?.hourlyUsd ?? AZURE_DEFAULT_DB_HOURLY_USD;
  return hourly * HOURS_PER_MONTH + storageGb * AZURE_DB_STORAGE_GB_MONTH_USD;
}

function estimateAzureNetworkingMonthly(targetResource: TranslatedResource): number {
  const tgtType = targetResource.targetType.toLowerCase();
  if (tgtType.includes('nat')) {
    const dataGb = Number(targetResource.attributes['estimated_data_gb'] ?? AZURE_ASSUMED_DATA_TRANSFER_GB);
    return AZURE_NAT_GATEWAY_HOURLY_USD * HOURS_PER_MONTH + dataGb * AZURE_NAT_GATEWAY_PER_GB_USD;
  }
  if (tgtType.includes('load_balancer') || tgtType.includes('lb')) {
    return AZURE_LB_HOURLY_USD * HOURS_PER_MONTH;
  }
  const dataGb = Number(targetResource.attributes['estimated_data_gb'] ?? AZURE_ASSUMED_DATA_TRANSFER_GB);
  return dataGb * AZURE_DATA_TRANSFER_OUT_USD;
}

// ---------------------------------------------------------------------------
// GCP target cost estimation helpers
// ---------------------------------------------------------------------------

function estimateGcpComputeMonthly(targetResource: TranslatedResource): number {
  const machineType = String(targetResource.attributes['machine_type'] ?? '').toLowerCase();
  // Try direct lookup via machine_type attribute (e.g. n2-standard-4 won't match, use fallback)
  // Try reverse lookup using source instance type key
  const sourceInstanceType = String(targetResource.traceability.sourceType ?? '').toLowerCase();
  const mappedEntry = GCP_INSTANCE_PRICING[machineType] ??
    Object.entries(GCP_INSTANCE_PRICING).find(([k]) => sourceInstanceType.includes(k))?.[1];
  if (mappedEntry !== undefined) {
    return mappedEntry.hourlyUsd * HOURS_PER_MONTH;
  }
  const vcpu = Number(targetResource.attributes['vcpu'] ?? 2);
  const ramGb = Number(targetResource.attributes['memory_gb'] ?? 4);
  return (vcpu * GCP_DEFAULT_VCPU_HOURLY_USD + ramGb * GCP_DEFAULT_RAM_GB_HOURLY_USD) * HOURS_PER_MONTH;
}

function estimateGcpStorageMonthly(targetResource: TranslatedResource): number {
  const storageClass = String(targetResource.attributes['storage_class'] ?? targetResource.attributes['type'] ?? 's3_standard').toLowerCase();
  const sizeGb = Number(targetResource.attributes['size'] ?? targetResource.attributes['size_gb'] ?? 100);
  const tierKey = storageClass.replace(/[^a-z0-9_]/g, '_');
  const tier = GCP_STORAGE_PRICING[tierKey];
  const gbRate = tier?.gbMonthUsd ?? GCP_DEFAULT_STORAGE_GB_MONTH_USD;
  return gbRate * sizeGb;
}

function estimateGcpDatabaseMonthly(targetResource: TranslatedResource): number {
  const tier = String(targetResource.attributes['tier'] ?? '').toLowerCase();
  const entry = GCP_DATABASE_PRICING[tier];
  const storageGb = Number(targetResource.attributes['disk_size'] ?? 20);
  const hourly = entry?.hourlyUsd ?? GCP_DEFAULT_DB_HOURLY_USD;
  return hourly * HOURS_PER_MONTH + storageGb * GCP_DB_STORAGE_GB_MONTH_USD;
}

function estimateGcpNetworkingMonthly(targetResource: TranslatedResource): number {
  const tgtType = targetResource.targetType.toLowerCase();
  if (tgtType.includes('router_nat') || tgtType.includes('cloud_nat')) {
    const dataGb = Number(targetResource.attributes['estimated_data_gb'] ?? GCP_ASSUMED_DATA_TRANSFER_GB);
    return GCP_NAT_GATEWAY_HOURLY_USD * HOURS_PER_MONTH + dataGb * GCP_NAT_GATEWAY_PER_GB_USD;
  }
  if (tgtType.includes('forwarding_rule') || tgtType.includes('url_map') || tgtType.includes('load_balancer')) {
    return GCP_LB_HOURLY_USD * HOURS_PER_MONTH;
  }
  const dataGb = Number(targetResource.attributes['estimated_data_gb'] ?? GCP_ASSUMED_DATA_TRANSFER_GB);
  return dataGb * GCP_DATA_TRANSFER_OUT_USD;
}

// ---------------------------------------------------------------------------
// Category detection from target resource type
// ---------------------------------------------------------------------------

type ResourceCategoryHint = 'compute' | 'storage' | 'database' | 'networking' | 'other';

function detectTargetCategory(targetType: string, sourceCategory: string): ResourceCategoryHint {
  const t = targetType.toLowerCase();
  // Database check MUST come before compute — 'google_sql_database_instance' contains 'instance'
  if (t.includes('sql_server') || t.includes('flexible_server') || t.includes('sql_database') ||
      t.includes('cloud_sql') || t.includes('db_instance') || t.includes('sql_instance')) return 'database';
  if (t.includes('virtual_machine') || t.includes('compute_instance') ||
      (t.includes('instance') && !t.includes('sql') && !t.includes('db'))) return 'compute';
  if (t.includes('storage_account') || t.includes('bucket') || t.includes('disk') || t.includes('managed_disk')) return 'storage';
  if (t.includes('nat') || t.includes('load_balancer') || t.includes('lb') ||
      t.includes('forwarding_rule') || t.includes('url_map')) return 'networking';

  // Fall back to the source IR category
  const s = sourceCategory.toLowerCase();
  if (s === 'compute' || s === 'storage' || s === 'database' || s === 'networking') {
    return s as ResourceCategoryHint;
  }
  return 'other';
}

function estimateTargetResourceMonthly(
  targetResource: TranslatedResource,
  sourceCategory: string,
  target: 'azure' | 'gcp'
): number {
  const category = detectTargetCategory(targetResource.targetType, sourceCategory);

  if (target === 'azure') {
    switch (category) {
      case 'compute':    return estimateAzureComputeMonthly(targetResource);
      case 'storage':    return estimateAzureStorageMonthly(targetResource);
      case 'database':   return estimateAzureDatabaseMonthly(targetResource);
      case 'networking': return estimateAzureNetworkingMonthly(targetResource);
      default:           return 0;
    }
  } else {
    switch (category) {
      case 'compute':    return estimateGcpComputeMonthly(targetResource);
      case 'storage':    return estimateGcpStorageMonthly(targetResource);
      case 'database':   return estimateGcpDatabaseMonthly(targetResource);
      case 'networking': return estimateGcpNetworkingMonthly(targetResource);
      default:           return 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Main public function
// ---------------------------------------------------------------------------

/**
 * Estimate the cost delta between a source AWS architecture (described by
 * `ir`) and the translated target architecture (described by `result`).
 *
 * All figures are INFORMATIONAL approximations.  `reviewRequired` is always
 * `true` per PRD EC-011.
 */
export function estimateCostDelta(
  ir: CanonicalIR,
  result: TranslationResult,
): CostDeltaReport {
  try {
  const target = result.target as 'azure' | 'gcp';

  // -------------------------------------------------------------------------
  // Build a lookup from sourceId → [TranslatedResource]
  // -------------------------------------------------------------------------
  const targetBySource = new Map<string, TranslatedResource[]>();
  for (const tr of result.resources) {
    const existing = targetBySource.get(tr.sourceId) ?? [];
    existing.push(tr);
    targetBySource.set(tr.sourceId, existing);
  }

  // -------------------------------------------------------------------------
  // Per-resource comparison
  // -------------------------------------------------------------------------
  const perResource: ResourceCostComparison[] = [];
  const sourceLineItems: CostLineItem[] = [];
  const targetLineItems: CostLineItem[] = [];

  for (const resource of ir.resources) {
    // Skip resources with no expected cost (security groups, IAM, etc.)
    const billableCategories = new Set(['compute', 'storage', 'database', 'networking']);
    if (!billableCategories.has(resource.category)) {
      continue;
    }

    const srcMonthly = estimateAwsResourceMonthly(resource);
    const translatedResources = targetBySource.get(resource.id) ?? [];
    const tgtMonthly = translatedResources.reduce((sum, tr) => {
      return sum + estimateTargetResourceMonthly(tr, resource.category, target);
    }, 0);

    perResource.push({
      sourceId: resource.id,
      sourceType: resource.sourceType,
      targetTypes: translatedResources.map(tr => tr.targetType),
      sourceMonthlyUsd: srcMonthly,
      targetMonthlyUsd: tgtMonthly,
      deltaUsd: tgtMonthly - srcMonthly,
    });

    if (srcMonthly > 0) {
      sourceLineItems.push({
        label: `${resource.sourceType} / ${resource.sourceName}`,
        monthlyUsd: srcMonthly,
        basis: `AWS on-demand, category=${resource.category}`,
      });
    }

    if (tgtMonthly > 0) {
      const tgtLabels = translatedResources.map(tr => tr.targetType).join(', ') || 'untranslated';
      targetLineItems.push({
        label: `${tgtLabels} (from ${resource.sourceName})`,
        monthlyUsd: tgtMonthly,
        basis: `${target === 'azure' ? 'Azure' : 'GCP'} on-demand, category=${resource.category}`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Aggregate totals
  // -------------------------------------------------------------------------
  const totalSource = sourceLineItems.reduce((s, l) => s + l.monthlyUsd, 0);
  const totalTarget = targetLineItems.reduce((s, l) => s + l.monthlyUsd, 0);
  const delta = totalTarget - totalSource;
  const deltaPercent = totalSource > 0 ? (delta / totalSource) * 100 : 0;

  // -------------------------------------------------------------------------
  // Caveats — standard + staleness
  // -------------------------------------------------------------------------
  const staleWarnings = collectStaleCaveats(target);
  const caveats: string[] = [...STANDARD_CAVEATS, ...staleWarnings];

  return {
    sourceEstimate: { totalMonthlyUsd: totalSource, lineItems: sourceLineItems },
    targetEstimate: { totalMonthlyUsd: totalTarget, lineItems: targetLineItems },
    delta,
    deltaPercent,
    perResource,
    caveats,
    reviewRequired: true,
  };
  } catch (_err: unknown) {
    // Never-throw: return a safe empty report on unexpected errors
    return {
      sourceEstimate: { totalMonthlyUsd: 0, lineItems: [] },
      targetEstimate: { totalMonthlyUsd: 0, lineItems: [] },
      delta: 0,
      deltaPercent: 0,
      perResource: [],
      caveats: [...STANDARD_CAVEATS, 'Cost estimation encountered an unexpected error'],
      reviewRequired: true,
    };
  }
}
