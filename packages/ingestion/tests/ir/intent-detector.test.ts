import { describe, it, expect } from 'vitest';
import { detectIntents } from '../../src/ir/intent-detector.js';
import type { IrResource, IrRelationship } from '@tla/shared';

const SOURCE_LOC = { file: 'main.tf', line: 1, column: 0 };

function makeResource(overrides: Partial<IrResource> & { id: string; sourceType: string }): IrResource {
  return {
    sourceName: overrides.id.split('.')[1] ?? overrides.id,
    sourceModule: null,
    category: 'compute',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: null,
    translationStatus: 'pending',
    confidence: 0.9,
    tags: {},
    sourceLocation: SOURCE_LOC,
    ...overrides,
  };
}

describe('detectIntents', () => {
  it('returns empty array for no resources', () => {
    expect(detectIntents([], [])).toEqual([]);
  });

  it('returns empty array for non-matching resources', () => {
    const resources = [
      makeResource({ id: 'aws_s3_bucket.data', sourceType: 'aws_s3_bucket' }),
    ];
    expect(detectIntents(resources, [])).toEqual([]);
  });

  // ---- Networking ----

  describe('networking intent', () => {
    it('detects VPC resources', () => {
      const resources = [
        makeResource({ id: 'aws_vpc.main', sourceType: 'aws_vpc' }),
        makeResource({ id: 'aws_subnet.pub', sourceType: 'aws_subnet' }),
      ];
      const intents = detectIntents(resources, []);
      const net = intents.find((i) => i.kind === 'networking');
      expect(net).toBeDefined();
      expect(net!.resources).toContain('aws_vpc.main');
      expect(net!.resources).toContain('aws_subnet.pub');
    });

    it('infers load_balancer subtype when LB present', () => {
      const resources = [
        makeResource({ id: 'aws_lb.app', sourceType: 'aws_lb' }),
        makeResource({ id: 'aws_vpc.main', sourceType: 'aws_vpc' }),
      ];
      const intents = detectIntents(resources, []);
      const net = intents.find((i) => i.kind === 'networking');
      expect(net!.subtype).toBe('load_balancer');
    });

    it('infers security_group subtype', () => {
      const resources = [
        makeResource({ id: 'aws_security_group.web', sourceType: 'aws_security_group' }),
      ];
      const intents = detectIntents(resources, []);
      expect(intents[0].subtype).toBe('security_group');
    });

    it('infers peering subtype', () => {
      const resources = [
        makeResource({ id: 'aws_vpc_peering_connection.peer', sourceType: 'aws_vpc_peering_connection' }),
      ];
      const intents = detectIntents(resources, []);
      expect(intents[0].subtype).toBe('peering');
    });

    it('infers nat subtype', () => {
      const resources = [
        makeResource({ id: 'aws_nat_gateway.nat', sourceType: 'aws_nat_gateway' }),
      ];
      const intents = detectIntents(resources, []);
      expect(intents[0].subtype).toBe('nat');
    });
  });

  // ---- Identity ----

  describe('identity intent', () => {
    it('detects IAM role resources', () => {
      const resources = [
        makeResource({ id: 'aws_iam_role.lambda', sourceType: 'aws_iam_role' }),
        makeResource({ id: 'aws_iam_policy.access', sourceType: 'aws_iam_policy' }),
      ];
      const intents = detectIntents(resources, []);
      const id = intents.find((i) => i.kind === 'identity');
      expect(id).toBeDefined();
      expect(id!.subtype).toBe('role');
    });

    it('infers user subtype', () => {
      const resources = [
        makeResource({ id: 'aws_iam_user.admin', sourceType: 'aws_iam_user' }),
      ];
      const intents = detectIntents(resources, []);
      expect(intents[0].subtype).toBe('user');
    });

    it('infers service_account subtype for instance profiles', () => {
      const resources = [
        makeResource({ id: 'aws_iam_instance_profile.ec2', sourceType: 'aws_iam_instance_profile' }),
      ];
      const intents = detectIntents(resources, []);
      expect(intents[0].subtype).toBe('service_account');
    });

    it('infers policy subtype when only aws_iam_policy present', () => {
      const resources = [
        makeResource({ id: 'aws_iam_policy.readonly', sourceType: 'aws_iam_policy' }),
      ];
      const intents = detectIntents(resources, []);
      const id = intents.find((i) => i.kind === 'identity');
      expect(id).toBeDefined();
      expect(id!.subtype).toBe('policy');
      expect(id!.resources).toEqual(['aws_iam_policy.readonly']);
    });
  });

  // ---- Encryption ----

  describe('encryption intent', () => {
    it('detects KMS key resources', () => {
      const resources = [
        makeResource({ id: 'aws_kms_key.main', sourceType: 'aws_kms_key' }),
      ];
      const intents = detectIntents(resources, []);
      const enc = intents.find((i) => i.kind === 'encryption');
      expect(enc).toBeDefined();
      expect(enc!.subtype).toBe('key_management');
    });

    it('detects encryption via resource attributes (no KMS key)', () => {
      const resources = [
        makeResource({
          id: 'aws_s3_bucket.encrypted',
          sourceType: 'aws_s3_bucket',
          attributes: { server_side_encryption: 'aws:kms' },
        }),
      ];
      const intents = detectIntents(resources, []);
      const enc = intents.find((i) => i.kind === 'encryption');
      expect(enc).toBeDefined();
      expect(enc!.subtype).toBe('at_rest');
      expect(enc!.resources).toContain('aws_s3_bucket.encrypted');
    });

    it('detects encryption via sourceAttributes kms_key_id', () => {
      const resources = [
        makeResource({
          id: 'aws_ebs_volume.data',
          sourceType: 'aws_ebs_volume',
          sourceAttributes: { kms_key_id: 'arn:aws:kms:...' },
        }),
      ];
      const intents = detectIntents(resources, []);
      const enc = intents.find((i) => i.kind === 'encryption');
      expect(enc).toBeDefined();
    });

    it('includes both KMS and encrypted resources', () => {
      const resources = [
        makeResource({ id: 'aws_kms_key.main', sourceType: 'aws_kms_key' }),
        makeResource({
          id: 'aws_rds_cluster.db',
          sourceType: 'aws_rds_cluster',
          attributes: { kms_key_id: 'arn:...' },
        }),
      ];
      const intents = detectIntents(resources, []);
      const enc = intents.find((i) => i.kind === 'encryption');
      expect(enc!.resources).toHaveLength(2);
      expect(enc!.subtype).toBe('key_management');
    });
  });

  // ---- Scaling ----

  describe('scaling intent', () => {
    it('detects autoscaling group', () => {
      const resources = [
        makeResource({ id: 'aws_autoscaling_group.web', sourceType: 'aws_autoscaling_group' }),
      ];
      const intents = detectIntents(resources, []);
      const scale = intents.find((i) => i.kind === 'scaling');
      expect(scale).toBeDefined();
      expect(scale!.subtype).toBe('auto_scaling');
    });

    it('infers application_scaling subtype', () => {
      const resources = [
        makeResource({ id: 'aws_appautoscaling_target.ecs', sourceType: 'aws_appautoscaling_target' }),
      ];
      const intents = detectIntents(resources, []);
      expect(intents[0].subtype).toBe('application_scaling');
    });

    it('infers scheduled subtype', () => {
      const resources = [
        makeResource({ id: 'aws_autoscaling_schedule.night', sourceType: 'aws_autoscaling_schedule' }),
      ];
      const intents = detectIntents(resources, []);
      expect(intents[0].subtype).toBe('scheduled');
    });
  });

  // ---- Resilience ----

  describe('resilience intent', () => {
    it('detects backup resources', () => {
      const resources = [
        makeResource({ id: 'aws_backup_plan.daily', sourceType: 'aws_backup_plan' }),
      ];
      const intents = detectIntents(resources, []);
      const res = intents.find((i) => i.kind === 'resilience');
      expect(res).toBeDefined();
      expect(res!.subtype).toBe('backup');
    });

    it('detects multi_az from attributes', () => {
      const resources = [
        makeResource({
          id: 'aws_db_instance.primary',
          sourceType: 'aws_db_instance',
          attributes: { multi_az: true },
        }),
      ];
      const intents = detectIntents(resources, []);
      const res = intents.find((i) => i.kind === 'resilience');
      expect(res).toBeDefined();
      expect(res!.subtype).toBe('multi_az');
    });

    it('detects availability_zones attribute', () => {
      const resources = [
        makeResource({
          id: 'aws_autoscaling_group.web',
          sourceType: 'aws_autoscaling_group',
          sourceAttributes: { availability_zones: ['us-east-1a', 'us-east-1b'] },
        }),
      ];
      const intents = detectIntents(resources, []);
      // scaling + resilience
      const res = intents.find((i) => i.kind === 'resilience');
      expect(res).toBeDefined();
    });
  });

  // ---- Observability ----

  describe('observability intent', () => {
    it('detects CloudWatch alarms', () => {
      const resources = [
        makeResource({ id: 'aws_cloudwatch_metric_alarm.cpu', sourceType: 'aws_cloudwatch_metric_alarm' }),
      ];
      const intents = detectIntents(resources, []);
      const obs = intents.find((i) => i.kind === 'observability');
      expect(obs).toBeDefined();
      expect(obs!.subtype).toBe('alerting');
    });

    it('detects CloudWatch log groups as logging', () => {
      const resources = [
        makeResource({ id: 'aws_cloudwatch_log_group.app', sourceType: 'aws_cloudwatch_log_group' }),
      ];
      const intents = detectIntents(resources, []);
      expect(intents[0].subtype).toBe('logging');
    });

    it('detects X-Ray as tracing', () => {
      const resources = [
        makeResource({ id: 'aws_xray_sampling_rule.default', sourceType: 'aws_xray_sampling_rule' }),
      ];
      const intents = detectIntents(resources, []);
      expect(intents[0].subtype).toBe('tracing');
    });

    it('infers monitoring subtype for aws_cloudwatch_dashboard only', () => {
      const resources = [
        makeResource({ id: 'aws_cloudwatch_dashboard.main', sourceType: 'aws_cloudwatch_dashboard' }),
      ];
      const intents = detectIntents(resources, []);
      const obs = intents.find((i) => i.kind === 'observability');
      expect(obs).toBeDefined();
      expect(obs!.subtype).toBe('monitoring');
      expect(obs!.resources).toEqual(['aws_cloudwatch_dashboard.main']);
    });
  });

  // ---- Secret ----

  describe('secret intent', () => {
    it('detects Secrets Manager resources', () => {
      const resources = [
        makeResource({ id: 'aws_secretsmanager_secret.db', sourceType: 'aws_secretsmanager_secret' }),
      ];
      const intents = detectIntents(resources, []);
      const sec = intents.find((i) => i.kind === 'secret');
      expect(sec).toBeDefined();
      expect(sec!.subtype).toBe('secret_store');
    });

    it('detects SSM parameters as parameter_store', () => {
      const resources = [
        makeResource({ id: 'aws_ssm_parameter.config', sourceType: 'aws_ssm_parameter' }),
      ];
      const intents = detectIntents(resources, []);
      expect(intents[0].subtype).toBe('parameter_store');
    });
  });

  // ---- Multiple intents ----

  describe('multiple intents', () => {
    it('detects multiple intent types from mixed resources', () => {
      const resources = [
        makeResource({ id: 'aws_vpc.main', sourceType: 'aws_vpc' }),
        makeResource({ id: 'aws_iam_role.lambda', sourceType: 'aws_iam_role' }),
        makeResource({ id: 'aws_kms_key.main', sourceType: 'aws_kms_key' }),
        makeResource({ id: 'aws_cloudwatch_log_group.app', sourceType: 'aws_cloudwatch_log_group' }),
        makeResource({ id: 'aws_secretsmanager_secret.db', sourceType: 'aws_secretsmanager_secret' }),
      ];
      const intents = detectIntents(resources, []);
      const kinds = intents.map((i) => i.kind);
      expect(kinds).toContain('networking');
      expect(kinds).toContain('identity');
      expect(kinds).toContain('encryption');
      expect(kinds).toContain('observability');
      expect(kinds).toContain('secret');
    });
  });
});
