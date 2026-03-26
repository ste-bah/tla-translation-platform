import { describe, it, expect } from 'vitest';
import {
  TlaError,
  RegistryError,
  IngestionError,
  TranslationError,
  ValidationError,
  isTlaError,
} from '@tla/shared';

describe('TlaError', () => {
  it('has correct properties', () => {
    const ctx = { key: 'value' };
    const err = new TlaError('test message', 'TEST_CODE', ctx);

    expect(err.message).toBe('test message');
    expect(err.code).toBe('TEST_CODE');
    expect(err.context).toEqual({ key: 'value' });
    expect(err.name).toBe('TlaError');
    expect(err).toBeInstanceOf(Error);
  });

  it('stores cause when provided', () => {
    const cause = new Error('root cause');
    const err = new TlaError('wrapper', 'WRAP', undefined, cause);

    expect(err.cause).toBe(cause);
  });

  it('has undefined context when not provided', () => {
    const err = new TlaError('msg', 'CODE');
    expect(err.context).toBeUndefined();
  });

  describe('toJSON', () => {
    it('produces expected structure without cause', () => {
      const err = new TlaError('msg', 'CODE', { a: 1 });
      const json = err.toJSON();

      expect(json).toEqual({
        name: 'TlaError',
        code: 'CODE',
        message: 'msg',
        context: { a: 1 },
        cause: undefined,
      });
    });

    it('serializes Error cause as name+message', () => {
      const cause = new TypeError('bad type');
      const err = new TlaError('msg', 'CODE', undefined, cause);
      const json = err.toJSON();

      expect(json.cause).toEqual({ name: 'TypeError', message: 'bad type' });
    });

    it('serializes non-Error cause directly', () => {
      const err = new TlaError('msg', 'CODE', undefined, 'string cause');
      const json = err.toJSON();

      expect(json.cause).toBe('string cause');
    });
  });
});

describe('RegistryError', () => {
  it('has correct code', () => {
    const err = new RegistryError('registry failed');
    expect(err.code).toBe('REGISTRY_ERROR');
    expect(err.name).toBe('RegistryError');
  });

  it('is an instance of TlaError', () => {
    const err = new RegistryError('msg');
    expect(err).toBeInstanceOf(TlaError);
  });

  it('accepts context and cause', () => {
    const cause = new Error('disk failure');
    const err = new RegistryError('load failed', { path: '/tmp' }, cause);
    expect(err.context).toEqual({ path: '/tmp' });
    expect(err.cause).toBe(cause);
  });
});

describe('IngestionError', () => {
  it('has correct code', () => {
    const err = new IngestionError('ingestion failed');
    expect(err.code).toBe('INGESTION_ERROR');
    expect(err.name).toBe('IngestionError');
  });

  it('is an instance of TlaError', () => {
    expect(new IngestionError('msg')).toBeInstanceOf(TlaError);
  });
});

describe('TranslationError', () => {
  it('has correct code', () => {
    const err = new TranslationError('translation failed');
    expect(err.code).toBe('TRANSLATION_ERROR');
    expect(err.name).toBe('TranslationError');
  });

  it('is an instance of TlaError', () => {
    expect(new TranslationError('msg')).toBeInstanceOf(TlaError);
  });
});

describe('ValidationError', () => {
  it('has correct code', () => {
    const err = new ValidationError('validation failed');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.name).toBe('ValidationError');
  });

  it('is an instance of TlaError', () => {
    expect(new ValidationError('msg')).toBeInstanceOf(TlaError);
  });
});

describe('isTlaError', () => {
  it('returns true for TlaError instances', () => {
    expect(isTlaError(new TlaError('msg', 'CODE'))).toBe(true);
  });

  it('returns true for subclass instances', () => {
    expect(isTlaError(new RegistryError('msg'))).toBe(true);
    expect(isTlaError(new IngestionError('msg'))).toBe(true);
    expect(isTlaError(new TranslationError('msg'))).toBe(true);
    expect(isTlaError(new ValidationError('msg'))).toBe(true);
  });

  it('returns false for regular Error', () => {
    expect(isTlaError(new Error('msg'))).toBe(false);
  });

  it('returns false for plain object', () => {
    expect(isTlaError({ code: 'FAKE', message: 'fake' })).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isTlaError(null)).toBe(false);
    expect(isTlaError(undefined)).toBe(false);
  });

  it('returns false for string', () => {
    expect(isTlaError('error string')).toBe(false);
  });
});

describe('Error cause chain', () => {
  it('supports multi-level cause chain', () => {
    const root = new Error('disk full');
    const mid = new RegistryError('read failed', { file: 'a.yaml' }, root);
    const top = new TlaError('init failed', 'INIT_ERROR', undefined, mid);

    expect(top.cause).toBe(mid);
    expect((top.cause as RegistryError).cause).toBe(root);
    expect((top.cause as RegistryError).code).toBe('REGISTRY_ERROR');
  });
});
