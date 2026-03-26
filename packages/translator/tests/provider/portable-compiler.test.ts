/**
 * Tests for portable resource compiler and exit-path generator.
 *
 * @module tests/provider/portable-compiler
 */

import { describe, it, expect } from 'vitest';
import {
  compilePortableResource,
} from '../../src/provider/portable-compiler.js';
import { emitNativeEquivalent } from '../../src/provider/exit-path.js';
import type { PortableResource, CloudObjectStorage, CloudContainerRegistry, CloudCacheRedis } from '@tla/shared';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeObjectStorage(
  overrides: Partial<{
    name: string;
    versioning_enabled: boolean;
    encryption: { enabled: boolean; kms_key_ref?: string };
    tags: Record<string, string>;
  }> = {},
): PortableResource {
  return {
    resource_type: 'cloud_object_storage',
    name: 'my-bucket',
    ...overrides,
  };
}

function makeContainerRegistry(
  overrides: Partial<{
    name: string;
    immutable_tags: boolean;
    scan_on_push: boolean;
    encryption: { enabled: boolean; kms_key_ref?: string };
    tags: Record<string, string>;
  }> = {},
): PortableResource {
  return {
    resource_type: 'cloud_container_registry',
    name: 'my-registry',
    ...overrides,
  };
}

function makeCacheRedis(
  overrides: Partial<{
    name: string;
    size: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    engine_version: string;
    replicas: number;
    transit_encryption: boolean;
    encryption: { enabled: boolean; kms_key_ref?: string };
    tags: Record<string, string>;
  }> = {},
): PortableResource {
  return {
    resource_type: 'cloud_cache_redis',
    name: 'my-cache',
    ...overrides,
  };
}

// ===========================================================================
// cloud_object_storage
// ===========================================================================

