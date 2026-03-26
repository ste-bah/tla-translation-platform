import type { IrResource, IrRelationship, InfraIntent } from '@tla/shared';

// ---------------------------------------------------------------------------
// Resource-type prefix patterns for intent detection
// ---------------------------------------------------------------------------

const NETWORKING_TYPES = new Set([
  'aws_vpc',
  'aws_subnet',
  'aws_security_group',
  'aws_security_group_rule',
  'aws_route_table',
  'aws_route',
  'aws_nat_gateway',
  'aws_internet_gateway',
  'aws_lb',
  'aws_alb',
  'aws_elb',
  'aws_lb_listener',
  'aws_lb_target_group',
  'aws_vpc_peering_connection',
  'aws_network_acl',
]);

const IDENTITY_TYPES = new Set([
  'aws_iam_role',
  'aws_iam_policy',
  'aws_iam_policy_attachment',
  'aws_iam_role_policy',
  'aws_iam_role_policy_attachment',
  'aws_iam_user',
  'aws_iam_group',
  'aws_iam_instance_profile',
]);

const KMS_TYPES = new Set([
  'aws_kms_key',
  'aws_kms_alias',
  'aws_kms_grant',
]);

const SCALING_TYPES = new Set([
  'aws_autoscaling_group',
  'aws_autoscaling_policy',
  'aws_autoscaling_schedule',
  'aws_appautoscaling_target',
  'aws_appautoscaling_policy',
]);

const OBSERVABILITY_TYPES = new Set([
  'aws_cloudwatch_metric_alarm',
  'aws_cloudwatch_log_group',
  'aws_cloudwatch_log_stream',
  'aws_cloudwatch_dashboard',
  'aws_xray_sampling_rule',
  'aws_xray_group',
]);

const SECRET_TYPES = new Set([
  'aws_secretsmanager_secret',
  'aws_secretsmanager_secret_version',
  'aws_ssm_parameter',
]);

