/**
 * E2E tests for real-world migration patterns.
 *
 * Each fixture is a self-contained .tf file representing a common AWS pattern.
 * The test parses → builds dependency graph → emits IR → translates to Azure
 * and asserts specific outcomes (resource types, findings, blockers).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { parseHclFile, DependencyGraph, IrEmitter, resolveRegistryKey } from '@tla/ingestion';
import { TranslationCompiler } from '@tla/translator';
import { RegistryApi, loadRegistryFromDirectory, validateRegistryEntries } from '@tla/registry';
import type { CanonicalIR, TranslationResult, CompilerOptions } from '@tla/shared';
import type { RegistryEntry } from '@tla/shared';
import type { RegistryApi as RegistryApiType } from '@tla/registry';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const FIXTURES_DIR = resolve(__dirname, '../fixtures');
const REGISTRY_DIR = resolve(__dirname, '../../../registry/data');

// ---------------------------------------------------------------------------
// Bridge registry wrapper (same as e2e-azure.test.ts)
// ---------------------------------------------------------------------------

function makeBridgeRegistry(realRegistry: RegistryApi): RegistryApiType {
  const bridge: RegistryApiType = {
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
        const entry = bridge.lookup(t);
        if (entry) result.set(t, entry);
      }
      return result;
    },
  } as unknown as RegistryApiType;
  return bridge;
}

// ---------------------------------------------------------------------------
// Helper: parse a single fixture, emit IR, translate to azure
// ---------------------------------------------------------------------------

let registry: RegistryApiType;

async function translateFixture(fixtureName: string): Promise<{
  ir: CanonicalIR;
  result: TranslationResult;
}> {
  const ast = await parseHclFile(resolve(FIXTURES_DIR, fixtureName));

  const graph = new DependencyGraph();
  graph.build([ast]);

  const emitter = new IrEmitter(registry);
  const { ir } = emitter.emit([ast], graph);

  const options: CompilerOptions = {
    targetProvider: 'azure',
    registryVersion: '2025.03.01',
  };

  const compiler = new TranslationCompiler(registry);
  const result = compiler.translate(ir, options);
  return { ir, result };
}

// ---------------------------------------------------------------------------
// Suite-level setup: load registry once
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const realRegistry = new RegistryApi(REGISTRY_DIR, loadRegistryFromDirectory, validateRegistryEntries);
  await realRegistry.init();
  registry = makeBridgeRegistry(realRegistry);
}, 15000);

// ---------------------------------------------------------------------------
// 1. EC2 Web Tier
// ---------------------------------------------------------------------------

describe('EC2 Web Tier (ec2-web-tier.tf)', () => {
  let ir: CanonicalIR;
  let result: TranslationResult;

  beforeAll(async () => {
    ({ ir, result } = await translateFixture('ec2-web-tier.tf'));
  }, 15000);

  it('produces IR with aws_instance, aws_vpc, aws_subnet, aws_security_group', () => {
    const types = ir.resources.map((r) => r.sourceType);
    expect(types).toContain('aws_instance');
    expect(types).toContain('aws_vpc');
    expect(types).toContain('aws_subnet');
    expect(types).toContain('aws_security_group');
  });

  it('EC2 translates to at least one Azure VM resource', () => {
    const instanceIr = ir.resources.find((r) => r.sourceType === 'aws_instance');
    expect(instanceIr).toBeDefined();

    const ec2Translated = result.resources.filter((r) => r.sourceId === instanceIr!.id);
    expect(ec2Translated.length).toBeGreaterThanOrEqual(1);

    // Should produce a VM resource (linux or windows virtual machine)
    const targetTypes = ec2Translated.map((r) => r.targetType);
    expect(
      targetTypes.some((t) => t.includes('virtual_machine') || t.includes('linux')),
    ).toBe(true);
  });

  it('EC2 manifest entry is not blocked', () => {
    const instanceIr = ir.resources.find((r) => r.sourceType === 'aws_instance');
    expect(instanceIr).toBeDefined();

    const entry = result.manifest.entries.find((e) => e.sourceId === instanceIr!.id);
    expect(entry).toBeDefined();
    expect(entry!.status).not.toBe('blocked');
  });

  it('has no blocker findings across the whole fixture', () => {
    const allFindings = [
      ...result.findings,
      ...result.manifest.entries.flatMap((e) => e.findings),
    ];
    const blockers = allFindings.filter((f) => f.severity === 'blocker');
    expect(blockers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. RDS Private
// ---------------------------------------------------------------------------

describe('RDS Private (rds-private.tf)', () => {
  let ir: CanonicalIR;
  let result: TranslationResult;

  beforeAll(async () => {
    ({ ir, result } = await translateFixture('rds-private.tf'));
  }, 15000);

  it('produces IR with aws_db_instance', () => {
    const rds = ir.resources.find((r) => r.sourceType === 'aws_db_instance');
    expect(rds).toBeDefined();
  });

  it('translates to at least one Azure resource', () => {
    const rdsIr = ir.resources.find((r) => r.sourceType === 'aws_db_instance');
    expect(rdsIr).toBeDefined();

    const translated = result.resources.filter((r) => r.sourceId === rdsIr!.id);
    expect(translated.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT have RDS_PUBLICLY_ACCESSIBLE blocker (publicly_accessible=false)', () => {
    const allFindings = [
      ...result.findings,
      ...result.manifest.entries.flatMap((e) => e.findings),
    ];
    const pubBlockers = allFindings.filter(
      (f) => f.code === 'RDS_PUBLICLY_ACCESSIBLE' && f.severity === 'blocker',
    );
    expect(pubBlockers).toHaveLength(0);
  });

  it('does NOT have RDS_NO_ENCRYPTION warning (storage_encrypted=true)', () => {
    const allFindings = [
      ...result.findings,
      ...result.manifest.entries.flatMap((e) => e.findings),
    ];
    const encFindings = allFindings.filter((f) => f.code === 'RDS_NO_ENCRYPTION');
    expect(encFindings).toHaveLength(0);
  });

  it('manifest entry is not blocked', () => {
    const rdsIr = ir.resources.find((r) => r.sourceType === 'aws_db_instance');
    const entry = result.manifest.entries.find((e) => e.sourceId === rdsIr!.id);
    expect(entry).toBeDefined();
    expect(entry!.status).not.toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// 3. S3 Full
// ---------------------------------------------------------------------------

describe('S3 Full (s3-full.tf)', () => {
  let ir: CanonicalIR;
  let result: TranslationResult;

  beforeAll(async () => {
    ({ ir, result } = await translateFixture('s3-full.tf'));
  }, 15000);

  it('produces IR with aws_s3_bucket', () => {
    const s3 = ir.resources.find((r) => r.sourceType === 'aws_s3_bucket');
    expect(s3).toBeDefined();
  });

  it('translates to Azure storage resources', () => {
    const s3Ir = ir.resources.find((r) => r.sourceType === 'aws_s3_bucket');
    expect(s3Ir).toBeDefined();

    const translated = result.resources.filter((r) => r.sourceId === s3Ir!.id);
    expect(translated.length).toBeGreaterThanOrEqual(1);
  });

  it('S3 translation produces findings (encryption or fallback info)', () => {
    const allFindings = [
      ...result.findings,
      ...result.manifest.entries.flatMap((e) => e.findings),
    ];
    // The S3 handler may emit S3_ENCRYPTION_KMS if routed through the
    // specialized direct mapper, or a GENERIC_PARAMETRIC_FALLBACK if routed
    // through parametric (current registry mapping_type mismatch).
    // Either way, there should be at least one finding for the S3 resource.
    const s3Ir = ir.resources.find((r) => r.sourceType === 'aws_s3_bucket');
    expect(s3Ir).toBeDefined();
    const s3Findings = allFindings.filter((f) => f.resourceId === s3Ir!.id);
    expect(s3Findings.length).toBeGreaterThanOrEqual(1);
  });

  it('manifest entry is translated or expanded (not blocked)', () => {
    const s3Ir = ir.resources.find((r) => r.sourceType === 'aws_s3_bucket');
    const entry = result.manifest.entries.find((e) => e.sourceId === s3Ir!.id);
    expect(entry).toBeDefined();
    expect(['translated', 'expanded', 'partial']).toContain(entry!.status);
  });
});

// ---------------------------------------------------------------------------
// 4. VPC Cohesion
// ---------------------------------------------------------------------------

describe('VPC Cohesion (vpc-cohesion.tf)', () => {
  let ir: CanonicalIR;
  let result: TranslationResult;

  beforeAll(async () => {
    ({ ir, result } = await translateFixture('vpc-cohesion.tf'));
  }, 15000);

  it('produces IR for all networking resource types', () => {
    const types = ir.resources.map((r) => r.sourceType);
    expect(types).toContain('aws_vpc');
    expect(types).toContain('aws_subnet');
    expect(types).toContain('aws_nat_gateway');
    expect(types).toContain('aws_internet_gateway');
    expect(types).toContain('aws_route_table');
  });

  it('translates VPC resource', () => {
    const vpcIr = ir.resources.find((r) => r.sourceType === 'aws_vpc');
    expect(vpcIr).toBeDefined();

    const translated = result.resources.filter((r) => r.sourceId === vpcIr!.id);
    expect(translated.length).toBeGreaterThanOrEqual(1);
  });

  it('translates both subnets', () => {
    const subnetIrs = ir.resources.filter((r) => r.sourceType === 'aws_subnet');
    expect(subnetIrs.length).toBe(2);

    for (const sub of subnetIrs) {
      const translated = result.resources.filter((r) => r.sourceId === sub.id);
      expect(translated.length, `Subnet ${sub.sourceName} not translated`).toBeGreaterThanOrEqual(1);
    }
  });

  it('translates NAT gateway', () => {
    const natIr = ir.resources.find((r) => r.sourceType === 'aws_nat_gateway');
    expect(natIr).toBeDefined();

    const translated = result.resources.filter((r) => r.sourceId === natIr!.id);
    expect(translated.length).toBeGreaterThanOrEqual(1);
  });

  it('has no blocker findings for the VPC stack', () => {
    const allFindings = [
      ...result.findings,
      ...result.manifest.entries.flatMap((e) => e.findings),
    ];
    const blockers = allFindings.filter((f) => f.severity === 'blocker');
    expect(blockers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. SG Blocker
// ---------------------------------------------------------------------------

describe('SG Blocker (sg-blocker.tf)', () => {
  let ir: CanonicalIR;
  let result: TranslationResult;

  beforeAll(async () => {
    ({ ir, result } = await translateFixture('sg-blocker.tf'));
  }, 15000);

  it('produces IR with aws_security_group', () => {
    const sg = ir.resources.find((r) => r.sourceType === 'aws_security_group');
    expect(sg).toBeDefined();
  });

  it('has SECURITY_GROUP_RULE_BROADENING blocker finding', () => {
    const allFindings = [
      ...result.findings,
      ...result.manifest.entries.flatMap((e) => e.findings),
    ];
    const sgBlockers = allFindings.filter(
      (f) => f.code === 'SECURITY_GROUP_RULE_BROADENING' && f.severity === 'blocker',
    );
    expect(sgBlockers.length).toBeGreaterThanOrEqual(1);
  });

  it('security group manifest entry status is blocked', () => {
    const sgIr = ir.resources.find((r) => r.sourceType === 'aws_security_group');
    expect(sgIr).toBeDefined();

    const entry = result.manifest.entries.find((e) => e.sourceId === sgIr!.id);
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('blocked');
  });

  it('produces no translated resources for the blocked SG', () => {
    const sgIr = ir.resources.find((r) => r.sourceType === 'aws_security_group');
    expect(sgIr).toBeDefined();

    const translated = result.resources.filter((r) => r.sourceId === sgIr!.id);
    expect(translated).toHaveLength(0);
  });
});