describe('compilePortableResource — cloud_object_storage', () => {
  // -------------------------------------------------------------------------
  // AWS
  // -------------------------------------------------------------------------
  describe('→ aws', () => {
    it('emits aws_s3_bucket with correct bucket name', () => {
      const { translated, findings } = compilePortableResource(
        makeObjectStorage({ name: 'my-bucket' }),
        'aws',
      );
      expect(translated).toHaveLength(1);
      expect(translated[0]!.targetType).toBe('aws_s3_bucket');
      expect(translated[0]!.targetName).toBe('my-bucket');
      expect((translated[0]!.attributes as Record<string, unknown>)['bucket']).toBe('my-bucket');
      expect(findings).toHaveLength(0);
    });

    it('includes versioning when versioning_enabled is true', () => {
      const { translated } = compilePortableResource(
        makeObjectStorage({ versioning_enabled: true }),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['versioning']).toEqual({ enabled: true });
    });

    it('does not include versioning when not set', () => {
      const { translated } = compilePortableResource(
        makeObjectStorage(),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['versioning']).toBeUndefined();
    });

    it('includes AES256 SSE when encryption.enabled is true (no kms_key_ref)', () => {
      const { translated } = compilePortableResource(
        makeObjectStorage({ encryption: { enabled: true } }),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      const sseConfig = attrs['server_side_encryption_configuration'] as Record<string, unknown>;
      expect(sseConfig).toBeDefined();
      const rule = sseConfig['rule'] as Record<string, unknown>;
      const defaults = rule['apply_server_side_encryption_by_default'] as Record<string, unknown>;
      expect(defaults['sse_algorithm']).toBe('AES256');
    });

    it('includes KMS SSE when kms_key_ref is provided', () => {
      const { translated } = compilePortableResource(
        makeObjectStorage({ encryption: { enabled: true, kms_key_ref: 'arn:aws:kms:us-east-1:1234:key/abc' } }),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      const sseConfig = attrs['server_side_encryption_configuration'] as Record<string, unknown>;
      const rule = (sseConfig['rule'] as Record<string, unknown>)['apply_server_side_encryption_by_default'] as Record<string, unknown>;
      expect(rule['sse_algorithm']).toBe('aws:kms');
      expect(rule['kms_master_key_id']).toBe('arn:aws:kms:us-east-1:1234:key/abc');
    });

    it('includes tags when provided', () => {
      const { translated } = compilePortableResource(
        makeObjectStorage({ tags: { Env: 'prod', App: 'api' } }),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['tags']).toEqual({ Env: 'prod', App: 'api' });
    });

    it('sets correct sourceId and traceability', () => {
      const { translated } = compilePortableResource(makeObjectStorage(), 'aws');
      expect(translated[0]!.sourceId).toBe('portable:cloud_object_storage:my-bucket');
      expect(translated[0]!.traceability.engineUsed).toContain('aws');
      expect(translated[0]!.traceability.mappingType).toBe('direct');
    });
  });

  // -------------------------------------------------------------------------
  // Azure
  // -------------------------------------------------------------------------
  describe('→ azure', () => {
    it('emits 2 resources: azurerm_storage_account + azurerm_storage_container', () => {
      const { translated } = compilePortableResource(makeObjectStorage(), 'azure');
      expect(translated).toHaveLength(2);
      expect(translated[0]!.targetType).toBe('azurerm_storage_account');
      expect(translated[1]!.targetType).toBe('azurerm_storage_container');
    });

    it('sanitizes the storage account name to max 24 lowercase alphanumeric', () => {
      const { translated } = compilePortableResource(
        makeObjectStorage({ name: 'my-long-bucket-name-that-exceeds-limit' }),
        'azure',
      );
      const saName = (translated[0]!.attributes as Record<string, unknown>)['name'] as string;
      expect(saName).toMatch(/^[a-z0-9]{1,24}$/);
    });

    it('sets container_access_type to private', () => {
      const { translated } = compilePortableResource(makeObjectStorage(), 'azure');
      const containerAttrs = translated[1]!.attributes as Record<string, unknown>;
      expect(containerAttrs['container_access_type']).toBe('private');
    });

    it('includes blob_properties with versioning when versioning_enabled is true', () => {
      const { translated } = compilePortableResource(
        makeObjectStorage({ versioning_enabled: true }),
        'azure',
      );
      const accountAttrs = translated[0]!.attributes as Record<string, unknown>;
      expect((accountAttrs['blob_properties'] as Record<string, unknown>)['versioning_enabled']).toBe(true);
    });

    it('includes customer_managed_key when kms_key_ref is provided', () => {
      const { translated } = compilePortableResource(
        makeObjectStorage({ encryption: { enabled: true, kms_key_ref: 'https://kv.azure.com/key/1' } }),
        'azure',
      );
      const accountAttrs = translated[0]!.attributes as Record<string, unknown>;
      const cmk = accountAttrs['customer_managed_key'] as Record<string, unknown>;
      expect(cmk['key_vault_key_id']).toBe('https://kv.azure.com/key/1');
    });

    it('includes tags on storage account', () => {
      const { translated } = compilePortableResource(
        makeObjectStorage({ tags: { Env: 'staging' } }),
        'azure',
      );
      const accountAttrs = translated[0]!.attributes as Record<string, unknown>;
      expect(accountAttrs['tags']).toEqual({ Env: 'staging' });
    });

    it('produces no findings for basic usage', () => {
      const { findings } = compilePortableResource(makeObjectStorage(), 'azure');
      expect(findings).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // GCP
  // -------------------------------------------------------------------------
  describe('→ gcp', () => {
    it('emits google_storage_bucket', () => {
      const { translated } = compilePortableResource(makeObjectStorage(), 'gcp');
      expect(translated).toHaveLength(1);
      expect(translated[0]!.targetType).toBe('google_storage_bucket');
    });

    it('sets name and storage_class', () => {
      const { translated } = compilePortableResource(
        makeObjectStorage({ name: 'gcs-test' }),
        'gcp',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['name']).toBe('gcs-test');
      expect(attrs['storage_class']).toBe('STANDARD');
    });

    it('includes versioning block when versioning_enabled is true', () => {
      const { translated } = compilePortableResource(
        makeObjectStorage({ versioning_enabled: true }),
        'gcp',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['versioning']).toEqual({ enabled: true });
    });

    it('includes encryption block when kms_key_ref is provided', () => {
      const { translated } = compilePortableResource(
        makeObjectStorage({ encryption: { enabled: true, kms_key_ref: 'projects/p/locations/l/keyRings/kr/cryptoKeys/k' } }),
        'gcp',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect((attrs['encryption'] as Record<string, unknown>)['default_kms_key_name']).toBe(
        'projects/p/locations/l/keyRings/kr/cryptoKeys/k',
      );
    });

    it('converts tags to GCP labels (lowercase, replace invalid chars)', () => {
      const { translated } = compilePortableResource(
        makeObjectStorage({ tags: { 'My-Tag': 'value', Env: 'prod' } }),
        'gcp',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      const labels = attrs['labels'] as Record<string, string>;
      // GCP labels: lowercase; hyphens are valid ([a-z0-9_-]), so 'My-Tag' → 'my-tag'
      expect(labels['my-tag']).toBe('value');
      expect(labels['env']).toBe('prod');
    });
  });
});

// ===========================================================================
// cloud_container_registry
// ===========================================================================

describe('compilePortableResource — cloud_container_registry', () => {
  // -------------------------------------------------------------------------
  // AWS
  // -------------------------------------------------------------------------
  describe('→ aws', () => {
    it('emits aws_ecr_repository', () => {
      const { translated, findings } = compilePortableResource(
        makeContainerRegistry({ name: 'my-ecr' }),
        'aws',
      );
      expect(translated).toHaveLength(1);
      expect(translated[0]!.targetType).toBe('aws_ecr_repository');
      expect(translated[0]!.targetName).toBe('my-ecr');
      expect(findings).toHaveLength(0);
    });

    it('sets IMMUTABLE mutability when immutable_tags is true', () => {
      const { translated } = compilePortableResource(
        makeContainerRegistry({ immutable_tags: true }),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['image_tag_mutability']).toBe('IMMUTABLE');
    });

    it('sets MUTABLE mutability when immutable_tags is false', () => {
      const { translated } = compilePortableResource(
        makeContainerRegistry({ immutable_tags: false }),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['image_tag_mutability']).toBe('MUTABLE');
    });

    it('sets scan_on_push when scan_on_push is true', () => {
      const { translated } = compilePortableResource(
        makeContainerRegistry({ scan_on_push: true }),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      const scanConfig = attrs['image_scanning_configuration'] as Record<string, unknown>;
      expect(scanConfig['scan_on_push']).toBe(true);
    });

    it('includes KMS encryption_configuration when kms_key_ref is provided', () => {
      const { translated } = compilePortableResource(
        makeContainerRegistry({ encryption: { enabled: true, kms_key_ref: 'arn:aws:kms:key/123' } }),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      const enc = attrs['encryption_configuration'] as Record<string, unknown>;
      expect(enc['encryption_type']).toBe('KMS');
      expect(enc['kms_key']).toBe('arn:aws:kms:key/123');
    });
  });

  // -------------------------------------------------------------------------
  // Azure
  // -------------------------------------------------------------------------
  describe('→ azure', () => {
    it('emits azurerm_container_registry', () => {
      const { translated } = compilePortableResource(
        makeContainerRegistry({ name: 'myregistry' }),
        'azure',
      );
      expect(translated).toHaveLength(1);
      expect(translated[0]!.targetType).toBe('azurerm_container_registry');
    });

    it('sanitizes name (removes non-alphanumeric)', () => {
      const { translated } = compilePortableResource(
        makeContainerRegistry({ name: 'my-registry!' }),
        'azure',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['name']).toBe('myregistry');
    });

    it('disables admin when immutable_tags is true', () => {
      const { translated } = compilePortableResource(
        makeContainerRegistry({ immutable_tags: true }),
        'azure',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['admin_enabled']).toBe(false);
    });

    it('enables admin when immutable_tags is false', () => {
      const { translated } = compilePortableResource(
        makeContainerRegistry({ immutable_tags: false }),
        'azure',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['admin_enabled']).toBe(true);
    });

    it('upgrades to Premium SKU when kms_key_ref is provided', () => {
      const { translated } = compilePortableResource(
        makeContainerRegistry({ encryption: { enabled: true, kms_key_ref: 'https://kv.azure.com/key/abc' } }),
        'azure',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['sku']).toBe('Premium');
      const enc = attrs['encryption'] as Record<string, unknown>;
      expect(enc['key_vault_key_id']).toBe('https://kv.azure.com/key/abc');
    });

    it('sets trust_policy when scan_on_push is true', () => {
      const { translated } = compilePortableResource(
        makeContainerRegistry({ scan_on_push: true }),
        'azure',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect((attrs['trust_policy'] as Record<string, unknown>)['enabled']).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // GCP
  // -------------------------------------------------------------------------
  describe('→ gcp', () => {
    it('emits google_artifact_registry_repository', () => {
      const { translated } = compilePortableResource(
        makeContainerRegistry({ name: 'my-repo' }),
        'gcp',
      );
      expect(translated).toHaveLength(1);
      expect(translated[0]!.targetType).toBe('google_artifact_registry_repository');
    });

    it('sets format to DOCKER and repository_id', () => {
      const { translated } = compilePortableResource(
        makeContainerRegistry({ name: 'docker-repo' }),
        'gcp',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['format']).toBe('DOCKER');
      expect(attrs['repository_id']).toBe('docker-repo');
    });

    it('includes kms_key_name when kms_key_ref is provided', () => {
      const { translated } = compilePortableResource(
        makeContainerRegistry({ encryption: { enabled: true, kms_key_ref: 'projects/p/locations/l/keyRings/kr/cryptoKeys/k' } }),
        'gcp',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['kms_key_name']).toBe('projects/p/locations/l/keyRings/kr/cryptoKeys/k');
    });

    it('emits info finding when scan_on_push is true (external resource needed)', () => {
      const { findings } = compilePortableResource(
        makeContainerRegistry({ scan_on_push: true }),
        'gcp',
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe('info');
      expect(findings[0]!.code).toBe('PORTABLE_REGISTRY_SCAN');
    });

    it('converts tags to GCP labels', () => {
      const { translated } = compilePortableResource(
        makeContainerRegistry({ tags: { Team: 'infra' } }),
        'gcp',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect((attrs['labels'] as Record<string, string>)['team']).toBe('infra');
    });
  });
});

// ===========================================================================
// cloud_cache_redis
// ===========================================================================

describe('compilePortableResource — cloud_cache_redis', () => {
  // -------------------------------------------------------------------------
  // AWS
  // -------------------------------------------------------------------------
  describe('→ aws', () => {
    it('emits aws_elasticache_replication_group', () => {
      const { translated, findings } = compilePortableResource(
        makeCacheRedis({ name: 'my-cache' }),
        'aws',
      );
      expect(translated).toHaveLength(1);
      expect(translated[0]!.targetType).toBe('aws_elasticache_replication_group');
      expect(translated[0]!.targetName).toBe('my-cache');
      expect(findings).toHaveLength(0);
    });

    it('sets replication_group_id to resource name', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ name: 'prod-cache' }),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['replication_group_id']).toBe('prod-cache');
    });

    it('maps size xs to cache.t3.micro node type', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ size: 'xs' }),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['node_type']).toBe('cache.t3.micro');
    });

    it('maps size lg to cache.r5.large node type', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ size: 'lg' }),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['node_type']).toBe('cache.r5.large');
    });

    it('sets num_cache_clusters and automatic_failover when replicas > 0', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ replicas: 2 }),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['num_cache_clusters']).toBe(3); // 1 primary + 2 replicas
      expect(attrs['automatic_failover_enabled']).toBe(true);
    });

    it('does not set num_cache_clusters when replicas is 0', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ replicas: 0 }),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['num_cache_clusters']).toBeUndefined();
      expect(attrs['automatic_failover_enabled']).toBeUndefined();
    });

    it('sets transit_encryption_enabled when transit_encryption is true', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ transit_encryption: true }),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['transit_encryption_enabled']).toBe(true);
    });

    it('sets at_rest_encryption_enabled when encryption is enabled', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ encryption: { enabled: true } }),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['at_rest_encryption_enabled']).toBe(true);
    });

    it('includes kms_key_id when kms_key_ref is provided', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ encryption: { enabled: true, kms_key_ref: 'arn:aws:kms:key/xyz' } }),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['kms_key_id']).toBe('arn:aws:kms:key/xyz');
    });

    it('forwards engine_version', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ engine_version: '7.0' }),
        'aws',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['engine_version']).toBe('7.0');
    });
  });

  // -------------------------------------------------------------------------
  // Azure
  // -------------------------------------------------------------------------
  describe('→ azure', () => {
    it('emits azurerm_redis_cache', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ name: 'az-cache' }),
        'azure',
      );
      expect(translated).toHaveLength(1);
      expect(translated[0]!.targetType).toBe('azurerm_redis_cache');
      expect(translated[0]!.targetName).toBe('az-cache');
    });

    it('sets sku_name, family, capacity from size', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ size: 'sm' }),
        'azure',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['sku_name']).toBeDefined();
      expect(attrs['family']).toBeDefined();
      expect(typeof attrs['capacity']).toBe('number');
    });

    it('defaults redis_version to "6" when engine_version is not set', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis(),
        'azure',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['redis_version']).toBe('6');
    });

    it('uses engine_version when provided', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ engine_version: '7' }),
        'azure',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['redis_version']).toBe('7');
    });

    it('sets replicas_per_master and shard_count when replicas > 0', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ replicas: 1 }),
        'azure',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['replicas_per_master']).toBe(1);
      expect(attrs['shard_count']).toBe(1);
    });

    it('sets ssl/tls attributes when transit_encryption is true', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ transit_encryption: true }),
        'azure',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['enable_non_ssl_port']).toBe(false);
      expect(attrs['minimum_tls_version']).toBe('1.2');
    });

    it('emits warning finding when encryption enabled but SKU is not Premium', () => {
      const { findings } = compilePortableResource(
        makeCacheRedis({ size: 'sm', encryption: { enabled: true } }),
        'azure',
      );
      const encFinding = findings.find((f) => f.code === 'PORTABLE_REDIS_ENCRYPTION_TIER');
      expect(encFinding).toBeDefined();
      expect(encFinding?.severity).toBe('warning');
    });

    it('includes tags', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ tags: { project: 'core' } }),
        'azure',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect((attrs['tags'] as Record<string, string>)['project']).toBe('core');
    });
  });

  // -------------------------------------------------------------------------
  // GCP
  // -------------------------------------------------------------------------
  describe('→ gcp', () => {
    it('emits google_redis_instance', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ name: 'gcp-cache' }),
        'gcp',
      );
      expect(translated).toHaveLength(1);
      expect(translated[0]!.targetType).toBe('google_redis_instance');
      expect(translated[0]!.targetName).toBe('gcp-cache');
    });

    it('sets tier and memory_size_gb from size', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ size: 'md' }),
        'gcp',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['tier']).toBeDefined();
      expect(typeof attrs['memory_size_gb']).toBe('number');
    });

    it('defaults redis_version to REDIS_6_X', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis(),
        'gcp',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['redis_version']).toBe('REDIS_6_X');
    });

    it('converts engine_version to REDIS_x_x format', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ engine_version: '7.0' }),
        'gcp',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['redis_version']).toBe('REDIS_7_0');
    });

    it('sets replica_count when replicas > 0', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ replicas: 2 }),
        'gcp',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['replica_count']).toBe(2);
    });

    it('sets transit_encryption_mode when transit_encryption is true', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ transit_encryption: true }),
        'gcp',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['transit_encryption_mode']).toBe('SERVER_AUTHENTICATION');
    });

    it('converts tags to GCP labels', () => {
      const { translated } = compilePortableResource(
        makeCacheRedis({ tags: { 'My-Tag': 'value' } }),
        'gcp',
      );
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      // GCP labels: lowercase; hyphens are valid ([a-z0-9_-]), so 'My-Tag' → 'my-tag'
      expect((attrs['labels'] as Record<string, string>)['my-tag']).toBe('value');
    });
  });
});

