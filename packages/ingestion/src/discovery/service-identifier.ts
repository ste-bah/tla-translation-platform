import { createComponentLogger } from '@tla/shared';
import type {
  HclAst,
  IdentifiedService,
  ProceduralResource,
  ServiceInventory,
  AwsServiceFamily,
} from '@tla/shared';

const logger = createComponentLogger('ingestion');

/**
 * Maps AWS resource type prefixes to service families.
 * Order matters: more specific prefixes should come first.
 */
export const AWS_RESOURCE_PREFIX_MAP: ReadonlyMap<string, AwsServiceFamily> =
  new Map<string, AwsServiceFamily>([
    // Containers
    ['aws_ecs', 'containers'],
    ['aws_ecr', 'containers'],
    ['aws_eks', 'containers'],

    // Serverless
    ['aws_lambda', 'serverless'],
    ['aws_api_gateway', 'serverless'],
    ['aws_apigatewayv2', 'serverless'],
    ['aws_sfn', 'serverless'],
    ['aws_step_function', 'serverless'],

    // Compute
    ['aws_instance', 'compute'],
    ['aws_launch_template', 'compute'],
    ['aws_autoscaling', 'compute'],
    ['aws_ami', 'compute'],
    ['aws_ebs', 'compute'],
    ['aws_ec2', 'compute'],
    ['aws_lb', 'compute'],
    ['aws_alb', 'compute'],
    ['aws_elb', 'compute'],

    // Storage
    ['aws_s3', 'storage'],
    ['aws_efs', 'storage'],
    ['aws_fsx', 'storage'],
    ['aws_glacier', 'storage'],

    // Database
    ['aws_rds', 'database'],
    ['aws_db', 'database'],
    ['aws_dynamodb', 'database'],
    ['aws_elasticache', 'database'],
    ['aws_redshift', 'database'],
    ['aws_aurora', 'database'],

    // Networking
    ['aws_vpc', 'networking'],
    ['aws_subnet', 'networking'],
    ['aws_route', 'networking'],
    ['aws_security_group', 'networking'],
    ['aws_network', 'networking'],
    ['aws_nat', 'networking'],
    ['aws_internet_gateway', 'networking'],
    ['aws_eip', 'networking'],
    ['aws_cloudfront', 'networking'],
    ['aws_route53', 'networking'],

    // Security
    ['aws_kms', 'security'],
    ['aws_acm', 'security'],
    ['aws_waf', 'security'],
    ['aws_shield', 'security'],
    ['aws_guardduty', 'security'],
    ['aws_secretsmanager', 'security'],
    ['aws_ssm_parameter', 'security'],

    // Identity
    ['aws_iam', 'identity'],
    ['aws_cognito', 'identity'],

    // Messaging
    ['aws_sqs', 'messaging'],
    ['aws_sns', 'messaging'],
    ['aws_kinesis', 'messaging'],
    ['aws_mq', 'messaging'],
    ['aws_eventbridge', 'messaging'],

    // Observability
    ['aws_cloudwatch', 'observability'],
    ['aws_cloudtrail', 'observability'],
    ['aws_xray', 'observability'],
  ]);

/**
 * Resource types considered procedural (not translatable infrastructure).
 */
const PROCEDURAL_TYPES = new Set([
  'null_resource',
  'terraform_data',
  'time_sleep',
  'time_offset',
  'time_rotating',
  'time_static',
  'random_id',
  'random_integer',
  'random_password',
  'random_pet',
  'random_shuffle',
  'random_string',
  'random_uuid',
  'local_file',
  'local_sensitive_file',
]);

/**
 * Provisioner names that mark a resource as procedural.
 */
const PROCEDURAL_PROVISIONERS = new Set([
  'local-exec',
  'remote-exec',
]);

/**
 * Identifies AWS services, procedural resources, and unknown providers
 * from a collection of parsed HCL ASTs.
 *
 * @param asts - Parsed HCL ASTs from one or more .tf files
 * @returns Aggregated service inventory
 */