// Attribute keys that indicate encryption at rest
const ENCRYPTION_ATTRIBUTE_KEYS = new Set([
  'kms_key_id',
  'kms_key_arn',
  'server_side_encryption',
  'encrypted',
  'encryption_configuration',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchResources(resources: IrResource[], typeSet: Set<string>): IrResource[] {
  return resources.filter((r) => typeSet.has(r.sourceType));
}

function resourceIds(rs: IrResource[]): string[] {
  return rs.map((r) => r.id);
}

// Presence of an encryption-related key is sufficient evidence of encryption
// intent regardless of the key's value (e.g. kms_key_id being empty string
// is still a declaration of intent to encrypt). Value inspection is left to
// downstream translation logic.
function hasEncryptionAttributes(resource: IrResource): boolean {
  const allAttrs = { ...resource.attributes, ...resource.sourceAttributes };
  for (const key of Object.keys(allAttrs)) {
    if (ENCRYPTION_ATTRIBUTE_KEYS.has(key)) {
      return true;
    }
  }
  return false;
}

function inferNetworkingSubtype(
  resources: IrResource[],
): 'vpc' | 'subnet' | 'security_group' | 'load_balancer' | 'nat' | 'route_table' | 'peering' {
  const types = new Set(resources.map((r) => r.sourceType));
  if (types.has('aws_lb') || types.has('aws_alb') || types.has('aws_elb')) return 'load_balancer';
  if (types.has('aws_vpc_peering_connection')) return 'peering';
  if (types.has('aws_nat_gateway')) return 'nat';
  if (types.has('aws_security_group') || types.has('aws_security_group_rule')) return 'security_group';
  if (types.has('aws_subnet')) return 'subnet';
  if (types.has('aws_route_table') || types.has('aws_route')) return 'route_table';
  return 'vpc';
}

function inferIdentitySubtype(
  resources: IrResource[],
): 'role' | 'policy' | 'user' | 'group' | 'service_account' {
  const types = new Set(resources.map((r) => r.sourceType));
  if (types.has('aws_iam_user')) return 'user';
  if (types.has('aws_iam_group')) return 'group';
  if (types.has('aws_iam_instance_profile')) return 'service_account';
  if (types.has('aws_iam_role')) return 'role';
  return 'policy';
}

function inferScalingSubtype(
  resources: IrResource[],
): 'auto_scaling' | 'application_scaling' | 'scheduled' {
  const types = new Set(resources.map((r) => r.sourceType));
  if (types.has('aws_autoscaling_schedule')) return 'scheduled';
  if (types.has('aws_appautoscaling_target') || types.has('aws_appautoscaling_policy')) return 'application_scaling';
  return 'auto_scaling';
}

function inferObservabilitySubtype(
  resources: IrResource[],
): 'monitoring' | 'logging' | 'tracing' | 'alerting' {
  const types = new Set(resources.map((r) => r.sourceType));
  if (types.has('aws_xray_sampling_rule') || types.has('aws_xray_group')) return 'tracing';
  if (types.has('aws_cloudwatch_metric_alarm')) return 'alerting';
  if (types.has('aws_cloudwatch_log_group') || types.has('aws_cloudwatch_log_stream')) return 'logging';
  return 'monitoring';
}

function inferSecretSubtype(
  resources: IrResource[],
): 'secret_store' | 'parameter_store' | 'rotation' {
  const types = new Set(resources.map((r) => r.sourceType));
  if (types.has('aws_ssm_parameter')) return 'parameter_store';
  return 'secret_store';
}

// ---------------------------------------------------------------------------
// Multi-AZ / backup detection for Resilience intent
// ---------------------------------------------------------------------------

const BACKUP_TYPES = new Set([
  'aws_backup_plan',
  'aws_backup_vault',
  'aws_backup_selection',
  'aws_db_instance_automated_backups_replication',
]);

function detectResilienceResources(resources: IrResource[]): IrResource[] {
  const result: IrResource[] = [];
  for (const r of resources) {
    // Explicit backup resources
    if (BACKUP_TYPES.has(r.sourceType)) {
      result.push(r);
      continue;
    }
    // Multi-AZ attribute on RDS, ElastiCache, etc.
    const allAttrs = { ...r.attributes, ...r.sourceAttributes };
    if (allAttrs['multi_az'] === true || allAttrs['availability_zones'] !== undefined) {
      result.push(r);
    }
  }
  return result;
}

function inferResilienceSubtype(
  resources: IrResource[],
): 'multi_az' | 'backup' | 'replication' | 'failover' {
  const types = new Set(resources.map((r) => r.sourceType));
  for (const t of types) {
    if (BACKUP_TYPES.has(t)) return 'backup';
  }
  return 'multi_az';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect infrastructure intents from IR resources and relationships.
 * Only returns intents that are backed by concrete resource evidence.
 */
export function detectIntents(
  resources: IrResource[],
  _relationships: IrRelationship[],
): InfraIntent[] {
  const intents: InfraIntent[] = [];

  // Networking
  const netResources = matchResources(resources, NETWORKING_TYPES);
  if (netResources.length > 0) {
    intents.push({
      kind: 'networking',
      subtype: inferNetworkingSubtype(netResources),
      resources: resourceIds(netResources),
      properties: {},
    });
  }

  // Identity
  const idResources = matchResources(resources, IDENTITY_TYPES);
  if (idResources.length > 0) {
    intents.push({
      kind: 'identity',
      subtype: inferIdentitySubtype(idResources),
      resources: resourceIds(idResources),
      properties: {},
    });
  }

  // Encryption — KMS key resources + any resource that declares encryption attributes.
  // KMS resources take precedence for subtype: if explicit key management is
  // present, the intent is 'key_management'; otherwise it is 'at_rest'.
  const kmsResources = matchResources(resources, KMS_TYPES);
  const attributeEncryptedResources = resources.filter(
    (r) => !KMS_TYPES.has(r.sourceType) && hasEncryptionAttributes(r),
  );
  const encryptionResources = [...kmsResources, ...attributeEncryptedResources];
  if (encryptionResources.length > 0) {
    intents.push({
      kind: 'encryption',
      subtype: kmsResources.length > 0 ? 'key_management' : 'at_rest',
      resources: resourceIds(encryptionResources),
      properties: {},
    });
  }

  // Scaling
  const scaleResources = matchResources(resources, SCALING_TYPES);
  if (scaleResources.length > 0) {
    intents.push({
      kind: 'scaling',
      subtype: inferScalingSubtype(scaleResources),
      resources: resourceIds(scaleResources),
      properties: {},
    });
  }

  // Resilience
  const resilResources = detectResilienceResources(resources);
  if (resilResources.length > 0) {
    intents.push({
      kind: 'resilience',
      subtype: inferResilienceSubtype(resilResources),
      resources: resourceIds(resilResources),
      properties: {},
    });
  }

  // Observability
  const obsResources = matchResources(resources, OBSERVABILITY_TYPES);
  if (obsResources.length > 0) {
    intents.push({
      kind: 'observability',
      subtype: inferObservabilitySubtype(obsResources),
      resources: resourceIds(obsResources),
      properties: {},
    });
  }

  // Secrets
  const secResources = matchResources(resources, SECRET_TYPES);
  if (secResources.length > 0) {
    intents.push({
      kind: 'secret',
      subtype: inferSecretSubtype(secResources),
      resources: resourceIds(secResources),
      properties: {},
    });
  }

  return intents;
}
