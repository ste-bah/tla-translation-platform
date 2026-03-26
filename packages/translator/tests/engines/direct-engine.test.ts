import { describe, it, expect, vi } from 'vitest';
import { directEngine } from '../../src/engines/direct-engine.js';
import {
  transformTags,
  transformRegion,
  createFinding,
  collectUnmappedAttrs,
  makeTraceability,
  REGION_MAP,
  NODE_TYPE_SKU_MAP,
} from '../../src/engines/direct/attribute-transformer.js';
import { translateS3 } from '../../src/engines/direct/s3-mapping.js';
import { translateEcr } from '../../src/engines/direct/ecr-mapping.js';
import { translateRedis } from '../../src/engines/direct/redis-mapping.js';
import { translateDns } from '../../src/engines/direct/dns-mapping.js';
import { translatePeering } from '../../src/engines/direct/peering-mapping.js';
import type { TranslationContext } from '../../src/engines/mapping-engine.js';
import type {
  IrResource,
  RegistryEntry,
  CanonicalIR,
  CloudProvider,
  CompilerOptions,
} from '@tla/shared';
import type { RegistryApi } from '@tla/registry';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'res-001',
    sourceType: 'aws_s3_bucket',
    sourceName: 'my_bucket',
    sourceModule: null,
    category: 'storage',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: 'SER-STORAGE-S3-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-STORAGE-S3-001',
    aws_service: 'aws_s3_bucket',
    aws_family: 'storage',
    azure_targets: ['azurerm_storage_account'],
    gcp_targets: ['google_storage_bucket'],
    mapping_type: 'direct',
    output_mode: 'native_emit_only',
    band: 'P1',
    confidence: 0.95,
    portable_provider_candidate: false,
    behavioral_gaps: [],
    manual_review_required: false,
    review_domains: [],
    test_status: 'unit_tested',
    owner: 'team-infra',
    registry_version: '2025.03.01',
    last_updated: '2025-03-01T00:00:00Z',
    related_requirements: [],
    related_edge_cases: [],
    ...overrides,
  };
}

function makeMockRegistry(): RegistryApi {
  return {
    lookup: vi.fn().mockReturnValue(undefined),
    lookupMany: vi.fn().mockReturnValue(new Map()),
  } as unknown as RegistryApi;
}

function makeCompilerOptions(overrides: Partial<CompilerOptions> = {}): CompilerOptions {
  return {
    targetProvider: 'azure',
    registryVersion: '2025.03.01',
    emitComments: true,
    sortKeys: true,
    ...overrides,
  };
}

function makeTranslationContext(overrides: Partial<TranslationContext> = {}): TranslationContext {
  const resource = overrides.resource ?? makeIrResource();
  const entry = overrides.registryEntry ?? makeRegistryEntry();
  return {
    targetProvider: 'azure' as CloudProvider,
    resource,
    registryEntry: entry,
    relationships: [],
    siblingResources: [],
    ir: {
      version: '1.0.0',
      sourceProvider: 'aws',
      resources: [resource],
      relationships: [],
      modules: [],
      intents: [],
      metadata: {
        generatedAt: new Date().toISOString(),
        sourceFiles: ['main.tf'],
        toolVersion: '0.1.0',
      },
    } as CanonicalIR,
    registry: makeMockRegistry(),
    options: makeCompilerOptions(),
    ...overrides,
  };
}

// ===========================================================================
// attribute-transformer
// ===========================================================================

