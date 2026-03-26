import { describe, it, expect } from 'vitest';
import {
  analyzeExpression,
  extractReferencesFromValue,
  REFERENCE_RE,
} from '../../src/variables/expression-analyzer.js';

// ---------------------------------------------------------------------------
// analyzeExpression
// ---------------------------------------------------------------------------

describe('analyzeExpression', () => {
  // -- Literal primitives ---------------------------------------------------

  describe('literal primitives', () => {
    it('should classify null as literal with no refs', () => {
      const result = analyzeExpression(null);
      expect(result.complexity).toBe('literal');
      expect(result.references).toEqual([]);
      expect(result.hasFunctions).toBe(false);
    });

    it('should classify undefined as literal with no refs', () => {
      const result = analyzeExpression(undefined);
      expect(result.complexity).toBe('literal');
      expect(result.references).toEqual([]);
      expect(result.hasFunctions).toBe(false);
    });

    it('should classify number 42 as literal', () => {
      const result = analyzeExpression(42);
      expect(result.complexity).toBe('literal');
      expect(result.references).toEqual([]);
      expect(result.hasFunctions).toBe(false);
    });

    it('should classify 0 as literal', () => {
      const result = analyzeExpression(0);
      expect(result.complexity).toBe('literal');
      expect(result.references).toEqual([]);
    });

    it('should classify boolean true as literal', () => {
      const result = analyzeExpression(true);
      expect(result.complexity).toBe('literal');
      expect(result.references).toEqual([]);
      expect(result.hasFunctions).toBe(false);
    });

    it('should classify boolean false as literal', () => {
      const result = analyzeExpression(false);
      expect(result.complexity).toBe('literal');
      expect(result.references).toEqual([]);
    });

    it('should classify a plain string as literal', () => {
      const result = analyzeExpression('hello world');
      expect(result.complexity).toBe('literal');
      expect(result.references).toEqual([]);
      expect(result.hasFunctions).toBe(false);
    });

    it('should classify empty string as literal', () => {
      const result = analyzeExpression('');
      expect(result.complexity).toBe('literal');
      expect(result.references).toEqual([]);
    });
  });

  // -- Simple references ----------------------------------------------------

  describe('simple references', () => {
    it('should classify "var.region" as simple_ref', () => {
      const result = analyzeExpression('var.region');
      expect(result.complexity).toBe('simple_ref');
      expect(result.references).toEqual(['var.region']);
      expect(result.hasFunctions).toBe(false);
    });

    it('should classify "local.tags" as simple_ref', () => {
      const result = analyzeExpression('local.tags');
      expect(result.complexity).toBe('simple_ref');
      expect(result.references).toEqual(['local.tags']);
    });

    it('should classify "data.aws_ami.latest" as simple_ref', () => {
      const result = analyzeExpression('data.aws_ami.latest');
      expect(result.complexity).toBe('simple_ref');
      expect(result.references).toEqual(['data.aws_ami.latest']);
    });

    it('should classify "module.vpc" as simple_ref', () => {
      const result = analyzeExpression('module.vpc');
      expect(result.complexity).toBe('simple_ref');
      expect(result.references).toEqual(['module.vpc']);
    });

    it('should trim whitespace for simple_ref classification', () => {
      const result = analyzeExpression('  var.region  ');
      expect(result.complexity).toBe('simple_ref');
      expect(result.references).toEqual(['var.region']);
    });

    it('should extract nested dot-path reference', () => {
      const result = analyzeExpression('module.vpc.output_id');
      expect(result.complexity).toBe('simple_ref');
      expect(result.references).toEqual(['module.vpc.output_id']);
    });
  });

  // -- Interpolation --------------------------------------------------------

  describe('interpolation', () => {
    it('should classify ${var.prefix}-suffix as interpolation', () => {
      const result = analyzeExpression('${var.prefix}-suffix');
      expect(result.complexity).toBe('interpolation');
      expect(result.references).toEqual(['var.prefix']);
    });

    it('should classify "${var.prefix}-${var.suffix}" with two refs as interpolation', () => {
      const result = analyzeExpression('${var.prefix}-${var.suffix}');
      expect(result.complexity).toBe('interpolation');
      expect(result.references).toContain('var.prefix');
      expect(result.references).toContain('var.suffix');
      expect(result.references).toHaveLength(2);
    });

    it('should classify mixed text with refs as interpolation', () => {
      const result = analyzeExpression('arn:aws:s3:::var.bucket_name');
      expect(result.complexity).toBe('interpolation');
      expect(result.references).toEqual(['var.bucket_name']);
    });

    it('should detect multiple references in interpolation', () => {
      const result = analyzeExpression('${var.env}-${local.name}-${var.suffix}');
      expect(result.references).toHaveLength(3);
      expect(result.references).toContain('var.env');
      expect(result.references).toContain('local.name');
      expect(result.references).toContain('var.suffix');
    });
  });

  // -- Complex expressions --------------------------------------------------

  describe('complex expressions', () => {
    it('should classify object with nested refs as complex', () => {
      const result = analyzeExpression({
        Name: 'var.project_name',
        Environment: 'var.env',
      });
      expect(result.complexity).toBe('complex');
      expect(result.references).toContain('var.project_name');
      expect(result.references).toContain('var.env');
    });

    it('should classify array with refs as complex', () => {
      const result = analyzeExpression(['var.cidr_block', 'var.secondary_cidr']);
      expect(result.complexity).toBe('complex');
      expect(result.references).toContain('var.cidr_block');
      expect(result.references).toContain('var.secondary_cidr');
    });

    it('should classify empty object as literal', () => {
      const result = analyzeExpression({});
      expect(result.complexity).toBe('literal');
      expect(result.references).toEqual([]);
    });

    it('should classify empty array as literal', () => {
      const result = analyzeExpression([]);
      expect(result.complexity).toBe('literal');
      expect(result.references).toEqual([]);
    });

    it('should classify object without refs as literal', () => {
      const result = analyzeExpression({ Name: 'static', Env: 'prod' });
      expect(result.complexity).toBe('literal');
      expect(result.references).toEqual([]);
    });
  });

  // -- Function detection ---------------------------------------------------

  describe('function detection', () => {
    it('should detect merge() as a function call', () => {
      const result = analyzeExpression('merge(var.a, var.b)');
      expect(result.hasFunctions).toBe(true);
      expect(result.references).toContain('var.a');
      expect(result.references).toContain('var.b');
    });

    it('should detect lookup() function', () => {
      const result = analyzeExpression('lookup(var.map, "key", "default")');
      expect(result.hasFunctions).toBe(true);
    });

    it('should detect length() function', () => {
      const result = analyzeExpression('length(var.list)');
      expect(result.hasFunctions).toBe(true);
    });

    it('should detect function in complex expression', () => {
      const result = analyzeExpression('toset(var.allowed_cidrs)');
      expect(result.hasFunctions).toBe(true);
      expect(result.references).toEqual(['var.allowed_cidrs']);
    });

    it('should not detect function when no parens', () => {
      const result = analyzeExpression('var.region');
      expect(result.hasFunctions).toBe(false);
    });

    it('should classify string with function + refs as complex', () => {
      const result = analyzeExpression('merge(var.default_tags, var.extra_tags)');
      expect(result.complexity).toBe('complex');
      expect(result.hasFunctions).toBe(true);
    });
  });

  // -- REFERENCE_RE lastIndex reset -----------------------------------------

  describe('REFERENCE_RE lastIndex reset', () => {
    it('should return correct refs on consecutive calls', () => {
      const first = analyzeExpression('var.first');
      const second = analyzeExpression('var.second');
      expect(first.references).toEqual(['var.first']);
      expect(second.references).toEqual(['var.second']);
    });

    it('should handle rapid repeated calls with same input', () => {
      for (let i = 0; i < 5; i++) {
        const result = analyzeExpression('var.region');
        expect(result.references).toEqual(['var.region']);
      }
    });
  });

  // -- Deduplication --------------------------------------------------------

  describe('reference deduplication', () => {
    it('should deduplicate repeated references', () => {
      const result = analyzeExpression('${var.region}-${var.region}');
      expect(result.references).toEqual(['var.region']);
    });

    it('should deduplicate in object values', () => {
      const result = analyzeExpression({
        a: 'var.same',
        b: 'var.same',
      });
      expect(result.references).toEqual(['var.same']);
    });
  });

  // -- data.* and module.* references ---------------------------------------

  describe('data and module references', () => {
    it('should extract data.aws_ami.latest', () => {
      const result = analyzeExpression('data.aws_ami.latest');
      expect(result.references).toEqual(['data.aws_ami.latest']);
    });

    it('should extract module.vpc.vpc_id', () => {
      const result = analyzeExpression('module.vpc.vpc_id');
      expect(result.references).toEqual(['module.vpc.vpc_id']);
    });

    it('should extract mixed ref types', () => {
      const result = analyzeExpression(
        '${var.region}-${data.aws_caller_identity.current.account_id}-${module.naming.prefix}',
      );
      expect(result.references).toContain('var.region');
      expect(result.references).toContain('data.aws_caller_identity.current.account_id');
      expect(result.references).toContain('module.naming.prefix');
    });
  });
});

// ---------------------------------------------------------------------------
// extractReferencesFromValue
// ---------------------------------------------------------------------------

describe('extractReferencesFromValue', () => {
  it('should return empty array for null', () => {
    expect(extractReferencesFromValue(null)).toEqual([]);
  });

  it('should return empty array for plain string', () => {
    expect(extractReferencesFromValue('hello')).toEqual([]);
  });

  it('should return refs from interpolation', () => {
    const refs = extractReferencesFromValue('${var.env}-app');
    expect(refs).toEqual(['var.env']);
  });

  it('should return refs from object', () => {
    const refs = extractReferencesFromValue({ key: 'var.x', val: 'local.y' });
    expect(refs).toContain('var.x');
    expect(refs).toContain('local.y');
  });

  it('should return empty array for number', () => {
    expect(extractReferencesFromValue(100)).toEqual([]);
  });

  it('should return empty array for boolean', () => {
    expect(extractReferencesFromValue(true)).toEqual([]);
  });
});
