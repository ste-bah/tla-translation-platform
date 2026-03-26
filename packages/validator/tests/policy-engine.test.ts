import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  CanonicalIR,
  TranslationManifest,
  IrResource,
} from '@tla/shared';

import { createPolicyFinding } from '../src/policy/policy-helpers.js';
import { POLICY_CODES } from '../src/policy/policy-codes.js';
import { encryptionRequired } from '../src/policy/built-in/encryption-required.js';
import { ingressUnrestricted } from '../src/policy/built-in/ingress-unrestricted.js';
import { publicStorageBlocked } from '../src/policy/built-in/public-storage-blocked.js';
import { encryptionAtRest } from '../src/policy/built-in/encryption-at-rest.js';
import { BUILT_IN_POLICIES } from '../src/policy/built-in/index.js';
import { evaluateOpa } from '../src/policy/opa-client.js';
import { evaluatePolicies } from '../src/policy/policy-engine.js';
import type { PolicyEvalContext, OpaClientConfig } from '../src/policy/types.js';

// ---------------------------------------------------------------------------
// Test factories
// ---------------------------------------------------------------------------

function makeSourceLocation() {
  return { file: 'main.tf', line: 1, column: 0 };
}

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'aws_instance.web',
    sourceType: 'aws_instance',
    sourceName: 'web',
    sourceModule: null,
    category: 'compute',
    attributes: { instance_type: 't3.micro', ami: 'ami-12345' },
    sourceAttributes: {},
    registryEntryId: null,
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: makeSourceLocation(),
    ...overrides,
  };
}

function makeCanonicalIR(overrides: Partial<CanonicalIR> = {}): CanonicalIR {
  return {
    version: '1.0.0',
    sourceProvider: 'aws',
    resources: [makeIrResource()],
    relationships: [],
    modules: [],
    intents: [],
    metadata: {
      generatedAt: '2025-01-01T00:00:00Z',
      sourceFiles: ['main.tf'],
      toolVersion: '1.0.0',
      resourceCount: 1,
      relationshipCount: 0,
    },
    ...overrides,
  };
}

function makeTranslationManifest(overrides: Partial<TranslationManifest> = {}): TranslationManifest {
  return {
    version: '1.0.0',
    registryVersion: '1.0.0',
    target: 'azure',
    counts: { total: 1, translated: 1, expanded: 0, partial: 0, blocked: 0, advisory: 0 },
    entries: [],
    findings: [],
    confidenceOverall: 0.9,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<PolicyEvalContext> = {}): PolicyEvalContext {
  return {
    resourceId: 'aws_s3_bucket.data',
    sourceType: 'aws_s3_bucket',
    attributes: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper to create a mock fetch that returns a given JSON body
// ---------------------------------------------------------------------------

function mockFetchOk(body: unknown): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  }) as unknown as typeof globalThis.fetch;
}

function mockFetchError(status: number): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({}),
  }) as unknown as typeof globalThis.fetch;
}

// ===========================================================================
// 1. Policy Helpers
// ===========================================================================

describe('policy-helpers', () => {
  it('createPolicyFinding creates a basic finding', () => {
    const finding = createPolicyFinding(
      'res-1',
      'warning',
      POLICY_CODES.ENCRYPTION_REQUIRED,
      'Missing encryption',
    );

    expect(finding.resourceId).toBe('res-1');
    expect(finding.severity).toBe('warning');
    expect(finding.code).toBe('POLICY_ENCRYPTION_REQUIRED');
    expect(finding.message).toBe('Missing encryption');
    expect(finding.detail).toBeUndefined();
  });

  it('createPolicyFinding includes detail when provided', () => {
    const finding = createPolicyFinding(
      'res-2',
      'blocker',
      POLICY_CODES.INGRESS_UNRESTRICTED,
      'Open ingress',
      'Extra detail here',
    );

    expect(finding.detail).toBe('Extra detail here');
    expect(finding.severity).toBe('blocker');
  });

  it('POLICY_CODES has exactly 7 entries', () => {
    const codes = Object.keys(POLICY_CODES);
    expect(codes).toHaveLength(7);
    expect(codes).toContain('ENCRYPTION_REQUIRED');
    expect(codes).toContain('INGRESS_UNRESTRICTED');
    expect(codes).toContain('PUBLIC_STORAGE_BLOCKED');
    expect(codes).toContain('ENCRYPTION_AT_REST');
    expect(codes).toContain('OPA_VIOLATION');
    expect(codes).toContain('OPA_ERROR');
    expect(codes).toContain('ENGINE_ERROR');
  });
});

// ===========================================================================
// 2. Encryption Required Policy
// ===========================================================================

