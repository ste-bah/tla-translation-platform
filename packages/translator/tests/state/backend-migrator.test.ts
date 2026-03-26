import { describe, it, expect } from 'vitest';
import type { HclBackend } from '@tla/shared';
import type { TranslationFinding } from '@tla/shared';
import { detectS3Backend } from '../../src/state/s3-detector.js';
import { scrubCredentials } from '../../src/state/credential-scrubber.js';
import { generateAzureBackend } from '../../src/state/azure-backend.js';
import { generateGcpBackend } from '../../src/state/gcp-backend.js';
import { generateRunbook } from '../../src/state/runbook-generator.js';
import { migrateBackend } from '../../src/state/backend-migrator.js';
import type { BackendMigrationOptions } from '../../src/state/backend-migrator.js';

// ===========================================================================
// Factory helpers
// ===========================================================================

function makeBackend(
  type: string,
  attributes: Record<string, unknown> = {},
): HclBackend {
  return { type, attributes };
}

function makeOptions(
  targetProvider: 'azure' | 'gcp',
  overrides?: Partial<BackendMigrationOptions>,
): BackendMigrationOptions {
  return { targetProvider, ...overrides };
}

/** A complete S3 backend with all common fields populated. */
function makeFullS3Backend(): HclBackend {
  return makeBackend('s3', {
    bucket: 'my-tf-state',
    key: 'env/prod/terraform.tfstate',
    region: 'us-west-2',
    encrypt: true,
    dynamodb_table: 'tf-lock',
    workspace_key_prefix: 'workspaces',
    profile: 'production',
    role_arn: 'arn:aws:iam::123:role/deploy',
    acl: 'bucket-owner-full-control',
  });
}

function findingCodes(findings: readonly TranslationFinding[]): string[] {
  return findings.map((f) => f.code);
}

// ===========================================================================
// s3-detector
// ===========================================================================

describe('s3-detector', () => {
  it('returns null for a local backend', () => {
    const result = detectS3Backend(makeBackend('local', { path: './state' }));
    expect(result).toBeNull();
  });

  it('returns null for a consul backend', () => {
    const result = detectS3Backend(makeBackend('consul', { address: 'demo.consul.io' }));
    expect(result).toBeNull();
  });

  it('extracts all fields from a complete S3 config', () => {
    const backend = makeFullS3Backend();
    const result = detectS3Backend(backend);
    expect(result).not.toBeNull();
    const { attrs } = result!;
    expect(attrs.bucket).toBe('my-tf-state');
    expect(attrs.key).toBe('env/prod/terraform.tfstate');
    expect(attrs.region).toBe('us-west-2');
    expect(attrs.encrypt).toBe(true);
    expect(attrs.dynamodb_table).toBe('tf-lock');
    expect(attrs.workspace_key_prefix).toBe('workspaces');
    expect(attrs.profile).toBe('production');
    expect(attrs.role_arn).toBe('arn:aws:iam::123:role/deploy');
    expect(attrs.acl).toBe('bucket-owner-full-control');
  });

  it('defaults key to empty string when missing', () => {
    const result = detectS3Backend(makeBackend('s3', { bucket: 'b' }));
    expect(result).not.toBeNull();
    expect(result!.attrs.key).toBe('');
  });

  it('defaults region to undefined when missing', () => {
    const result = detectS3Backend(makeBackend('s3', { bucket: 'b', key: 'k' }));
    expect(result).not.toBeNull();
    expect(result!.attrs.region).toBeUndefined();
  });

  it('detects workspace_key_prefix and sets usesWorkspaces advisory', () => {
    const result = detectS3Backend(
      makeBackend('s3', {
        bucket: 'b',
        key: 'k',
        workspace_key_prefix: 'ws',
      }),
    );
    expect(result).not.toBeNull();
    const codes = findingCodes(result!.findings);
    expect(codes).toContain('STATE_WORKSPACE_ADVISORY');
  });

  it('emits STATE_BACKEND_DETECTED info finding', () => {
    const result = detectS3Backend(makeBackend('s3', { bucket: 'b', key: 'k' }));
    expect(result).not.toBeNull();
    const codes = findingCodes(result!.findings);
    expect(codes).toContain('STATE_BACKEND_DETECTED');
    const detected = result!.findings.find((f) => f.code === 'STATE_BACKEND_DETECTED');
    expect(detected!.severity).toBe('info');
  });

  it('emits STATE_DYNAMO_LOCK_ADVISORY when dynamodb_table present', () => {
    const result = detectS3Backend(
      makeBackend('s3', {
        bucket: 'b',
        key: 'k',
        dynamodb_table: 'locks',
      }),
    );
    expect(result).not.toBeNull();
    const codes = findingCodes(result!.findings);
    expect(codes).toContain('STATE_DYNAMO_LOCK_ADVISORY');
    const dynamo = result!.findings.find((f) => f.code === 'STATE_DYNAMO_LOCK_ADVISORY');
    expect(dynamo!.severity).toBe('warning');
    expect(dynamo!.message).toContain('locks');
  });
});

