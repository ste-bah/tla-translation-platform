import { describe, it, expect } from 'vitest';
import {
  GcpCodeGenerator,
  convertValue,
} from '../../src/codegen/gcp-codegen.js';
import type { GcpGenOptions } from '../../src/codegen/gcp-codegen.js';
import type { TranslatedResource } from '@tla/shared';
import { resolveGcpRegion, awsAzToGcpZone, AWS_TO_GCP_REGION } from '../../src/codegen/gcp/region-mapping.js';
import { sanitizeGcpName } from '../../src/codegen/gcp/naming.js';
import { transformLabels } from '../../src/codegen/gcp/label-transformer.js';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeResource(overrides: Partial<TranslatedResource> = {}): TranslatedResource {
  return {
    targetType: 'google_compute_network',
    targetName: 'main',
    attributes: {},
    sourceId: 'res-001',
    traceability: {
      sourceId: 'res-001',
      sourceType: 'aws_vpc',
      registryEntryId: 'SER-NET-VPC-001',
      mappingType: 'direct',
      confidence: 0.95,
      engineUsed: 'direct',
    },
    ...overrides,
  };
}

function generate(
  resources: TranslatedResource[] = [],
  options?: GcpGenOptions,
): Map<string, string> {
  const gen = new GcpCodeGenerator();
  return gen.generate(resources, options);
}

// ---------------------------------------------------------------------------
// GcpCodeGenerator -- file generation
// ---------------------------------------------------------------------------