describe('encryption_required policy', () => {
  it('S3 missing SSE returns violation', () => {
    const ctx = makeCtx({
      resourceId: 'aws_s3_bucket.data',
      sourceType: 'aws_s3_bucket',
      attributes: {},
    });
    const result = encryptionRequired.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.code).toBe(POLICY_CODES.ENCRYPTION_REQUIRED);
    expect(result!.message).toContain('server-side encryption');
  });

  it('S3 with SSE passes', () => {
    const ctx = makeCtx({
      sourceType: 'aws_s3_bucket',
      attributes: { server_side_encryption_configuration: { rule: {} } },
    });
    const result = encryptionRequired.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it('RDS storage_encrypted false returns violation', () => {
    const ctx = makeCtx({
      resourceId: 'aws_db_instance.main',
      sourceType: 'aws_db_instance',
      attributes: { storage_encrypted: false },
    });
    const result = encryptionRequired.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain('storage_encrypted');
  });

  it('RDS storage_encrypted true passes', () => {
    const ctx = makeCtx({
      sourceType: 'aws_db_instance',
      attributes: { storage_encrypted: true },
    });
    const result = encryptionRequired.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it('non-applicable resource type returns null', () => {
    const ctx = makeCtx({
      sourceType: 'aws_lambda_function',
      attributes: {},
    });
    const result = encryptionRequired.evaluate(ctx);
    expect(result).toBeNull();
  });
});

// ===========================================================================
// 3. Ingress Unrestricted Policy
// ===========================================================================

describe('ingress_unrestricted policy', () => {
  it('SG with 0.0.0.0/0 + protocol -1 returns violation', () => {
    const ctx = makeCtx({
      resourceId: 'aws_security_group.open',
      sourceType: 'aws_security_group',
      attributes: {
        ingress: [
          { cidr_blocks: ['0.0.0.0/0'], protocol: '-1', from_port: 0, to_port: 0 },
        ],
      },
    });
    const result = ingressUnrestricted.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.severity).toBe('blocker');
    expect(result!.code).toBe(POLICY_CODES.INGRESS_UNRESTRICTED);
  });

  it('SG with 0.0.0.0/0 + all ports returns violation', () => {
    const ctx = makeCtx({
      sourceType: 'aws_security_group',
      attributes: {
        ingress: [
          { cidr_blocks: ['0.0.0.0/0'], protocol: 'tcp', from_port: 0, to_port: 65535 },
        ],
      },
    });
    const result = ingressUnrestricted.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
  });

  it('SG with restricted CIDR passes', () => {
    const ctx = makeCtx({
      sourceType: 'aws_security_group',
      attributes: {
        ingress: [
          { cidr_blocks: ['10.0.0.0/8'], protocol: 'tcp', from_port: 443, to_port: 443 },
        ],
      },
    });
    const result = ingressUnrestricted.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it('SG with no ingress rules passes', () => {
    const ctx = makeCtx({
      sourceType: 'aws_security_group',
      attributes: { ingress: [] },
    });
    const result = ingressUnrestricted.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it('non-SG resource returns null', () => {
    const ctx = makeCtx({
      sourceType: 'aws_instance',
      attributes: {},
    });
    const result = ingressUnrestricted.evaluate(ctx);
    expect(result).toBeNull();
  });
});

// ===========================================================================
// 4. Public Storage Blocked Policy
// ===========================================================================

describe('public_storage_blocked policy', () => {
  it('S3 public-read ACL returns violation', () => {
    const ctx = makeCtx({
      sourceType: 'aws_s3_bucket',
      attributes: { acl: 'public-read' },
    });
    const result = publicStorageBlocked.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.severity).toBe('blocker');
    expect(result!.message).toContain('public ACL');
  });

  it('S3 private ACL passes', () => {
    const ctx = makeCtx({
      sourceType: 'aws_s3_bucket',
      attributes: { acl: 'private' },
    });
    const result = publicStorageBlocked.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it('RDS publicly_accessible true returns violation', () => {
    const ctx = makeCtx({
      sourceType: 'aws_db_instance',
      attributes: { publicly_accessible: true },
    });
    const result = publicStorageBlocked.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain('publicly accessible');
  });

  it('RDS publicly_accessible false passes', () => {
    const ctx = makeCtx({
      sourceType: 'aws_db_instance',
      attributes: { publicly_accessible: false },
    });
    const result = publicStorageBlocked.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });
});

// ===========================================================================
// 5. Encryption At Rest Policy
// ===========================================================================

describe('encryption_at_rest policy', () => {
  it('RDS no storage_encrypted returns violation', () => {
    const ctx = makeCtx({
      sourceType: 'aws_db_instance',
      attributes: {},
    });
    const result = encryptionAtRest.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.code).toBe(POLICY_CODES.ENCRYPTION_AT_REST);
  });

  it('EC2 root_block_device.encrypted false returns violation', () => {
    const ctx = makeCtx({
      sourceType: 'aws_instance',
      attributes: {
        root_block_device: { encrypted: false },
      },
    });
    const result = encryptionAtRest.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.message).toContain('root_block_device');
  });

  it('ElastiCache at_rest false returns violation', () => {
    const ctx = makeCtx({
      sourceType: 'aws_elasticache_replication_group',
      attributes: { at_rest_encryption_enabled: false },
    });
    const result = encryptionAtRest.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
  });

  it('all encrypted passes', () => {
    const ctx = makeCtx({
      sourceType: 'aws_db_instance',
      attributes: { storage_encrypted: true },
    });
    const result = encryptionAtRest.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });
});

// ===========================================================================
// 6. OPA Client
// ===========================================================================

describe('opa-client', () => {
  const opaConfig: OpaClientConfig = {
    baseUrl: 'http://localhost:8181',
    path: 'tla/deny',
    timeoutMs: 5000,
  };

  it('successful query with violations returns PolicyResult[]', async () => {
    const violations = [
      { msg: 'S3 bucket is public', severity: 'blocker', resource_id: 'aws_s3_bucket.data' },
      { message: 'Missing tags', severity: 'warning' },
    ];
    const fetchFn = mockFetchOk({ result: violations });
    const ir = makeCanonicalIR();

    const results = await evaluateOpa(ir, opaConfig, fetchFn);

    expect(results).toHaveLength(2);
    expect(results[0].passed).toBe(false);
    expect(results[0].policyId).toBe('opa');
    expect(results[0].code).toBe(POLICY_CODES.OPA_VIOLATION);
    expect(results[0].severity).toBe('blocker');
    expect(results[0].resourceId).toBe('aws_s3_bucket.data');
    expect(results[0].message).toBe('S3 bucket is public');

    expect(results[1].severity).toBe('warning');
    expect(results[1].resourceId).toBe('*'); // fallback
    expect(results[1].message).toBe('Missing tags');
  });

  it('successful query with no violations returns empty', async () => {
    const fetchFn = mockFetchOk({ result: {} }); // non-array = no violations
    const ir = makeCanonicalIR();

    const results = await evaluateOpa(ir, opaConfig, fetchFn);
    expect(results).toHaveLength(0);
  });

  it('HTTP error returns OPA_ERROR result', async () => {
    const fetchFn = mockFetchError(500);
    const ir = makeCanonicalIR();

    const results = await evaluateOpa(ir, opaConfig, fetchFn);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].code).toBe(POLICY_CODES.OPA_ERROR);
    expect(results[0].message).toContain('HTTP 500');
  });

  it('timeout returns OPA_ERROR with timeout message', async () => {
    const fetchFn = vi.fn().mockRejectedValue(
      Object.assign(new DOMException('The operation was aborted', 'AbortError'), {}),
    ) as unknown as typeof globalThis.fetch;
    const ir = makeCanonicalIR();

    const results = await evaluateOpa(ir, { ...opaConfig, timeoutMs: 100 }, fetchFn);

    expect(results).toHaveLength(1);
    expect(results[0].code).toBe(POLICY_CODES.OPA_ERROR);
    expect(results[0].message).toContain('timed out');
  });
});

// ===========================================================================
// 7. Policy Engine Orchestrator
// ===========================================================================

describe('policy-engine evaluatePolicies', () => {
  it('empty IR returns empty report with passed true', async () => {
    const ir = makeCanonicalIR({ resources: [] });
    const manifest = makeTranslationManifest();

    const report = await evaluatePolicies(ir, manifest);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(0);
    expect(report.findings).toHaveLength(0);
    expect(report.summary.total).toBe(0);
    expect(report.summary.passed).toBe(0);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.errors).toBe(0);
  });

  it('single resource with violation returns report with findings', async () => {
    const ir = makeCanonicalIR({
      resources: [
        makeIrResource({
          id: 'aws_s3_bucket.data',
          sourceType: 'aws_s3_bucket',
          sourceName: 'data',
          category: 'storage',
          attributes: { acl: 'public-read' }, // triggers public_storage_blocked (blocker)
          // also triggers encryption_required (no SSE) and encryption_at_rest (no SSE)
        }),
      ],
    });
    const manifest = makeTranslationManifest();

    const report = await evaluatePolicies(ir, manifest);

    expect(report.passed).toBe(false);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.summary.failed).toBeGreaterThan(0);

    // There should be failures for encryption_required, public_storage_blocked, encryption_at_rest
    const failedCodes = report.findings.map((f) => f.code);
    expect(failedCodes).toContain(POLICY_CODES.ENCRYPTION_REQUIRED);
    expect(failedCodes).toContain(POLICY_CODES.PUBLIC_STORAGE_BLOCKED);
    expect(failedCodes).toContain(POLICY_CODES.ENCRYPTION_AT_REST);
  });

  it('mixed resources produce correct summary counts', async () => {
    const ir = makeCanonicalIR({
      resources: [
        // This S3 bucket passes all policies (has SSE + private ACL)
        makeIrResource({
          id: 'aws_s3_bucket.good',
          sourceType: 'aws_s3_bucket',
          sourceName: 'good',
          category: 'storage',
          attributes: {
            acl: 'private',
            server_side_encryption_configuration: { rule: {} },
          },
        }),
        // This SG triggers a blocker (open ingress)
        makeIrResource({
          id: 'aws_security_group.bad',
          sourceType: 'aws_security_group',
          sourceName: 'bad',
          category: 'networking',
          attributes: {
            ingress: [{ cidr_blocks: ['0.0.0.0/0'], protocol: '-1' }],
          },
        }),
      ],
    });
    const manifest = makeTranslationManifest();

    const report = await evaluatePolicies(ir, manifest);

    expect(report.passed).toBe(false);
    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.summary.passed).toBeGreaterThan(0);
    expect(report.summary.failed).toBeGreaterThan(0);
    // Verify the ingress violation is present
    const ingressFindings = report.findings.filter(
      (f) => f.code === POLICY_CODES.INGRESS_UNRESTRICTED,
    );
    expect(ingressFindings).toHaveLength(1);
  });

  it('OPA integration via mock fetch', async () => {
    const violations = [
      { msg: 'Custom OPA rule failed', severity: 'warning', resource_id: 'res-1' },
    ];
    const fetchFn = mockFetchOk({ result: violations });

    const ir = makeCanonicalIR({ resources: [] }); // empty IR so only OPA fires
    const manifest = makeTranslationManifest();

    const report = await evaluatePolicies(ir, manifest, {
      skipBuiltIn: true,
      opa: { baseUrl: 'http://localhost:8181', path: 'tla/deny' },
      fetch: fetchFn,
    });

    expect(report.passed).toBe(false);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].code).toBe(POLICY_CODES.OPA_VIOLATION);
    expect(report.results[0].message).toBe('Custom OPA rule failed');
    expect(report.findings).toHaveLength(1);
  });

  it('never throws on engine error', async () => {
    // Provide a fetch that throws a generic error for OPA
    const fetchFn = vi.fn().mockRejectedValue(new Error('Network down')) as unknown as typeof globalThis.fetch;

    const ir = makeCanonicalIR({ resources: [] });
    const manifest = makeTranslationManifest();

    const report = await evaluatePolicies(ir, manifest, {
      skipBuiltIn: true,
      opa: { baseUrl: 'http://localhost:8181', path: 'tla/deny' },
      fetch: fetchFn,
    });

    // Should NOT throw; error is captured
    expect(report).toBeDefined();
    expect(report.summary.errors).toBeGreaterThanOrEqual(1);
  });

  it('skipBuiltIn true skips built-in policies', async () => {
    const ir = makeCanonicalIR({
      resources: [
        makeIrResource({
          id: 'aws_s3_bucket.unenc',
          sourceType: 'aws_s3_bucket',
          sourceName: 'unenc',
          category: 'storage',
          attributes: {},
        }),
      ],
    });
    const manifest = makeTranslationManifest();

    const report = await evaluatePolicies(ir, manifest, { skipBuiltIn: true });

    // With no OPA and built-in skipped, there should be no results at all
    expect(report.results).toHaveLength(0);
    expect(report.passed).toBe(true);
  });
});

// ===========================================================================
// 8. Built-in policy registry
// ===========================================================================

describe('BUILT_IN_POLICIES registry', () => {
  it('contains exactly 4 policies', () => {
    expect(BUILT_IN_POLICIES).toHaveLength(4);
  });

  it('all policies have required shape', () => {
    for (const policy of BUILT_IN_POLICIES) {
      expect(typeof policy.id).toBe('string');
      expect(typeof policy.description).toBe('string');
      expect(typeof policy.evaluate).toBe('function');
      expect(['blocker', 'warning', 'info']).toContain(policy.severity);
    }
  });
});