// ===========================================================================
// credential-scrubber
// ===========================================================================

describe('credential-scrubber', () => {
  it('passes through safe keys (bucket, key, region)', () => {
    const attrs = { bucket: 'b', key: 'k', region: 'us-east-1' };
    const result = scrubCredentials(attrs);
    expect(result.scrubbed).toEqual(attrs);
    expect(result.findings).toHaveLength(0);
  });

  it('strips access_key and secret_key', () => {
    const attrs = {
      bucket: 'b',
      access_key: 'AKIA...',
      secret_key: 'secret...',
    };
    const result = scrubCredentials(attrs);
    expect(result.scrubbed).toEqual({ bucket: 'b' });
    expect(result.findings).toHaveLength(2);
  });

  it('strips all 12 credential keys when present', () => {
    const attrs: Record<string, unknown> = {
      bucket: 'b',
      access_key: 'x',
      secret_key: 'x',
      token: 'x',
      session_token: 'x',
      role_arn: 'x',
      external_id: 'x',
      profile: 'x',
      shared_credentials_file: 'x',
      shared_credentials_files: 'x',
      web_identity_token_file: 'x',
      web_identity_token: 'x',
      assume_role_with_web_identity: 'x',
    };
    const result = scrubCredentials(attrs);
    expect(Object.keys(result.scrubbed)).toEqual(['bucket']);
    expect(result.findings).toHaveLength(12);
    for (const f of result.findings) {
      expect(f.code).toBe('STATE_CREDENTIAL_SCRUBBED');
      expect(f.severity).toBe('info');
    }
  });

  it('each stripped key produces a STATE_CREDENTIAL_SCRUBBED finding', () => {
    const attrs = { access_key: 'x', secret_key: 'y' };
    const result = scrubCredentials(attrs);
    expect(result.findings).toHaveLength(2);
    const messages = result.findings.map((f) => f.message);
    expect(messages).toContain(
      "Credential attribute 'access_key' removed from backend configuration",
    );
    expect(messages).toContain(
      "Credential attribute 'secret_key' removed from backend configuration",
    );
  });

  it('empty attributes yields empty scrubbed and no findings', () => {
    const result = scrubCredentials({});
    expect(result.scrubbed).toEqual({});
    expect(result.findings).toHaveLength(0);
  });
});

// ===========================================================================
// azure-backend
// ===========================================================================

describe('azure-backend', () => {
  const baseAttrs = {
    bucket: 'my-state-bucket',
    key: 'prod/terraform.tfstate',
  } as const;

  it('generates a backend "azurerm" HCL entry', () => {
    const entry = generateAzureBackend(baseAttrs);
    expect(entry.key).toBe('backend "azurerm"');
    expect(entry.value.kind).toBe('block');
  });

  it('maps bucket to container_name', () => {
    const entry = generateAzureBackend(baseAttrs);
    const body = (entry.value as { kind: 'block'; body: Array<{ key: string; value: { kind: string; value?: unknown } }> }).body;
    const containerName = body.find((b) => b.key === 'container_name');
    expect(containerName).toBeDefined();
    expect(containerName!.value).toEqual({ kind: 'literal', value: 'my-state-bucket' });
  });

  it('uses var.resource_group_name and var.storage_account_name expressions by default', () => {
    const entry = generateAzureBackend(baseAttrs);
    const body = (entry.value as { kind: 'block'; body: Array<{ key: string; value: { kind: string; expr?: string } }> }).body;
    const rg = body.find((b) => b.key === 'resource_group_name');
    const sa = body.find((b) => b.key === 'storage_account_name');
    expect(rg!.value).toEqual({ kind: 'expr', expr: 'var.resource_group_name' });
    expect(sa!.value).toEqual({ kind: 'expr', expr: 'var.storage_account_name' });
  });

  it('uses literal options when provided', () => {
    const entry = generateAzureBackend(baseAttrs, {
      resourceGroupName: 'my-rg',
      storageAccountName: 'mystorageacct',
      containerName: 'custom-container',
    });
    const body = (entry.value as { kind: 'block'; body: Array<{ key: string; value: { kind: string; expr?: string; value?: unknown } }> }).body;
    const rg = body.find((b) => b.key === 'resource_group_name');
    const sa = body.find((b) => b.key === 'storage_account_name');
    const cn = body.find((b) => b.key === 'container_name');
    expect(rg!.value).toEqual({ kind: 'expr', expr: 'my-rg' });
    expect(sa!.value).toEqual({ kind: 'expr', expr: 'mystorageacct' });
    expect(cn!.value).toEqual({ kind: 'literal', value: 'custom-container' });
  });

  it('maps key correctly', () => {
    const entry = generateAzureBackend(baseAttrs);
    const body = (entry.value as { kind: 'block'; body: Array<{ key: string; value: { kind: string; value?: unknown } }> }).body;
    const keyEntry = body.find((b) => b.key === 'key');
    expect(keyEntry!.value).toEqual({ kind: 'literal', value: 'prod/terraform.tfstate' });
  });
});

