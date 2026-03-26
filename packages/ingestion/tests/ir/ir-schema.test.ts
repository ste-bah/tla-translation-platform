import { describe, it, expect } from 'vitest';
import { validateIr } from '../../src/ir/ir-schema.js';
import { ValidationError } from '@tla/shared';

const SOURCE_LOC = { file: 'main.tf', line: 1, column: 0 };

function makeMinimalIr(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

function makeResource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'aws_s3_bucket.main',
    sourceType: 'aws_s3_bucket',
    sourceName: 'main',
    sourceModule: null,
    category: 'storage',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: null,
    translationStatus: 'pending',
    confidence: 0.9,
    tags: {},
    sourceLocation: SOURCE_LOC,
    ...overrides,
  };
}

describe('validateIr', () => {
  it('accepts a minimal valid IR', () => {
    const ir = validateIr(makeMinimalIr());
    expect(ir.version).toBe('1.0.0');
    expect(ir.sourceProvider).toBe('aws');
    expect(ir.resources).toEqual([]);
  });

  it('accepts an IR with resources', () => {
    const ir = validateIr(makeMinimalIr({
      resources: [makeResource()],
      metadata: {
        generatedAt: '2026-01-01T00:00:00Z',
        sourceFiles: ['main.tf'],
        toolVersion: '0.1.0',
        resourceCount: 1,
        relationshipCount: 0,
      },
    }));
    expect(ir.resources).toHaveLength(1);
    expect(ir.resources[0].id).toBe('aws_s3_bucket.main');
  });

  it('accepts an IR with relationships', () => {
    const ir = validateIr(makeMinimalIr({
      relationships: [
        { from: 'a', to: 'b', type: 'depends_on' },
        { from: 'c', to: 'd', type: 'secures', metadata: { note: 'tls' } },
      ],
    }));
    expect(ir.relationships).toHaveLength(2);
    expect(ir.relationships[0].type).toBe('depends_on');
    expect(ir.relationships[1].metadata).toEqual({ note: 'tls' });
  });

  it('accepts an IR with modules', () => {
    const ir = validateIr(makeMinimalIr({
      modules: [{ name: 'vpc', source: './modules/vpc', resources: ['aws_vpc.main'] }],
    }));
    expect(ir.modules).toHaveLength(1);
  });

  it('accepts an IR with intents', () => {
    const ir = validateIr(makeMinimalIr({
      intents: [
        { kind: 'networking', subtype: 'vpc', resources: ['aws_vpc.main'], properties: {} },
        { kind: 'secret', subtype: 'secret_store', resources: ['aws_secretsmanager_secret.db'], properties: {} },
      ],
    }));
    expect(ir.intents).toHaveLength(2);
    expect(ir.intents[0].kind).toBe('networking');
  });

  it('defaults resource translationStatus to pending', () => {
    const resource = { ...makeResource() };
    delete (resource as Record<string, unknown>).translationStatus;
    const ir = validateIr(makeMinimalIr({ resources: [resource] }));
    expect(ir.resources[0].translationStatus).toBe('pending');
  });

  it('defaults resource confidence to 0', () => {
    const resource = { ...makeResource() };
    delete (resource as Record<string, unknown>).confidence;
    const ir = validateIr(makeMinimalIr({ resources: [resource] }));
    expect(ir.resources[0].confidence).toBe(0);
  });

  // ---- Invalid input tests ----

  it('rejects non-semver version', () => {
    expect(() => validateIr(makeMinimalIr({ version: 'v1' }))).toThrow(ValidationError);
  });

  it('rejects invalid provider', () => {
    expect(() => validateIr(makeMinimalIr({ sourceProvider: 'oracle' }))).toThrow(ValidationError);
  });

  it('rejects resource with empty id', () => {
    expect(() => validateIr(makeMinimalIr({
      resources: [makeResource({ id: '' })],
    }))).toThrow(ValidationError);
  });

  it('rejects confidence > 1', () => {
    expect(() => validateIr(makeMinimalIr({
      resources: [makeResource({ confidence: 1.5 })],
    }))).toThrow(ValidationError);
  });

  it('rejects confidence < 0', () => {
    expect(() => validateIr(makeMinimalIr({
      resources: [makeResource({ confidence: -0.1 })],
    }))).toThrow(ValidationError);
  });

  it('rejects invalid relationship type', () => {
    expect(() => validateIr(makeMinimalIr({
      relationships: [{ from: 'a', to: 'b', type: 'invalid_type' }],
    }))).toThrow(ValidationError);
  });

  it('rejects invalid category', () => {
    expect(() => validateIr(makeMinimalIr({
      resources: [makeResource({ category: 'unknown_category' })],
    }))).toThrow(ValidationError);
  });

  it('rejects invalid intent kind', () => {
    expect(() => validateIr(makeMinimalIr({
      intents: [{ kind: 'teleportation', subtype: 'x', resources: [], properties: {} }],
    }))).toThrow(ValidationError);
  });

  it('rejects missing metadata fields', () => {
    expect(() => validateIr(makeMinimalIr({
      metadata: { generatedAt: '2026-01-01T00:00:00Z' },
    }))).toThrow(ValidationError);
  });

  it('rejects null input', () => {
    expect(() => validateIr(null)).toThrow(ValidationError);
  });

  it('rejects undefined input', () => {
    expect(() => validateIr(undefined)).toThrow(ValidationError);
  });

  it('wraps Zod parse error in ValidationError with zodError context', () => {
    try {
      validateIr({ version: 123, garbage: true });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const ve = err as InstanceType<typeof ValidationError>;
      expect(ve.message).toBe('Invalid Canonical IR structure');
      // The catch path stores the Zod error message in context.zodError
      expect((ve as unknown as { context: Record<string, unknown> }).context).toHaveProperty('zodError');
      expect(typeof (ve as unknown as { context: Record<string, unknown> }).context.zodError).toBe('string');
      // Should preserve the original cause
      expect(ve.cause).toBeDefined();
    }
  });

  it('catches non-object input and wraps in ValidationError', () => {
    // Passing a primitive string exercises the Zod parse catch path.
    // The catch block converts the Zod error via `err instanceof Error ? err.message : String(err)`.
    try {
      validateIr('just a string');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const ve = err as InstanceType<typeof ValidationError>;
      expect(ve.message).toBe('Invalid Canonical IR structure');
      expect((ve as unknown as { context: Record<string, unknown> }).context).toHaveProperty('zodError');
    }
  });

  it('catches numeric input and wraps in ValidationError', () => {
    try {
      validateIr(42);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
    }
  });

  it('accepts all valid translation statuses', () => {
    const statuses = ['pending', 'translated', 'expanded', 'partial', 'blocked', 'advisory'];
    for (const status of statuses) {
      const ir = validateIr(makeMinimalIr({
        resources: [makeResource({ translationStatus: status })],
      }));
      expect(ir.resources[0].translationStatus).toBe(status);
    }
  });

  it('accepts all valid relationship types', () => {
    const types = ['contains', 'references', 'depends_on', 'secures', 'routes_to', 'stores_in'];
    for (const type of types) {
      const ir = validateIr(makeMinimalIr({
        relationships: [{ from: 'a', to: 'b', type }],
      }));
      expect(ir.relationships[0].type).toBe(type);
    }
  });

  it('accepts all valid resource categories', () => {
    const categories = [
      'compute', 'storage', 'database', 'networking', 'security',
      'serverless', 'messaging', 'observability', 'containers', 'identity',
    ];
    for (const category of categories) {
      const ir = validateIr(makeMinimalIr({
        resources: [makeResource({ category })],
      }));
      expect(ir.resources[0].category).toBe(category);
    }
  });
});
