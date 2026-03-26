import { describe, it, expect } from 'vitest';
import { validateRegistryEntries, validateRegistryWithPaths } from '@tla/registry';
import { createTestEntry } from './helpers.js';

describe('validateRegistryEntries', () => {
  it('returns empty array for valid entries', () => {
    const entries = [
      createTestEntry({ registry_entry_id: 'SER-COM-AAA-001', aws_service: 'svc-a' }),
      createTestEntry({ registry_entry_id: 'SER-COM-BBB-001', aws_service: 'svc-b' }),
    ];

    const results = validateRegistryEntries(entries);
    expect(results).toEqual([]);
  });

  describe('Rule 1: no-duplicate-ids', () => {
    it('produces error for duplicate registry_entry_id', () => {
      const entries = [
        createTestEntry({ registry_entry_id: 'SER-COM-DUP-001', aws_service: 'svc-a' }),
        createTestEntry({ registry_entry_id: 'SER-COM-DUP-001', aws_service: 'svc-b' }),
      ];

      const results = validateRegistryEntries(entries);
      const rule1 = results.filter((r) => r.rule === 'no-duplicate-ids');
      expect(rule1).toHaveLength(1);
      expect(rule1[0]!.severity).toBe('error');
      expect(rule1[0]!.field).toBe('registry_entry_id');
    });
  });

  describe('Rule 2: no-duplicate-aws-service', () => {
    it('produces error for duplicate aws_service', () => {
      const entries = [
        createTestEntry({ registry_entry_id: 'SER-COM-AAA-001', aws_service: 'ec2' }),
        createTestEntry({ registry_entry_id: 'SER-COM-BBB-001', aws_service: 'ec2' }),
      ];

      const results = validateRegistryEntries(entries);
      const rule2 = results.filter((r) => r.rule === 'no-duplicate-aws-service');
      expect(rule2).toHaveLength(1);
      expect(rule2[0]!.severity).toBe('error');
      expect(rule2[0]!.field).toBe('aws_service');
    });
  });

  describe('Rule 3: valid-requirement-refs', () => {
    it('produces warning for invalid requirement reference format', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          related_requirements: ['BAD-FORMAT'],
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule3 = results.filter((r) => r.rule === 'valid-requirement-refs');
      expect(rule3).toHaveLength(1);
      expect(rule3[0]!.severity).toBe('warning');
      expect(rule3[0]!.field).toBe('related_requirements');
    });
  });

  describe('Rule 4: valid-edge-case-refs', () => {
    it('produces warning for invalid edge case reference format', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          related_edge_cases: ['NOT-VALID'],
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule4 = results.filter((r) => r.rule === 'valid-edge-case-refs');
      expect(rule4).toHaveLength(1);
      expect(rule4[0]!.severity).toBe('warning');
      expect(rule4[0]!.field).toBe('related_edge_cases');
    });
  });

  describe('Rule 5: confidence-in-range', () => {
    it('produces error for confidence below 0', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          confidence: -0.1 as unknown as number,
          band: 'N1',
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule5 = results.filter((r) => r.rule === 'confidence-in-range');
      expect(rule5).toHaveLength(1);
      expect(rule5[0]!.severity).toBe('error');
    });

    it('produces error for confidence above 1', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          confidence: 1.5 as unknown as number,
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule5 = results.filter((r) => r.rule === 'confidence-in-range');
      expect(rule5).toHaveLength(1);
      expect(rule5[0]!.severity).toBe('error');
    });
  });

  describe('Rule 6: p1-confidence-threshold', () => {
    it('produces error for P1 band with confidence < 0.80', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'P1',
          confidence: 0.70,
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule6 = results.filter((r) => r.rule === 'p1-confidence-threshold');
      expect(rule6).toHaveLength(1);
      expect(rule6[0]!.severity).toBe('error');
    });

    it('passes for P1 band with confidence >= 0.80', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'P1',
          confidence: 0.80,
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule6 = results.filter((r) => r.rule === 'p1-confidence-threshold');
      expect(rule6).toHaveLength(0);
    });
  });

  describe('Rule 7: m1-requires-review', () => {
    it('produces error for M1 band without manual_review_required', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'M1',
          confidence: 0.30,
          manual_review_required: false,
          mapping_type: 'none',
          azure_targets: [],
          gcp_targets: [],
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule7 = results.filter((r) => r.rule === 'm1-requires-review');
      expect(rule7).toHaveLength(1);
      expect(rule7[0]!.severity).toBe('error');
    });

    it('passes for M1 band with manual_review_required true', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'M1',
          confidence: 0.30,
          manual_review_required: true,
          mapping_type: 'none',
          azure_targets: [],
          gcp_targets: [],
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule7 = results.filter((r) => r.rule === 'm1-requires-review');
      expect(rule7).toHaveLength(0);
    });
  });

  describe('Rule 8: none-requires-m1', () => {
    it('produces error for mapping_type none without band M1', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          mapping_type: 'none',
          band: 'P1',
          confidence: 0.90,
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule8 = results.filter((r) => r.rule === 'none-requires-m1');
      expect(rule8).toHaveLength(1);
      expect(rule8[0]!.severity).toBe('error');
    });

    it('passes for mapping_type none with band M1', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          mapping_type: 'none',
          band: 'M1',
          confidence: 0.30,
          manual_review_required: true,
          azure_targets: [],
          gcp_targets: [],
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule8 = results.filter((r) => r.rule === 'none-requires-m1');
      expect(rule8).toHaveLength(0);
    });
  });

  describe('Rule 9: non-m1-requires-targets', () => {
    it('produces error for non-M1 band with no azure or gcp targets', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'P1',
          confidence: 0.90,
          azure_targets: [],
          gcp_targets: [],
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule9 = results.filter((r) => r.rule === 'non-m1-requires-targets');
      expect(rule9).toHaveLength(1);
      expect(rule9[0]!.severity).toBe('error');
    });

    it('passes for M1 band with no targets', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'M1',
          confidence: 0.30,
          manual_review_required: true,
          mapping_type: 'none',
          azure_targets: [],
          gcp_targets: [],
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule9 = results.filter((r) => r.rule === 'non-m1-requires-targets');
      expect(rule9).toHaveLength(0);
    });

    it('passes for non-M1 band with azure targets only', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'P1',
          confidence: 0.90,
          azure_targets: ['azurerm_thing'],
          gcp_targets: [],
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule9 = results.filter((r) => r.rule === 'non-m1-requires-targets');
      expect(rule9).toHaveLength(0);
    });
  });

  describe('Rule 10: p2-confidence-range', () => {
    it('produces error for P2 band with confidence < 0.50', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'P2',
          confidence: 0.40,
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule10 = results.filter((r) => r.rule === 'p2-confidence-range');
      expect(rule10).toHaveLength(1);
      expect(rule10[0]!.severity).toBe('error');
    });

    it('produces error for P2 band with confidence >= 0.90', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'P2',
          confidence: 0.90,
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule10 = results.filter((r) => r.rule === 'p2-confidence-range');
      expect(rule10).toHaveLength(1);
      expect(rule10[0]!.severity).toBe('error');
    });

    it('passes for P2 band with confidence 0.50', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'P2',
          confidence: 0.50,
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule10 = results.filter((r) => r.rule === 'p2-confidence-range');
      expect(rule10).toHaveLength(0);
    });

    it('passes for P2 band with confidence 0.89', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'P2',
          confidence: 0.89,
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule10 = results.filter((r) => r.rule === 'p2-confidence-range');
      expect(rule10).toHaveLength(0);
    });
  });

  describe('Rule 11: n1-confidence-range', () => {
    it('produces error for N1 band with confidence < 0.30', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'N1',
          confidence: 0.20,
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule11 = results.filter((r) => r.rule === 'n1-confidence-range');
      expect(rule11).toHaveLength(1);
      expect(rule11[0]!.severity).toBe('error');
    });

    it('produces error for N1 band with confidence >= 0.80', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'N1',
          confidence: 0.80,
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule11 = results.filter((r) => r.rule === 'n1-confidence-range');
      expect(rule11).toHaveLength(1);
      expect(rule11[0]!.severity).toBe('error');
    });

    it('passes for N1 band with confidence 0.30', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'N1',
          confidence: 0.30,
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule11 = results.filter((r) => r.rule === 'n1-confidence-range');
      expect(rule11).toHaveLength(0);
    });

    it('passes for N1 band with confidence 0.79', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'N1',
          confidence: 0.79,
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule11 = results.filter((r) => r.rule === 'n1-confidence-range');
      expect(rule11).toHaveLength(0);
    });
  });

  describe('Rule 12: m1-confidence-ceiling', () => {
    it('produces error for M1 band with confidence >= 0.50', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'M1',
          confidence: 0.50,
          manual_review_required: true,
          mapping_type: 'none',
          azure_targets: [],
          gcp_targets: [],
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule12 = results.filter((r) => r.rule === 'm1-confidence-ceiling');
      expect(rule12).toHaveLength(1);
      expect(rule12[0]!.severity).toBe('error');
    });

    it('passes for M1 band with confidence 0.49', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'M1',
          confidence: 0.49,
          manual_review_required: true,
          mapping_type: 'none',
          azure_targets: [],
          gcp_targets: [],
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule12 = results.filter((r) => r.rule === 'm1-confidence-ceiling');
      expect(rule12).toHaveLength(0);
    });
  });

  describe('Rule 13: gap-id-uniqueness', () => {
    it('produces error for duplicate gap_id within an entry', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          behavioral_gaps: [
            {
              gap_id: 'BGR-COM-EC2-001',
              gap_type: 'feature',
              description: 'Gap A',
              severity: 'minor',
              affected_targets: ['azure'],
              workaround: null,
              requires_manual_review: false,
            },
            {
              gap_id: 'BGR-COM-EC2-001',
              gap_type: 'policy',
              description: 'Gap B',
              severity: 'major',
              affected_targets: ['gcp'],
              workaround: null,
              requires_manual_review: false,
            },
          ],
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule13 = results.filter((r) => r.rule === 'gap-id-uniqueness');
      expect(rule13).toHaveLength(1);
      expect(rule13[0]!.severity).toBe('error');
      expect(rule13[0]!.field).toBe('behavioral_gaps');
    });

    it('passes for unique gap_ids within an entry', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          behavioral_gaps: [
            {
              gap_id: 'BGR-COM-EC2-001',
              gap_type: 'feature',
              description: 'Gap A',
              severity: 'minor',
              affected_targets: ['azure'],
              workaround: null,
              requires_manual_review: false,
            },
            {
              gap_id: 'BGR-COM-EC2-002',
              gap_type: 'policy',
              description: 'Gap B',
              severity: 'major',
              affected_targets: ['gcp'],
              workaround: null,
              requires_manual_review: false,
            },
          ],
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule13 = results.filter((r) => r.rule === 'gap-id-uniqueness');
      expect(rule13).toHaveLength(0);
    });
  });

  describe('Rule 14: blocker-gap-warning', () => {
    it('produces warning for P1 entry with blocker-severity gap', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'P1',
          confidence: 0.90,
          behavioral_gaps: [
            {
              gap_id: 'BGR-COM-EC2-001',
              gap_type: 'feature',
              description: 'Blocking gap',
              severity: 'blocker',
              affected_targets: ['azure'],
              workaround: null,
              requires_manual_review: true,
            },
          ],
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule14 = results.filter((r) => r.rule === 'blocker-gap-warning');
      expect(rule14).toHaveLength(1);
      expect(rule14[0]!.severity).toBe('warning');
    });

    it('produces warning for P2 entry with blocker-severity gap', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'P2',
          confidence: 0.70,
          behavioral_gaps: [
            {
              gap_id: 'BGR-COM-EC2-001',
              gap_type: 'feature',
              description: 'Blocking gap',
              severity: 'blocker',
              affected_targets: ['azure'],
              workaround: null,
              requires_manual_review: true,
            },
          ],
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule14 = results.filter((r) => r.rule === 'blocker-gap-warning');
      expect(rule14).toHaveLength(1);
      expect(rule14[0]!.severity).toBe('warning');
    });

    it('does not warn for N1 entry with blocker-severity gap', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'N1',
          confidence: 0.50,
          behavioral_gaps: [
            {
              gap_id: 'BGR-COM-EC2-001',
              gap_type: 'feature',
              description: 'Blocking gap',
              severity: 'blocker',
              affected_targets: ['azure'],
              workaround: null,
              requires_manual_review: true,
            },
          ],
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule14 = results.filter((r) => r.rule === 'blocker-gap-warning');
      expect(rule14).toHaveLength(0);
    });

    it('does not warn for P1 entry with non-blocker gap', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'P1',
          confidence: 0.90,
          behavioral_gaps: [
            {
              gap_id: 'BGR-COM-EC2-001',
              gap_type: 'feature',
              description: 'Minor gap',
              severity: 'minor',
              affected_targets: ['azure'],
              workaround: null,
              requires_manual_review: false,
            },
          ],
        }),
      ];

      const results = validateRegistryEntries(entries);
      const rule14 = results.filter((r) => r.rule === 'blocker-gap-warning');
      expect(rule14).toHaveLength(0);
    });
  });

  describe('Rule 15: family-directory', () => {
    it('produces warning when file is in wrong directory', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          aws_family: 'compute',
        }),
      ];
      const pathMap = new Map<string, string>([
        ['SER-COM-AAA-001', '/data/storage/SER-COM-AAA-001.yaml'],
      ]);

      const results = validateRegistryWithPaths(entries, pathMap);
      const rule15 = results.filter((r) => r.rule === 'family-directory');
      expect(rule15).toHaveLength(1);
      expect(rule15[0]!.severity).toBe('warning');
      expect(rule15[0]!.message).toContain('storage');
      expect(rule15[0]!.message).toContain('compute');
    });

    it('passes when file is in correct directory', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          aws_family: 'compute',
        }),
      ];
      const pathMap = new Map<string, string>([
        ['SER-COM-AAA-001', '/data/compute/SER-COM-AAA-001.yaml'],
      ]);

      const results = validateRegistryWithPaths(entries, pathMap);
      const rule15 = results.filter((r) => r.rule === 'family-directory');
      expect(rule15).toHaveLength(0);
    });

    it('skips entries with no path mapping', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          aws_family: 'compute',
        }),
      ];
      const pathMap = new Map<string, string>();

      const results = validateRegistryWithPaths(entries, pathMap);
      const rule15 = results.filter((r) => r.rule === 'family-directory');
      expect(rule15).toHaveLength(0);
    });

    it('also runs all standard rules (1-14)', () => {
      const entries = [
        createTestEntry({
          registry_entry_id: 'SER-COM-AAA-001',
          aws_service: 'svc-a',
          band: 'P1',
          confidence: 0.50, // violates p1-confidence-threshold
        }),
      ];
      const pathMap = new Map<string, string>([
        ['SER-COM-AAA-001', '/data/compute/SER-COM-AAA-001.yaml'],
      ]);

      const results = validateRegistryWithPaths(entries, pathMap);
      const rule6 = results.filter((r) => r.rule === 'p1-confidence-threshold');
      expect(rule6).toHaveLength(1);
    });
  });
});
