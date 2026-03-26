import { describe, it, expect } from 'vitest';
import {
  MappingType,
  TranslationBand,
  OutputMode,
  AwsServiceFamily,
  GapType,
  GapSeverity,
  ReviewDomain,
  TestStatus,
  CloudProvider,
} from '@tla/shared';

describe('MappingType', () => {
  it.each(['direct', 'parametric', 'compound', 'structural', 'none'])(
    'accepts valid value "%s"',
    (value) => {
      expect(MappingType.parse(value)).toBe(value);
    },
  );

  it('rejects invalid value', () => {
    const result = MappingType.safeParse('invalid');
    expect(result.success).toBe(false);
  });

  it('inferred type includes all enum members', () => {
    const values: MappingType[] = ['direct', 'parametric', 'compound', 'structural', 'none'];
    expect(values).toHaveLength(5);
  });
});

describe('TranslationBand', () => {
  it.each(['P1', 'P2', 'N1', 'M1'])('accepts valid value "%s"', (value) => {
    expect(TranslationBand.parse(value)).toBe(value);
  });

  it('rejects invalid value', () => {
    const result = TranslationBand.safeParse('P3');
    expect(result.success).toBe(false);
  });
});

describe('OutputMode', () => {
  it.each(['portable', 'native_emit_only', 'advisory_manual'])(
    'accepts valid value "%s"',
    (value) => {
      expect(OutputMode.parse(value)).toBe(value);
    },
  );

  it('rejects invalid value', () => {
    const result = OutputMode.safeParse('unknown_mode');
    expect(result.success).toBe(false);
  });
});

describe('AwsServiceFamily', () => {
  it.each([
    'compute',
    'storage',
    'database',
    'networking',
    'security',
    'serverless',
    'messaging',
    'observability',
    'containers',
    'identity',
  ])('accepts valid value "%s"', (value) => {
    expect(AwsServiceFamily.parse(value)).toBe(value);
  });

  it('rejects invalid value', () => {
    const result = AwsServiceFamily.safeParse('analytics');
    expect(result.success).toBe(false);
  });
});

describe('GapType', () => {
  it.each(['feature', 'topology', 'policy', 'runtime', 'data_model'])(
    'accepts valid value "%s"',
    (value) => {
      expect(GapType.parse(value)).toBe(value);
    },
  );

  it('rejects invalid value', () => {
    const result = GapType.safeParse('cost');
    expect(result.success).toBe(false);
  });
});

describe('GapSeverity', () => {
  it.each(['blocker', 'major', 'minor', 'informational'])(
    'accepts valid value "%s"',
    (value) => {
      expect(GapSeverity.parse(value)).toBe(value);
    },
  );

  it('rejects invalid value', () => {
    const result = GapSeverity.safeParse('critical');
    expect(result.success).toBe(false);
  });
});

describe('ReviewDomain', () => {
  it.each(['networking', 'security', 'identity', 'data', 'compliance'])(
    'accepts valid value "%s"',
    (value) => {
      expect(ReviewDomain.parse(value)).toBe(value);
    },
  );

  it('rejects invalid value', () => {
    const result = ReviewDomain.safeParse('performance');
    expect(result.success).toBe(false);
  });
});

describe('TestStatus', () => {
  it.each(['untested', 'unit_tested', 'integration_validated', 'e2e_validated'])(
    'accepts valid value "%s"',
    (value) => {
      expect(TestStatus.parse(value)).toBe(value);
    },
  );

  it('rejects invalid value', () => {
    const result = TestStatus.safeParse('smoke_tested');
    expect(result.success).toBe(false);
  });
});

describe('CloudProvider', () => {
  it.each(['aws', 'azure', 'gcp'])('accepts valid value "%s"', (value) => {
    expect(CloudProvider.parse(value)).toBe(value);
  });

  it('rejects invalid value', () => {
    const result = CloudProvider.safeParse('digitalocean');
    expect(result.success).toBe(false);
  });
});