export function identifyAwsServices(asts: readonly HclAst[]): ServiceInventory {
  logger.info({ fileCount: asts.length }, 'Identifying AWS services');

  /** Accumulator: resource_type -> { family, count, names, files } */
  const serviceAcc = new Map<
    string,
    {
      family: AwsServiceFamily;
      prefix: string;
      names: Set<string>;
      files: Set<string>;
      count: number;
    }
  >();
  const procedural: ProceduralResource[] = [];
  const unknownFlat: Array<{
    resource_type: string;
    resource_name: string;
    file_path: string;
  }> = [];

  let totalResources = 0;
  let totalAwsResources = 0;

  for (const ast of asts) {
    for (const resource of ast.resources) {
      totalResources++;

      // Check procedural types first
      if (PROCEDURAL_TYPES.has(resource.resource_type)) {
        procedural.push({
          resource_type: resource.resource_type,
          resource_name: resource.name,
          reason: `Procedural resource type: ${resource.resource_type}`,
          file_path: ast.file_path,
        });
        continue;
      }

      // Check for local-exec / remote-exec provisioners in attributes
      if (hasProceduralProvisioner(resource.attributes)) {
        procedural.push({
          resource_type: resource.resource_type,
          resource_name: resource.name,
          reason: 'Contains procedural provisioner (local-exec/remote-exec)',
          file_path: ast.file_path,
        });
        // Still count the resource in its service family if AWS
      }

      // Try to match AWS service family
      const match = matchAwsFamily(resource.resource_type);
      if (match) {
        totalAwsResources++;
        const existing = serviceAcc.get(resource.resource_type);
        if (existing) {
          existing.names.add(resource.name);
          existing.files.add(ast.file_path);
          existing.count++;
        } else {
          serviceAcc.set(resource.resource_type, {
            family: match.family,
            prefix: match.prefix,
            names: new Set([resource.name]),
            files: new Set([ast.file_path]),
            count: 1,
          });
        }
      } else if (!resource.resource_type.startsWith('aws_')) {
        // Non-AWS provider
        unknownFlat.push({
          resource_type: resource.resource_type,
          resource_name: resource.name,
          file_path: ast.file_path,
        });
      } else {
        // AWS resource type with no family mapping
        totalAwsResources++;
        unknownFlat.push({
          resource_type: resource.resource_type,
          resource_name: resource.name,
          file_path: ast.file_path,
        });
      }
    }
  }

  const identifiedServices: IdentifiedService[] = [];
  for (const [resourceType, acc] of serviceAcc) {
    identifiedServices.push({
      resource_type: resourceType,
      resource_name: [...acc.names].join(', '),
      family: acc.family,
      service_prefix: acc.prefix,
      count: acc.count,
      file_paths: [...acc.files],
    });
  }

  // Sort by count descending for readability
  identifiedServices.sort((a, b) => b.count - a.count);

  logger.info(
    {
      identified: identifiedServices.length,
      procedural: procedural.length,
      unknown: unknownFlat.length,
      totalResources,
      totalAwsResources,
    },
    'Service identification complete',
  );

  return {
    identified_services: identifiedServices,
    procedural_resources: procedural,
    unknown_providers: unknownFlat,
    total_resources: totalResources,
    total_aws_resources: totalAwsResources,
  };
}

/**
 * Matches a resource type to an AWS service family using the prefix map.
 * @internal
 */
function matchAwsFamily(
  resourceType: string,
): { family: AwsServiceFamily; prefix: string } | undefined {
  for (const [prefix, family] of AWS_RESOURCE_PREFIX_MAP) {
    if (
      resourceType === prefix ||
      resourceType.startsWith(prefix + '_')
    ) {
      return { family, prefix };
    }
  }
  return undefined;
}

/**
 * Checks if resource attributes contain a procedural provisioner reference.
 * hcl2json typically places provisioners in a "provisioner" key.
 * @internal
 */
function hasProceduralProvisioner(
  attributes: Record<string, unknown>,
): boolean {
  const provisioners = attributes['provisioner'];
  if (!Array.isArray(provisioners)) return false;

  for (const p of provisioners) {
    if (typeof p !== 'object' || p === null) continue;
    for (const key of Object.keys(p as Record<string, unknown>)) {
      if (PROCEDURAL_PROVISIONERS.has(key)) return true;
    }
  }
  return false;
}