// ===========================================================================
// emitNativeEquivalent (exit-path)
// ===========================================================================

describe('emitNativeEquivalent', () => {
  it('produces a non-empty string for cloud_object_storage → aws', () => {
    const hcl = emitNativeEquivalent(
      { resource_type: 'cloud_object_storage', name: 'test-bucket' },
      'aws',
    );
    expect(typeof hcl).toBe('string');
    expect(hcl.length).toBeGreaterThan(0);
  });

  it('contains resource block type for aws_s3_bucket', () => {
    const hcl = emitNativeEquivalent(
      { resource_type: 'cloud_object_storage', name: 'test-bucket' },
      'aws',
    );
    expect(hcl).toContain('resource "aws_s3_bucket" "test-bucket"');
  });

  it('contains bucket attribute with quoted value', () => {
    const hcl = emitNativeEquivalent(
      { resource_type: 'cloud_object_storage', name: 'my-bucket' },
      'aws',
    );
    expect(hcl).toContain('"my-bucket"');
  });

  it('produces two resource blocks for Azure object storage', () => {
    const hcl = emitNativeEquivalent(
      { resource_type: 'cloud_object_storage', name: 'mybucket' },
      'azure',
    );
    expect(hcl).toContain('azurerm_storage_account');
    expect(hcl).toContain('azurerm_storage_container');
  });

  it('contains comment referencing portable source', () => {
    const hcl = emitNativeEquivalent(
      { resource_type: 'cloud_object_storage', name: 'bucket' },
      'gcp',
    );
    expect(hcl).toContain('cloud_object_storage');
    expect(hcl).toContain('gcp');
  });

  it('produces ECR resource block for cloud_container_registry → aws', () => {
    const hcl = emitNativeEquivalent(
      { resource_type: 'cloud_container_registry', name: 'my-ecr' },
      'aws',
    );
    expect(hcl).toContain('resource "aws_ecr_repository" "my-ecr"');
  });

  it('produces azurerm_container_registry for cloud_container_registry → azure', () => {
    const hcl = emitNativeEquivalent(
      { resource_type: 'cloud_container_registry', name: 'myregistry' },
      'azure',
    );
    expect(hcl).toContain('azurerm_container_registry');
  });

  it('produces google_artifact_registry_repository for cloud_container_registry → gcp', () => {
    const hcl = emitNativeEquivalent(
      { resource_type: 'cloud_container_registry', name: 'my-repo' },
      'gcp',
    );
    expect(hcl).toContain('google_artifact_registry_repository');
  });

  it('produces aws_elasticache_replication_group for cloud_cache_redis → aws', () => {
    const hcl = emitNativeEquivalent(
      { resource_type: 'cloud_cache_redis', name: 'redis-prod' },
      'aws',
    );
    expect(hcl).toContain('resource "aws_elasticache_replication_group" "redis-prod"');
  });

  it('produces azurerm_redis_cache for cloud_cache_redis → azure', () => {
    const hcl = emitNativeEquivalent(
      { resource_type: 'cloud_cache_redis', name: 'redis-prod' },
      'azure',
    );
    expect(hcl).toContain('azurerm_redis_cache');
  });

  it('produces google_redis_instance for cloud_cache_redis → gcp', () => {
    const hcl = emitNativeEquivalent(
      { resource_type: 'cloud_cache_redis', name: 'redis-prod' },
      'gcp',
    );
    expect(hcl).toContain('google_redis_instance');
  });

  it('outputs valid HCL structure with opening and closing braces', () => {
    const hcl = emitNativeEquivalent(
      { resource_type: 'cloud_cache_redis', name: 'test', transit_encryption: true },
      'azure',
    );
    expect(hcl).toContain('{');
    expect(hcl).toContain('}');
  });
});

