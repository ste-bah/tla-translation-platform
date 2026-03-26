/**
 * Maps Terraform resource types to registry aws_service keys.
 *
 * The registry stores entries keyed by short AWS service names (e.g. "s3", "ec2"),
 * while Terraform uses full resource type prefixes (e.g. "aws_s3_bucket").
 * This map bridges the two namespaces.
 *
 * Shared between @tla/ingestion (IrEmitter) and @tla/translator (TranslationPlanner).
 */

/**
 * Exact Terraform resource-type prefix to registry aws_service key.
 */
export const RESOURCE_TYPE_REGISTRY_MAP: ReadonlyMap<string, string> = new Map([
  // Compute
  ['aws_instance', 'ec2'],
  ['aws_ec2', 'ec2'],
  ['aws_launch_template', 'ec2'],
  ['aws_ami', 'ec2'],

  // Auto-scaling
  ['aws_autoscaling', 'asg'],

  // Lambda
  ['aws_lambda', 'lambda'],

  // ECS
  ['aws_ecs', 'ecs'],

  // EKS
  ['aws_eks', 'eks'],

  // Storage
  ['aws_s3', 's3'],

  // EFS
  ['aws_efs', 'efs'],

  // EBS
  ['aws_ebs', 'ebs'],

  // ECR
  ['aws_ecr', 'ecr'],

  // Database
  ['aws_rds', 'rds'],
  ['aws_db', 'rds'],
  ['aws_aurora', 'rds'],

  // DynamoDB
  ['aws_dynamodb', 'dynamodb'],

  // ElastiCache
  ['aws_elasticache', 'elasticache_redis'],

  // Networking — VPC
  ['aws_vpc', 'vpc'],

  // Subnet
  ['aws_subnet', 'subnet'],

  // Security group
  ['aws_security_group', 'security_group'],

  // NAT
  ['aws_nat_gateway', 'nat_gateway'],

  // ALB
  ['aws_lb', 'alb'],
  ['aws_alb', 'alb'],

  // Route53
  ['aws_route53', 'route53'],

  // CloudFront
  ['aws_cloudfront', 'cloudfront'],

  // VPC Peering
  ['aws_vpc_peering', 'vpc_peering'],

  // ELB (classic)
  ['aws_elb', 'alb'],

  // Internet gateway (falls under VPC in registry)
  ['aws_internet_gateway', 'vpc'],

  // Route table (falls under VPC in registry)
  ['aws_route_table', 'vpc'],
  ['aws_route', 'vpc'],
]);

/**
 * Resolve a Terraform resource type to its registry aws_service key.
 *
 * Uses progressive prefix fallback: tries the full type first, then
 * strips trailing segments separated by `_` until a match is found.
 */
export function resolveRegistryKey(terraformType: string): string | undefined {
  const exact = RESOURCE_TYPE_REGISTRY_MAP.get(terraformType);
  if (exact !== undefined) {
    return exact;
  }

  let candidate = terraformType;
  let lastUnderscore = candidate.lastIndexOf('_');
  while (lastUnderscore > 0) {
    candidate = candidate.slice(0, lastUnderscore);
    const hit = RESOURCE_TYPE_REGISTRY_MAP.get(candidate);
    if (hit !== undefined) {
      return hit;
    }
    lastUnderscore = candidate.lastIndexOf('_');
  }

  return undefined;
}