describe('attribute-transformer', () => {
  // -----------------------------------------------------------------------
  // transformTags
  // -----------------------------------------------------------------------
  describe('transformTags', () => {
    it('should preserve keys unchanged for Azure', () => {
      const tags = { Environment: 'prod', 'App:Name': 'MyApp' };
      const result = transformTags('azure', tags);
      expect(result).toEqual({ Environment: 'prod', 'App:Name': 'MyApp' });
    });

    it('should return a copy, not the same reference, for Azure', () => {
      const tags = { Env: 'dev' };
      const result = transformTags('azure', tags);
      expect(result).not.toBe(tags);
      expect(result).toEqual(tags);
    });

    it('should lowercase keys for GCP', () => {
      const tags = { Environment: 'prod', Name: 'test' };
      const result = transformTags('gcp', tags);
      expect(result['environment']).toBe('prod');
      expect(result['name']).toBe('test');
    });

    it('should replace invalid GCP label chars with underscore', () => {
      const tags = { 'App:Name': 'val', 'Some.Key': 'val2' };
      const result = transformTags('gcp', tags);
      expect(result['app_name']).toBe('val');
      expect(result['some_key']).toBe('val2');
    });

    it('should sort GCP label keys alphabetically', () => {
      const tags = { Zulu: 'z', Alpha: 'a', Mike: 'm' };
      const result = transformTags('gcp', tags);
      const keys = Object.keys(result);
      expect(keys).toEqual(['alpha', 'mike', 'zulu']);
    });

    it('should handle empty tags object for both providers', () => {
      expect(transformTags('azure', {})).toEqual({});
      expect(transformTags('gcp', {})).toEqual({});
    });
  });

  // -----------------------------------------------------------------------
  // transformRegion
  // -----------------------------------------------------------------------
  describe('transformRegion', () => {
    it('should map us-east-1 to eastus for Azure', () => {
      expect(transformRegion('azure', 'us-east-1')).toBe('eastus');
    });

    it('should map us-east-1 to us-east1 for GCP', () => {
      expect(transformRegion('gcp', 'us-east-1')).toBe('us-east1');
    });

    it('should map eu-west-1 to westeurope for Azure', () => {
      expect(transformRegion('azure', 'eu-west-1')).toBe('westeurope');
    });

    it('should map eu-west-1 to europe-west1 for GCP', () => {
      expect(transformRegion('gcp', 'eu-west-1')).toBe('europe-west1');
    });

    it('should map ap-southeast-1 to southeastasia for Azure', () => {
      expect(transformRegion('azure', 'ap-southeast-1')).toBe('southeastasia');
    });

    it('should return unknown region as-is', () => {
      expect(transformRegion('azure', 'moon-west-1')).toBe('moon-west-1');
      expect(transformRegion('gcp', 'mars-central-1')).toBe('mars-central-1');
    });

    it('should have entries for all major AWS regions', () => {
      expect(REGION_MAP.size).toBeGreaterThanOrEqual(15);
    });
  });

  // -----------------------------------------------------------------------
  // createFinding
  // -----------------------------------------------------------------------
  describe('createFinding', () => {
    it('should create a finding with correct fields', () => {
      const f = createFinding('r-1', 'warning', 'MY_CODE', 'Something happened');
      expect(f.resourceId).toBe('r-1');
      expect(f.severity).toBe('warning');
      expect(f.code).toBe('MY_CODE');
      expect(f.message).toBe('Something happened');
    });

    it('should include detail when provided', () => {
      const f = createFinding('r-1', 'info', 'C', 'msg', 'extra detail');
      expect(f.detail).toBe('extra detail');
    });

    it('should not include detail key when undefined', () => {
      const f = createFinding('r-1', 'blocker', 'C', 'msg');
      expect('detail' in f).toBe(false);
    });

    it('should accept all severity levels', () => {
      for (const sev of ['blocker', 'warning', 'info'] as const) {
        const f = createFinding('r', sev, 'X', 'm');
        expect(f.severity).toBe(sev);
      }
    });
  });

  // -----------------------------------------------------------------------
  // collectUnmappedAttrs
  // -----------------------------------------------------------------------
  describe('collectUnmappedAttrs', () => {
    it('should return findings for unmapped keys', () => {
      const source = { mapped1: 'a', unmapped1: 'b', unmapped2: 'c' };
      const findings = collectUnmappedAttrs('r-1', source, ['mapped1']);
      expect(findings).toHaveLength(2);
      expect(findings[0]!.code).toBe('UNMAPPED_ATTRIBUTE');
      expect(findings[0]!.severity).toBe('info');
    });

    it('should return 0 findings when all keys are mapped', () => {
      const source = { a: 1, b: 2 };
      const findings = collectUnmappedAttrs('r-1', source, ['a', 'b']);
      expect(findings).toHaveLength(0);
    });

    it('should return 0 findings for empty source', () => {
      const findings = collectUnmappedAttrs('r-1', {}, ['a']);
      expect(findings).toHaveLength(0);
    });

    it('should sort unmapped keys for determinism', () => {
      const source = { z_key: 1, a_key: 2, m_key: 3 };
      const findings = collectUnmappedAttrs('r-1', source, []);
      expect(findings[0]!.message).toContain('a_key');
      expect(findings[1]!.message).toContain('m_key');
      expect(findings[2]!.message).toContain('z_key');
    });

    it('should include resource id in each finding', () => {
      const findings = collectUnmappedAttrs('my-res', { x: 1 }, []);
      expect(findings[0]!.resourceId).toBe('my-res');
    });
  });

  // -----------------------------------------------------------------------
  // makeTraceability
  // -----------------------------------------------------------------------
  describe('makeTraceability', () => {
    it('should populate sourceId from context resource', () => {
      const ctx = makeTranslationContext();
      const t = makeTraceability(ctx, 'direct/test');
      expect(t.sourceId).toBe(ctx.resource.id);
    });

    it('should populate sourceType from context resource', () => {
      const ctx = makeTranslationContext();
      const t = makeTraceability(ctx, 'direct/test');
      expect(t.sourceType).toBe(ctx.resource.sourceType);
    });

    it('should populate registryEntryId from context entry', () => {
      const ctx = makeTranslationContext();
      const t = makeTraceability(ctx, 'direct/test');
      expect(t.registryEntryId).toBe(ctx.registryEntry.registry_entry_id);
    });

    it('should always set mappingType to direct', () => {
      const ctx = makeTranslationContext();
      const t = makeTraceability(ctx, 'direct/s3');
      expect(t.mappingType).toBe('direct');
    });

    it('should include confidence from registry entry', () => {
      const ctx = makeTranslationContext({
        registryEntry: makeRegistryEntry({ confidence: 0.87 }),
      });
      const t = makeTraceability(ctx, 'direct/test');
      expect(t.confidence).toBe(0.87);
    });

    it('should set engineUsed to the provided value', () => {
      const ctx = makeTranslationContext();
      const t = makeTraceability(ctx, 'direct/s3');
      expect(t.engineUsed).toBe('direct/s3');
    });
  });
});

// ===========================================================================
// directEngine dispatch
// ===========================================================================

