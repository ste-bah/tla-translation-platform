import { describe, it, expect } from 'vitest';
import { BehavioralGapSchema, RegistryEntrySchema } from '@tla/shared';

function createValidGap() {
  return {
    gap_id: 'BGR-COM-EC2-001',
    gap_type: 'feature',
    description: 'EC2 placement groups have no direct Azure equivalent',
    severity: 'minor',
    affected_targets: ['azure'],
    workaround: 'Use Azure proximity placement groups',
    requires_manual_review: false,
  };
}

function createValidEntry() {
  return {
    registry_entry_id: 'SER-COM-TEST-001',
    aws_service: 'test-service',
    aws_family: 'compute',
    azure_targets: ['azurerm_test'],
    gcp_targets: ['google_test'],
    mapping_type: 'direct',
    output_mode: 'portable',
    band: 'P1',
    confidence: 0.90,
    portable_provider_candidate: true,
    behavioral_gaps: [],
    manual_review_required: false,
    review_domains: [],
    test_status: 'untested',
    owner: 'test-team',
    registry_version: '2026.03.13',
    last_updated: '2026-03-13T10:00:00Z',
    related_requirements: ['REQ-REG-001'],
    related_edge_cases: ['EC-001'],
  };
}

describe('BehavioralGapSchema', () => {
  it('accepts a valid gap object', () => {
    const result = BehavioralGapSchema.safeParse(createValidGap());
    expect(result.success).toBe(true);
  });

  it('accepts null workaround', () => {
    const gap = { ...createValidGap(), workaround: null };
    const result = BehavioralGapSchema.safeParse(gap);
    expect(result.success).toBe(true);
  });

  it('rejects invalid gap_id format', () => {
    const gap = { ...createValidGap(), gap_id: 'INVALID-ID' };
    const result = BehavioralGapSchema.safeParse(gap);
    expect(result.success).toBe(false);
  });

  it('rejects empty description', () => {
    const gap = { ...createValidGap(), description: '' };
    const result = BehavioralGapSchema.safeParse(gap);
    expect(result.success).toBe(false);
  });

  it('rejects empty affected_targets array', () => {
    const gap = { ...createValidGap(), affected_targets: [] };
    const result = BehavioralGapSchema.safeParse(gap);
    expect(result.success).toBe(false);
  });

  it('rejects invalid gap_type enum value', () => {
    const gap = { ...createValidGap(), gap_type: 'cost' };
    const result = BehavioralGapSchema.safeParse(gap);
    expect(result.success).toBe(false);
  });

  it('rejects unknown extra fields in strict mode', () => {
    const gap = { ...createValidGap(), extra_field: 'should fail' };
    const result = BehavioralGapSchema.safeParse(gap);
    expect(result.success).toBe(false);
  });
});

describe('RegistryEntrySchema', () => {
  it('accepts a valid complete entry', () => {
    const result = RegistryEntrySchema.safeParse(createValidEntry());
    expect(result.success).toBe(true);
  });

  it('accepts entry with behavioral gaps', () => {
    const entry = { ...createValidEntry(), behavioral_gaps: [createValidGap()] };
    const result = RegistryEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it('rejects missing required field (aws_service)', () => {
    const entry = createValidEntry();
    const { aws_service: _, ...withoutService } = entry;
    const result = RegistryEntrySchema.safeParse(withoutService);
    expect(result.success).toBe(false);
  });

  it('rejects unknown extra fields in strict mode', () => {
    const entry = { ...createValidEntry(), unknown_field: 'not allowed' };
    const result = RegistryEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it('rejects invalid enum value for mapping_type', () => {
    const entry = { ...createValidEntry(), mapping_type: 'magical' };
    const result = RegistryEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it('rejects invalid registry_entry_id format', () => {
    const entry = { ...createValidEntry(), registry_entry_id: 'BAD-FORMAT' };
    const result = RegistryEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it('rejects confidence below 0', () => {
    const entry = { ...createValidEntry(), confidence: -0.1 };
    const result = RegistryEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it('rejects confidence above 1', () => {
    const entry = { ...createValidEntry(), confidence: 1.1 };
    const result = RegistryEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it('rejects empty string for owner', () => {
    const entry = { ...createValidEntry(), owner: '' };
    const result = RegistryEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it('rejects invalid registry_version format', () => {
    const entry = { ...createValidEntry(), registry_version: '2026-03-13' };
    const result = RegistryEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it('rejects invalid last_updated datetime', () => {
    const entry = { ...createValidEntry(), last_updated: 'not-a-date' };
    const result = RegistryEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it('rejects invalid related_requirements format', () => {
    const entry = { ...createValidEntry(), related_requirements: ['BAD-REF'] };
    const result = RegistryEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it('rejects invalid related_edge_cases format', () => {
    const entry = { ...createValidEntry(), related_edge_cases: ['BAD'] };
    const result = RegistryEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it('accepts confidence at boundary 0', () => {
    const entry = { ...createValidEntry(), confidence: 0 };
    const result = RegistryEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it('accepts confidence at boundary 1', () => {
    const entry = { ...createValidEntry(), confidence: 1 };
    const result = RegistryEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });
});
