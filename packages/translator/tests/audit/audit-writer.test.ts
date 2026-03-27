import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildAuditEntry, appendAuditEntry } from '../../src/audit/audit-writer.js';
import { checkAuditIntegrity } from '../../src/audit/integrity-checker.js';
import type { AuditEntry } from '../../src/audit/audit-types.js';
import type { TranslationResult } from '@tla/shared';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<TranslationResult> = {}): TranslationResult {
  return {
    target: 'azure',
    resources: [],
    files: { 'main.tf': 'resource {}' },
    manifest: {
      version: '1.0.0',
      registryVersion: '2.1.0',
      target: 'azure',
      counts: { total: 5, translated: 3, expanded: 1, partial: 0, blocked: 1, advisory: 0 },
      entries: [],
      findings: [],
      confidenceOverall: 0.82,
    },
    findings: [
      { resourceId: 'sg-1', severity: 'blocker', code: 'SEC-001', message: 'broad rule' },
      { resourceId: 'vpc-1', severity: 'warning', code: 'NET-002', message: 'no peering' },
      { resourceId: 'ec2-1', severity: 'info', code: 'GEN-001', message: 'note' },
      { resourceId: 'ec2-2', severity: 'info', code: 'GEN-002', message: 'another note' },
    ],
    stats: {
      totalResources: 5,
      translated: 3,
      expanded: 1,
      partial: 0,
      blocked: 1,
      advisory: 0,
      durationMs: 120,
    },
    ...overrides,
  } as TranslationResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildAuditEntry', () => {
  it('produces correct counts and fields from a result', () => {
    const result = makeResult();
    const manifestJson = JSON.stringify(result.manifest, null, 2);
    const entry = buildAuditEntry(result, '/tmp/source', 'azure', 250, manifestJson);

    expect(entry.source).toBe('/tmp/source');
    expect(entry.target).toBe('azure');
    expect(entry.registryVersion).toBe('2.1.0');
    expect(entry.resourceCount).toBe(5);
    expect(entry.counts).toEqual({
      total: 5, translated: 3, expanded: 1, partial: 0, blocked: 1, advisory: 0,
    });
    expect(entry.confidenceOverall).toBe(0.82);
    expect(entry.durationMs).toBe(250);
  });

  it('computes a valid SHA-256 manifestHash', () => {
    const result = makeResult();
    const manifestJson = JSON.stringify(result.manifest, null, 2);
    const entry = buildAuditEntry(result, '/src', 'gcp', 100, manifestJson);

    const expected = createHash('sha256').update(manifestJson, 'utf-8').digest('hex');
    expect(entry.manifestHash).toBe(expected);
    expect(entry.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a valid UUIDv4 runId', () => {
    const result = makeResult();
    const entry = buildAuditEntry(result, '/src', 'azure', 50, '{}');

    // UUIDv4 regex: 8-4-4-4-12 hex with version 4 and variant bits
    expect(entry.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('counts findings by severity correctly', () => {
    const result = makeResult();
    const entry = buildAuditEntry(result, '/src', 'azure', 10, '{}');

    expect(entry.findingCounts).toEqual({ blocker: 1, warning: 1, info: 2 });
  });

  it('produces an ISO-8601 timestamp', () => {
    const result = makeResult();
    const entry = buildAuditEntry(result, '/src', 'azure', 10, '{}');

    // ISO-8601 timestamps end with Z and parse to valid dates
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
  });
});

describe('appendAuditEntry', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = resolve(tmpdir(), `audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates audit-log.jsonl and writes a single line', async () => {
    const result = makeResult();
    const entry = buildAuditEntry(result, '/src', 'azure', 10, '{}');

    await appendAuditEntry(tmpDir, entry);

    const content = await readFile(join(tmpDir, 'audit-log.jsonl'), 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]!);
    expect(parsed.runId).toBe(entry.runId);
    expect(parsed.target).toBe('azure');
  });

  it('appends multiple entries (append-only)', async () => {
    const result = makeResult();
    const entry1 = buildAuditEntry(result, '/src1', 'azure', 10, '{}');
    const entry2 = buildAuditEntry(result, '/src2', 'gcp', 20, '{"v":2}');

    await appendAuditEntry(tmpDir, entry1);
    await appendAuditEntry(tmpDir, entry2);

    const content = await readFile(join(tmpDir, 'audit-log.jsonl'), 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);

    const parsed0 = JSON.parse(lines[0]!);
    const parsed1 = JSON.parse(lines[1]!);
    expect(parsed0.source).toBe('/src1');
    expect(parsed1.source).toBe('/src2');
    expect(parsed1.target).toBe('gcp');
  });

  it('does not throw on write failure (logs to stderr)', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Pass a path that cannot be written (directory that doesn't exist + no recursive mkdir)
    await expect(
      appendAuditEntry('/nonexistent/deeply/nested/path', {
        timestamp: new Date().toISOString(),
        runId: '00000000-0000-4000-8000-000000000000',
        source: '/x',
        target: 'azure',
        registryVersion: '1.0.0',
        resourceCount: 0,
        counts: { translated: 0, expanded: 0, partial: 0, blocked: 0, advisory: 0, total: 0 },
        confidenceOverall: 0,
        manifestHash: 'abc',
        findingCounts: { blocker: 0, warning: 0, info: 0 },
        durationMs: 0,
        artifactHashes: {},
        toolVersion: '0.1.0',
      }),
    ).resolves.toBeUndefined();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[audit] Failed to write audit log'));
    stderrSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// New: artifactHashes & toolVersion
// ---------------------------------------------------------------------------

describe('buildAuditEntry — artifactHashes & toolVersion', () => {
  it('includes artifactHashes when provided', () => {
    const result = makeResult();
    const manifestJson = JSON.stringify(result.manifest, null, 2);
    const hashes = { 'main.tf': 'abc123', 'manifest.json': 'def456' };
    const entry = buildAuditEntry(result, '/src', 'azure', 10, manifestJson, hashes);

    expect(entry.artifactHashes).toEqual(hashes);
  });

  it('includes toolVersion when provided', () => {
    const result = makeResult();
    const entry = buildAuditEntry(result, '/src', 'azure', 10, '{}', {}, '1.2.3');

    expect(entry.toolVersion).toBe('1.2.3');
  });

  it('defaults artifactHashes to empty object and toolVersion to 0.1.0', () => {
    const result = makeResult();
    const entry = buildAuditEntry(result, '/src', 'azure', 10, '{}');

    expect(entry.artifactHashes).toEqual({});
    expect(entry.toolVersion).toBe('0.1.0');
  });
});

// ---------------------------------------------------------------------------
// New: checkAuditIntegrity
// ---------------------------------------------------------------------------

describe('checkAuditIntegrity', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = resolve(tmpdir(), `integrity-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  function makeAuditEntry(artifactHashes: Record<string, string>): AuditEntry {
    return {
      timestamp: new Date().toISOString(),
      runId: '00000000-0000-4000-8000-000000000000',
      source: '/test',
      target: 'azure',
      registryVersion: '1.0.0',
      resourceCount: 1,
      counts: { translated: 1, expanded: 0, partial: 0, blocked: 0, advisory: 0, total: 1 },
      confidenceOverall: 0.9,
      manifestHash: 'unused',
      findingCounts: { blocker: 0, warning: 0, info: 0 },
      durationMs: 50,
      artifactHashes,
      toolVersion: '0.1.0',
    };
  }

  it('returns valid for matching hashes', async () => {
    const content = 'resource "azurerm_resource_group" "rg" {}';
    await writeFile(join(tmpDir, 'main.tf'), content, 'utf-8');

    const entry = makeAuditEntry({ 'main.tf': hashContent(content) });
    const result = await checkAuditIntegrity(tmpDir, entry);

    expect(result.valid).toBe(true);
    expect(result.mismatches).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });

  it('detects tampered files', async () => {
    const original = 'resource "azurerm_resource_group" "rg" {}';
    const tampered = 'resource "azurerm_resource_group" "rg" { location = "eastus" }';
    await writeFile(join(tmpDir, 'main.tf'), tampered, 'utf-8');

    const entry = makeAuditEntry({ 'main.tf': hashContent(original) });
    const result = await checkAuditIntegrity(tmpDir, entry);

    expect(result.valid).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]!.file).toBe('main.tf');
    expect(result.mismatches[0]!.expected).toBe(hashContent(original));
    expect(result.mismatches[0]!.actual).toBe(hashContent(tampered));
  });

  it('reports missing files', async () => {
    const entry = makeAuditEntry({ 'gone.tf': hashContent('whatever') });
    const result = await checkAuditIntegrity(tmpDir, entry);

    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['gone.tf']);
    expect(result.mismatches).toHaveLength(0);
  });
});