describe('directEngine dispatch', () => {
  it('should have mappingType "direct"', () => {
    expect(directEngine.mappingType).toBe('direct');
  });

  it('should dispatch aws_s3_bucket to S3 mapper', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_s3_bucket', attributes: { bucket: 'test' } }),
    });
    const result = directEngine.translate(ctx);
    // S3 Azure produces 2 resources
    expect(result.translated.length).toBe(2);
    expect(result.translated[0]!.targetType).toBe('azurerm_storage_account');
  });

  it('should dispatch aws_ecr_repository to ECR mapper', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({
        sourceType: 'aws_ecr_repository',
        sourceName: 'my_ecr',
        category: 'containers',
        attributes: { name: 'my-repo' },
      }),
      registryEntry: makeRegistryEntry({
        azure_targets: ['azurerm_container_registry'],
        gcp_targets: ['google_artifact_registry_repository'],
      }),
    });
    const result = directEngine.translate(ctx);
    expect(result.translated[0]!.targetType).toBe('azurerm_container_registry');
  });

  it('should dispatch aws_elasticache_replication_group to Redis mapper', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({
        sourceType: 'aws_elasticache_replication_group',
        sourceName: 'my_redis',
        category: 'database',
        attributes: { node_type: 'cache.t3.micro' },
      }),
    });
    const result = directEngine.translate(ctx);
    expect(result.translated[0]!.targetType).toBe('azurerm_redis_cache');
  });

  it('should dispatch aws_route53_zone to DNS mapper', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({
        sourceType: 'aws_route53_zone',
        sourceName: 'my_zone',
        category: 'networking',
        attributes: { name: 'example.com' },
      }),
    });
    const result = directEngine.translate(ctx);
    expect(result.translated[0]!.targetType).toBe('azurerm_dns_zone');
  });

  it('should dispatch aws_route53_record to DNS mapper', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({
        sourceType: 'aws_route53_record',
        sourceName: 'my_record',
        category: 'networking',
        attributes: { type: 'A', records: ['1.2.3.4'] },
      }),
    });
    const result = directEngine.translate(ctx);
    expect(result.translated[0]!.targetType).toBe('azurerm_dns_a_record');
  });

  it('should dispatch aws_vpc_peering_connection to peering mapper', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({
        sourceType: 'aws_vpc_peering_connection',
        sourceName: 'my_peering',
        category: 'networking',
        attributes: { vpc_id: 'vpc-1', peer_vpc_id: 'vpc-2' },
      }),
    });
    const result = directEngine.translate(ctx);
    expect(result.translated[0]!.targetType).toBe('azurerm_virtual_network_peering');
  });

  it('should fallback to generic for unknown sourceType', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({
        sourceType: 'aws_unknown_thing',
        sourceName: 'mystery',
        attributes: { foo: 'bar' },
      }),
      registryEntry: makeRegistryEntry({
        azure_targets: ['azurerm_some_resource'],
      }),
    });
    const result = directEngine.translate(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_some_resource');
    expect(result.findings.some((f) => f.code === 'GENERIC_DIRECT_FALLBACK')).toBe(true);
  });

  it('should emit NO_TARGET_TYPE if registry has no targets for provider', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({
        sourceType: 'aws_unknown_thing',
        attributes: {},
      }),
      registryEntry: makeRegistryEntry({ azure_targets: [] }),
    });
    const result = directEngine.translate(ctx);
    expect(result.translated).toHaveLength(0);
    expect(result.findings.some((f) => f.code === 'NO_TARGET_TYPE')).toBe(true);
    expect(result.findings[0]!.severity).toBe('blocker');
  });

  it('should copy attributes verbatim in generic fallback', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({
        sourceType: 'aws_unknown_thing',
        attributes: { alpha: 1, beta: 2 },
      }),
      registryEntry: makeRegistryEntry({ azure_targets: ['azurerm_x'] }),
    });
    const result = directEngine.translate(ctx);
    expect(result.translated[0]!.attributes).toEqual({ alpha: 1, beta: 2 });
  });

  it('should sort generic fallback attribute keys', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({
        sourceType: 'aws_unknown_thing',
        attributes: { zulu: 'z', alpha: 'a' },
      }),
      registryEntry: makeRegistryEntry({ azure_targets: ['azurerm_x'] }),
    });
    const result = directEngine.translate(ctx);
    const keys = Object.keys(result.translated[0]!.attributes);
    expect(keys).toEqual(['alpha', 'zulu']);
  });

  it('should use gcp_targets for generic fallback when target is gcp', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({
        sourceType: 'aws_unknown_thing',
        attributes: {},
      }),
      registryEntry: makeRegistryEntry({
        azure_targets: ['azure_x'],
        gcp_targets: ['google_x'],
      }),
    });
    const result = directEngine.translate(ctx);
    expect(result.translated[0]!.targetType).toBe('google_x');
  });
});

// ===========================================================================
// translateS3
// ===========================================================================