// ===========================================================================
// gcp-backend
// ===========================================================================

describe('gcp-backend', () => {
  const baseAttrs = {
    bucket: 'my-state-bucket',
    key: 'env/prod/terraform.tfstate',
  } as const;

  it('generates a backend "gcs" HCL entry', () => {
    const entry = generateGcpBackend(baseAttrs);
    expect(entry.key).toBe('backend "gcs"');
    expect(entry.value.kind).toBe('block');
  });

  it('maps bucket to bucket', () => {
    const entry = generateGcpBackend(baseAttrs);
    const body = (entry.value as { kind: 'block'; body: Array<{ key: string; value: { kind: string; value?: unknown } }> }).body;
    const bucketEntry = body.find((b) => b.key === 'bucket');
    expect(bucketEntry!.value).toEqual({ kind: 'literal', value: 'my-state-bucket' });
  });

  it('extracts prefix from key path (dirname)', () => {
    const entry = generateGcpBackend(baseAttrs);
    const body = (entry.value as { kind: 'block'; body: Array<{ key: string; value: { kind: string; value?: unknown } }> }).body;
    const prefix = body.find((b) => b.key === 'prefix');
    expect(prefix!.value).toEqual({ kind: 'literal', value: 'env/prod' });
  });

  it('single-segment key yields key itself as prefix', () => {
    const entry = generateGcpBackend({ bucket: 'b', key: 'terraform.tfstate' });
    const body = (entry.value as { kind: 'block'; body: Array<{ key: string; value: { kind: string; value?: unknown } }> }).body;
    const prefix = body.find((b) => b.key === 'prefix');
    expect(prefix!.value).toEqual({ kind: 'literal', value: 'terraform.tfstate' });
  });

  it('uses override options when provided', () => {
    const entry = generateGcpBackend(baseAttrs, {
      bucket: 'custom-bucket',
      prefix: 'custom/prefix',
    });
    const body = (entry.value as { kind: 'block'; body: Array<{ key: string; value: { kind: string; value?: unknown } }> }).body;
    const bucketEntry = body.find((b) => b.key === 'bucket');
    const prefix = body.find((b) => b.key === 'prefix');
    expect(bucketEntry!.value).toEqual({ kind: 'literal', value: 'custom-bucket' });
    expect(prefix!.value).toEqual({ kind: 'literal', value: 'custom/prefix' });
  });
});

// ===========================================================================
// runbook-generator
// ===========================================================================

describe('runbook-generator', () => {
  const attrs = {
    bucket: 'my-bucket',
    key: 'prod/terraform.tfstate',
    region: 'us-east-1',
    dynamodb_table: 'tf-lock',
  } as const;

  const snippet = 'backend "azurerm" {\n  container_name = "my-bucket"\n}';

  it('contains all section headings', () => {
    const runbook = generateRunbook(attrs, 'azure', snippet);
    expect(runbook).toContain('# Terraform State Backend Migration Runbook');
    expect(runbook).toContain('## 1. Source Configuration (Current)');
    expect(runbook).toContain('## 2. Target Configuration');
    expect(runbook).toContain('## 3. Pre-Migration Checklist');
    expect(runbook).toContain('## 4. Migration Steps');
    expect(runbook).toContain('## 5. Verification');
    expect(runbook).toContain('## 6. Rollback');
  });

  it('contains terraform state pull backup command', () => {
    const runbook = generateRunbook(attrs, 'azure', snippet);
    expect(runbook).toContain('terraform state pull > backup.tfstate');
  });

  it('contains terraform init -migrate-state command', () => {
    const runbook = generateRunbook(attrs, 'azure', snippet);
    expect(runbook).toContain('terraform init -migrate-state');
  });

  it('contains rollback section with state push', () => {
    const runbook = generateRunbook(attrs, 'azure', snippet);
    expect(runbook).toContain('Rollback');
    expect(runbook).toContain('terraform state push backup.tfstate');
  });

  it('includes workspace section when workspace_key_prefix is set', () => {
    const wsAttrs = { ...attrs, workspace_key_prefix: 'ws-prefix' };
    const runbook = generateRunbook(wsAttrs, 'gcp', snippet);
    expect(runbook).toContain('ws-prefix');
    expect(runbook).toContain('manual workspace setup');
  });
});

