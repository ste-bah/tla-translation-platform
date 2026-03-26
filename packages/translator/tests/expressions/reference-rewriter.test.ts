import { describe, it, expect } from 'vitest';
import {
  buildReferenceMap,
  rewriteReference,
} from '../../src/expressions/reference-rewriter.js';
import type { ExpressionContext, ReferenceMap } from '../../src/expressions/types.js';
import type { CloudProvider } from '@tla/shared';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeCtx(target: CloudProvider = 'azure', refMap?: ReferenceMap): ExpressionContext {
  return {
    referenceMap: refMap ?? buildReferenceMap(),
    target,
  };
}

// ---------------------------------------------------------------------------
// buildReferenceMap
// ---------------------------------------------------------------------------

describe('buildReferenceMap', () => {
  const refMap = buildReferenceMap();

  // --- 24. Returns ReferenceMap with all expected maps -------------------

  it('returns a ReferenceMap with resourceTypeMap, attributeMap, and outputMap', () => {
    expect(refMap.resourceTypeMap).toBeInstanceOf(Map);
    expect(refMap.attributeMap).toBeInstanceOf(Map);
    expect(refMap.outputMap).toBeInstanceOf(Map);
  });

  // --- 25. resourceTypeMap has entries for all major AWS types -----------

  it('contains all major AWS resource types in resourceTypeMap', () => {
    const expectedTypes = [
      // Direct engine (P1)
      'aws_s3_bucket',
      'aws_ecr_repository',
      'aws_elasticache_replication_group',
      'aws_route53_zone',
      'aws_route53_record',
      'aws_vpc_peering_connection',
      // Parametric engine (P2)
      'aws_vpc',
      'aws_subnet',
      'aws_nat_gateway',
      'aws_kms_key',
      'aws_secretsmanager_secret',
      'aws_eks_cluster',
      // Compound engine
      'aws_instance',
      'aws_autoscaling_group',
      'aws_lb',
      'aws_db_instance',
      // Structural engine
      'aws_security_group',
      'aws_lambda_function',
      'aws_ecs_service',
      'aws_sqs_queue',
      'aws_sns_topic',
      'aws_cloudwatch_metric_alarm',
      'aws_cloudwatch_log_group',
    ];

    for (const awsType of expectedTypes) {
      expect(
        refMap.resourceTypeMap.has(awsType),
        `Expected resourceTypeMap to contain '${awsType}'`,
      ).toBe(true);
      const entry = refMap.resourceTypeMap.get(awsType)!;
      expect(entry).toHaveProperty('azure');
      expect(entry).toHaveProperty('gcp');
    }
  });

  // --- 26. attributeMap has per-type attribute renames --------------------

  it('contains per-type attribute renames in attributeMap', () => {
    // aws_instance attrs
    const instanceAttrs = refMap.attributeMap.get('aws_instance');
    expect(instanceAttrs).toBeDefined();
    expect(instanceAttrs!.has('instance_type')).toBe(true);
    expect(instanceAttrs!.has('ami')).toBe(true);
    expect(instanceAttrs!.has('subnet_id')).toBe(true);
    expect(instanceAttrs!.has('private_ip')).toBe(true);
    expect(instanceAttrs!.get('instance_type')!.azure).toBe('size');
    expect(instanceAttrs!.get('instance_type')!.gcp).toBe('machine_type');

    // aws_vpc attrs
    const vpcAttrs = refMap.attributeMap.get('aws_vpc');
    expect(vpcAttrs).toBeDefined();
    expect(vpcAttrs!.has('cidr_block')).toBe(true);

    // aws_subnet attrs
    const subnetAttrs = refMap.attributeMap.get('aws_subnet');
    expect(subnetAttrs).toBeDefined();
    expect(subnetAttrs!.has('cidr_block')).toBe(true);
    expect(subnetAttrs!.has('availability_zone')).toBe(true);

    // aws_s3_bucket attrs
    const s3Attrs = refMap.attributeMap.get('aws_s3_bucket');
    expect(s3Attrs).toBeDefined();
    expect(s3Attrs!.has('bucket')).toBe(true);
    expect(s3Attrs!.has('acl')).toBe(true);

    // aws_security_group attrs
    const sgAttrs = refMap.attributeMap.get('aws_security_group');
    expect(sgAttrs).toBeDefined();
    expect(sgAttrs!.has('vpc_id')).toBe(true);

    // aws_db_instance attrs
    const dbAttrs = refMap.attributeMap.get('aws_db_instance');
    expect(dbAttrs).toBeDefined();
    expect(dbAttrs!.has('engine')).toBe(true);
    expect(dbAttrs!.has('instance_class')).toBe(true);
    expect(dbAttrs!.has('allocated_storage')).toBe(true);
  });

  // --- 27. outputMap has module output renames ----------------------------

  it('contains module output renames in outputMap', () => {
    expect(refMap.outputMap.has('vpc_id')).toBe(true);
    expect(refMap.outputMap.get('vpc_id')!.azure).toBe('vnet_id');
    expect(refMap.outputMap.get('vpc_id')!.gcp).toBe('network_id');

    expect(refMap.outputMap.has('subnet_id')).toBe(true);
    expect(refMap.outputMap.has('cluster_endpoint')).toBe(true);
    expect(refMap.outputMap.has('cluster_ca_certificate')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rewriteReference
// ---------------------------------------------------------------------------

describe('rewriteReference', () => {
  // --- 28. Simple resource ref rewrites type -----------------------------

  it('rewrites resource type for Azure', () => {
    const result = rewriteReference('aws_instance.web.id', makeCtx('azure'));
    expect(result.rewritten).toBe('azurerm_linux_virtual_machine.web.id');
    expect(result.findings).toHaveLength(0);
  });

  it('rewrites resource type for GCP', () => {
    const result = rewriteReference('aws_s3_bucket.logs.id', makeCtx('gcp'));
    expect(result.rewritten).toBe('google_storage_bucket.logs.id');
    expect(result.findings).toHaveLength(0);
  });

  // --- 29. Attribute rename works ----------------------------------------

  it('renames attribute according to attributeMap', () => {
    const result = rewriteReference('aws_instance.web.private_ip', makeCtx('azure'));
    expect(result.rewritten).toBe('azurerm_linux_virtual_machine.web.private_ip_address');
  });

  it('renames attribute for GCP', () => {
    const result = rewriteReference('aws_instance.web.instance_type', makeCtx('gcp'));
    expect(result.rewritten).toBe('google_compute_instance.web.machine_type');
  });

  it('preserves attribute when no rename mapping exists', () => {
    // "id" has no explicit attribute mapping — it should pass through unchanged
    const result = rewriteReference('aws_vpc.main.id', makeCtx('azure'));
    expect(result.rewritten).toBe('azurerm_virtual_network.main.id');
    expect(result.findings).toHaveLength(0);
  });

  // --- 30. Indexed ref preserves brackets --------------------------------

  it('preserves numeric index bracket in rewritten reference', () => {
    const result = rewriteReference('aws_instance.web[0].id', makeCtx('azure'));
    expect(result.rewritten).toBe('azurerm_linux_virtual_machine.web[0].id');
  });

  it('preserves splat [*] in rewritten reference', () => {
    const result = rewriteReference('aws_instance.web[*].id', makeCtx('azure'));
    expect(result.rewritten).toBe('azurerm_linux_virtual_machine.web[*].id');
  });

  it('preserves count.index bracket expression', () => {
    const result = rewriteReference('aws_subnet.sub[count.index].id', makeCtx('azure'));
    expect(result.rewritten).toBe('azurerm_subnet.sub[count.index].id');
  });

  // --- 31. Module ref rewrites output name -------------------------------

  it('rewrites module output vpc_id to Azure vnet_id', () => {
    const result = rewriteReference('module.vpc.vpc_id', makeCtx('azure'));
    expect(result.rewritten).toBe('module.vpc.vnet_id');
    expect(result.findings).toHaveLength(0);
  });

  it('rewrites module output vpc_id to GCP network_id', () => {
    const result = rewriteReference('module.vpc.vpc_id', makeCtx('gcp'));
    expect(result.rewritten).toBe('module.vpc.network_id');
  });

  it('rewrites module output cluster_endpoint', () => {
    const result = rewriteReference('module.eks.cluster_endpoint', makeCtx('azure'));
    expect(result.rewritten).toBe('module.eks.kube_config.0.host');
  });

  // --- 32. Unknown type -> warning finding + original --------------------

  it('returns original with warning for unknown resource type', () => {
    const result = rewriteReference('aws_imaginary_service.foo.id', makeCtx('azure'));
    expect(result.rewritten).toBe('aws_imaginary_service.foo.id');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.code).toBe('UNKNOWN_REF_TYPE');
    expect(result.findings[0]!.severity).toBe('warning');
    expect(result.findings[0]!.message).toContain('aws_imaginary_service');
  });

  // --- 33. Missing attribute -> original attribute preserved -------------

  it('preserves original attribute when no attribute mapping exists', () => {
    // aws_instance has no mapping for "tags" attribute
    const result = rewriteReference('aws_instance.web.tags', makeCtx('azure'));
    expect(result.rewritten).toBe('azurerm_linux_virtual_machine.web.tags');
    expect(result.findings).toHaveLength(0);
  });

  // --- Additional edge cases ---------------------------------------------

  it('returns data ref as-is (data refs handled by mapDataSource)', () => {
    // rewriteReference delegates data refs to rewriteDataRef which returns as-is
    const result = rewriteReference('data.aws_caller_identity.current.account_id', makeCtx('azure'));
    expect(result.rewritten).toBe('data.aws_caller_identity.current.account_id');
    expect(result.findings).toHaveLength(0);
  });

  it('handles reference without attribute tail', () => {
    // aws_instance.web (no attribute) — should rewrite type only
    const result = rewriteReference('aws_instance.web', makeCtx('azure'));
    expect(result.rewritten).toBe('azurerm_linux_virtual_machine.web');
  });

  it('returns non-recognised reference shape as-is', () => {
    // single segment — not a valid ref pattern
    const result = rewriteReference('just_a_name', makeCtx('azure'));
    expect(result.rewritten).toBe('just_a_name');
    expect(result.findings).toHaveLength(0);
  });

  it('handles module ref with unknown output by preserving original', () => {
    const result = rewriteReference('module.custom.custom_output', makeCtx('azure'));
    expect(result.rewritten).toBe('module.custom.custom_output');
    expect(result.findings).toHaveLength(0);
  });

  it('rewrites all structural engine types correctly', () => {
    const cases: Array<{ input: string; azure: string; gcp: string }> = [
      {
        input: 'aws_security_group.sg.id',
        azure: 'azurerm_network_security_group.sg.id',
        gcp: 'google_compute_firewall.sg.id',
      },
      {
        input: 'aws_lambda_function.fn.arn',
        azure: 'azurerm_linux_function_app.fn.arn',
        gcp: 'google_cloudfunctions2_function.fn.arn',
      },
      {
        input: 'aws_ecs_service.svc.id',
        azure: 'azurerm_container_app.svc.id',
        gcp: 'google_cloud_run_v2_service.svc.id',
      },
      {
        input: 'aws_sqs_queue.q.arn',
        azure: 'azurerm_servicebus_queue.q.arn',
        gcp: 'google_pubsub_topic.q.arn',
      },
    ];

    for (const { input, azure, gcp } of cases) {
      const azResult = rewriteReference(input, makeCtx('azure'));
      expect(azResult.rewritten).toBe(azure);

      const gcpResult = rewriteReference(input, makeCtx('gcp'));
      expect(gcpResult.rewritten).toBe(gcp);
    }
  });

  it('rewrites parametric engine types correctly', () => {
    const result = rewriteReference('aws_eks_cluster.main.id', makeCtx('azure'));
    expect(result.rewritten).toBe('azurerm_kubernetes_cluster.main.id');

    const gcpResult = rewriteReference('aws_eks_cluster.main.id', makeCtx('gcp'));
    expect(gcpResult.rewritten).toBe('google_container_cluster.main.id');
  });

  it('rewrites aws_subnet cidr_block attribute for Azure', () => {
    const result = rewriteReference('aws_subnet.main.cidr_block', makeCtx('azure'));
    expect(result.rewritten).toBe('azurerm_subnet.main.address_prefixes');
  });

  it('rewrites aws_subnet cidr_block attribute for GCP', () => {
    const result = rewriteReference('aws_subnet.main.cidr_block', makeCtx('gcp'));
    expect(result.rewritten).toBe('google_compute_subnetwork.main.ip_cidr_range');
  });

  it('rewrites aws_db_instance allocated_storage for Azure', () => {
    const result = rewriteReference('aws_db_instance.db.allocated_storage', makeCtx('azure'));
    expect(result.rewritten).toBe('azurerm_postgresql_flexible_server.db.storage_mb');
  });

  it('rewrites aws_security_group vpc_id for GCP', () => {
    const result = rewriteReference('aws_security_group.sg.vpc_id', makeCtx('gcp'));
    expect(result.rewritten).toBe('google_compute_firewall.sg.network');
  });
});