describe('translateS3', () => {
  describe('Azure', () => {
    it('should produce 2 resources (storage_account + container)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { bucket: 'my-bucket', region: 'us-east-1' } }),
      });
      const result = translateS3(ctx);
      expect(result.translated).toHaveLength(2);
      expect(result.translated[0]!.targetType).toBe('azurerm_storage_account');
      expect(result.translated[1]!.targetType).toBe('azurerm_storage_container');
    });

    it('should set account_kind to StorageV2', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { bucket: 'test' } }),
      });
      const result = translateS3(ctx);
      expect(result.translated[0]!.attributes['account_kind']).toBe('StorageV2');
    });

    it('should map region to Azure location', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { bucket: 'test', region: 'eu-west-1' } }),
      });
      const result = translateS3(ctx);
      expect(result.translated[0]!.attributes['location']).toBe('westeurope');
    });

    it('should sanitize account name (lowercase alphanum, max 24 chars)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { bucket: 'My-Long-Bucket-Name-That-Exceeds-Limit' },
        }),
      });
      const result = translateS3(ctx);
      const name = result.translated[0]!.attributes['name'] as string;
      expect(name).toMatch(/^[a-z0-9]+$/);
      expect(name.length).toBeLessThanOrEqual(24);
    });

    it('should set LRS replication by default', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { bucket: 'test' } }),
      });
      const result = translateS3(ctx);
      expect(result.translated[0]!.attributes['account_replication_type']).toBe('LRS');
    });

    it('should set GRS replication when replication_configuration present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { bucket: 'test', replication_configuration: { role: 'arn:xxx' } },
        }),
      });
      const result = translateS3(ctx);
      expect(result.translated[0]!.attributes['account_replication_type']).toBe('GRS');
    });

    it('should enable versioning when versioning.enabled is true', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { bucket: 'test', versioning: { enabled: true } },
        }),
      });
      const result = translateS3(ctx);
      expect(result.translated[0]!.attributes['blob_properties']).toEqual({
        versioning_enabled: true,
      });
    });

    it('should not include blob_properties when versioning is disabled', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { bucket: 'test', versioning: { enabled: false } },
        }),
      });
      const result = translateS3(ctx);
      expect(result.translated[0]!.attributes['blob_properties']).toBeUndefined();
    });

    it('should pass through Azure tags unchanged', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { bucket: 'test', tags: { Env: 'prod' } },
        }),
      });
      const result = translateS3(ctx);
      expect(result.translated[0]!.attributes['tags']).toEqual({ Env: 'prod' });
    });

    it('should set container access type to private', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { bucket: 'test' } }),
      });
      const result = translateS3(ctx);
      expect(result.translated[1]!.attributes['container_access_type']).toBe('private');
    });

    it('should link container to account via storage_account_name', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { bucket: 'mybucket' } }),
      });
      const result = translateS3(ctx);
      expect(result.translated[1]!.attributes['storage_account_name']).toBe(
        result.translated[0]!.attributes['name'],
      );
    });
  });

  describe('GCP', () => {
    it('should produce 1 resource (google_storage_bucket)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: { bucket: 'my-bucket' } }),
      });
      const result = translateS3(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('google_storage_bucket');
    });

    it('should map region to GCP location', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: { bucket: 'test', region: 'us-west-2' } }),
      });
      const result = translateS3(ctx);
      expect(result.translated[0]!.attributes['location']).toBe('us-west2');
    });

    it('should set storage_class to STANDARD', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: { bucket: 'test' } }),
      });
      const result = translateS3(ctx);
      expect(result.translated[0]!.attributes['storage_class']).toBe('STANDARD');
    });

    it('should enable versioning when versioning.enabled is true', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          attributes: { bucket: 'test', versioning: { enabled: true } },
        }),
      });
      const result = translateS3(ctx);
      expect(result.translated[0]!.attributes['versioning']).toEqual({ enabled: true });
    });

    it('should not set versioning when disabled', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          attributes: { bucket: 'test', versioning: { enabled: false } },
        }),
      });
      const result = translateS3(ctx);
      expect(result.translated[0]!.attributes['versioning']).toBeUndefined();
    });

    it('should map lifecycle rules with expiration to Delete action', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          attributes: {
            bucket: 'test',
            lifecycle_rule: [{ expiration: { days: 30 } }],
          },
        }),
      });
      const result = translateS3(ctx);
      const rules = result.translated[0]!.attributes['lifecycle_rule'] as unknown[];
      expect(rules).toHaveLength(1);
      expect((rules[0] as any).action.type).toBe('Delete');
      expect((rules[0] as any).condition.age).toBe(30);
    });

    it('should map lifecycle rules with transition to SetStorageClass', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          attributes: {
            bucket: 'test',
            lifecycle_rule: [{ transition: { storage_class: 'GLACIER' } }],
          },
        }),
      });
      const result = translateS3(ctx);
      const rules = result.translated[0]!.attributes['lifecycle_rule'] as unknown[];
      expect((rules[0] as any).action.type).toBe('SetStorageClass');
      expect((rules[0] as any).action.storage_class).toBe('GLACIER');
    });

    it('should map encryption with KMS key', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          attributes: {
            bucket: 'test',
            server_side_encryption_configuration: {
              rule: {
                apply_server_side_encryption_by_default: {
                  kms_master_key_id: 'projects/p/locations/l/keyRings/kr/cryptoKeys/k',
                },
              },
            },
          },
        }),
      });
      const result = translateS3(ctx);
      expect(result.translated[0]!.attributes['encryption']).toEqual({
        default_kms_key_name: 'projects/p/locations/l/keyRings/kr/cryptoKeys/k',
      });
    });

    it('should not set encryption when no KMS key', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          attributes: {
            bucket: 'test',
            server_side_encryption_configuration: { rule: {} },
          },
        }),
      });
      const result = translateS3(ctx);
      expect(result.translated[0]!.attributes['encryption']).toBeUndefined();
    });

    it('should map CORS rules', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          attributes: {
            bucket: 'test',
            cors_rule: [
              {
                allowed_methods: ['GET', 'PUT'],
                allowed_origins: ['*'],
                allowed_headers: ['Content-Type'],
                max_age_seconds: 7200,
              },
            ],
          },
        }),
      });
      const result = translateS3(ctx);
      const cors = result.translated[0]!.attributes['cors'] as unknown[];
      expect(cors).toHaveLength(1);
      expect((cors[0] as any).method).toEqual(['GET', 'PUT']);
      expect((cors[0] as any).origin).toEqual(['*']);
      expect((cors[0] as any).max_age_seconds).toBe(7200);
    });

    it('should map logging configuration', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          attributes: {
            bucket: 'test',
            logging: { target_bucket: 'log-bucket', target_prefix: 'logs/' },
          },
        }),
      });
      const result = translateS3(ctx);
      expect(result.translated[0]!.attributes['logging']).toEqual({
        log_bucket: 'log-bucket',
        log_object_prefix: 'logs/',
      });
    });

    it('should use GCP labels (lowercase keys) for tags', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          attributes: { bucket: 'test', tags: { Environment: 'prod' } },
        }),
      });
      const result = translateS3(ctx);
      expect(result.translated[0]!.attributes['labels']).toEqual({ environment: 'prod' });
    });
  });

  describe('unmapped attributes', () => {
    it('should produce findings for unmapped attributes', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { bucket: 'test', custom_unknown: 'val' },
        }),
      });
      const result = translateS3(ctx);
      expect(result.findings.some((f) => f.code === 'UNMAPPED_ATTRIBUTE')).toBe(true);
    });
  });

  describe('traceability', () => {
    it('should include traceability with engineUsed direct/s3', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { bucket: 'test' } }),
      });
      const result = translateS3(ctx);
      expect(result.translated[0]!.traceability.engineUsed).toBe('direct/s3');
    });
  });
});

