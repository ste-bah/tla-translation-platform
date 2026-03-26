import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'node:path';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { parseStateJson } from '../../src/parser/state-parser.js';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

const mockReadFile = vi.mocked(readFile);

const FIXTURE_PATH = resolve(__dirname, '../fixtures/state-v4.json');
const STATE_V4_FIXTURE = readFileSync(FIXTURE_PATH, 'utf-8');

describe('parseStateJson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses a valid v4 state file', async () => {
    mockReadFile.mockResolvedValueOnce(STATE_V4_FIXTURE as never);

    const state = await parseStateJson('/tmp/state.json');

    expect(state.version).toBe(4);
    expect(state.terraform_version).toBe('1.5.7');
    expect(state.serial).toBe(5);
    expect(state.lineage).toBeDefined();
  });

  it('parses v4 state resources', async () => {
    mockReadFile.mockResolvedValueOnce(STATE_V4_FIXTURE as never);

    const state = await parseStateJson('/tmp/state.json');

    // v4 has resources at top level
    if (state.version === 4) {
      expect(state.resources).toHaveLength(3);
      const s3 = state.resources.find((r) => r.type === 'aws_s3_bucket');
      expect(s3).toBeDefined();
      expect(s3!.name).toBe('data');
      expect(s3!.instances).toHaveLength(1);
      expect(s3!.instances[0]!.attributes['bucket']).toBe(
        'tla-demo-data-production',
      );
    }
  });

  it('parses v4 state outputs', async () => {
    mockReadFile.mockResolvedValueOnce(STATE_V4_FIXTURE as never);

    const state = await parseStateJson('/tmp/state.json');

    if (state.version === 4) {
      expect(state.outputs['bucket_arn']).toBeDefined();
      expect(state.outputs['bucket_arn']!.value).toBe(
        'arn:aws:s3:::tla-demo-data-production',
      );
    }
  });

  it('parses v4 resource dependencies', async () => {
    mockReadFile.mockResolvedValueOnce(STATE_V4_FIXTURE as never);

    const state = await parseStateJson('/tmp/state.json');

    if (state.version === 4) {
      const instance = state.resources.find(
        (r) => r.type === 'aws_instance',
      );
      expect(instance).toBeDefined();
      expect(instance!.instances[0]!.dependencies).toEqual([
        'aws_s3_bucket.data',
      ]);
    }
  });

  it('parses v4 data sources', async () => {
    mockReadFile.mockResolvedValueOnce(STATE_V4_FIXTURE as never);

    const state = await parseStateJson('/tmp/state.json');

    if (state.version === 4) {
      const ami = state.resources.find(
        (r) => r.mode === 'data' && r.type === 'aws_ami',
      );
      expect(ami).toBeDefined();
      expect(ami!.name).toBe('latest');
    }
  });

  it('parses a valid v3 state file', async () => {
    const v3State = JSON.stringify({
      version: 3,
      terraform_version: '0.11.14',
      serial: 3,
      lineage: 'abc-123',
      modules: [
        {
          path: ['root'],
          outputs: {
            bucket_id: { value: 'my-bucket' },
          },
          resources: {
            'aws_s3_bucket.data': {
              type: 'aws_s3_bucket',
              depends_on: [],
              primary: {
                id: 'my-bucket',
                attributes: {
                  id: 'my-bucket',
                  bucket: 'my-bucket',
                },
                meta: {},
              },
              provider: 'provider.aws',
            },
          },
        },
      ],
    });
    mockReadFile.mockResolvedValueOnce(v3State as never);

    const state = await parseStateJson('/tmp/state-v3.json');

    expect(state.version).toBe(3);
    if (state.version === 3) {
      expect(state.modules).toHaveLength(1);
      expect(state.modules[0]!.path).toEqual(['root']);
    }
  });

  it('throws IngestionError when file cannot be read', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT') as never);

    await expect(parseStateJson('/tmp/missing.json')).rejects.toThrow(
      'Failed to read state file',
    );
  });

  it('throws IngestionError on invalid JSON', async () => {
    mockReadFile.mockResolvedValueOnce('not json' as never);

    await expect(parseStateJson('/tmp/bad.json')).rejects.toThrow(
      'Invalid JSON in state file',
    );
  });

  it('throws IngestionError when version field is missing', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ terraform_version: '1.0' }) as never,
    );

    await expect(parseStateJson('/tmp/no-version.json')).rejects.toThrow(
      'State file missing version field',
    );
  });

  it('throws IngestionError for unsupported version', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ version: 2, terraform_version: '0.9' }) as never,
    );

    await expect(parseStateJson('/tmp/v2.json')).rejects.toThrow(
      'Unsupported state file version: 2',
    );
  });
});