describe('GcpCodeGenerator', () => {
  describe('empty resources', () => {
    it('produces 5 files', () => {
      const files = generate();
      expect(files.size).toBe(5);
      expect(files.has('main.tf')).toBe(true);
      expect(files.has('providers.tf')).toBe(true);
      expect(files.has('terraform.tf')).toBe(true);
      expect(files.has('variables.tf')).toBe(true);
      expect(files.has('outputs.tf')).toBe(true);
    });

    it('main.tf contains no-resources comment when empty', () => {
      const files = generate();
      const main = files.get('main.tf')!;
      expect(main).toContain('No resources translated');
    });
  });

  describe('main.tf', () => {
    it('renders a single translated resource', () => {
      const res = makeResource({
        targetType: 'google_compute_network',
        targetName: 'primary',
        attributes: {
          name: 'vpc-primary',
          auto_create_subnetworks: false,
        },
      });
      const files = generate([res]);
      const main = files.get('main.tf')!;
      expect(main).toContain('resource "google_compute_network"');
      expect(main).toContain('name = "vpc-primary"');
      expect(main).toContain('auto_create_subnetworks = false');
    });

    it('sorts resources by targetType then targetName', () => {
      const r1 = makeResource({ targetType: 'google_compute_subnetwork', targetName: 'b' });
      const r2 = makeResource({ targetType: 'google_compute_subnetwork', targetName: 'a' });
      const r3 = makeResource({ targetType: 'google_compute_network', targetName: 'x' });
      const files = generate([r1, r2, r3]);
      const main = files.get('main.tf')!;
      const networkIdx = main.indexOf('"google_compute_network"');
      const subnetIdx = main.indexOf('"google_compute_subnetwork"');
      expect(networkIdx).toBeLessThan(subnetIdx);
    });

    it('emits traceability comments when emitComments=true', () => {
      const res = makeResource();
      const files = generate([res], { emitComments: true });
      const main = files.get('main.tf')!;
      expect(main).toContain('# Source: aws_vpc');
      expect(main).toContain('engine: direct');
      expect(main).toContain('confidence: 0.95');
    });

    it('emits Required API comment for google_compute_ resources', () => {
      const res = makeResource({ targetType: 'google_compute_instance' });
      const files = generate([res], { emitComments: true });
      const main = files.get('main.tf')!;
      expect(main).toContain('# Required API: compute.googleapis.com');
    });

    it('omits traceability comments when emitComments=false', () => {
      const res = makeResource();
      const files = generate([res], { emitComments: false });
      const main = files.get('main.tf')!;
      expect(main).not.toContain('# Source:');
      expect(main).not.toContain('# Required API:');
    });

    it('detects interpolation expressions and renders bare references', () => {
      const res = makeResource({
        attributes: {
          network: '${google_compute_network.main.self_link}',
        },
      });
      const files = generate([res]);
      const main = files.get('main.tf')!;
      expect(main).toContain('network = google_compute_network.main.self_link');
      expect(main).not.toContain('"${google_compute_network.main.self_link}"');
    });

    it('renders labels as a map (with = sign)', () => {
      const res = makeResource({
        attributes: {
          labels: { name: 'my-vpc', environment: 'prod' },
        },
      });
      const files = generate([res]);
      const main = files.get('main.tf')!;
      expect(main).toContain('labels = {');
      expect(main).toContain('name = "my-vpc"');
    });

    it('renders block keys (boot_disk, network_interface) as blocks', () => {
      const res = makeResource({
        targetType: 'google_compute_instance',
        attributes: {
          boot_disk: { auto_delete: true, device_name: 'boot' },
          network_interface: { network: 'default' },
        },
      });
      const files = generate([res]);
      const main = files.get('main.tf')!;
      expect(main).toContain('boot_disk {');
      expect(main).not.toContain('boot_disk = {');
      expect(main).toContain('network_interface {');
      expect(main).not.toContain('network_interface = {');
    });

    it('sanitizes resource names via sanitizeGcpName', () => {
      const res = makeResource({
        targetType: 'google_compute_instance',
        targetName: 'MY_LONG_INSTANCE_NAME_THAT_EXCEEDS_THE_63_CHARACTER_LIMIT_FOR_GCP_RESOURCES',
      });
      const files = generate([res]);
      const main = files.get('main.tf')!;
      const match = main.match(/resource "google_compute_instance" "([^"]+)"/);
      expect(match).not.toBeNull();
      const name = match![1]!;
      expect(name.length).toBeLessThanOrEqual(63);
      expect(name).toBe(name.toLowerCase());
    });
  });

  describe('providers.tf', () => {
    it('renders google provider with project and region', () => {
      const files = generate();
      const providers = files.get('providers.tf')!;
      expect(providers).toContain('provider "google" {');
      expect(providers).toContain('var.project_id');
      expect(providers).toContain('var.region');
    });

    it('does NOT contain features block (unlike Azure)', () => {
      const files = generate();
      const providers = files.get('providers.tf')!;
      expect(providers).not.toContain('features');
    });

    it('uses custom projectIdVar', () => {
      const files = generate([], { projectIdVar: 'my_project' });
      const providers = files.get('providers.tf')!;
      expect(providers).toContain('var.my_project');
    });
  });

  describe('terraform.tf', () => {
    it('contains hashicorp/google source', () => {
      const files = generate();
      const tf = files.get('terraform.tf')!;
      expect(tf).toContain('hashicorp/google');
    });

    it('contains version constraint ~> 5.0', () => {
      const files = generate();
      const tf = files.get('terraform.tf')!;
      expect(tf).toContain('~> 5.0');
    });

    it('contains required_providers block', () => {
      const files = generate();
      const tf = files.get('terraform.tf')!;
      expect(tf).toContain('required_providers {');
    });

    it('wraps in terraform block', () => {
      const files = generate();
      const tf = files.get('terraform.tf')!;
      expect(tf).toContain('terraform {');
    });
  });

  describe('variables.tf', () => {
    it('declares project_id variable as sensitive', () => {
      const files = generate();
      const vars = files.get('variables.tf')!;
      expect(vars).toContain('variable "project_id"');
      expect(vars).toContain('sensitive   = true');
    });

    it('declares region variable with default GCP region', () => {
      const files = generate();
      const vars = files.get('variables.tf')!;
      expect(vars).toContain('variable "region"');
      expect(vars).toContain('type        = string');
      // Default region for us-east-1 is us-east1
      expect(vars).toContain('"us-east1"');
    });

    it('declares zone variable', () => {
      const files = generate();
      const vars = files.get('variables.tf')!;
      expect(vars).toContain('variable "zone"');
      // Default zone is region + -b
      expect(vars).toContain('"us-east1-b"');
    });

    it('declares environment variable', () => {
      const files = generate();
      const vars = files.get('variables.tf')!;
      expect(vars).toContain('variable "environment"');
      expect(vars).toContain('"dev"');
    });

    it('maps source region to GCP region', () => {
      const files = generate([], { sourceRegion: 'us-west-2' });
      const vars = files.get('variables.tf')!;
      expect(vars).toContain('"us-west2"');
    });

    it('uses custom environment', () => {
      const files = generate([], { environment: 'staging' });
      const vars = files.get('variables.tf')!;
      expect(vars).toContain('"staging"');
    });
  });

  describe('outputs.tf', () => {
    it('declares project_id output', () => {
      const files = generate();
      const outputs = files.get('outputs.tf')!;
      expect(outputs).toContain('output "project_id"');
      expect(outputs).toContain('var.project_id');
    });

    it('declares region output', () => {
      const files = generate();
      const outputs = files.get('outputs.tf')!;
      expect(outputs).toContain('output "region"');
      expect(outputs).toContain('var.region');
    });

    it('marks project_id output as sensitive', () => {
      const files = generate();
      const outputs = files.get('outputs.tf')!;
      // The sensitive marker should appear in the project_id output block
      expect(outputs).toContain('sensitive');
    });
  });

  describe('deterministic output', () => {
    it('same input produces same output', () => {
      const resources = [
        makeResource({ targetType: 'google_compute_subnetwork', targetName: 'a', sourceId: 's1' }),
        makeResource({ targetType: 'google_compute_network', targetName: 'b', sourceId: 's2' }),
      ];
      const opts: GcpGenOptions = { sourceRegion: 'eu-west-1', environment: 'prod' };
      const files1 = generate(resources, opts);
      const files2 = generate(resources, opts);
      for (const [name, content] of files1) {
        expect(files2.get(name)).toBe(content);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// convertValue() (exported as convertGcpValue alias in tests)
// ---------------------------------------------------------------------------

describe('convertValue()', () => {
  it('converts null to literal null', () => {
    const v = convertValue(null);
    expect(v.kind).toBe('literal');
    expect((v as { value: unknown }).value).toBeNull();
  });

  it('converts undefined to literal null', () => {
    const v = convertValue(undefined);
    expect(v.kind).toBe('literal');
  });

  it('converts booleans to literal', () => {
    expect(convertValue(true)).toEqual({ kind: 'literal', value: true });
    expect(convertValue(false)).toEqual({ kind: 'literal', value: false });
  });

  it('converts numbers to literal', () => {
    expect(convertValue(42)).toEqual({ kind: 'literal', value: 42 });
  });

  it('converts plain strings to literal', () => {
    const v = convertValue('hello');
    expect(v.kind).toBe('literal');
    expect((v as { value: unknown }).value).toBe('hello');
  });

  it('converts ${...} interpolation to expr', () => {
    const v = convertValue('${google_compute_network.main.self_link}');
    expect(v.kind).toBe('expr');
    expect((v as { expr: string }).expr).toBe('google_compute_network.main.self_link');
  });

  it('does not convert partial interpolation to expr', () => {
    const v = convertValue('prefix-${var.name}-suffix');
    expect(v.kind).toBe('literal');
  });

  it('converts arrays of primitives to list', () => {
    const v = convertValue(['a', 'b']);
    expect(v.kind).toBe('list');
  });

  it('converts array of primitives under block key to list', () => {
    const v = convertValue([1, 2, 3], 'allow');
    expect(v.kind).toBe('list');
  });

  it('converts objects to map by default', () => {
    const v = convertValue({ key: 'val' });
    expect(v.kind).toBe('map');
  });

  it('converts objects under block keys (boot_disk) to block', () => {
    const v = convertValue({ auto_delete: true }, 'boot_disk');
    expect(v.kind).toBe('block');
  });

  it('converts objects not at block key to map', () => {
    const v = convertValue({ custom_field: 'val' }, 'metadata');
    expect(v.kind).toBe('map');
  });

  it('always converts labels as map even though it is an object', () => {
    const v = convertValue({ env: 'prod' }, 'labels');
    expect(v.kind).toBe('map');
  });

  it('routes tags through transformLabels (returns map)', () => {
    const v = convertValue({ Name: 'my-res', Env: 'prod' }, 'tags');
    expect(v.kind).toBe('map');
  });

  it('converts array of objects under block key to blocks', () => {
    const v = convertValue(
      [{ priority: 100 }, { priority: 200 }],
      'allow',
    );
    expect(v.kind).toBe('blocks');
  });
});

// ---------------------------------------------------------------------------
// resolveGcpRegion()
// ---------------------------------------------------------------------------

describe('resolveGcpRegion()', () => {
  it('maps us-east-1 to us-east1', () => {
    expect(resolveGcpRegion('us-east-1')).toBe('us-east1');
  });

  it('maps us-west-2 to us-west2', () => {
    expect(resolveGcpRegion('us-west-2')).toBe('us-west2');
  });

  it('maps eu-west-1 to europe-west1', () => {
    expect(resolveGcpRegion('eu-west-1')).toBe('europe-west1');
  });

  it('maps ap-southeast-1 to asia-southeast1', () => {
    expect(resolveGcpRegion('ap-southeast-1')).toBe('asia-southeast1');
  });

  it('maps ap-northeast-1 to asia-northeast1', () => {
    expect(resolveGcpRegion('ap-northeast-1')).toBe('asia-northeast1');
  });

  it('maps sa-east-1 to southamerica-east1', () => {
    expect(resolveGcpRegion('sa-east-1')).toBe('southamerica-east1');
  });

  it('returns us-central1 for unknown region', () => {
    expect(resolveGcpRegion('mars-central-1')).toBe('us-central1');
  });

  it('returns us-central1 for empty string', () => {
    expect(resolveGcpRegion('')).toBe('us-central1');
  });
});

// ---------------------------------------------------------------------------
// awsAzToGcpZone()
// ---------------------------------------------------------------------------

describe('awsAzToGcpZone()', () => {
  it('maps us-east-1a to us-east1-a', () => {
    expect(awsAzToGcpZone('us-east-1a')).toBe('us-east1-a');
  });

  it('maps us-east-1b to us-east1-b', () => {
    expect(awsAzToGcpZone('us-east-1b')).toBe('us-east1-b');
  });

  it('maps eu-west-1c to europe-west1-c', () => {
    expect(awsAzToGcpZone('eu-west-1c')).toBe('europe-west1-c');
  });

  it('returns default zone for empty string', () => {
    const result = awsAzToGcpZone('');
    expect(result).toBe('us-central1-a');
  });
});

// ---------------------------------------------------------------------------
// AWS_TO_GCP_REGION map
// ---------------------------------------------------------------------------

describe('AWS_TO_GCP_REGION', () => {
  it('has 16 entries matching REGION_MAP', () => {
    expect(AWS_TO_GCP_REGION.size).toBe(16);
  });

  it('maps ca-central-1 to northamerica-northeast1', () => {
    expect(AWS_TO_GCP_REGION.get('ca-central-1')).toBe('northamerica-northeast1');
  });
});

// ---------------------------------------------------------------------------
// sanitizeGcpName()
// ---------------------------------------------------------------------------

describe('sanitizeGcpName()', () => {
  it('lowercases names', () => {
    const name = sanitizeGcpName('vm', 'MyInstance');
    expect(name).toBe('myinstance');
  });

  it('replaces special characters with hyphens', () => {
    const name = sanitizeGcpName('vm', 'my_instance.name');
    expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('truncates to 63 characters by default', () => {
    const long = 'a'.repeat(100);
    const name = sanitizeGcpName('vm', long);
    expect(name.length).toBeLessThanOrEqual(63);
  });

  it('prepends type prefix when name starts with digit', () => {
    const name = sanitizeGcpName('vm', '123instance');
    expect(name).toMatch(/^[a-z]/);
    expect(name).toContain('123instance');
  });

  it('falls back to typeShort for empty input', () => {
    const name = sanitizeGcpName('vm', '');
    expect(name).toBe('vm');
  });

  it('falls back to typeShort when all chars are invalid', () => {
    const name = sanitizeGcpName('vpc', '!!!');
    expect(name).toBe('vpc');
  });

  it('leaves already valid names unchanged', () => {
    const name = sanitizeGcpName('vm', 'my-valid-name');
    expect(name).toBe('my-valid-name');
  });

  it('collapses consecutive hyphens', () => {
    const name = sanitizeGcpName('vm', 'a---b');
    expect(name).toBe('a-b');
  });

  it('strips leading and trailing hyphens', () => {
    const name = sanitizeGcpName('vm', '-leading-trailing-');
    expect(name).toBe('leading-trailing');
  });

  it('respects GCS bucket max length of 222', () => {
    const long = 'a'.repeat(250);
    const name = sanitizeGcpName('gcs', long);
    expect(name.length).toBeLessThanOrEqual(222);
  });

  it('respects pubsub max length of 255', () => {
    const long = 'a'.repeat(300);
    const name = sanitizeGcpName('pubsub', long);
    expect(name.length).toBeLessThanOrEqual(255);
  });

  it('strips trailing hyphen from truncation', () => {
    // Create a name that will have a hyphen right at the truncation point
    const base = 'a'.repeat(62) + '-z';
    const name = sanitizeGcpName('vm', base);
    expect(name).not.toMatch(/-$/);
    expect(name.length).toBeLessThanOrEqual(63);
  });
});

// ---------------------------------------------------------------------------
// transformLabels()
// ---------------------------------------------------------------------------

describe('transformLabels()', () => {
  it('transforms clean tags to clean labels (lowercase)', () => {
    const { labels, warnings } = transformLabels({ name: 'test', env: 'prod' });
    expect(labels).toEqual({ env: 'prod', name: 'test' });
    expect(warnings).toHaveLength(0);
  });

  it('lowercases uppercase keys', () => {
    const { labels, warnings } = transformLabels({ Name: 'test' });
    expect(labels).toHaveProperty('name', 'test');
    expect(warnings).toHaveLength(0);
  });

  it('replaces invalid characters in key with underscore', () => {
    const { labels, warnings } = transformLabels({ 'my.key@val': 'v' });
    const keys = Object.keys(labels);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^[a-z][a-z0-9_-]*$/);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('prepends tag_ for key starting with digit', () => {
    const { labels, warnings } = transformLabels({ '1key': 'val' });
    const keys = Object.keys(labels);
    expect(keys[0]).toBe('tag_1key');
    expect(warnings.some((w) => w.includes('sanitised'))).toBe(true);
  });

  it('drops reserved goog prefix with warning', () => {
    const { labels, warnings } = transformLabels({ google_managed: 'yes', valid: 'ok' });
    expect(labels).not.toHaveProperty('google_managed');
    expect(labels).toHaveProperty('valid', 'ok');
    expect(warnings.some((w) => w.includes('Dropped reserved'))).toBe(true);
  });

  it('drops reserved aws: prefix with warning', () => {
    const { labels, warnings } = transformLabels({ 'aws:createdBy': 'cf', valid: 'ok' });
    expect(Object.keys(labels)).not.toContain('aws:createdBy');
    expect(labels).toHaveProperty('valid', 'ok');
    expect(warnings.some((w) => w.includes('Dropped reserved'))).toBe(true);
  });

  it('truncates key longer than 63 chars with warning', () => {
    const longKey = 'a'.repeat(100);
    const { labels, warnings } = transformLabels({ [longKey]: 'val' });
    const keys = Object.keys(labels);
    expect(keys[0]!.length).toBeLessThanOrEqual(63);
    expect(warnings.some((w) => w.includes('sanitised'))).toBe(true);
  });

  it('truncates value longer than 63 chars with warning', () => {
    const longVal = 'x'.repeat(100);
    const { labels, warnings } = transformLabels({ key: longVal });
    expect(labels['key']!.length).toBeLessThanOrEqual(63);
    expect(warnings.some((w) => w.includes('sanitised'))).toBe(true);
  });

  it('returns empty labels and no warnings for empty tags', () => {
    const { labels, warnings } = transformLabels({});
    expect(Object.keys(labels)).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('drops excess labels beyond 64 with warning', () => {
    const tags: Record<string, string> = {};
    for (let i = 0; i < 70; i++) {
      tags[`key${String(i).padStart(3, '0')}`] = `val${i}`;
    }
    const { labels, warnings } = transformLabels(tags);
    expect(Object.keys(labels).length).toBeLessThanOrEqual(64);
    expect(warnings.some((w) => w.includes('Exceeded maximum'))).toBe(true);
  });

  it('handles duplicate keys after sanitisation (last wins with warning)', () => {
    // 'A.B' and 'A_B' both sanitise to 'a_b'
    const { labels, warnings } = transformLabels({ 'A.B': 'first', 'A_B': 'second' });
    // Both sanitise to 'a_b'; sorted order: A.B before A_B -> second wins
    expect(labels['a_b']).toBe('second');
    expect(warnings.some((w) => w.includes('Duplicate label key'))).toBe(true);
  });
});
