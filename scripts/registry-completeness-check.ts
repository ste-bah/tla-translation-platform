#!/usr/bin/env npx tsx
/**
 * TASK-NFR-004: Registry Completeness CI Check
 *
 * Compares registry entries against a reference list of the ~50 most commonly
 * used AWS Terraform resource types and reports coverage.
 *
 * Usage:
 *   npx tsx scripts/registry-completeness-check.ts
 *
 * Exit codes:
 *   0 — always (informational report, not a gate)
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { createRequire } from 'node:module';

// Resolve 'yaml' from the registry package where pnpm has it available
const require = createRequire(
  resolve(import.meta.dirname ?? '.', '..', 'packages', 'registry', 'src', 'loader.ts'),
);
const { parse: parseYaml } = require('yaml') as { parse: (input: string) => unknown };

// ---------------------------------------------------------------------------
// Reference list — ~50 most commonly used AWS Terraform resource types
// ---------------------------------------------------------------------------

interface ReferenceType {
  /** The Terraform resource type (e.g. "aws_instance") */
  tfType: string;
  /** Human-readable label */
  label: string;
}

const REFERENCE_TYPES: ReadonlyArray<ReferenceType> = [
  // Compute
  { tfType: 'aws_instance', label: 'EC2 Instance' },
  { tfType: 'aws_launch_template', label: 'Launch Template' },
  { tfType: 'aws_autoscaling_group', label: 'Auto Scaling Group' },
  { tfType: 'aws_lambda_function', label: 'Lambda Function' },
  { tfType: 'aws_ecs_service', label: 'ECS Service' },
  { tfType: 'aws_ecs_task_definition', label: 'ECS Task Definition' },
  { tfType: 'aws_eks_cluster', label: 'EKS Cluster' },

  // Storage
  { tfType: 'aws_s3_bucket', label: 'S3 Bucket' },
  { tfType: 'aws_s3_bucket_versioning', label: 'S3 Bucket Versioning' },
  { tfType: 'aws_s3_bucket_policy', label: 'S3 Bucket Policy' },
  { tfType: 'aws_ebs_volume', label: 'EBS Volume' },
  { tfType: 'aws_efs_file_system', label: 'EFS File System' },
  { tfType: 'aws_ecr_repository', label: 'ECR Repository' },

  // Networking
  { tfType: 'aws_vpc', label: 'VPC' },
  { tfType: 'aws_subnet', label: 'Subnet' },
  { tfType: 'aws_security_group', label: 'Security Group' },
  { tfType: 'aws_security_group_rule', label: 'Security Group Rule' },
  { tfType: 'aws_nat_gateway', label: 'NAT Gateway' },
  { tfType: 'aws_internet_gateway', label: 'Internet Gateway' },
  { tfType: 'aws_route_table', label: 'Route Table' },
  { tfType: 'aws_route', label: 'Route' },
  { tfType: 'aws_vpc_peering_connection', label: 'VPC Peering Connection' },
  { tfType: 'aws_lb', label: 'Load Balancer (ALB/NLB)' },
  { tfType: 'aws_lb_target_group', label: 'LB Target Group' },
  { tfType: 'aws_lb_listener', label: 'LB Listener' },

  // DNS & CDN
  { tfType: 'aws_route53_zone', label: 'Route 53 Zone' },
  { tfType: 'aws_route53_record', label: 'Route 53 Record' },
  { tfType: 'aws_cloudfront_distribution', label: 'CloudFront Distribution' },

  // Database
  { tfType: 'aws_rds_cluster', label: 'RDS Aurora Cluster' },
  { tfType: 'aws_db_instance', label: 'RDS DB Instance' },
  { tfType: 'aws_dynamodb_table', label: 'DynamoDB Table' },
  { tfType: 'aws_elasticache_replication_group', label: 'ElastiCache Replication Group' },
  { tfType: 'aws_elasticache_cluster', label: 'ElastiCache Cluster' },

  // Security & IAM
  { tfType: 'aws_iam_role', label: 'IAM Role' },
  { tfType: 'aws_iam_policy', label: 'IAM Policy' },
  { tfType: 'aws_iam_role_policy_attachment', label: 'IAM Role Policy Attachment' },
  { tfType: 'aws_iam_instance_profile', label: 'IAM Instance Profile' },
  { tfType: 'aws_kms_key', label: 'KMS Key' },
  { tfType: 'aws_secretsmanager_secret', label: 'Secrets Manager Secret' },
  { tfType: 'aws_acm_certificate', label: 'ACM Certificate' },

  // Messaging
  { tfType: 'aws_sqs_queue', label: 'SQS Queue' },
  { tfType: 'aws_sns_topic', label: 'SNS Topic' },
  { tfType: 'aws_sns_topic_subscription', label: 'SNS Subscription' },

  // Observability
  { tfType: 'aws_cloudwatch_log_group', label: 'CloudWatch Log Group' },
  { tfType: 'aws_cloudwatch_metric_alarm', label: 'CloudWatch Alarm' },

  // Other common
  { tfType: 'aws_api_gateway_rest_api', label: 'API Gateway REST API' },
  { tfType: 'aws_apigatewayv2_api', label: 'API Gateway v2 (HTTP)' },
  { tfType: 'aws_cloudwatch_event_rule', label: 'EventBridge Rule' },
  { tfType: 'aws_sfn_state_machine', label: 'Step Functions State Machine' },
  { tfType: 'aws_kinesis_stream', label: 'Kinesis Stream' },
];

// ---------------------------------------------------------------------------
// Registry YAML loader (same approach as registry-coverage-audit.ts)
// ---------------------------------------------------------------------------

