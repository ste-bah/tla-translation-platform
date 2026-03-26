import { describe, it, expect, vi } from 'vitest';
import { advisoryEngine } from '../../src/engines/advisory-engine.js';
import { createAdvisoryStub, createManualTaskFinding } from '../../src/engines/advisory/advisory-helpers.js';
import { translateDynamoDb } from '../../src/engines/advisory/dynamodb-advisory.js';
import { translateIam } from '../../src/engines/advisory/iam-advisory.js';
import { translateCloudfront } from '../../src/engines/advisory/cloudfront-advisory.js';
import { translateRoute53Health } from '../../src/engines/advisory/route53-health-advisory.js';
import { translateElasticacheCluster } from '../../src/engines/advisory/elasticache-cluster-advisory.js';
import type { TranslationContext } from '../../src/engines/mapping-engine.js';
import type {
  IrResource,
  RegistryEntry,
  CanonicalIR,
  CloudProvider,
  CompilerOptions,
} from '@tla/shared';
import type { RegistryApi } from '@tla/registry';

// ===========================================================================
// Factory helpers
// ===========================================================================

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'res-001',
    sourceType: 'aws_dynamodb_table',
    sourceName: 'my_table',
    sourceModule: null,
    category: 'database',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: 'SER-DB-DDB-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-DB-DDB-001',
    aws_service: 'aws_dynamodb_table',
    aws_family: 'database',
    azure_targets: [],
    gcp_targets: [],
    mapping_type: 'none',
    output_mode: 'native_emit_only',
    band: 'P4',
    confidence: 0,
    portable_provider_candidate: false,
    behavioral_gaps: [],
    manual_review_required: true,
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
        resourceCount: 1,
        relationshipCount: 0,
      },
    } as CanonicalIR,
    registry: makeMockRegistry(),
    options: makeCompilerOptions(),
    ...overrides,
  };
}

// ===========================================================================
// advisory-helpers
// ===========================================================================

describe('advisory-helpers', () => {
  describe('createAdvisoryStub', () => {
    it('should return translated:[] and 1 warning finding', () => {
      const ctx = makeTranslationContext();
      const result = createAdvisoryStub(
        ctx,
        'TEST_ADVISORY',
        'Test reason',
        ['Step 1', 'Step 2'],
        ['Alt A', 'Alt B'],
      );

      expect(result.translated).toHaveLength(0);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]!.severity).toBe('warning');
      expect(result.findings[0]!.code).toBe('TEST_ADVISORY');
    });

    it('should produce valid JSON detail with migrationSteps and alternatives', () => {
      const ctx = makeTranslationContext();
      const result = createAdvisoryStub(
        ctx,
        'TEST_ADVISORY',
        'Test reason',
        ['Step 1', 'Step 2'],
        ['Alt A'],
      );

      const detail = JSON.parse(result.findings[0]!.detail!);
      expect(detail.migrationSteps).toEqual(['Step 1', 'Step 2']);
      expect(detail.alternatives).toEqual(['Alt A']);
    });

    it('should never return blocker severity', () => {
      const ctx = makeTranslationContext();
      const result = createAdvisoryStub(ctx, 'X', 'reason', [], []);

      for (const f of result.findings) {
        expect(f.severity).not.toBe('blocker');
      }
    });
  });

  describe('createManualTaskFinding', () => {
    it('should return a finding with severity warning', () => {
      const finding = createManualTaskFinding('res-001', 'MANUAL_TASK', 'Do this', 'details');

      expect(finding.severity).toBe('warning');
      expect(finding.code).toBe('MANUAL_TASK');
      expect(finding.resourceId).toBe('res-001');
      expect(finding.message).toBe('Do this');
      expect(finding.detail).toBe('details');
    });
  });
});

// ===========================================================================
// DynamoDB Advisory
// ===========================================================================

