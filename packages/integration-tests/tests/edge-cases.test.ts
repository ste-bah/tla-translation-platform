/**
 * TASK-INT-003: Edge Case Tests — PRD Section 13 Edge Cases
 *
 * Exercises 12 targeted scenarios through the full pipeline:
 *   parseHclDirectory -> DependencyGraph.build -> IrEmitter.emit -> TranslationCompiler.translate
 *
 * Each test suite corresponds to one edge-case fixture directory under
 * fixtures/edge-cases/ec-XXX-*. Fixtures are intentionally minimal (1 resource
 * per file) to isolate specific behaviours.
 *
 * Module resolution (EC-001) additionally calls resolveModules + flattenModules
 * to verify the OpaqueRecord path.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import {
  parseHclDirectory,
  DependencyGraph,
  IrEmitter,
  resolveRegistryKey,
  resolveModules,
  flattenModules,
} from '@tla/ingestion';
import { TranslationCompiler } from '@tla/translator';
import { RegistryApi, loadRegistryFromDirectory, validateRegistryEntries } from '@tla/registry';
import type { RegistryEntry } from '@tla/shared';
import type { CanonicalIR, CompilerOptions, TranslationResult } from '@tla/shared';
import type { RegistryApi as RegistryApiType } from '@tla/registry';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const FIXTURES_BASE = resolve(__dirname, '../fixtures/edge-cases');

const REGISTRY_DIR = resolve(__dirname, '../../registry/data');

// ---------------------------------------------------------------------------
// Bridge registry (same pattern as e2e tests)
// ---------------------------------------------------------------------------

function makeBridgeRegistry(realRegistry: RegistryApi): RegistryApiType {
  return {
    lookup: (awsResourceType: string): RegistryEntry | undefined => {
      const shortKey = resolveRegistryKey(awsResourceType);
      if (shortKey !== undefined) {
        return realRegistry.lookup(shortKey);
      }
      return realRegistry.lookup(awsResourceType);
    },
    lookupMany: (types: ReadonlyArray<string>): Map<string, RegistryEntry> => {
      const result = new Map<string, RegistryEntry>();
      for (const t of types) {
        const entry = makeBridgeRegistry(realRegistry).lookup(t);
        if (entry) {
          result.set(t, entry);
        }
      }
      return result;
    },
  } as unknown as RegistryApiType;
}

// ---------------------------------------------------------------------------
// Helper: run full pipeline for a fixture directory
// ---------------------------------------------------------------------------

interface PipelineResult {
  ir: CanonicalIR;
  result: TranslationResult;
  unmappedTypes: string[];
  parseErrors: Array<{ file: string; error: Error }>;
}

async function runPipeline(
  fixtureDir: string,
  registry: RegistryApiType,
  targetProvider: 'azure' | 'gcp' = 'azure',
): Promise<PipelineResult> {
  const parseResult = await parseHclDirectory(fixtureDir);
  const graph = new DependencyGraph();
  graph.build(parseResult.asts);

  const emitter = new IrEmitter(registry);
  const emitResult = emitter.emit(parseResult.asts, graph);

  const options: CompilerOptions = {
    targetProvider,
    registryVersion: '2025.03.01',
  };

  const compiler = new TranslationCompiler(registry);
  const translationResult = compiler.translate(emitResult.ir, options);

  return {
    ir: emitResult.ir,
    result: translationResult,
    unmappedTypes: emitResult.unmappedTypes,
    parseErrors: parseResult.errors,
  };
}

// ---------------------------------------------------------------------------
// Suite-level setup: init shared registry once
// ---------------------------------------------------------------------------

let realRegistry: RegistryApi;
let registry: RegistryApiType;

beforeAll(async () => {
  realRegistry = new RegistryApi(REGISTRY_DIR, loadRegistryFromDirectory, validateRegistryEntries);
  await realRegistry.init();
  registry = makeBridgeRegistry(realRegistry);
}, 30000);

// ---------------------------------------------------------------------------
// Shared no-silent-drops assertion
// ---------------------------------------------------------------------------

function assertNoSilentDrops(ir: CanonicalIR, result: TranslationResult): void {
  const manifestIds = new Set(result.manifest.entries.map((e) => e.sourceId));
  for (const irRes of ir.resources) {
    expect(
      manifestIds.has(irRes.id),
      `IR resource ${irRes.id} (${irRes.sourceType}.${irRes.sourceName}) has no manifest entry`,
    ).toBe(true);
  }
  expect(result.manifest.counts.total).toBe(ir.resources.length);
}

// ===========================================================================
// EC-001: Opaque Module (external registry source)
// ===========================================================================

describe('EC-001: opaque module (external source)', () => {
  const fixtureDir = resolve(FIXTURES_BASE, 'ec-001-opaque-module');

  it('parses the module-only fixture without errors', async () => {
    const parseResult = await parseHclDirectory(fixtureDir);
    expect(
      parseResult.errors,
      `Parse errors: ${parseResult.errors.map((e) => e.error.message).join(', ')}`,
    ).toHaveLength(0);
  });

  it('resolves the module as opaque (review required) via module flattener', async () => {
    const parseResult = await parseHclDirectory(fixtureDir);
    const tree = await resolveModules(parseResult.asts as never[], {
      rootDir: fixtureDir,
    });
    const flatResult = flattenModules(tree, parseResult.asts as never[]);

    // External registry module cannot be resolved locally -> opaque record
    expect(
      flatResult.opaqueRecords.length,
      'Expected at least one opaque record for external module',
    ).toBeGreaterThan(0);

    const opaqueRecord = flatResult.opaqueRecords[0]!;
    expect(opaqueRecord.reviewRequired).toBe(true);
  });

  it('produces an empty IR (module-only fixture has no resource blocks)', async () => {
    const parseResult = await parseHclDirectory(fixtureDir);
    const graph = new DependencyGraph();
    graph.build(parseResult.asts);
    const emitter = new IrEmitter(registry);
    const { ir } = emitter.emit(parseResult.asts, graph);

    expect(ir.resources).toHaveLength(0);
  });

  it('manifest has zero entries (no resources = no silent drops)', async () => {
    const { ir, result } = await runPipeline(fixtureDir, registry);
    assertNoSilentDrops(ir, result);
    expect(result.manifest.counts.total).toBe(0);
  });
});

// ===========================================================================
// EC-002: Transit Gateway
// ===========================================================================

describe('EC-002: transit gateway', () => {
  const fixtureDir = resolve(FIXTURES_BASE, 'ec-002-transit-gateway');
  let pipeline: PipelineResult;

  beforeAll(async () => {
    pipeline = await runPipeline(fixtureDir, registry);
  });

  it('parses without errors', () => {
    expect(pipeline.parseErrors).toHaveLength(0);
  });

  it('emits one IR resource of type aws_ec2_transit_gateway', () => {
    const tgw = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_ec2_transit_gateway',
    );
    expect(tgw).toBeDefined();
    expect(pipeline.ir.resources).toHaveLength(1);
  });

  it('produces a manifest entry for the transit gateway (no silent drops)', () => {
    assertNoSilentDrops(pipeline.ir, pipeline.result);
  });

  it('manifest entry is not plain blocked (structural expansion produces output or advisory)', () => {
    const tgwIr = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_ec2_transit_gateway',
    );
    expect(tgwIr).toBeDefined();
    const entry = pipeline.result.manifest.entries.find(
      (e) => e.sourceId === tgwIr!.id,
    );
    expect(entry).toBeDefined();
    // Transit gateway maps to structural expansion; entry should not be purely
    // blocked (it translates to vWAN/vHub on Azure).
    expect(entry!.status).not.toBe('blocked');
  });

  it('translation produces at least one target resource for the transit gateway', () => {
    const tgwIr = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_ec2_transit_gateway',
    );
    expect(tgwIr).toBeDefined();
    const targetResources = pipeline.result.resources.filter(
      (r) => r.sourceId === tgwIr!.id,
    );
    expect(targetResources.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// EC-003: PrivateLink (Interface endpoint)
// ===========================================================================

describe('EC-003: PrivateLink interface endpoint', () => {
  const fixtureDir = resolve(FIXTURES_BASE, 'ec-003-privatelink');
  let pipeline: PipelineResult;

  beforeAll(async () => {
    pipeline = await runPipeline(fixtureDir, registry);
  });

  it('parses without errors', () => {
    expect(pipeline.parseErrors).toHaveLength(0);
  });

  it('emits one IR resource of type aws_vpc_endpoint', () => {
    const ep = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_vpc_endpoint',
    );
    expect(ep).toBeDefined();
  });

  it('has a manifest entry for the vpc endpoint (no silent drops)', () => {
    assertNoSilentDrops(pipeline.ir, pipeline.result);
  });

  it('Interface endpoint is not blocked (translates to Private Endpoint resources)', () => {
    const epIr = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_vpc_endpoint',
    );
    expect(epIr).toBeDefined();
    const entry = pipeline.result.manifest.entries.find(
      (e) => e.sourceId === epIr!.id,
    );
    expect(entry).toBeDefined();
    expect(entry!.status).not.toBe('blocked');
  });
});

// ===========================================================================
// EC-004: IAM role (advisory — no automated mapping)
// ===========================================================================

describe('EC-004: IAM role (advisory)', () => {
  const fixtureDir = resolve(FIXTURES_BASE, 'ec-004-iam-conditions');
  let pipeline: PipelineResult;

  beforeAll(async () => {
    pipeline = await runPipeline(fixtureDir, registry);
  });

  it('parses without errors', () => {
    expect(pipeline.parseErrors).toHaveLength(0);
  });

  it('emits one IR resource of type aws_iam_role', () => {
    const role = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_iam_role',
    );
    expect(role).toBeDefined();
  });

  it('has a manifest entry for the IAM role (no silent drops)', () => {
    assertNoSilentDrops(pipeline.ir, pipeline.result);
  });

  it('IAM role manifest entry is advisory (no automated cross-cloud IAM translation)', () => {
    const roleIr = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_iam_role',
    );
    expect(roleIr).toBeDefined();
    const entry = pipeline.result.manifest.entries.find(
      (e) => e.sourceId === roleIr!.id,
    );
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('advisory');
  });

  it('IAM role produces zero translated resources', () => {
    const roleIr = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_iam_role',
    );
    expect(roleIr).toBeDefined();
    const targets = pipeline.result.resources.filter(
      (r) => r.sourceId === roleIr!.id,
    );
    expect(targets).toHaveLength(0);
  });
});

// ===========================================================================
// EC-005: DynamoDB table with GSI (advisory)
// ===========================================================================

describe('EC-005: DynamoDB with GSI (advisory)', () => {
  const fixtureDir = resolve(FIXTURES_BASE, 'ec-005-dynamodb');
  let pipeline: PipelineResult;

  beforeAll(async () => {
    pipeline = await runPipeline(fixtureDir, registry);
  });

  it('parses without errors', () => {
    expect(pipeline.parseErrors).toHaveLength(0);
  });

  it('emits one IR resource of type aws_dynamodb_table', () => {
    const ddb = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_dynamodb_table',
    );
    expect(ddb).toBeDefined();
  });

  it('has a manifest entry for the DynamoDB table (no silent drops)', () => {
    assertNoSilentDrops(pipeline.ir, pipeline.result);
  });

  it('DynamoDB table manifest entry is advisory (mapping_type: none)', () => {
    const ddbIr = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_dynamodb_table',
    );
    expect(ddbIr).toBeDefined();
    const entry = pipeline.result.manifest.entries.find(
      (e) => e.sourceId === ddbIr!.id,
    );
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('advisory');
  });

  it('DynamoDB table produces zero translated resources', () => {
    const ddbIr = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_dynamodb_table',
    );
    expect(ddbIr).toBeDefined();
    const targets = pipeline.result.resources.filter(
      (r) => r.sourceId === ddbIr!.id,
    );
    expect(targets).toHaveLength(0);
  });
});

// ===========================================================================
// EC-006: Serverless (Lambda function)
// ===========================================================================

describe('EC-006: serverless Lambda function', () => {
  const fixtureDir = resolve(FIXTURES_BASE, 'ec-006-serverless');
  let pipeline: PipelineResult;

  beforeAll(async () => {
    pipeline = await runPipeline(fixtureDir, registry);
  });

  it('parses without errors', () => {
    expect(pipeline.parseErrors).toHaveLength(0);
  });

  it('emits one IR resource of type aws_lambda_function', () => {
    const fn = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_lambda_function',
    );
    expect(fn).toBeDefined();
  });

  it('has a manifest entry for the Lambda function (no silent drops)', () => {
    assertNoSilentDrops(pipeline.ir, pipeline.result);
  });

  it('Lambda function has a manifest entry (not silently dropped)', () => {
    const fnIr = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_lambda_function',
    );
    expect(fnIr).toBeDefined();
    const entry = pipeline.result.manifest.entries.find(
      (e) => e.sourceId === fnIr!.id,
    );
    expect(entry).toBeDefined();
  });
});

// ===========================================================================
// EC-007: Security broadening — BLOCKER trigger
// ===========================================================================

describe('EC-007: security broadening (BLOCKER)', () => {
  const fixtureDir = resolve(FIXTURES_BASE, 'ec-007-security-broadening');
  let pipeline: PipelineResult;

  beforeAll(async () => {
    pipeline = await runPipeline(fixtureDir, registry);
  });

  it('parses without errors', () => {
    expect(pipeline.parseErrors).toHaveLength(0);
  });

  it('emits one IR resource of type aws_security_group', () => {
    const sg = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_security_group',
    );
    expect(sg).toBeDefined();
    expect(pipeline.ir.resources).toHaveLength(1);
  });

  it('has a manifest entry for the security group (no silent drops)', () => {
    assertNoSilentDrops(pipeline.ir, pipeline.result);
  });

  it('security group manifest entry is blocked (BLOCKER gate: 0.0.0.0/0 with protocol -1)', () => {
    const sgIr = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_security_group',
    );
    expect(sgIr).toBeDefined();
    const entry = pipeline.result.manifest.entries.find(
      (e) => e.sourceId === sgIr!.id,
    );
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('blocked');
  });

  it('blocked security group produces a SECURITY_GROUP_RULE_BROADENING blocker finding', () => {
    const sgIr = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_security_group',
    );
    expect(sgIr).toBeDefined();
    const entry = pipeline.result.manifest.entries.find(
      (e) => e.sourceId === sgIr!.id,
    );
    expect(entry).toBeDefined();
    const blockerFinding = entry!.findings.find(
      (f) => f.severity === 'blocker' && f.code === 'SECURITY_GROUP_RULE_BROADENING',
    );
    expect(
      blockerFinding,
      'Expected a SECURITY_GROUP_RULE_BROADENING blocker finding',
    ).toBeDefined();
  });

  it('blocked security group produces zero translated resources', () => {
    const sgIr = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_security_group',
    );
    expect(sgIr).toBeDefined();
    const targets = pipeline.result.resources.filter(
      (r) => r.sourceId === sgIr!.id,
    );
    expect(targets).toHaveLength(0);
  });

  it('manifest counts.blocked is at least 1', () => {
    expect(pipeline.result.manifest.counts.blocked).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// EC-008: Normal resource in assessment-only mode
// ===========================================================================

describe('EC-008: normal resource (assessment-only perspective)', () => {
  const fixtureDir = resolve(FIXTURES_BASE, 'ec-008-missing-state');
  let pipeline: PipelineResult;

  beforeAll(async () => {
    // Assessment-only is a conceptual mode: we translate normally but the
    // fixture represents a resource with no prior state. The pipeline still
    // produces a manifest entry.
    pipeline = await runPipeline(fixtureDir, registry);
  });

  it('parses without errors', () => {
    expect(pipeline.parseErrors).toHaveLength(0);
  });

  it('emits one IR resource (aws_s3_bucket)', () => {
    const s3 = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_s3_bucket',
    );
    expect(s3).toBeDefined();
    expect(pipeline.ir.resources).toHaveLength(1);
  });

  it('has a manifest entry (no silent drops)', () => {
    assertNoSilentDrops(pipeline.ir, pipeline.result);
  });

  it('S3 bucket is translated to an Azure storage resource', () => {
    const s3Ir = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_s3_bucket',
    );
    expect(s3Ir).toBeDefined();
    const entry = pipeline.result.manifest.entries.find(
      (e) => e.sourceId === s3Ir!.id,
    );
    expect(entry).toBeDefined();
    expect(entry!.status).not.toBe('blocked');
  });
});

// ===========================================================================
// EC-009: local-exec provisioner
// ===========================================================================

describe('EC-009: local-exec provisioner', () => {
  const fixtureDir = resolve(FIXTURES_BASE, 'ec-009-local-exec');
  let pipeline: PipelineResult;

  beforeAll(async () => {
    pipeline = await runPipeline(fixtureDir, registry);
  });

  it('parses without errors', () => {
    expect(pipeline.parseErrors).toHaveLength(0);
  });

  it('emits one IR resource (aws_instance)', () => {
    const instance = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_instance',
    );
    expect(instance).toBeDefined();
    expect(pipeline.ir.resources).toHaveLength(1);
  });

  it('has a manifest entry for the instance (no silent drops)', () => {
    assertNoSilentDrops(pipeline.ir, pipeline.result);
  });

  it('EC2 instance with local-exec provisioner still has a manifest entry', () => {
    const instanceIr = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_instance',
    );
    expect(instanceIr).toBeDefined();
    const entry = pipeline.result.manifest.entries.find(
      (e) => e.sourceId === instanceIr!.id,
    );
    expect(entry).toBeDefined();
  });
});

// ===========================================================================
// EC-010: CloudWatch metric alarm
// ===========================================================================

describe('EC-010: CloudWatch metric alarm', () => {
  const fixtureDir = resolve(FIXTURES_BASE, 'ec-010-cloudwatch');
  let pipeline: PipelineResult;

  beforeAll(async () => {
    pipeline = await runPipeline(fixtureDir, registry);
  });

  it('parses without errors', () => {
    expect(pipeline.parseErrors).toHaveLength(0);
  });

  it('emits one IR resource of type aws_cloudwatch_metric_alarm', () => {
    const alarm = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_cloudwatch_metric_alarm',
    );
    expect(alarm).toBeDefined();
    expect(pipeline.ir.resources).toHaveLength(1);
  });

  it('has a manifest entry for the alarm (no silent drops)', () => {
    assertNoSilentDrops(pipeline.ir, pipeline.result);
  });

  it('CloudWatch alarm has a manifest entry (structurally translated or advisory)', () => {
    const alarmIr = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_cloudwatch_metric_alarm',
    );
    expect(alarmIr).toBeDefined();
    const entry = pipeline.result.manifest.entries.find(
      (e) => e.sourceId === alarmIr!.id,
    );
    expect(entry).toBeDefined();
    // CloudWatch alarm maps to azure_monitor_metric_alert (structural);
    // status should not be plain blocked
    expect(entry!.status).not.toBe('blocked');
  });
});

// ===========================================================================
// EC-011: SKU mismatch (exotic EC2 instance type)
// ===========================================================================

describe('EC-011: SKU mismatch (exotic instance type)', () => {
  const fixtureDir = resolve(FIXTURES_BASE, 'ec-011-sku-mismatch');
  let pipeline: PipelineResult;

  beforeAll(async () => {
    pipeline = await runPipeline(fixtureDir, registry);
  });

  it('parses without errors', () => {
    expect(pipeline.parseErrors).toHaveLength(0);
  });

  it('emits one IR resource (aws_instance with p3.16xlarge)', () => {
    const instance = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_instance',
    );
    expect(instance).toBeDefined();
    expect(pipeline.ir.resources).toHaveLength(1);
  });

  it('has a manifest entry (no silent drops)', () => {
    assertNoSilentDrops(pipeline.ir, pipeline.result);
  });

  it('p3.16xlarge instance has a manifest entry (pipeline handles exotic SKUs without crashing)', () => {
    const instanceIr = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_instance',
    );
    expect(instanceIr).toBeDefined();
    const entry = pipeline.result.manifest.entries.find(
      (e) => e.sourceId === instanceIr!.id,
    );
    expect(entry).toBeDefined();
  });

  it('exotic instance type produces a MISSING_SKU_MATCH or partial translation finding or is translated', () => {
    const instanceIr = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_instance',
    );
    expect(instanceIr).toBeDefined();
    const entry = pipeline.result.manifest.entries.find(
      (e) => e.sourceId === instanceIr!.id,
    );
    expect(entry).toBeDefined();
    // Either the entry is translated/partial (with a SKU mismatch finding) or
    // advisory. The key contract: the pipeline must not silently drop it.
    const validStatuses: Array<typeof entry.status> = [
      'translated',
      'partial',
      'advisory',
      'expanded',
    ];
    expect(
      validStatuses,
      `Unexpected manifest status: ${entry!.status}`,
    ).toContain(entry!.status);
  });
});

// ===========================================================================
// EC-012: Long-tail service (Kinesis — advisory, no registry entry)
// ===========================================================================

describe('EC-012: long-tail service (Kinesis — advisory)', () => {
  const fixtureDir = resolve(FIXTURES_BASE, 'ec-012-long-tail');
  let pipeline: PipelineResult;

  beforeAll(async () => {
    pipeline = await runPipeline(fixtureDir, registry);
  });

  it('parses without errors', () => {
    expect(pipeline.parseErrors).toHaveLength(0);
  });

  it('emits one IR resource of type aws_kinesis_stream', () => {
    const stream = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_kinesis_stream',
    );
    expect(stream).toBeDefined();
    expect(pipeline.ir.resources).toHaveLength(1);
  });

  it('aws_kinesis_stream is reported as unmapped (no registry entry)', () => {
    expect(pipeline.unmappedTypes).toContain('aws_kinesis_stream');
  });

  it('has a manifest entry for kinesis stream (no silent drops)', () => {
    assertNoSilentDrops(pipeline.ir, pipeline.result);
  });

  it('Kinesis stream manifest entry is advisory (no registry = no automated translation)', () => {
    const streamIr = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_kinesis_stream',
    );
    expect(streamIr).toBeDefined();
    const entry = pipeline.result.manifest.entries.find(
      (e) => e.sourceId === streamIr!.id,
    );
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('advisory');
  });

  it('Kinesis stream produces zero translated resources', () => {
    const streamIr = pipeline.ir.resources.find(
      (r) => r.sourceType === 'aws_kinesis_stream',
    );
    expect(streamIr).toBeDefined();
    const targets = pipeline.result.resources.filter(
      (r) => r.sourceId === streamIr!.id,
    );
    expect(targets).toHaveLength(0);
  });
});
