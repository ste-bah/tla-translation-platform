import { describe, it, expect } from 'vitest';
import { serializeIr, deserializeIr } from '../../src/ir/ir-serializer.js';
import { ValidationError, IngestionError } from '@tla/shared';
import type { CanonicalIR } from '@tla/shared';

const SOURCE_LOC = { file: 'main.tf', line: 1, column: 0 };

function makeValidIr(overrides: Partial<CanonicalIR> = {}): CanonicalIR {
  return {
    version: '1.0.0',
    sourceProvider: 'aws',
    resources: [],
    relationships: [],
    modules: [],
    intents: [],
    metadata: {
      generatedAt: '2026-01-01T00:00:00Z',
      sourceFiles: ['main.tf'],
      toolVersion: '0.1.0',
      resourceCount: 0,
      relationshipCount: 0,
    },
    ...overrides,
  };
}

describe('serializeIr', () => {
  it('produces valid JSON', () => {
    const ir = makeValidIr();
    const json = serializeIr(ir);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('sorts keys alphabetically', () => {
    const ir = makeValidIr();
    const json = serializeIr(ir);
    const parsed = JSON.parse(json);
    const keys = Object.keys(parsed);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });

  it('preserves all data', () => {
    const ir = makeValidIr({
      resources: [
        {
          id: 'aws_s3_bucket.main',
          sourceType: 'aws_s3_bucket',
          sourceName: 'main',
          sourceModule: null,
          category: 'storage',
          attributes: { versioning: true },
          sourceAttributes: {},
          registryEntryId: null,
          translationStatus: 'pending',
          confidence: 0.95,
          tags: { env: 'prod' },
          sourceLocation: SOURCE_LOC,
        },
      ],
      metadata: {
        generatedAt: '2026-01-01T00:00:00Z',
        sourceFiles: ['main.tf'],
        toolVersion: '0.1.0',
        resourceCount: 1,
        relationshipCount: 0,
      },
    });
    const json = serializeIr(ir);
    const parsed = JSON.parse(json);
    expect(parsed.resources[0].id).toBe('aws_s3_bucket.main');
    expect(parsed.resources[0].attributes.versioning).toBe(true);
    expect(parsed.resources[0].tags.env).toBe('prod');
  });

  it('produces pretty-printed output', () => {
    const ir = makeValidIr();
    const json = serializeIr(ir);
    expect(json).toContain('\n');
    expect(json).toContain('  ');
  });
});

describe('deserializeIr', () => {
  it('round-trips a valid IR', () => {
    const ir = makeValidIr({
      resources: [
        {
          id: 'aws_vpc.main',
          sourceType: 'aws_vpc',
          sourceName: 'main',
          sourceModule: 'network',
          category: 'networking',
          attributes: { cidr_block: '10.0.0.0/16' },
          sourceAttributes: {},
          registryEntryId: 'reg-001',
          translationStatus: 'translated',
          confidence: 1.0,
          tags: {},
          sourceLocation: SOURCE_LOC,
        },
      ],
      relationships: [
        { from: 'aws_vpc.main', to: 'aws_subnet.pub', type: 'contains' },
      ],
      modules: [
        { name: 'network', source: './modules/vpc', resources: ['aws_vpc.main'] },
      ],
      intents: [
        { kind: 'networking', subtype: 'vpc', resources: ['aws_vpc.main'], properties: {} },
      ],
      metadata: {
        generatedAt: '2026-01-01T00:00:00Z',
        sourceFiles: ['main.tf', 'vpc.tf'],
        toolVersion: '0.1.0',
        resourceCount: 1,
        relationshipCount: 1,
      },
    });

    const json = serializeIr(ir);
    const restored = deserializeIr(json);

    expect(restored.version).toBe(ir.version);
    expect(restored.sourceProvider).toBe(ir.sourceProvider);
    expect(restored.resources).toHaveLength(1);
    expect(restored.resources[0].id).toBe('aws_vpc.main');
    expect(restored.resources[0].attributes.cidr_block).toBe('10.0.0.0/16');
    expect(restored.relationships).toHaveLength(1);
    expect(restored.modules).toHaveLength(1);
    expect(restored.intents).toHaveLength(1);
    expect(restored.metadata.sourceFiles).toEqual(['main.tf', 'vpc.tf']);
  });

  it('throws ValidationError for invalid JSON structure', () => {
    expect(() => deserializeIr('{"version":"bad"}')).toThrow(ValidationError);
  });

  it('throws IngestionError for malformed JSON', () => {
    expect(() => deserializeIr('not json')).toThrow(IngestionError);
  });

  it('IngestionError for malformed JSON includes context and cause', () => {
    try {
      deserializeIr('not json');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(IngestionError);
      const ie = err as IngestionError;
      expect(ie.message).toBe('Failed to parse IR JSON');
      expect(ie.context).toHaveProperty('jsonLength', 8);
      expect(ie.cause).toBeInstanceOf(SyntaxError);
    }
  });

  it('round-trips an IR with all intent kinds', () => {
    const ir = makeValidIr({
      intents: [
        { kind: 'networking', subtype: 'vpc', resources: ['r1'], properties: {} },
        { kind: 'identity', subtype: 'role', resources: ['r2'], properties: {} },
        { kind: 'encryption', subtype: 'at_rest', resources: ['r3'], properties: {} },
        { kind: 'scaling', subtype: 'auto_scaling', resources: ['r4'], properties: {} },
        { kind: 'resilience', subtype: 'multi_az', resources: ['r5'], properties: {} },
        { kind: 'observability', subtype: 'monitoring', resources: ['r6'], properties: {} },
        { kind: 'secret', subtype: 'secret_store', resources: ['r7'], properties: {} },
      ],
    });
    const json = serializeIr(ir);
    const restored = deserializeIr(json);
    expect(restored.intents).toHaveLength(7);
    const kinds = restored.intents.map((i) => i.kind);
    expect(kinds).toEqual([
      'networking', 'identity', 'encryption', 'scaling',
      'resilience', 'observability', 'secret',
    ]);
  });

  it('deterministic serialization produces identical output', () => {
    const ir = makeValidIr({
      resources: [
        {
          id: 'aws_s3_bucket.main',
          sourceType: 'aws_s3_bucket',
          sourceName: 'main',
          sourceModule: null,
          category: 'storage',
          attributes: { zebra: 1, alpha: 2 },
          sourceAttributes: {},
          registryEntryId: null,
          translationStatus: 'pending',
          confidence: 0.5,
          tags: {},
          sourceLocation: SOURCE_LOC,
        },
      ],
    });
    const json1 = serializeIr(ir);
    const json2 = serializeIr(ir);
    expect(json1).toBe(json2);
  });
});