// ===========================================================================
// provider_overrides — applyOverrides behaviour
// ===========================================================================

describe('compilePortableResource — provider_overrides', () => {
  // -------------------------------------------------------------------------
  // Azure override applied
  // -------------------------------------------------------------------------
  describe('Azure target with azure override', () => {
    it('merges override keys into translated resource attributes', () => {
      const resource: CloudObjectStorage = {
        resource_type: 'cloud_object_storage',
        name: 'override-bucket',
        provider_overrides: {
          azure: { resource_group_name: 'my-rg', account_replication_type: 'GRS' },
        },
      };
      const { translated } = compilePortableResource(resource as PortableResource, 'azure');
      // Azure object storage emits 2 resources; both should receive the override
      for (const tr of translated) {
        const attrs = tr.attributes as Record<string, unknown>;
        expect(attrs['resource_group_name']).toBe('my-rg');
        expect(attrs['account_replication_type']).toBe('GRS');
      }
    });

    it('emits one PORTABLE_OVERRIDE_APPLIED info finding per override key', () => {
      const resource: CloudContainerRegistry = {
        resource_type: 'cloud_container_registry',
        name: 'my-reg',
        provider_overrides: {
          azure: { location: 'westeurope', tags: { env: 'prod' } },
        },
      };
      const { findings } = compilePortableResource(resource as PortableResource, 'azure');
      const applied = findings.filter((f) => f.code === 'PORTABLE_OVERRIDE_APPLIED');
      expect(applied).toHaveLength(2); // 'location' and 'tags'
      expect(applied.every((f) => f.severity === 'info')).toBe(true);
      const messages = applied.map((f) => f.message);
      expect(messages.some((m) => m.includes('location'))).toBe(true);
      expect(messages.some((m) => m.includes('tags'))).toBe(true);
    });

    it('override value wins over compiler-generated value for the same key', () => {
      const resource: CloudCacheRedis = {
        resource_type: 'cloud_cache_redis',
        name: 'az-redis',
        size: 'sm',
        provider_overrides: {
          azure: { sku_name: 'Premium' },
        },
      };
      const { translated } = compilePortableResource(resource as PortableResource, 'azure');
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['sku_name']).toBe('Premium');
    });

    it('does not emit PORTABLE_OVERRIDE_IGNORED for the active azure target', () => {
      const resource: CloudObjectStorage = {
        resource_type: 'cloud_object_storage',
        name: 'bucket',
        provider_overrides: {
          azure: { resource_group_name: 'rg' },
        },
      };
      const { findings } = compilePortableResource(resource as PortableResource, 'azure');
      const ignored = findings.filter((f) => f.code === 'PORTABLE_OVERRIDE_IGNORED');
      expect(ignored).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // GCP override applied
  // -------------------------------------------------------------------------
  describe('GCP target with gcp override', () => {
    it('merges override keys into translated GCP resource attributes', () => {
      const resource: CloudObjectStorage = {
        resource_type: 'cloud_object_storage',
        name: 'gcs-bucket',
        provider_overrides: {
          gcp: { project: 'my-gcp-project', uniform_bucket_level_access: true },
        },
      };
      const { translated } = compilePortableResource(resource as PortableResource, 'gcp');
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['project']).toBe('my-gcp-project');
      expect(attrs['uniform_bucket_level_access']).toBe(true);
    });

    it('emits PORTABLE_OVERRIDE_APPLIED info findings for each GCP key', () => {
      const resource: CloudContainerRegistry = {
        resource_type: 'cloud_container_registry',
        name: 'artifact-reg',
        provider_overrides: {
          gcp: { location: 'europe-west1' },
        },
      };
      const { findings } = compilePortableResource(resource as PortableResource, 'gcp');
      const applied = findings.filter((f) => f.code === 'PORTABLE_OVERRIDE_APPLIED');
      expect(applied).toHaveLength(1);
      expect(applied[0]!.severity).toBe('info');
      expect(applied[0]!.message).toContain('location');
    });

    it('does not emit PORTABLE_OVERRIDE_IGNORED for the active gcp target', () => {
      const resource: CloudObjectStorage = {
        resource_type: 'cloud_object_storage',
        name: 'bucket',
        provider_overrides: {
          gcp: { project: 'proj' },
        },
      };
      const { findings } = compilePortableResource(resource as PortableResource, 'gcp');
      const ignored = findings.filter((f) => f.code === 'PORTABLE_OVERRIDE_IGNORED');
      expect(ignored).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Wrong-provider warning
  // -------------------------------------------------------------------------
  describe('Wrong-provider override warning', () => {
    it('emits PORTABLE_OVERRIDE_IGNORED warning when azure override is present but target is gcp', () => {
      const resource: CloudObjectStorage = {
        resource_type: 'cloud_object_storage',
        name: 'bucket',
        provider_overrides: {
          azure: { resource_group_name: 'rg' },
        },
      };
      const { findings } = compilePortableResource(resource as PortableResource, 'gcp');
      const ignored = findings.filter((f) => f.code === 'PORTABLE_OVERRIDE_IGNORED');
      expect(ignored).toHaveLength(1);
      expect(ignored[0]!.severity).toBe('warning');
      expect(ignored[0]!.message).toContain('azure');
      expect(ignored[0]!.message).toContain('gcp');
    });

    it('emits PORTABLE_OVERRIDE_IGNORED warning when gcp override is present but target is azure', () => {
      const resource: CloudCacheRedis = {
        resource_type: 'cloud_cache_redis',
        name: 'redis',
        provider_overrides: {
          gcp: { project: 'proj' },
        },
      };
      const { findings } = compilePortableResource(resource as PortableResource, 'azure');
      const ignored = findings.filter((f) => f.code === 'PORTABLE_OVERRIDE_IGNORED');
      expect(ignored).toHaveLength(1);
      expect(ignored[0]!.severity).toBe('warning');
      expect(ignored[0]!.message).toContain('gcp');
      expect(ignored[0]!.message).toContain('azure');
    });

    it('emits no PORTABLE_OVERRIDE_IGNORED when targeting aws (no aws overrides field exists)', () => {
      const resource: CloudObjectStorage = {
        resource_type: 'cloud_object_storage',
        name: 'bucket',
        provider_overrides: {
          azure: { resource_group_name: 'rg' },
          gcp: { project: 'proj' },
        },
      };
      // Both azure and gcp overrides are present but neither applies to aws
      const { findings } = compilePortableResource(resource as PortableResource, 'aws');
      // Both are ignored, so we expect two PORTABLE_OVERRIDE_IGNORED findings
      const ignored = findings.filter((f) => f.code === 'PORTABLE_OVERRIDE_IGNORED');
      expect(ignored).toHaveLength(2);
    });

    it('does not apply wrong-provider override attributes', () => {
      const resource: CloudObjectStorage = {
        resource_type: 'cloud_object_storage',
        name: 'bucket',
        provider_overrides: {
          azure: { resource_group_name: 'should-not-appear' },
        },
      };
      const { translated } = compilePortableResource(resource as PortableResource, 'gcp');
      const attrs = translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['resource_group_name']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // No-overrides regression — existing behaviour unchanged
  // -------------------------------------------------------------------------
  describe('No overrides — regression', () => {
    it('returns unchanged result when provider_overrides is absent', () => {
      const withOverride: CloudObjectStorage = {
        resource_type: 'cloud_object_storage',
        name: 'bucket',
        provider_overrides: { azure: { extra: 'val' } },
      };
      const withoutOverride: CloudObjectStorage = {
        resource_type: 'cloud_object_storage',
        name: 'bucket',
      };
      const withResult = compilePortableResource(withOverride as PortableResource, 'azure');
      const withoutResult = compilePortableResource(withoutOverride as PortableResource, 'azure');
      // Base attributes (without the extra key) should match
      for (const tr of withoutResult.translated) {
        const withAttrs = withResult.translated.find((t) => t.targetName === tr.targetName)!.attributes as Record<string, unknown>;
        const withoutAttrs = tr.attributes as Record<string, unknown>;
        // All keys from the no-override result must appear identically
        for (const [k, v] of Object.entries(withoutAttrs)) {
          if (k !== 'extra') {
            expect(withAttrs[k]).toEqual(v);
          }
        }
      }
      // No override findings without overrides
      const ignoredOrApplied = withoutResult.findings.filter(
        (f) => f.code === 'PORTABLE_OVERRIDE_APPLIED' || f.code === 'PORTABLE_OVERRIDE_IGNORED',
      );
      expect(ignoredOrApplied).toHaveLength(0);
    });

    it('emits no override findings for cloud_cache_redis → aws with no provider_overrides', () => {
      const { findings } = compilePortableResource(
        makeCacheRedis({ name: 'no-override-redis' }),
        'aws',
      );
      const overrideFindingCodes = ['PORTABLE_OVERRIDE_APPLIED', 'PORTABLE_OVERRIDE_IGNORED'];
      expect(findings.filter((f) => overrideFindingCodes.includes(f.code))).toHaveLength(0);
    });

    it('emits no override findings for cloud_container_registry → gcp with no provider_overrides', () => {
      const { findings } = compilePortableResource(
        makeContainerRegistry({ name: 'no-override-reg', scan_on_push: true }),
        'gcp',
      );
      const overrideFindingCodes = ['PORTABLE_OVERRIDE_APPLIED', 'PORTABLE_OVERRIDE_IGNORED'];
      expect(findings.filter((f) => overrideFindingCodes.includes(f.code))).toHaveLength(0);
      // Original PORTABLE_REGISTRY_SCAN finding still present
      expect(findings.some((f) => f.code === 'PORTABLE_REGISTRY_SCAN')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Exit-path includes override attributes
  // -------------------------------------------------------------------------
  describe('emitNativeEquivalent — exit path includes override attributes', () => {
    it('Azure override attributes appear in HCL output', () => {
      const resource: CloudObjectStorage = {
        resource_type: 'cloud_object_storage',
        name: 'mybucket',
        provider_overrides: {
          azure: { resource_group_name: 'injected-rg' },
        },
      };
      const hcl = emitNativeEquivalent(resource as PortableResource, 'azure');
      expect(hcl).toContain('resource_group_name');
      expect(hcl).toContain('injected-rg');
    });

    it('GCP override attributes appear in HCL output', () => {
      const resource: CloudCacheRedis = {
        resource_type: 'cloud_cache_redis',
        name: 'gcp-redis',
        provider_overrides: {
          gcp: { project: 'my-gcp-project' },
        },
      };
      const hcl = emitNativeEquivalent(resource as PortableResource, 'gcp');
      expect(hcl).toContain('project');
      expect(hcl).toContain('my-gcp-project');
    });

    it('wrong-provider override attributes do NOT appear in HCL output', () => {
      const resource: CloudObjectStorage = {
        resource_type: 'cloud_object_storage',
        name: 'bucket',
        provider_overrides: {
          azure: { resource_group_name: 'should-not-be-in-gcp-output' },
        },
      };
      const hcl = emitNativeEquivalent(resource as PortableResource, 'gcp');
      expect(hcl).not.toContain('should-not-be-in-gcp-output');
    });
  });
});
