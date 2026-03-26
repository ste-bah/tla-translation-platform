import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'node:path';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { parsePlanJson } from '../../src/parser/plan-parser.js';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

const mockReadFile = vi.mocked(readFile);

const FIXTURE_PATH = resolve(__dirname, '../fixtures/plan.json');
const PLAN_FIXTURE = readFileSync(FIXTURE_PATH, 'utf-8');

describe('parsePlanJson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses a valid plan JSON file', async () => {
    mockReadFile.mockResolvedValueOnce(PLAN_FIXTURE as never);

    const plan = await parsePlanJson('/tmp/plan.json');

    expect(plan.format_version).toBe('1.2');
    expect(plan.terraform_version).toBe('1.5.7');
    expect(plan.resource_changes).toHaveLength(2);
    expect(plan.planned_values.root_module.resources).toHaveLength(2);
  });

  it('parses resource change actions', async () => {
    mockReadFile.mockResolvedValueOnce(PLAN_FIXTURE as never);

    const plan = await parsePlanJson('/tmp/plan.json');

    const s3Change = plan.resource_changes.find(
      (rc) => rc.type === 'aws_s3_bucket',
    );
    expect(s3Change).toBeDefined();
    expect(s3Change!.change.actions).toEqual(['create']);
    expect(s3Change!.change.before).toBeNull();
    expect(s3Change!.change.after).toBeDefined();
  });

  it('parses planned values with resource addresses', async () => {
    mockReadFile.mockResolvedValueOnce(PLAN_FIXTURE as never);

    const plan = await parsePlanJson('/tmp/plan.json');

    const resources = plan.planned_values.root_module.resources;
    expect(resources[0]!.address).toBe('aws_s3_bucket.data');
    expect(resources[1]!.address).toBe('aws_instance.web');
  });

  it('parses configuration provider_config', async () => {
    mockReadFile.mockResolvedValueOnce(PLAN_FIXTURE as never);

    const plan = await parsePlanJson('/tmp/plan.json');

    expect(plan.configuration).toBeDefined();
    expect(plan.configuration!.provider_config['aws']).toBeDefined();
    expect(plan.configuration!.provider_config['aws']!.name).toBe('aws');
  });

  it('throws IngestionError on file read failure', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT') as never);

    await expect(parsePlanJson('/tmp/missing.json')).rejects.toThrow(
      'Failed to read plan file',
    );
  });

  it('throws IngestionError on invalid JSON', async () => {
    mockReadFile.mockResolvedValueOnce('not json {{{' as never);

    await expect(parsePlanJson('/tmp/bad.json')).rejects.toThrow(
      'Invalid JSON in plan file',
    );
  });

  it('throws IngestionError on schema validation failure', async () => {
    const invalidPlan = JSON.stringify({
      format_version: '1.2',
      // Missing terraform_version and planned_values
    });
    mockReadFile.mockResolvedValueOnce(invalidPlan as never);

    await expect(parsePlanJson('/tmp/invalid.json')).rejects.toThrow(
      'Plan file failed schema validation',
    );
  });
});