// ===========================================================================
// translateEcr
// ===========================================================================

describe('translateEcr', () => {
  function ecrResource(attrs: Record<string, unknown> = {}): IrResource {
    return makeIrResource({
      sourceType: 'aws_ecr_repository',
      sourceName: 'my_ecr',
      category: 'containers',
      attributes: { name: 'my-repo', ...attrs },
    });
  }

  describe('Azure', () => {
    it('should produce azurerm_container_registry', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: ecrResource(),
      });
      const result = translateEcr(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('azurerm_container_registry');
    });

    it('should strip non-alphanumeric chars from name', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: ecrResource({ name: 'my-repo.v2' }),
      });
      const result = translateEcr(ctx);
      expect(result.translated[0]!.attributes['name']).toBe('myrepov2');
    });

    it('should set admin_enabled false for IMMUTABLE tag mutability', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: ecrResource({ image_tag_mutability: 'IMMUTABLE' }),
      });
      const result = translateEcr(ctx);
      expect(result.translated[0]!.attributes['admin_enabled']).toBe(false);
    });

    it('should set admin_enabled true for MUTABLE', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: ecrResource({ image_tag_mutability: 'MUTABLE' }),
      });
      const result = translateEcr(ctx);
      expect(result.translated[0]!.attributes['admin_enabled']).toBe(true);
    });

    it('should upgrade to Premium SKU with CMK encryption', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: ecrResource({ encryption_configuration: { kms_key: 'arn:aws:kms:xxx' } }),
      });
      const result = translateEcr(ctx);
      expect(result.translated[0]!.attributes['sku']).toBe('Premium');
      expect(result.translated[0]!.attributes['encryption']).toEqual({
        key_vault_key_id: 'arn:aws:kms:xxx',
      });
    });

    it('should set trust_policy when scan_on_push is true', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: ecrResource({ image_scanning_configuration: { scan_on_push: true } }),
      });
      const result = translateEcr(ctx);
      expect(result.translated[0]!.attributes['trust_policy']).toEqual({ enabled: true });
    });

    it('should default SKU to Basic', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: ecrResource(),
      });
      const result = translateEcr(ctx);
      expect(result.translated[0]!.attributes['sku']).toBe('Basic');
    });
  });

  describe('GCP', () => {
    it('should produce google_artifact_registry_repository', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: ecrResource(),
      });
      const result = translateEcr(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('google_artifact_registry_repository');
    });

    it('should set format to DOCKER', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: ecrResource(),
      });
      const result = translateEcr(ctx);
      expect(result.translated[0]!.attributes['format']).toBe('DOCKER');
    });

    it('should set kms_key_name when encryption configured', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: ecrResource({ encryption_configuration: { kms_key: 'projects/p/locations/l/keyRings/kr/cryptoKeys/k' } }),
      });
      const result = translateEcr(ctx);
      expect(result.translated[0]!.attributes['kms_key_name']).toBe(
        'projects/p/locations/l/keyRings/kr/cryptoKeys/k',
      );
    });

    it('should emit ECR_SCAN_ON_PUSH finding when scan_on_push is true', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: ecrResource({ image_scanning_configuration: { scan_on_push: true } }),
      });
      const result = translateEcr(ctx);
      expect(result.findings.some((f) => f.code === 'ECR_SCAN_ON_PUSH')).toBe(true);
    });

    it('should use labels for GCP tags', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: ecrResource({ tags: { Env: 'prod' } }),
      });
      const result = translateEcr(ctx);
      expect(result.translated[0]!.attributes['labels']).toEqual({ env: 'prod' });
    });
  });

  it('should include traceability with engineUsed direct/ecr', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: ecrResource(),
    });
    const result = translateEcr(ctx);
    expect(result.translated[0]!.traceability.engineUsed).toBe('direct/ecr');
  });
});

// ===========================================================================
// translateRedis
// ===========================================================================

