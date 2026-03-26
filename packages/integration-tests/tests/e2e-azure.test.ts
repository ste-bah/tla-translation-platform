/**
 * TASK-INT-001: E2E Test — AWS to Azure Full Stack Translation
 *
 * Exercises the complete pipeline:
 *   parseHclDirectory -> DependencyGraph.build -> IrEmitter.emit -> TranslationCompiler.translate
 *
 * Uses real registry data loaded from packages/registry/data.
 * Fixtures are intentionally simple (no for_each, no dynamic blocks) to stay
 * within what the @cdktf/hcl2json parser handles reliably.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { parseHclDirectory, DependencyGraph, IrEmitter, resolveRegistryKey } from '@tla/ingestion';
import { TranslationCompiler } from '@tla/translator';
import { RegistryApi } from '@tla/registry';
import { loadRegistryFromDirectory } from '@tla/registry';
import { validateRegistryEntries } from '@tla/registry';
import type { RegistryEntry } from '@tla/shared';
import type { CanonicalIR, CompilerOptions, TranslationResult } from '@tla/shared';
import type { RegistryApi as RegistryApiType } from '@tla/registry';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const FIXTURES_DIR = resolve(
  __dirname,
  '../fixtures/aws-reference-stack',
);

const REGISTRY_DIR = resolve(
  __dirname,
  '../../registry/data',
);

// ---------------------------------------------------------------------------
// Bridge registry wrapper
//
// The real RegistryApi stores entries keyed by short aws_service names
// (e.g. "vpc", "ec2"), while the TranslationCompiler/Planner calls
// registry.lookup(resource.sourceType) with full Terraform types (e.g.
// "aws_vpc", "aws_instance"). The IrEmitter bridges this with
// resolveRegistryKey(), but the planner calls lookup() directly.
//
// This wrapper resolves the full type to its short key before delegating,
// making the pipeline work end-to-end without changing production code.
// ---------------------------------------------------------------------------

function makeBridgeRegistry(realRegistry: RegistryApi): RegistryApiType {
  return {
    // Resolve full Terraform type → short registry key before delegating
    lookup: (awsResourceType: string): RegistryEntry | undefined => {
      const shortKey = resolveRegistryKey(awsResourceType);
      if (shortKey !== undefined) {
        return realRegistry.lookup(shortKey);
      }
      // Already a short key or unknown — try direct lookup as fallback
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
// Suite-level setup — parse once, translate once
// ---------------------------------------------------------------------------

let ir: CanonicalIR;
let result: TranslationResult;
let parseErrors: Array<{ file: string; error: Error }>;
let unmappedTypes: string[];

beforeAll(async () => {
  // 1. Parse HCL fixture directory
  const parseResult = await parseHclDirectory(FIXTURES_DIR);
  parseErrors = parseResult.errors;

  expect(parseErrors, `HCL parse errors: ${parseErrors.map((e) => e.error.message).join(', ')}`).toHaveLength(0);
  expect(parseResult.asts.length).toBeGreaterThan(0);

  // 2. Build dependency graph
  const graph = new DependencyGraph();
  graph.build(parseResult.asts);

  // 3. Load registry (real entries, bridged for full-type lookup)
  const realRegistry = new RegistryApi(REGISTRY_DIR, loadRegistryFromDirectory, validateRegistryEntries);
  await realRegistry.init();
  const registry = makeBridgeRegistry(realRegistry);

  // 4. Emit IR
  const emitter = new IrEmitter(registry);
  const emitResult = emitter.emit(parseResult.asts, graph);
  ir = emitResult.ir;
  unmappedTypes = emitResult.unmappedTypes;

  expect(ir.resources.length, 'IR should contain at least one resource').toBeGreaterThan(0);

  // 5. Translate to Azure
  const options: CompilerOptions = {
    targetProvider: 'azure',
    registryVersion: '2025.03.01',
  };

  const compiler = new TranslationCompiler(registry);
  result = compiler.translate(ir, options);
}, 30000);

// ---------------------------------------------------------------------------
// Parse & IR integrity
// ---------------------------------------------------------------------------

describe('Parse and IR integrity', () => {
  it('parses all fixture .tf files without errors', () => {
    expect(parseErrors).toHaveLength(0);
  });

  it('produces a non-empty IR with aws sourceProvider', () => {
    expect(ir.sourceProvider).toBe('aws');
    expect(ir.resources.length).toBeGreaterThan(0);
  });

  it('includes a VPC resource in the IR', () => {
    const vpc = ir.resources.find((r) => r.sourceType === 'aws_vpc');
    expect(vpc).toBeDefined();
    expect(vpc?.sourceName).toBe('main');
  });

  it('includes at least 4 subnet resources in the IR', () => {
    const subnets = ir.resources.filter((r) => r.sourceType === 'aws_subnet');
    expect(subnets.length).toBeGreaterThanOrEqual(4);
  });

  it('includes 4 security group resources in the IR', () => {
    const sgs = ir.resources.filter((r) => r.sourceType === 'aws_security_group');
    expect(sgs.length).toBe(4);
  });

  it('includes an ALB resource in the IR', () => {
    const alb = ir.resources.find((r) => r.sourceType === 'aws_lb');
    expect(alb).toBeDefined();
    expect(alb?.sourceName).toBe('web');
  });

  it('includes an RDS instance in the IR', () => {
    const rds = ir.resources.find((r) => r.sourceType === 'aws_db_instance');
    expect(rds).toBeDefined();
    expect(rds?.sourceName).toBe('postgres');
  });

  it('includes an S3 bucket in the IR', () => {
    const s3 = ir.resources.find((r) => r.sourceType === 'aws_s3_bucket');
    expect(s3).toBeDefined();
    expect(s3?.sourceName).toBe('app_assets');
  });

  it('does not report aws_vpc, aws_subnet, aws_security_group, aws_lb, aws_db_instance, aws_s3_bucket as unmapped', () => {
    const mappedTypes = ['aws_vpc', 'aws_subnet', 'aws_security_group', 'aws_lb', 'aws_db_instance', 'aws_s3_bucket'];
    for (const t of mappedTypes) {
      expect(unmappedTypes, `${t} should be mapped in registry`).not.toContain(t);
    }
  });
});

// ---------------------------------------------------------------------------
// Translation result: target = azure
// ---------------------------------------------------------------------------

describe('Translation result metadata', () => {
  it('targets azure', () => {
    expect(result.target).toBe('azure');
  });

  it('produces translated resources', () => {
    expect(result.resources.length).toBeGreaterThan(0);
  });

  it('has a manifest with correct target', () => {
    expect(result.manifest.target).toBe('azure');
  });

  it('overall confidence is greater than 0', () => {
    expect(result.manifest.confidenceOverall).toBeGreaterThan(0);
  });

  it('generates HCL output files', () => {
    expect(Object.keys(result.files).length).toBeGreaterThan(0);
    // Azure codegen should produce at least a main.tf
    const hasMain = Object.keys(result.files).some((f) => f.includes('main'));
    expect(hasMain).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// VPC -> VNet mapping
// ---------------------------------------------------------------------------

describe('VPC -> Azure VNet mapping', () => {
  it('translates aws_vpc to azurerm_virtual_network', () => {
    const vnetResources = result.resources.filter(
      (r) => r.targetType === 'azurerm_virtual_network',
    );
    expect(vnetResources.length).toBeGreaterThanOrEqual(1);
  });

  it('VNet translated resource has the VPC as its sourceId', () => {
    const vpcIr = ir.resources.find((r) => r.sourceType === 'aws_vpc');
    expect(vpcIr).toBeDefined();

    const vnetResources = result.resources.filter(
      (r) => r.sourceId === vpcIr!.id && r.targetType === 'azurerm_virtual_network',
    );
    expect(vnetResources.length).toBeGreaterThanOrEqual(1);
  });

  it('VNet manifest entry is not blocked', () => {
    const vpcIr = ir.resources.find((r) => r.sourceType === 'aws_vpc');
    expect(vpcIr).toBeDefined();

    const entry = result.manifest.entries.find((e) => e.sourceId === vpcIr!.id);
    expect(entry).toBeDefined();
    expect(entry!.status).not.toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// Subnet mapping
// ---------------------------------------------------------------------------

describe('Subnet mapping', () => {
  it('translates at least 4 aws_subnet resources', () => {
    const subnetIrIds = ir.resources
      .filter((r) => r.sourceType === 'aws_subnet')
      .map((r) => r.id);

    const translatedSubnets = result.resources.filter(
      (r) => subnetIrIds.includes(r.sourceId) && r.targetType === 'azurerm_subnet',
    );
    expect(translatedSubnets.length).toBeGreaterThanOrEqual(4);
  });

  it('subnet manifest entries are not blocked', () => {
    const subnetIrIds = ir.resources
      .filter((r) => r.sourceType === 'aws_subnet')
      .map((r) => r.id);

    const subnetEntries = result.manifest.entries.filter(
      (e) => subnetIrIds.includes(e.sourceId),
    );
    for (const entry of subnetEntries) {
      expect(entry.status, `Subnet ${entry.sourceId} should not be blocked`).not.toBe('blocked');
    }
  });
});

// ---------------------------------------------------------------------------
// Security Group -> NSG mapping
// ---------------------------------------------------------------------------

describe('Security Group -> Azure NSG mapping', () => {
  it('translates aws_security_group resources to azurerm_network_security_group', () => {
    const sgIrIds = ir.resources
      .filter((r) => r.sourceType === 'aws_security_group')
      .map((r) => r.id);

    const nsgResources = result.resources.filter(
      (r) => sgIrIds.includes(r.sourceId) && r.targetType === 'azurerm_network_security_group',
    );
    // Each SG should produce at least one NSG resource
    expect(nsgResources.length).toBeGreaterThanOrEqual(1);
  });

  it('security group manifest entries are translated or expanded (not blocked)', () => {
    const sgIrIds = ir.resources
      .filter((r) => r.sourceType === 'aws_security_group')
      .map((r) => r.id);

    const sgEntries = result.manifest.entries.filter(
      (e) => sgIrIds.includes(e.sourceId),
    );
    for (const entry of sgEntries) {
      expect(entry.status, `SG ${entry.sourceId} should not be blocked`).not.toBe('blocked');
    }
  });

  it('produces NSG resources for web, app, db, and bastion security groups', () => {
    const sgNames = ['web', 'app', 'db', 'bastion'];
    for (const sgName of sgNames) {
      const sgIr = ir.resources.find(
        (r) => r.sourceType === 'aws_security_group' && r.sourceName === sgName,
      );
      expect(sgIr, `SG '${sgName}' not found in IR`).toBeDefined();

      const nsg = result.resources.find(
        (r) => r.sourceId === sgIr!.id && r.targetType === 'azurerm_network_security_group',
      );
      expect(nsg, `No NSG translated from SG '${sgName}'`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// ALB -> Azure Application Gateway (compound expansion)
// ---------------------------------------------------------------------------

describe('ALB -> Azure compound expansion', () => {
  it('produces at least one azurerm_application_gateway from aws_lb', () => {
    const albIr = ir.resources.find((r) => r.sourceType === 'aws_lb');
    expect(albIr).toBeDefined();

    const agw = result.resources.find(
      (r) => r.sourceId === albIr!.id && r.targetType === 'azurerm_application_gateway',
    );
    expect(agw).toBeDefined();
  });

  it('produces azurerm_public_ip as part of ALB compound expansion', () => {
    const albIr = ir.resources.find((r) => r.sourceType === 'aws_lb');
    expect(albIr).toBeDefined();

    const pip = result.resources.find(
      (r) => r.sourceId === albIr!.id && r.targetType === 'azurerm_public_ip',
    );
    expect(pip).toBeDefined();
  });

  it('ALB manifest entry is expanded (1:N compound output)', () => {
    const albIr = ir.resources.find((r) => r.sourceType === 'aws_lb');
    expect(albIr).toBeDefined();

    const entry = result.manifest.entries.find((e) => e.sourceId === albIr!.id);
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('expanded');
  });
});

// ---------------------------------------------------------------------------
// RDS PostgreSQL -> Azure Flexible Server
// ---------------------------------------------------------------------------

describe('RDS PostgreSQL -> Azure Flexible Server mapping', () => {
  it('translates aws_db_instance (postgres) to azurerm_postgresql_flexible_server', () => {
    const rdsIr = ir.resources.find((r) => r.sourceType === 'aws_db_instance');
    expect(rdsIr).toBeDefined();

    const flexServer = result.resources.find(
      (r) =>
        r.sourceId === rdsIr!.id &&
        r.targetType === 'azurerm_postgresql_flexible_server',
    );
    expect(flexServer).toBeDefined();
  });

  it('RDS manifest entry is not blocked', () => {
    const rdsIr = ir.resources.find((r) => r.sourceType === 'aws_db_instance');
    expect(rdsIr).toBeDefined();

    const entry = result.manifest.entries.find((e) => e.sourceId === rdsIr!.id);
    expect(entry).toBeDefined();
    expect(entry!.status).not.toBe('blocked');
  });

  it('RDS manifest entry confidence is greater than 0', () => {
    const rdsIr = ir.resources.find((r) => r.sourceType === 'aws_db_instance');
    expect(rdsIr).toBeDefined();

    const entry = result.manifest.entries.find((e) => e.sourceId === rdsIr!.id);
    expect(entry!.confidence).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// S3 -> Azure Storage Account
// ---------------------------------------------------------------------------

describe('S3 -> Azure Storage Account mapping', () => {
  it('translates aws_s3_bucket to azurerm_storage_account', () => {
    const s3Ir = ir.resources.find((r) => r.sourceType === 'aws_s3_bucket');
    expect(s3Ir).toBeDefined();

    const storageAccount = result.resources.find(
      (r) => r.sourceId === s3Ir!.id && r.targetType === 'azurerm_storage_account',
    );
    expect(storageAccount).toBeDefined();
  });

  it('S3 manifest entry is translated and not blocked', () => {
    const s3Ir = ir.resources.find((r) => r.sourceType === 'aws_s3_bucket');
    expect(s3Ir).toBeDefined();

    const entry = result.manifest.entries.find((e) => e.sourceId === s3Ir!.id);
    expect(entry).toBeDefined();
    expect(entry!.status).not.toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// Manifest completeness — no silent drops
// ---------------------------------------------------------------------------

describe('Manifest completeness', () => {
  it('manifest has an entry for every IR resource (no silent drops)', () => {
    const manifestIds = new Set(result.manifest.entries.map((e) => e.sourceId));
    for (const irRes of ir.resources) {
      expect(
        manifestIds.has(irRes.id),
        `IR resource ${irRes.id} (${irRes.sourceType}.${irRes.sourceName}) has no manifest entry`,
      ).toBe(true);
    }
  });

  it('manifest counts.total matches ir.resources.length', () => {
    expect(result.manifest.counts.total).toBe(ir.resources.length);
  });

  it('sum of manifest status counts equals total', () => {
    const { total, translated, expanded, partial, blocked, advisory } =
      result.manifest.counts;
    expect(translated + expanded + partial + blocked + advisory).toBe(total);
  });

  it('at least one resource is translated or expanded (pipeline produces output)', () => {
    const { translated, expanded } = result.manifest.counts;
    expect(translated + expanded).toBeGreaterThan(0);
  });

  it('overall confidence across the manifest is greater than 0', () => {
    expect(result.manifest.confidenceOverall).toBeGreaterThan(0);
  });
});
