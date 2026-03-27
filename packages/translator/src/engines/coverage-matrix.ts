/**
 * Coverage matrix: classifies registry entries by handler type
 * (specialized dispatch table, advisory stub, or generic fallback).
 */

import type { RegistryEntry } from '@tla/shared';

// -----------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------

export interface CoverageEntry {
  awsResourceType: string;
  mappingType: string;
  handlerType: 'specialized' | 'generic-fallback' | 'advisory';
}

export interface CoverageMatrix {
  specialized: number;
  genericFallback: number;
  advisory: number;
  total: number;
  entries: CoverageEntry[];
}

// -----------------------------------------------------------------------
// Static handler sets — mirrors the dispatch tables in each engine
// without importing them (avoids circular deps).
// -----------------------------------------------------------------------

const SPECIALIZED_HANDLERS = new Set([
  // Direct engine (P1 band)
  'aws_s3_bucket',
  'aws_ecr_repository',
  'aws_elasticache_replication_group',
  'aws_vpc_peering_connection',
  'aws_route53_zone',
  'aws_route53_record',
  // Parametric engine (P2 band)
  'aws_nat_gateway',
  'aws_kms_key',
  'aws_secretsmanager_secret',
  'aws_secretsmanager_secret_version',
  'aws_eks_cluster',
  'aws_dx_connection',
  'aws_dx_gateway',
  'aws_dx_gateway_association',
  'aws_vpn_gateway',
  'aws_vpn_connection',
  'aws_customer_gateway',
  // Compound engine (N1 band)
  'aws_instance',
  'aws_autoscaling_group',
  'aws_lb',
  'aws_db_instance',
  'aws_api_gateway_rest_api',
  // Structural engine
  'aws_security_group',
  'aws_lambda_function',
  'aws_ecs_service',
  'aws_sqs_queue',
  'aws_sns_topic',
  'aws_cloudwatch_metric_alarm',
  'aws_cloudwatch_log_group',
  'aws_vpc',
  'aws_vpc_dhcp_options',
  'aws_flow_log',
  'aws_internet_gateway',
  'aws_route_table',
  'aws_subnet',
  'aws_ec2_transit_gateway',
  'aws_ec2_transit_gateway_vpc_attachment',
  'aws_ec2_transit_gateway_route_table',
  'aws_ec2_transit_gateway_peering_attachment',
  'aws_vpc_endpoint',
  'aws_vpc_endpoint_service',
  'aws_wafv2_web_acl',
  'aws_wafv2_rule_group',
  'aws_sfn_state_machine',
]);

const ADVISORY_HANDLERS = new Set([
  'aws_dynamodb_table',
  'aws_iam_role',
  'aws_iam_policy',
  'aws_cloudfront_distribution',
  'aws_route53_health_check',
  'aws_elasticache_cluster',
]);

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

/**
 * Classify a single registry entry into a handler type.
 */
export function classifyEntry(entry: RegistryEntry): CoverageEntry {
  const awsType = entry.aws_service;
  const handlerType = resolveHandlerType(awsType, entry.mapping_type);
  return {
    awsResourceType: awsType,
    mappingType: entry.mapping_type,
    handlerType,
  };
}

/**
 * Build a full coverage matrix from an array of registry entries.
 */
export function buildCoverageMatrix(
  registryEntries: RegistryEntry[],
): CoverageMatrix {
  const entries = registryEntries.map(classifyEntry);

  let specialized = 0;
  let genericFallback = 0;
  let advisory = 0;

  for (const e of entries) {
    if (e.handlerType === 'specialized') specialized++;
    else if (e.handlerType === 'advisory') advisory++;
    else genericFallback++;
  }

  return {
    specialized,
    genericFallback,
    advisory,
    total: entries.length,
    entries,
  };
}

// -----------------------------------------------------------------------
// Internal
// -----------------------------------------------------------------------

function resolveHandlerType(
  awsType: string,
  mappingType: string,
): CoverageEntry['handlerType'] {
  if (mappingType === 'none' || ADVISORY_HANDLERS.has(awsType)) {
    return 'advisory';
  }
  if (SPECIALIZED_HANDLERS.has(awsType)) {
    return 'specialized';
  }
  return 'generic-fallback';
}