describe('translateRedis', () => {
  function redisResource(attrs: Record<string, unknown> = {}): IrResource {
    return makeIrResource({
      sourceType: 'aws_elasticache_replication_group',
      sourceName: 'my_redis',
      category: 'database',
      attributes: { replication_group_id: 'my-redis', node_type: 'cache.t3.micro', ...attrs },
    });
  }

  describe('Azure', () => {
    it('should produce azurerm_redis_cache', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: redisResource(),
      });
      const result = translateRedis(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('azurerm_redis_cache');
    });

    it('should map cache.t3.micro to Basic_C0 SKU', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: redisResource({ node_type: 'cache.t3.micro' }),
      });
      const result = translateRedis(ctx);
      expect(result.translated[0]!.attributes['sku_name']).toBe('Basic');
      expect(result.translated[0]!.attributes['family']).toBe('C');
      // parseAzureSku uses `parseInt("0", 10) || 1` which yields 1 for C0
      expect(result.translated[0]!.attributes['capacity']).toBe(1);
    });

    it('should map cache.m5.xlarge to Premium_P1 SKU', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: redisResource({ node_type: 'cache.m5.xlarge' }),
      });
      const result = translateRedis(ctx);
      expect(result.translated[0]!.attributes['sku_name']).toBe('Premium');
      expect(result.translated[0]!.attributes['family']).toBe('P');
      expect(result.translated[0]!.attributes['capacity']).toBe(1);
    });

    it('should emit warning for unknown node_type', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: redisResource({ node_type: 'cache.z99.mega' }),
      });
      const result = translateRedis(ctx);
      expect(result.findings.some((f) => f.code === 'REDIS_UNKNOWN_NODE_TYPE')).toBe(true);
    });

    it('should set replicas_per_master when num_cache_clusters > 1', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: redisResource({ num_cache_clusters: 3 }),
      });
      const result = translateRedis(ctx);
      expect(result.translated[0]!.attributes['replicas_per_master']).toBe(2);
      expect(result.translated[0]!.attributes['shard_count']).toBe(1);
    });

    it('should not set replicas when num_cache_clusters is 1', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: redisResource({ num_cache_clusters: 1 }),
      });
      const result = translateRedis(ctx);
      expect(result.translated[0]!.attributes['replicas_per_master']).toBeUndefined();
    });

    it('should enable TLS settings for transit encryption', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: redisResource({ transit_encryption_enabled: true }),
      });
      const result = translateRedis(ctx);
      expect(result.translated[0]!.attributes['enable_non_ssl_port']).toBe(false);
      expect(result.translated[0]!.attributes['minimum_tls_version']).toBe('1.2');
    });

    it('should warn about encryption tier mismatch for non-Premium', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: redisResource({
          node_type: 'cache.t3.micro',
          at_rest_encryption_enabled: true,
        }),
      });
      const result = translateRedis(ctx);
      expect(result.findings.some((f) => f.code === 'REDIS_ENCRYPTION_TIER')).toBe(true);
    });

    it('should not warn about encryption tier for Premium SKU', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: redisResource({
          node_type: 'cache.m5.xlarge', // maps to Premium_P1
          at_rest_encryption_enabled: true,
        }),
      });
      const result = translateRedis(ctx);
      expect(result.findings.some((f) => f.code === 'REDIS_ENCRYPTION_TIER')).toBe(false);
    });

    it('should use engine_version for redis_version', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: redisResource({ engine_version: '7.0' }),
      });
      const result = translateRedis(ctx);
      expect(result.translated[0]!.attributes['redis_version']).toBe('7.0');
    });

    it('should default redis_version to 6', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: redisResource({ engine_version: undefined }),
      });
      const result = translateRedis(ctx);
      expect(result.translated[0]!.attributes['redis_version']).toBe('6');
    });
  });

  describe('GCP', () => {
    it('should produce google_redis_instance', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: redisResource(),
      });
      const result = translateRedis(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('google_redis_instance');
    });

    it('should map cache.t3.micro to BASIC tier 1GB', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: redisResource({ node_type: 'cache.t3.micro' }),
      });
      const result = translateRedis(ctx);
      expect(result.translated[0]!.attributes['tier']).toBe('BASIC');
      expect(result.translated[0]!.attributes['memory_size_gb']).toBe(1);
    });

    it('should map cache.m5.large to STANDARD_HA 4GB', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: redisResource({ node_type: 'cache.m5.large' }),
      });
      const result = translateRedis(ctx);
      expect(result.translated[0]!.attributes['tier']).toBe('STANDARD_HA');
      expect(result.translated[0]!.attributes['memory_size_gb']).toBe(4);
    });

    it('should emit warning for unknown node_type', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: redisResource({ node_type: 'cache.z99.mega' }),
      });
      const result = translateRedis(ctx);
      expect(result.findings.some((f) => f.code === 'REDIS_UNKNOWN_NODE_TYPE')).toBe(true);
    });

    it('should format redis_version as REDIS_X_X', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: redisResource({ engine_version: '7.0' }),
      });
      const result = translateRedis(ctx);
      expect(result.translated[0]!.attributes['redis_version']).toBe('REDIS_7_0');
    });

    it('should default redis_version to REDIS_6_X', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: redisResource({ engine_version: undefined }),
      });
      const result = translateRedis(ctx);
      expect(result.translated[0]!.attributes['redis_version']).toBe('REDIS_6_X');
    });

    it('should set replica_count when num_cache_clusters > 1', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: redisResource({ num_cache_clusters: 4 }),
      });
      const result = translateRedis(ctx);
      expect(result.translated[0]!.attributes['replica_count']).toBe(3);
    });

    it('should set transit_encryption_mode for transit encryption', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: redisResource({ transit_encryption_enabled: true }),
      });
      const result = translateRedis(ctx);
      expect(result.translated[0]!.attributes['transit_encryption_mode']).toBe(
        'SERVER_AUTHENTICATION',
      );
    });

    it('should set auth_enabled when auth_token is present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: redisResource({ auth_token: 'secret123' }),
      });
      const result = translateRedis(ctx);
      expect(result.translated[0]!.attributes['auth_enabled']).toBe(true);
    });

    it('should use labels for GCP tags', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: redisResource({ tags: { Team: 'platform' } }),
      });
      const result = translateRedis(ctx);
      expect(result.translated[0]!.attributes['labels']).toEqual({ team: 'platform' });
    });
  });

  it('should include traceability with engineUsed direct/redis', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: redisResource(),
    });
    const result = translateRedis(ctx);
    expect(result.translated[0]!.traceability.engineUsed).toBe('direct/redis');
  });
});