// ===========================================================================
// backend-migrator orchestrator
// ===========================================================================

describe('backend-migrator (migrateBackend)', () => {
  it('returns null for a non-S3 backend', () => {
    const result = migrateBackend(
      makeBackend('local', { path: './state' }),
      makeOptions('azure'),
    );
    expect(result).toBeNull();
  });

  it('Azure pipeline: detected, HCL contains backend "azurerm", runbook non-empty', () => {
    const backend = makeBackend('s3', {
      bucket: 'my-bucket',
      key: 'prod/terraform.tfstate',
      region: 'us-east-1',
    });
    const result = migrateBackend(backend, makeOptions('azure'));
    expect(result).not.toBeNull();
    expect(result!.targetBackend.key).toBe('backend "azurerm"');
    expect(result!.hclSnippet).toContain('azurerm');
    expect(result!.runbook.length).toBeGreaterThan(0);
    expect(result!.runbook).toContain('Azure Storage');
  });

  it('GCP pipeline: detected, HCL contains backend "gcs", runbook non-empty', () => {
    const backend = makeBackend('s3', {
      bucket: 'my-bucket',
      key: 'env/prod/terraform.tfstate',
    });
    const result = migrateBackend(backend, makeOptions('gcp'));
    expect(result).not.toBeNull();
    expect(result!.targetBackend.key).toBe('backend "gcs"');
    expect(result!.hclSnippet).toContain('gcs');
    expect(result!.runbook).toContain('Google Cloud Storage');
  });

  it('findings accumulate from detector and scrubber', () => {
    const backend = makeBackend('s3', {
      bucket: 'b',
      key: 'k',
      access_key: 'AKIA...',
      secret_key: 'secret',
    });
    const result = migrateBackend(backend, makeOptions('azure'));
    expect(result).not.toBeNull();
    const codes = findingCodes(result!.findings);
    // Detector adds STATE_BACKEND_DETECTED
    expect(codes).toContain('STATE_BACKEND_DETECTED');
    // Scrubber adds STATE_CREDENTIAL_SCRUBBED for both keys
    const scrubCount = codes.filter((c) => c === 'STATE_CREDENTIAL_SCRUBBED').length;
    expect(scrubCount).toBe(2);
  });

  it('credentials are stripped before HCL generation (access_key not in HCL output)', () => {
    const backend = makeBackend('s3', {
      bucket: 'b',
      key: 'k',
      access_key: 'AKIA_VISIBLE',
      secret_key: 'SECRET_VISIBLE',
    });
    const result = migrateBackend(backend, makeOptions('azure'));
    expect(result).not.toBeNull();
    // The HCL snippet should NOT contain any credential values
    expect(result!.hclSnippet).not.toContain('AKIA_VISIBLE');
    expect(result!.hclSnippet).not.toContain('SECRET_VISIBLE');
    expect(result!.hclSnippet).not.toContain('access_key');
    expect(result!.hclSnippet).not.toContain('secret_key');
  });

  it('workspace advisory finding present when workspace_key_prefix is set', () => {
    const backend = makeBackend('s3', {
      bucket: 'b',
      key: 'k',
      workspace_key_prefix: 'env',
    });
    const result = migrateBackend(backend, makeOptions('azure'));
    expect(result).not.toBeNull();
    const codes = findingCodes(result!.findings);
    expect(codes).toContain('STATE_WORKSPACE_ADVISORY');
  });

  it('DynamoDB advisory finding present when dynamodb_table is set', () => {
    const backend = makeBackend('s3', {
      bucket: 'b',
      key: 'k',
      dynamodb_table: 'my-locks',
    });
    const result = migrateBackend(backend, makeOptions('gcp'));
    expect(result).not.toBeNull();
    const codes = findingCodes(result!.findings);
    expect(codes).toContain('STATE_DYNAMO_LOCK_ADVISORY');
    const dynamo = result!.findings.find((f) => f.code === 'STATE_DYNAMO_LOCK_ADVISORY');
    expect(dynamo!.message).toContain('my-locks');
  });
});
