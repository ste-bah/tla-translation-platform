/**
 * Opaque Module Handler — creates OpaqueRecord entries for modules that
 * cannot be resolved locally (registry, git, s3, gcs, or truly unknown).
 *
 * Per PRD EC-001: never silently skip a module. Every unresolved module
 * produces an OpaqueRecord with reviewRequired: true.
 */

import type { HclModuleCall } from '@tla/shared';
import { createComponentLogger } from '@tla/shared';
import type { ModuleSourceKind, OpaqueRecord } from './types.js';

const logger = createComponentLogger('modules');

// ---------------------------------------------------------------------------
// Name-based resource type heuristics
// ---------------------------------------------------------------------------

/**
 * Map of substrings found in module names to likely resource types.
 * Order matters: first match wins when multiple substrings are present.
 */
const MODULE_NAME_HEURISTICS: Array<[substring: string, resourceTypes: string[]]> = [
  ['vpc', ['aws_vpc', 'aws_subnet', 'aws_internet_gateway', 'aws_route_table']],
  ['subnet', ['aws_subnet']],
  ['dns', ['aws_route53_zone', 'aws_route53_record']],
  ['rds', ['aws_db_instance', 'aws_db_subnet_group']],
  ['aurora', ['aws_rds_cluster', 'aws_rds_cluster_instance']],
  ['dynamodb', ['aws_dynamodb_table']],
  ['s3', ['aws_s3_bucket', 'aws_s3_bucket_policy']],
  ['lambda', ['aws_lambda_function', 'aws_lambda_permission']],
  ['ecs', ['aws_ecs_cluster', 'aws_ecs_service', 'aws_ecs_task_definition']],
  ['eks', ['aws_eks_cluster', 'aws_eks_node_group']],
  ['alb', ['aws_lb', 'aws_lb_target_group', 'aws_lb_listener']],
  ['elb', ['aws_lb', 'aws_lb_target_group']],
  ['cloudfront', ['aws_cloudfront_distribution']],
  ['iam', ['aws_iam_role', 'aws_iam_policy']],
  ['security_group', ['aws_security_group', 'aws_security_group_rule']],
  ['sg', ['aws_security_group']],
  ['route53', ['aws_route53_zone', 'aws_route53_record']],
  ['acm', ['aws_acm_certificate']],
  ['kms', ['aws_kms_key', 'aws_kms_alias']],
  ['sqs', ['aws_sqs_queue']],
  ['sns', ['aws_sns_topic']],
  ['cloudwatch', ['aws_cloudwatch_log_group', 'aws_cloudwatch_metric_alarm']],
  ['ecr', ['aws_ecr_repository']],
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an OpaqueRecord for a module that cannot be resolved.
 *
 * @param call - The original HCL module call
 * @param callPath - Dot-delimited call path (e.g. "vpc" or "network.vpc")
 * @param sourceKind - Classified source kind
 * @param reason - Human-readable reason why resolution failed
 * @returns An OpaqueRecord with reviewRequired: true
 */
export function handleOpaqueModule(
  call: HclModuleCall,
  callPath: string,
  sourceKind: ModuleSourceKind,
  reason: string,
): OpaqueRecord {
  const inferredResourceTypes = inferResourceTypes(call.name);

  logger.warn(
    {
      moduleName: call.name,
      callPath,
      sourceKind,
      source: call.source,
      inferredCount: inferredResourceTypes.length,
    },
    'Created opaque record for unresolved module',
  );

  return {
    moduleName: call.name,
    callPath,
    source: call.source,
    sourceKind,
    reason,
    reviewRequired: true,
    inferredResourceTypes,
  };
}

/**
 * Infer likely resource types from a module name using substring heuristics.
 * Returns an empty array if no heuristics match.
 */
export function inferResourceTypes(moduleName: string): string[] {
  const lower = moduleName.toLowerCase();
  for (const [substring, types] of MODULE_NAME_HEURISTICS) {
    if (lower.includes(substring)) {
      return [...types];
    }
  }
  return [];
}