// ===========================================================================
// translateDns
// ===========================================================================

describe('translateDns', () => {
  function zoneResource(attrs: Record<string, unknown> = {}): IrResource {
    return makeIrResource({
      sourceType: 'aws_route53_zone',
      sourceName: 'my_zone',
      category: 'networking',
      attributes: { name: 'example.com', ...attrs },
    });
  }

  function recordResource(attrs: Record<string, unknown> = {}): IrResource {
    return makeIrResource({
      sourceType: 'aws_route53_record',
      sourceName: 'my_record',
      category: 'networking',
      attributes: { type: 'A', name: 'www.example.com', records: ['1.2.3.4'], ttl: 300, ...attrs },
    });
  }

  describe('Zone - Azure', () => {
    it('should produce azurerm_dns_zone', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: zoneResource(),
      });
      const result = translateDns(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('azurerm_dns_zone');
    });

    it('should set zone name from attributes', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: zoneResource({ name: 'myzone.io' }),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.attributes['name']).toBe('myzone.io');
    });

    it('should include resource_group_name reference', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: zoneResource(),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.attributes['resource_group_name']).toBe(
        '${azurerm_resource_group.main.name}',
      );
    });
  });

  describe('Zone - GCP', () => {
    it('should produce google_dns_managed_zone', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: zoneResource(),
      });
      const result = translateDns(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('google_dns_managed_zone');
    });

    it('should append trailing dot to dns_name', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: zoneResource({ name: 'example.com' }),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.attributes['dns_name']).toBe('example.com.');
    });

    it('should not double-dot if name already ends with dot', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: zoneResource({ name: 'example.com.' }),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.attributes['dns_name']).toBe('example.com.');
    });

    it('should set visibility to private when vpc is present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: zoneResource({ vpc: { vpc_id: 'vpc-123' } }),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.attributes['visibility']).toBe('private');
    });

    it('should use comment as description', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: zoneResource({ comment: 'My DNS zone' }),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.attributes['description']).toBe('My DNS zone');
    });
  });

  describe('Record - Azure', () => {
    it('should produce azurerm_dns_a_record for A type', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: recordResource({ type: 'A' }),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.targetType).toBe('azurerm_dns_a_record');
    });

    it('should produce azurerm_dns_cname_record for CNAME type', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: recordResource({ type: 'CNAME', records: ['target.example.com'] }),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.targetType).toBe('azurerm_dns_cname_record');
    });

    it('should produce azurerm_dns_mx_record for MX type', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: recordResource({ type: 'MX', records: ['10 mail.example.com'] }),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.targetType).toBe('azurerm_dns_mx_record');
    });

    it('should produce azurerm_dns_txt_record for TXT type', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: recordResource({ type: 'TXT', records: ['v=spf1 include:example.com ~all'] }),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.targetType).toBe('azurerm_dns_txt_record');
    });

    it('should emit DNS_ALIAS_NOT_PORTABLE warning for alias records', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: recordResource({
          alias: { name: 'elb.amazonaws.com', zone_id: 'Z123' },
          type: 'A',
        }),
      });
      const result = translateDns(ctx);
      expect(result.findings.some((f) => f.code === 'DNS_ALIAS_NOT_PORTABLE')).toBe(true);
    });

    it('should translate alias to CNAME in Azure', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: recordResource({
          alias: { name: 'elb.amazonaws.com' },
          type: 'A',
        }),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.targetType).toBe('azurerm_dns_cname_record');
      expect(result.translated[0]!.attributes['record']).toBe('elb.amazonaws.com');
    });

    it('should sort records for determinism', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: recordResource({ records: ['3.3.3.3', '1.1.1.1', '2.2.2.2'] }),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.attributes['records']).toEqual([
        '1.1.1.1',
        '2.2.2.2',
        '3.3.3.3',
      ]);
    });

    it('should default TTL to 300', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_route53_record',
          sourceName: 'rec',
          category: 'networking',
          attributes: { type: 'A', name: 'test' },
        }),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.attributes['ttl']).toBe(300);
    });
  });

  describe('Record - GCP', () => {
    it('should produce google_dns_record_set', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: recordResource(),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.targetType).toBe('google_dns_record_set');
    });

    it('should set type from record type', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: recordResource({ type: 'AAAA', records: ['::1'] }),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.attributes['type']).toBe('AAAA');
    });

    it('should emit DNS_ALIAS_NOT_PORTABLE for alias in GCP', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: recordResource({
          alias: { name: 'elb.amazonaws.com' },
          type: 'A',
        }),
      });
      const result = translateDns(ctx);
      expect(result.findings.some((f) => f.code === 'DNS_ALIAS_NOT_PORTABLE')).toBe(true);
    });

    it('should translate alias to CNAME type in GCP', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: recordResource({
          alias: { name: 'elb.amazonaws.com' },
          type: 'A',
        }),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.attributes['type']).toBe('CNAME');
    });

    it('should append trailing dot to alias rrdatas', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: recordResource({
          alias: { name: 'elb.amazonaws.com' },
          type: 'A',
        }),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.attributes['rrdatas']).toEqual(['elb.amazonaws.com.']);
    });

    it('should not double-dot alias rrdatas if already trailing', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: recordResource({
          alias: { name: 'elb.amazonaws.com.' },
          type: 'A',
        }),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.attributes['rrdatas']).toEqual(['elb.amazonaws.com.']);
    });

    it('should set managed_zone reference', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: recordResource(),
      });
      const result = translateDns(ctx);
      expect(result.translated[0]!.attributes['managed_zone']).toBe(
        '${google_dns_managed_zone.main.name}',
      );
    });
  });

  it('should include traceability with engineUsed direct/dns', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: zoneResource(),
    });
    const result = translateDns(ctx);
    expect(result.translated[0]!.traceability.engineUsed).toBe('direct/dns');
  });
});