interface RegistryYamlEntry {
  registry_entry_id: string;
  aws_service: string;
  aws_family: string;
  mapping_type: string;
  band: string;
}

async function collectYamlFiles(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  const dirents = await readdir(dirPath, { withFileTypes: true });
  for (const dirent of dirents) {
    if (dirent.isSymbolicLink()) continue;
    const fullPath = join(dirPath, dirent.name);
    if (dirent.isDirectory()) {
      results.push(...(await collectYamlFiles(fullPath)));
    } else if (dirent.isFile()) {
      const ext = extname(dirent.name).toLowerCase();
      if (ext === '.yaml' || ext === '.yml') {
        results.push(fullPath);
      }
    }
  }
  return results;
}

async function loadEntries(dirPath: string): Promise<RegistryYamlEntry[]> {
  const files = await collectYamlFiles(dirPath);
  const entries: RegistryYamlEntry[] = [];
  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = parseYaml(raw);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (item && typeof item === 'object' && 'aws_service' in item) {
        entries.push(item as RegistryYamlEntry);
      }
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Registry key resolution (lightweight inline copy to avoid build deps)
// ---------------------------------------------------------------------------

const RESOURCE_TYPE_REGISTRY_MAP: ReadonlyMap<string, string> = new Map([
  ['aws_instance', 'ec2'],
  ['aws_ec2', 'ec2'],
  ['aws_launch_template', 'ec2'],
  ['aws_ami', 'ec2'],
  ['aws_autoscaling', 'asg'],
  ['aws_lambda', 'lambda'],
  ['aws_ecs', 'ecs'],
  ['aws_eks', 'eks'],
  ['aws_s3', 's3'],
  ['aws_efs', 'efs'],
  ['aws_ebs', 'ebs'],
  ['aws_ecr', 'ecr'],
  ['aws_rds', 'rds'],
  ['aws_db', 'rds'],
  ['aws_aurora', 'rds'],
  ['aws_dynamodb', 'dynamodb'],
  ['aws_elasticache', 'elasticache_redis'],
  ['aws_vpc', 'vpc'],
  ['aws_subnet', 'subnet'],
  ['aws_security_group', 'security_group'],
  ['aws_nat_gateway', 'nat_gateway'],
  ['aws_lb', 'alb'],
  ['aws_alb', 'alb'],
  ['aws_route53', 'route53'],
  ['aws_cloudfront', 'cloudfront'],
  ['aws_vpc_peering', 'vpc_peering'],
  ['aws_elb', 'alb'],
  ['aws_internet_gateway', 'vpc'],
  ['aws_route_table', 'vpc'],
  ['aws_route', 'vpc'],
  ['aws_kms', 'kms'],
  ['aws_secretsmanager', 'secretsmanager'],
  ['aws_sqs', 'sqs'],
  ['aws_sns', 'sns'],
  ['aws_iam', 'iam'],
  ['aws_acm', 'acm'],
  ['aws_cloudwatch', 'cloudwatch'],
  ['aws_api_gateway', 'api_gateway'],
  ['aws_apigatewayv2', 'apigatewayv2'],
  ['aws_sfn', 'sfn'],
  ['aws_kinesis', 'kinesis'],
]);

function resolveRegistryKey(terraformType: string): string | undefined {
  const exact = RESOURCE_TYPE_REGISTRY_MAP.get(terraformType);
  if (exact !== undefined) return exact;

  let candidate = terraformType;
  let lastUnderscore = candidate.lastIndexOf('_');
  while (lastUnderscore > 0) {
    candidate = candidate.slice(0, lastUnderscore);
    const hit = RESOURCE_TYPE_REGISTRY_MAP.get(candidate);
    if (hit !== undefined) return hit;
    lastUnderscore = candidate.lastIndexOf('_');
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const registryDir = resolve(
    import.meta.dirname ?? '.',
    '..',
    'packages',
    'registry',
    'data',
  );

  const entries = await loadEntries(registryDir);

  // Build a set of registry aws_service keys
  const registryKeys = new Set(entries.map((e) => e.aws_service));

  // Build a lookup from aws_service key to entry for display info
  const entryByKey = new Map<string, RegistryYamlEntry>();
  for (const entry of entries) {
    if (!entryByKey.has(entry.aws_service)) {
      entryByKey.set(entry.aws_service, entry);
    }
  }

  // Classify each reference type as mapped or missing
  const mapped: Array<{ ref: ReferenceType; registryKey: string; entry: RegistryYamlEntry }> = [];
  const missing: ReferenceType[] = [];

  for (const ref of REFERENCE_TYPES) {
    const registryKey = resolveRegistryKey(ref.tfType);
    if (registryKey !== undefined && registryKeys.has(registryKey)) {
      mapped.push({ ref, registryKey, entry: entryByKey.get(registryKey)! });
    } else {
      missing.push(ref);
    }
  }

  const total = REFERENCE_TYPES.length;
  const coveragePct = ((mapped.length / total) * 100).toFixed(0);

  // -- Report ---------------------------------------------------------------

  console.log('');
  console.log('Registry Completeness Check');
  console.log('============================');
  console.log(`Reference types: ${total}`);
  console.log(`Mapped: ${mapped.length}`);
  console.log(`Missing: ${missing.length}`);
  console.log(`Coverage: ${coveragePct}%`);
  console.log('');

  console.log('Mapped:');
  for (const { ref, entry } of mapped) {
    const band = entry.band;
    const type = entry.mapping_type;
    console.log(`  \u2713 ${ref.tfType} (${band}, ${type})`);
  }
  console.log('');

  console.log('Missing:');
  for (const ref of missing) {
    console.log(`  \u2717 ${ref.tfType} — ${ref.label}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('Registry completeness check failed:', err);
  process.exit(1);
});
