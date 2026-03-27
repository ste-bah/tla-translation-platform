#!/usr/bin/env npx tsx
/**
 * Registry Coverage Audit
 *
 * Loads all registry YAML entries and produces an honest coverage report
 * showing unique AWS service types, family breakdown, band distribution,
 * and an estimate of coverage vs the full AWS Terraform provider catalogue.
 *
 * Usage:
 *   npx tsx scripts/registry-coverage-audit.ts
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { createRequire } from 'node:module';

// Resolve 'yaml' from the registry package where pnpm has it available
const require = createRequire(
  resolve(import.meta.dirname ?? '.', '..', 'packages', 'registry', 'src', 'loader.ts'),
);
const { parse: parseYaml } = require('yaml') as { parse: (input: string) => unknown };

// ── Types (minimal subset matching registry YAML schema) ────────────────

interface RegistryYamlEntry {
  registry_entry_id: string;
  aws_service: string;
  aws_family: string;
  azure_targets: string[];
  gcp_targets: string[];
  mapping_type: string;
  band: string;
  confidence: number;
  output_mode: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function collectYamlFiles(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  const dirents = await readdir(dirPath, { withFileTypes: true });
  for (const dirent of dirents) {
    if (dirent.isSymbolicLink()) continue;
    const fullPath = join(dirPath, dirent.name);
    if (dirent.isDirectory()) {
      results.push(...(await collectYamlFiles(fullPath)));
    } else if (dirent.isFile()) {
      const ext = extname(dirent.name).toLowerCase();
      if (ext === '.yaml' || ext === '.yml') {
        results.push(fullPath);
      }
    }
  }
  return results;
}

async function loadEntries(dirPath: string): Promise<RegistryYamlEntry[]> {
  const files = await collectYamlFiles(dirPath);
  const entries: RegistryYamlEntry[] = [];
  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = parseYaml(raw);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (item && typeof item === 'object' && 'aws_service' in item) {
        entries.push(item as RegistryYamlEntry);
      }
    }
  }
  return entries;
}

// ── Friendly display names for aws_service codes ────────────────────────

const SERVICE_DISPLAY: Record<string, string> = {
  ec2: 'EC2',
  asg: 'Auto Scaling Group',
  lambda: 'Lambda',
  ecs: 'ECS',
  eks: 'EKS',
  fargate: 'Fargate',
  rds: 'RDS',
  dynamodb: 'DynamoDB',
  elasticache_redis: 'ElastiCache Redis',
  s3: 'S3',
  ebs: 'EBS',
  ecr: 'ECR',
  efs: 'EFS',
  vpc: 'VPC',
  subnet: 'Subnet',
  nat_gateway: 'NAT Gateway',
  security_group: 'Security Group',
  alb: 'ALB',
  nlb: 'NLB',
  cloudfront: 'CloudFront',
  route53: 'Route 53',
  vpc_peering: 'VPC Peering',
};

function displayName(awsService: string): string {
  return SERVICE_DISPLAY[awsService] ?? awsService;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const registryDir = resolve(
    import.meta.dirname ?? '.',
    '..',
    'packages',
    'registry',
    'data',
  );

  const entries = await loadEntries(registryDir);

  // Unique AWS service types
  const uniqueServices = new Set(entries.map((e) => e.aws_service));

  // Group by family
  const byFamily = new Map<string, RegistryYamlEntry[]>();
  for (const entry of entries) {
    const list = byFamily.get(entry.aws_family) ?? [];
    list.push(entry);
    byFamily.set(entry.aws_family, list);
  }

  // Group by band
  const byBand = new Map<string, RegistryYamlEntry[]>();
  for (const entry of entries) {
    const list = byBand.get(entry.band) ?? [];
    list.push(entry);
    byBand.set(entry.band, list);
  }

  // Group by mapping type
  const byMappingType = new Map<string, RegistryYamlEntry[]>();
  for (const entry of entries) {
    const list = byMappingType.get(entry.mapping_type) ?? [];
    list.push(entry);
    byMappingType.set(entry.mapping_type, list);
  }

  // Average confidence
  const avgConfidence =
    entries.length > 0
      ? entries.reduce((sum, e) => sum + e.confidence, 0) / entries.length
      : 0;

  // ── Report ──────────────────────────────────────────────────────────

  console.log('');
  console.log('TLA Registry Coverage Audit');
  console.log('============================');
  console.log('');
  console.log(`Total registry entries:    ${entries.length}`);
  console.log(`Unique AWS service types:  ${uniqueServices.size}`);
  console.log(`Families covered:          ${byFamily.size}`);
  console.log(`Average confidence:        ${(avgConfidence * 100).toFixed(1)}%`);
  console.log('');

  // By Family
  console.log('By Family:');
  const familyOrder = [...byFamily.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [family, familyEntries] of familyOrder) {
    const services = familyEntries.map((e) => displayName(e.aws_service)).join(', ');
    console.log(`  ${family.padEnd(14)} ${String(familyEntries.length).padStart(2)} entries  (${services})`);
  }
  console.log('');

  // By Band
  console.log('By Band:');
  const bandLabels: Record<string, string> = {
    P1: 'P1 (portable)',
    P2: 'P2 (portable+ext)',
    N1: 'N1 (native only)',
    M1: 'M1 (advisory)',
  };
  const bandOrder = ['P1', 'P2', 'N1', 'M1'];
  for (const band of bandOrder) {
    const bandEntries = byBand.get(band) ?? [];
    if (bandEntries.length === 0) continue;
    const label = bandLabels[band] ?? band;
    const services = bandEntries.map((e) => displayName(e.aws_service)).join(', ');
    console.log(`  ${label.padEnd(22)} ${String(bandEntries.length).padStart(2)}  (${services})`);
  }
  console.log('');

  // By Mapping Type
  console.log('By Mapping Type:');
  const typeLabels: Record<string, string> = {
    direct: 'direct (1:1)',
    parametric: 'parametric (cross-ref)',
    compound: 'compound (1:N)',
    structural: 'structural (reshape)',
    none: 'none (advisory)',
  };
  const typeOrder = ['direct', 'parametric', 'compound', 'structural', 'none'];
  for (const mt of typeOrder) {
    const mtEntries = byMappingType.get(mt) ?? [];
    if (mtEntries.length === 0) continue;
    const label = typeLabels[mt] ?? mt;
    console.log(`  ${label.padEnd(26)} ${String(mtEntries.length).padStart(2)}`);
  }
  console.log('');

  // Coverage note
  console.log('Coverage Note:');
  console.log(`  This registry covers ${uniqueServices.size} AWS service types.`);
  console.log('  The full AWS Terraform provider has ~1,200+ resource types');
  console.log('  (aws_instance, aws_s3_bucket_versioning, aws_iam_role, etc.).');
  console.log(`  Current coverage: ~${((uniqueServices.size / 1200) * 100).toFixed(1)}% of all AWS resource types.`);
  console.log('');
  console.log(`  However, these ${uniqueServices.size} services represent the most commonly used`);
  console.log('  infrastructure primitives (compute, networking, storage, database)');
  console.log('  and cover a significant share of real-world Terraform configurations.');
  console.log('');
  console.log('  Empty family directories (no entries yet):');
  const allFamilyDirs = ['compute', 'containers', 'database', 'messaging', 'networking', 'observability', 'security', 'serverless', 'storage'];
  const emptyFamilies = allFamilyDirs.filter((f) => !byFamily.has(f));
  if (emptyFamilies.length > 0) {
    console.log(`    ${emptyFamilies.join(', ')}`);
  } else {
    console.log('    (none)');
  }
  console.log('');
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