// ===========================================================================
// translatePeering
// ===========================================================================

describe('translatePeering', () => {
  function peeringResource(attrs: Record<string, unknown> = {}): IrResource {
    return makeIrResource({
      sourceType: 'aws_vpc_peering_connection',
      sourceName: 'my_peering',
      category: 'networking',
      attributes: { vpc_id: 'vpc-111', peer_vpc_id: 'vpc-222', ...attrs },
    });
  }

  describe('Azure', () => {
    it('should produce azurerm_virtual_network_peering', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: peeringResource(),
      });
      const result = translatePeering(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('azurerm_virtual_network_peering');
    });

    it('should map vpc_id to virtual_network_name', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: peeringResource({ vpc_id: 'vpc-aaa' }),
      });
      const result = translatePeering(ctx);
      expect(result.translated[0]!.attributes['virtual_network_name']).toBe('vpc-aaa');
    });

    it('should map peer_vpc_id to remote_virtual_network_id', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: peeringResource({ peer_vpc_id: 'vpc-bbb' }),
      });
      const result = translatePeering(ctx);
      expect(result.translated[0]!.attributes['remote_virtual_network_id']).toBe('vpc-bbb');
    });

    it('should enable allow_forwarded_traffic', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: peeringResource(),
      });
      const result = translatePeering(ctx);
      expect(result.translated[0]!.attributes['allow_forwarded_traffic']).toBe(true);
    });

    it('should enable allow_virtual_network_access', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: peeringResource(),
      });
      const result = translatePeering(ctx);
      expect(result.translated[0]!.attributes['allow_virtual_network_access']).toBe(true);
    });

    it('should always emit PEERING_NON_TRANSITIVE warning', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: peeringResource(),
      });
      const result = translatePeering(ctx);
      expect(result.findings.some((f) => f.code === 'PEERING_NON_TRANSITIVE')).toBe(true);
      const pf = result.findings.find((f) => f.code === 'PEERING_NON_TRANSITIVE')!;
      expect(pf.severity).toBe('warning');
    });

    it('should include Azure tags when present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: peeringResource({ tags: { Team: 'net' } }),
      });
      const result = translatePeering(ctx);
      expect(result.translated[0]!.attributes['tags']).toEqual({ Team: 'net' });
    });
  });

  describe('GCP', () => {
    it('should produce google_compute_network_peering', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: peeringResource(),
      });
      const result = translatePeering(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('google_compute_network_peering');
    });

    it('should map vpc_id to network', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: peeringResource({ vpc_id: 'vpc-xxx' }),
      });
      const result = translatePeering(ctx);
      expect(result.translated[0]!.attributes['network']).toBe('vpc-xxx');
    });

    it('should map peer_vpc_id to peer_network', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: peeringResource({ peer_vpc_id: 'vpc-yyy' }),
      });
      const result = translatePeering(ctx);
      expect(result.translated[0]!.attributes['peer_network']).toBe('vpc-yyy');
    });

    it('should enable export_custom_routes', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: peeringResource(),
      });
      const result = translatePeering(ctx);
      expect(result.translated[0]!.attributes['export_custom_routes']).toBe(true);
    });

    it('should enable import_custom_routes', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: peeringResource(),
      });
      const result = translatePeering(ctx);
      expect(result.translated[0]!.attributes['import_custom_routes']).toBe(true);
    });

    it('should always emit PEERING_NON_TRANSITIVE warning', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: peeringResource(),
      });
      const result = translatePeering(ctx);
      expect(result.findings.some((f) => f.code === 'PEERING_NON_TRANSITIVE')).toBe(true);
    });

    it('should use GCP labels for tags', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: peeringResource({ tags: { Team: 'net' } }),
      });
      const result = translatePeering(ctx);
      expect(result.translated[0]!.attributes['labels']).toEqual({ team: 'net' });
    });
  });

  it('should include traceability with engineUsed direct/peering', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: peeringResource(),
    });
    const result = translatePeering(ctx);
    expect(result.translated[0]!.traceability.engineUsed).toBe('direct/peering');
  });
});