describe('DynamoDB Advisory', () => {
  it('should mention CosmosDB for azure target', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ sourceType: 'aws_dynamodb_table' }),
    });
    const result = translateDynamoDb(ctx);

    expect(result.translated).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.code).toContain('DYNAMODB');

    const detail = JSON.parse(result.findings[0]!.detail!);
    const altText = detail.alternatives.join(' ');
    expect(altText).toContain('Cosmos');
  });

  it('should mention Bigtable/Firestore for gcp target', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ sourceType: 'aws_dynamodb_table' }),
    });
    const result = translateDynamoDb(ctx);

    expect(result.translated).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.code).toContain('DYNAMODB');

    const detail = JSON.parse(result.findings[0]!.detail!);
    const altText = detail.alternatives.join(' ');
    expect(altText).toMatch(/Bigtable|Firestore/);
  });

  it('should always return empty translated array', () => {
    for (const target of ['azure', 'gcp'] as CloudProvider[]) {
      const ctx = makeTranslationContext({
        targetProvider: target,
        resource: makeIrResource({ sourceType: 'aws_dynamodb_table' }),
      });
      const result = translateDynamoDb(ctx);
      expect(result.translated).toHaveLength(0);
    }
  });
});

// ===========================================================================
// IAM Advisory
// ===========================================================================

describe('IAM Advisory', () => {
  it('should mention Entra ID for aws_iam_role on azure', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ sourceType: 'aws_iam_role' }),
    });
    const result = translateIam(ctx);

    expect(result.findings).toHaveLength(1);
    const msg = result.findings[0]!.message;
    expect(msg).toMatch(/Entra|Azure AD/i);
  });

  it('should mention GCP IAM/service accounts for aws_iam_role on gcp', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ sourceType: 'aws_iam_role' }),
    });
    const result = translateIam(ctx);

    expect(result.findings).toHaveLength(1);
    const detail = JSON.parse(result.findings[0]!.detail!);
    const altText = detail.alternatives.join(' ');
    expect(altText).toMatch(/Service Account|IAM/i);
  });

  it('should handle aws_iam_policy same as aws_iam_role dispatch', () => {
    const ctxRole = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ sourceType: 'aws_iam_role' }),
    });
    const ctxPolicy = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ sourceType: 'aws_iam_policy' }),
    });
    const resultRole = translateIam(ctxRole);
    const resultPolicy = translateIam(ctxPolicy);

    expect(resultRole.findings[0]!.code).toBe(resultPolicy.findings[0]!.code);
    expect(resultRole.translated).toHaveLength(0);
    expect(resultPolicy.translated).toHaveLength(0);
  });

  it('should NEVER contain policy document content in finding detail', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        sourceType: 'aws_iam_policy',
        attributes: {
          policy: '{"Statement":[{"Effect":"Allow","Action":"s3:*","Resource":"*"}]}',
        },
      }),
    });
    const result = translateIam(ctx);
    const detail = result.findings[0]!.detail!;

    expect(detail).not.toContain('s3:*');
    expect(detail).not.toContain('Statement');
    expect(detail).not.toContain('Effect');
  });
});

// ===========================================================================
// CloudFront Advisory
// ===========================================================================

describe('CloudFront Advisory', () => {
  it('should mention Front Door or CDN for azure target', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ sourceType: 'aws_cloudfront_distribution' }),
    });
    const result = translateCloudfront(ctx);

    expect(result.translated).toHaveLength(0);
    expect(result.findings).toHaveLength(1);

    const detail = JSON.parse(result.findings[0]!.detail!);
    const altText = detail.alternatives.join(' ');
    expect(altText).toMatch(/Front Door|CDN/);
  });

  it('should mention Cloud CDN for gcp target', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ sourceType: 'aws_cloudfront_distribution' }),
    });
    const result = translateCloudfront(ctx);

    expect(result.translated).toHaveLength(0);
    const detail = JSON.parse(result.findings[0]!.detail!);
    const altText = detail.alternatives.join(' ');
    expect(altText).toContain('Cloud CDN');
  });
});

// ===========================================================================
// Route53 Health Advisory
// ===========================================================================

describe('Route53 Health Advisory', () => {
  it('should mention Traffic Manager or Azure Monitor for azure', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({ sourceType: 'aws_route53_health_check' }),
    });
    const result = translateRoute53Health(ctx);

    expect(result.translated).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    const msg = result.findings[0]!.message;
    expect(msg).toMatch(/Traffic Manager|Azure Monitor/);
  });

  it('should mention Cloud Monitoring uptime checks for gcp', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({ sourceType: 'aws_route53_health_check' }),
    });
    const result = translateRoute53Health(ctx);

    expect(result.translated).toHaveLength(0);
    const msg = result.findings[0]!.message;
    expect(msg).toMatch(/Cloud Monitoring|uptime check/i);
  });
});

// ===========================================================================
// ElastiCache Cluster Advisory
// ===========================================================================

describe('ElastiCache Cluster Advisory', () => {
  it('should mention Azure Cache for Redis for azure', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        sourceType: 'aws_elasticache_cluster',
        attributes: { engine: 'redis' },
      }),
    });
    const result = translateElasticacheCluster(ctx);

    expect(result.translated).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    const msg = result.findings[0]!.message;
    expect(msg).toMatch(/Azure Cache for Redis/);
  });

  it('should mention Memorystore for gcp', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({
        sourceType: 'aws_elasticache_cluster',
        attributes: { engine: 'redis' },
      }),
    });
    const result = translateElasticacheCluster(ctx);

    expect(result.translated).toHaveLength(0);
    const msg = result.findings[0]!.message;
    expect(msg).toContain('Memorystore');
  });
});

// ===========================================================================
// Advisory Engine Dispatch
// ===========================================================================

describe('Advisory Engine Dispatch', () => {
  it('should dispatch aws_dynamodb_table to DynamoDB advisory', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_dynamodb_table' }),
    });
    const result = advisoryEngine.translate(ctx);

    expect(result.findings[0]!.code).toContain('DYNAMODB');
  });

  it('should dispatch aws_iam_role to IAM advisory', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_iam_role' }),
    });
    const result = advisoryEngine.translate(ctx);

    expect(result.findings[0]!.code).toBe('IAM_ADVISORY');
  });

  it('should dispatch aws_iam_policy to IAM advisory', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_iam_policy' }),
    });
    const result = advisoryEngine.translate(ctx);

    expect(result.findings[0]!.code).toBe('IAM_ADVISORY');
  });

  it('should dispatch aws_cloudfront_distribution to CloudFront advisory', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_cloudfront_distribution' }),
    });
    const result = advisoryEngine.translate(ctx);

    expect(result.findings[0]!.code).toContain('CLOUDFRONT');
  });

  it('should dispatch aws_route53_health_check to Route53 advisory', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_route53_health_check' }),
    });
    const result = advisoryEngine.translate(ctx);

    expect(result.findings[0]!.code).toContain('ROUTE53');
  });

  it('should dispatch aws_elasticache_cluster to ElastiCache advisory', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_elasticache_cluster' }),
    });
    const result = advisoryEngine.translate(ctx);

    expect(result.findings[0]!.code).toContain('ELASTICACHE');
  });

  it('should fall back to generic ADVISORY_NO_MAPPER for unknown type', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_unknown_thing' }),
    });
    const result = advisoryEngine.translate(ctx);

    expect(result.translated).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.code).toBe('ADVISORY_NO_MAPPER');
    expect(result.findings[0]!.message).toContain('aws_unknown_thing');
  });

  it('should always produce warning severity (never blocker) for all dispatched types', () => {
    const sourceTypes = [
      'aws_dynamodb_table',
      'aws_iam_role',
      'aws_iam_policy',
      'aws_cloudfront_distribution',
      'aws_route53_health_check',
      'aws_elasticache_cluster',
      'aws_totally_unknown',
    ];

    for (const sourceType of sourceTypes) {
      const ctx = makeTranslationContext({
        resource: makeIrResource({ sourceType }),
      });
      const result = advisoryEngine.translate(ctx);

      for (const f of result.findings) {
        expect(f.severity).toBe('warning');
      }
    }
  });

  it('should always return translated:[] for all dispatched types', () => {
    const sourceTypes = [
      'aws_dynamodb_table',
      'aws_iam_role',
      'aws_iam_policy',
      'aws_cloudfront_distribution',
      'aws_route53_health_check',
      'aws_elasticache_cluster',
      'aws_totally_unknown',
    ];

    for (const sourceType of sourceTypes) {
      const ctx = makeTranslationContext({
        resource: makeIrResource({ sourceType }),
      });
      const result = advisoryEngine.translate(ctx);
      expect(result.translated).toHaveLength(0);
    }
  });

  it('should have mappingType "none"', () => {
    expect(advisoryEngine.mappingType).toBe('none');
  });
});
