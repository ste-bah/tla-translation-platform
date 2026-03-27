import { describe, it, expect, vi } from 'vitest';
import { compoundEngine } from '../../src/engines/compound-engine.js';
import { translateEc2, detectOsFamily } from '../../src/engines/compound/ec2-mapping.js';
import { translateAsg } from '../../src/engines/compound/asg-mapping.js';
import { translateLb } from '../../src/engines/compound/lb-mapping.js';
import { translateRds } from '../../src/engines/compound/rds-mapping.js';
import { findSiblingByType } from '../../src/engines/direct/attribute-transformer.js';
import type { TranslationContext } from '../../src/engines/mapping-engine.js';
import type {
  IrResource,
  IrRelationship,
  RegistryEntry,
  CanonicalIR,
  CloudProvider,
  CompilerOptions,
} from '@tla/shared';
import type { RegistryApi } from '@tla/registry';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'res-001',
    sourceType: 'aws_instance',
    sourceName: 'my_server',
    sourceModule: null,
    category: 'compute',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: 'SER-COMPUTE-EC2-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-COMPUTE-EC2-001',
    aws_service: 'aws_instance',
    aws_family: 'compute',
    azure_targets: ['azurerm_linux_virtual_machine'],
    gcp_targets: ['google_compute_instance'],
    mapping_type: 'compound',
    output_mode: 'native_emit_only',
    band: 'P1',
    confidence: 0.9,
    portable_provider_candidate: false,
    behavioral_gaps: [],
    manual_review_required: false,
    review_domains: [],
    test_status: 'unit_tested',
    owner: 'team-infra',
    registry_version: '2025.03.01',
    last_updated: '2025-03-01T00:00:00Z',
    related_requirements: [],
    related_edge_cases: [],
    ...overrides,
  };
}

function makeMockRegistry(): RegistryApi {
  return {
    lookup: vi.fn().mockReturnValue(undefined),
    lookupMany: vi.fn().mockReturnValue(new Map()),
  } as unknown as RegistryApi;
}

function makeCompilerOptions(overrides: Partial<CompilerOptions> = {}): CompilerOptions {
  return {
    targetProvider: 'azure',
    registryVersion: '2025.03.01',
    emitComments: true,
    sortKeys: true,
    ...overrides,
  };
}

function makeTranslationContext(overrides: Partial<TranslationContext> = {}): TranslationContext {
  const resource = overrides.resource ?? makeIrResource();
  const entry = overrides.registryEntry ?? makeRegistryEntry();
  return {
    targetProvider: 'azure' as CloudProvider,
    resource,
    registryEntry: entry,
    relationships: [],
    siblingResources: [],
    ir: {
      version: '1.0.0',
      sourceProvider: 'aws',
      resources: [resource],
      relationships: [],
      modules: [],
      intents: [],
      metadata: {
        generatedAt: new Date().toISOString(),
        sourceFiles: ['main.tf'],
        toolVersion: '0.1.0',
      },
    } as CanonicalIR,
    registry: makeMockRegistry(),
    options: makeCompilerOptions(),
    ...overrides,
  };
}

// ===========================================================================
// findSiblingByType
// ===========================================================================

describe('findSiblingByType', () => {
  it('should find sibling via relationship-based match', () => {
    const sibling = makeIrResource({
      id: 'lt-001',
      sourceType: 'aws_launch_template',
      sourceName: 'my_lt',
    });
    const ctx = makeTranslationContext({
      relationships: [{ from: 'res-001', to: 'lt-001', type: 'references' } as IrRelationship],
      siblingResources: [sibling],
    });

    const result = findSiblingByType(ctx, 'aws_launch_template');
    expect(result).toBeDefined();
    expect(result!.id).toBe('lt-001');
    expect(result!.sourceName).toBe('my_lt');
  });

  it('should find sibling via reverse relationship direction', () => {
    const sibling = makeIrResource({
      id: 'lt-002',
      sourceType: 'aws_launch_template',
      sourceName: 'my_lt_rev',
    });
    const ctx = makeTranslationContext({
      relationships: [{ from: 'lt-002', to: 'res-001', type: 'references' } as IrRelationship],
      siblingResources: [sibling],
    });

    const result = findSiblingByType(ctx, 'aws_launch_template');
    expect(result).toBeDefined();
    expect(result!.id).toBe('lt-002');
  });

  it('should fallback to type scan when no relationship matches', () => {
    const sibling = makeIrResource({
      id: 'lt-003',
      sourceType: 'aws_launch_template',
      sourceName: 'fallback_lt',
    });
    const ctx = makeTranslationContext({
      relationships: [],
      siblingResources: [sibling],
    });

    const result = findSiblingByType(ctx, 'aws_launch_template');
    expect(result).toBeDefined();
    expect(result!.sourceName).toBe('fallback_lt');
  });

  it('should return undefined when no match exists', () => {
    const ctx = makeTranslationContext({
      relationships: [],
      siblingResources: [],
    });

    const result = findSiblingByType(ctx, 'aws_launch_template');
    expect(result).toBeUndefined();
  });

  it('should ignore relationships that do not involve the current resource', () => {
    const sibling = makeIrResource({
      id: 'lt-004',
      sourceType: 'aws_launch_template',
      sourceName: 'unrelated_lt',
    });
    const ctx = makeTranslationContext({
      relationships: [{ from: 'other-001', to: 'lt-004', type: 'references' } as IrRelationship],
      siblingResources: [sibling],
    });

    // Should still find via fallback scan
    const result = findSiblingByType(ctx, 'aws_launch_template');
    expect(result).toBeDefined();
    expect(result!.sourceName).toBe('unrelated_lt');
  });

  it('should prefer relationship-based match over scan', () => {
    const relatedSibling = makeIrResource({
      id: 'lt-rel',
      sourceType: 'aws_launch_template',
      sourceName: 'related_lt',
    });
    const scanSibling = makeIrResource({
      id: 'lt-scan',
      sourceType: 'aws_launch_template',
      sourceName: 'scan_lt',
    });
    const ctx = makeTranslationContext({
      relationships: [{ from: 'res-001', to: 'lt-rel', type: 'references' } as IrRelationship],
      siblingResources: [scanSibling, relatedSibling],
    });

    const result = findSiblingByType(ctx, 'aws_launch_template');
    expect(result).toBeDefined();
    expect(result!.sourceName).toBe('related_lt');
  });
});

// ===========================================================================
// compoundEngine dispatch
// ===========================================================================

describe('compoundEngine dispatch', () => {
  it('should have mappingType "compound"', () => {
    expect(compoundEngine.mappingType).toBe('compound');
  });

  it('should dispatch aws_instance to EC2 translator', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_instance', attributes: { instance_type: 't3.micro' } }),
    });
    const result = compoundEngine.translate(ctx);
    expect(result.translated.length).toBeGreaterThan(0);
    expect(result.translated[0]!.traceability.engineUsed).toBe('compound/ec2');
  });

  it('should dispatch aws_autoscaling_group to ASG translator', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_autoscaling_group', sourceName: 'my_asg' }),
      registryEntry: makeRegistryEntry({ aws_service: 'aws_autoscaling_group' }),
    });
    const result = compoundEngine.translate(ctx);
    expect(result.translated.length).toBeGreaterThanOrEqual(1);
    expect(result.translated[0]!.traceability.engineUsed).toBe('compound/asg');
  });

  it('should dispatch aws_lb to LB translator', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_lb', sourceName: 'my_lb' }),
      registryEntry: makeRegistryEntry({ aws_service: 'aws_lb' }),
    });
    const result = compoundEngine.translate(ctx);
    expect(result.translated.length).toBeGreaterThan(0);
  });

  it('should dispatch aws_db_instance to RDS translator', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({
        sourceType: 'aws_db_instance',
        sourceName: 'my_db',
        attributes: { engine: 'postgres' },
      }),
      registryEntry: makeRegistryEntry({ aws_service: 'aws_db_instance' }),
    });
    const result = compoundEngine.translate(ctx);
    expect(result.translated.length).toBeGreaterThan(0);
    expect(result.translated[0]!.traceability.engineUsed).toBe('compound/rds');
  });

  it('should emit UNKNOWN_COMPOUND_TYPE warning for unknown types', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_unknown_thing', sourceName: 'mystery' }),
    });
    const result = compoundEngine.translate(ctx);
    expect(result.translated).toHaveLength(0);
    const warning = result.findings.find((f) => f.code === 'UNKNOWN_COMPOUND_TYPE');
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe('warning');
    expect(warning!.message).toContain('aws_unknown_thing');
  });

  it('should return empty translated for unknown type', () => {
    const ctx = makeTranslationContext({
      resource: makeIrResource({ sourceType: 'aws_ecs_cluster' }),
    });
    const result = compoundEngine.translate(ctx);
    expect(result.translated).toHaveLength(0);
  });
});

// ===========================================================================
// translateEc2
// ===========================================================================

describe('translateEc2', () => {
  // -----------------------------------------------------------------------
  // Azure (3 resources)
  // -----------------------------------------------------------------------
  describe('Azure', () => {
    it('should emit 3 resources (NIC + VM + Disk)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { instance_type: 't3.micro' },
        }),
      });
      const result = translateEc2(ctx);
      expect(result.translated).toHaveLength(3);
    });

    it('should emit correct target types', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { instance_type: 't3.micro' } }),
      });
      const result = translateEc2(ctx);
      const types = result.translated.map((r) => r.targetType);
      expect(types).toContain('azurerm_network_interface');
      expect(types).toContain('azurerm_linux_virtual_machine');
      expect(types).toContain('azurerm_managed_disk');
    });

    it('should name NIC with -nic suffix', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceName: 'web', attributes: {} }),
      });
      const result = translateEc2(ctx);
      const nic = result.translated.find((r) => r.targetType === 'azurerm_network_interface');
      expect(nic).toBeDefined();
      expect(nic!.targetName).toBe('web_nic');
      expect((nic!.attributes as Record<string, unknown>)['name']).toBe('web-nic');
    });

    it('should name disk with -disk suffix', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceName: 'web', attributes: {} }),
      });
      const result = translateEc2(ctx);
      const disk = result.translated.find((r) => r.targetType === 'azurerm_managed_disk');
      expect(disk).toBeDefined();
      expect(disk!.targetName).toBe('web_disk');
    });

    it('should map t3.micro to Standard_B1s', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { instance_type: 't3.micro' } }),
      });
      const result = translateEc2(ctx);
      const vm = result.translated.find((r) => r.targetType === 'azurerm_linux_virtual_machine');
      expect((vm!.attributes as Record<string, unknown>)['size']).toBe('Standard_B1s');
    });

    it('should map m5.large to Standard_D2s_v5', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { instance_type: 'm5.large' } }),
      });
      const result = translateEc2(ctx);
      const vm = result.translated.find((r) => r.targetType === 'azurerm_linux_virtual_machine');
      expect((vm!.attributes as Record<string, unknown>)['size']).toBe('Standard_D2s_v5');
    });

    it('should map c5.large to Standard_F2s_v2', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { instance_type: 'c5.large' } }),
      });
      const result = translateEc2(ctx);
      const vm = result.translated.find((r) => r.targetType === 'azurerm_linux_virtual_machine');
      expect((vm!.attributes as Record<string, unknown>)['size']).toBe('Standard_F2s_v2');
    });

    it('should map r5.large to Standard_E2s_v5', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { instance_type: 'r5.large' } }),
      });
      const result = translateEc2(ctx);
      const vm = result.translated.find((r) => r.targetType === 'azurerm_linux_virtual_machine');
      expect((vm!.attributes as Record<string, unknown>)['size']).toBe('Standard_E2s_v5');
    });

    it('should emit UNKNOWN_INSTANCE_TYPE warning for unknown type', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { instance_type: 'x99.mega' } }),
      });
      const result = translateEc2(ctx);
      const warning = result.findings.find((f) => f.code === 'UNKNOWN_INSTANCE_TYPE');
      expect(warning).toBeDefined();
      expect(warning!.severity).toBe('warning');
      expect(warning!.message).toContain('x99.mega');
    });

    it('should default to Standard_B1s for unknown instance type', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { instance_type: 'z1.unknown' } }),
      });
      const result = translateEc2(ctx);
      const vm = result.translated.find((r) => r.targetType === 'azurerm_linux_virtual_machine');
      expect((vm!.attributes as Record<string, unknown>)['size']).toBe('Standard_B1s');
    });

    it('should default to t3.micro when instance_type absent', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: {} }),
      });
      const result = translateEc2(ctx);
      const vm = result.translated.find((r) => r.targetType === 'azurerm_linux_virtual_machine');
      expect((vm!.attributes as Record<string, unknown>)['size']).toBe('Standard_B1s');
    });

    it('should transform tags for Azure', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { tags: { Environment: 'prod', Team: 'infra' } },
        }),
      });
      const result = translateEc2(ctx);
      const vm = result.translated.find((r) => r.targetType === 'azurerm_linux_virtual_machine');
      expect((vm!.attributes as Record<string, unknown>)['tags']).toEqual({
        Environment: 'prod',
        Team: 'infra',
      });
    });

    it('should include tags on all 3 resources when present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { tags: { Env: 'dev' } } }),
      });
      const result = translateEc2(ctx);
      for (const r of result.translated) {
        expect((r.attributes as Record<string, unknown>)['tags']).toBeDefined();
      }
    });

    it('should not include tags when absent', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: {} }),
      });
      const result = translateEc2(ctx);
      const vm = result.translated.find((r) => r.targetType === 'azurerm_linux_virtual_machine');
      expect((vm!.attributes as Record<string, unknown>)['tags']).toBeUndefined();
    });

    it('should emit COMPOUND_EXPANSION finding', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: {} }),
      });
      const result = translateEc2(ctx);
      const expansion = result.findings.find((f) => f.code === 'COMPOUND_EXPANSION');
      expect(expansion).toBeDefined();
      expect(expansion!.message).toContain('3 azure');
    });

    it('should include traceability with mappingType compound and engineUsed compound/ec2', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: {} }),
      });
      const result = translateEc2(ctx);
      for (const r of result.translated) {
        expect(r.traceability.mappingType).toBe('compound');
        expect(r.traceability.engineUsed).toBe('compound/ec2');
      }
    });

    it('should use gp3 -> Premium_LRS storage mapping', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { root_block_device: { volume_type: 'gp3', volume_size: 50 } },
        }),
      });
      const result = translateEc2(ctx);
      const disk = result.translated.find((r) => r.targetType === 'azurerm_managed_disk');
      expect((disk!.attributes as Record<string, unknown>)['storage_account_type']).toBe('Premium_LRS');
      expect((disk!.attributes as Record<string, unknown>)['disk_size_gb']).toBe(50);
    });

    it('should default to StandardSSD_LRS for non-gp3 volume type', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { root_block_device: { volume_type: 'gp2' } },
        }),
      });
      const result = translateEc2(ctx);
      const disk = result.translated.find((r) => r.targetType === 'azurerm_managed_disk');
      expect((disk!.attributes as Record<string, unknown>)['storage_account_type']).toBe('StandardSSD_LRS');
    });

    it('should include admin_ssh_key when key_name present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { key_name: 'my-key' } }),
      });
      const result = translateEc2(ctx);
      const vm = result.translated.find((r) => r.targetType === 'azurerm_linux_virtual_machine');
      const vmAttrs = vm!.attributes as Record<string, unknown>;
      expect(vmAttrs['admin_ssh_key']).toBeDefined();
    });

    it('should include custom_data when user_data present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { user_data: '#!/bin/bash\necho hi' } }),
      });
      const result = translateEc2(ctx);
      const vm = result.translated.find((r) => r.targetType === 'azurerm_linux_virtual_machine');
      expect((vm!.attributes as Record<string, unknown>)['custom_data']).toBe('#!/bin/bash\necho hi');
    });

    it('should use subnet_id in NIC when provided', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { subnet_id: 'subnet-abc123' } }),
      });
      const result = translateEc2(ctx);
      const nic = result.translated.find((r) => r.targetType === 'azurerm_network_interface');
      const ipConfig = (nic!.attributes as Record<string, unknown>)['ip_configuration'] as Record<string, unknown>;
      expect(ipConfig['subnet_id']).toBe('subnet-abc123');
    });

    it('should set sourceId on all translated resources', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ id: 'res-xyz', attributes: {} }),
      });
      const result = translateEc2(ctx);
      for (const r of result.translated) {
        expect(r.sourceId).toBe('res-xyz');
      }
    });
  });

  // -----------------------------------------------------------------------
  // GCP (2 resources)
  // -----------------------------------------------------------------------
  describe('GCP', () => {
    it('should emit 2 resources (instance + disk)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: { instance_type: 't3.micro' } }),
      });
      const result = translateEc2(ctx);
      expect(result.translated).toHaveLength(2);
    });

    it('should emit correct target types', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: {} }),
      });
      const result = translateEc2(ctx);
      const types = result.translated.map((r) => r.targetType);
      expect(types).toContain('google_compute_instance');
      expect(types).toContain('google_compute_disk');
    });

    it('should map t3.micro to e2-micro', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: { instance_type: 't3.micro' } }),
      });
      const result = translateEc2(ctx);
      const instance = result.translated.find((r) => r.targetType === 'google_compute_instance');
      expect((instance!.attributes as Record<string, unknown>)['machine_type']).toBe('e2-micro');
    });

    it('should map m5.large to n2-standard-2', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: { instance_type: 'm5.large' } }),
      });
      const result = translateEc2(ctx);
      const instance = result.translated.find((r) => r.targetType === 'google_compute_instance');
      expect((instance!.attributes as Record<string, unknown>)['machine_type']).toBe('n2-standard-2');
    });

    it('should default to e2-micro for unknown instance type', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: { instance_type: 'z1.unknown' } }),
      });
      const result = translateEc2(ctx);
      const instance = result.translated.find((r) => r.targetType === 'google_compute_instance');
      expect((instance!.attributes as Record<string, unknown>)['machine_type']).toBe('e2-micro');
    });

    it('should emit UNKNOWN_INSTANCE_TYPE warning for unmapped type', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: { instance_type: 'p4d.24xlarge' } }),
      });
      const result = translateEc2(ctx);
      const warning = result.findings.find((f) => f.code === 'UNKNOWN_INSTANCE_TYPE');
      expect(warning).toBeDefined();
      expect(warning!.message).toContain('GCP');
    });

    it('should transform tags to labels for GCP', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          attributes: { tags: { Environment: 'prod', 'App:Name': 'MyApp' } },
        }),
      });
      const result = translateEc2(ctx);
      const instance = result.translated.find((r) => r.targetType === 'google_compute_instance');
      const labels = (instance!.attributes as Record<string, unknown>)['labels'] as Record<string, string>;
      expect(labels['environment']).toBe('prod');
      expect(labels['app_name']).toBe('MyApp');
    });

    it('should emit COMPOUND_EXPANSION with 2 gcp resources', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: {} }),
      });
      const result = translateEc2(ctx);
      const expansion = result.findings.find((f) => f.code === 'COMPOUND_EXPANSION');
      expect(expansion).toBeDefined();
      expect(expansion!.message).toContain('2 gcp');
    });

    it('should use gp3 -> pd-ssd disk type mapping', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          attributes: { root_block_device: { volume_type: 'gp3', volume_size: 100 } },
        }),
      });
      const result = translateEc2(ctx);
      const disk = result.translated.find((r) => r.targetType === 'google_compute_disk');
      expect((disk!.attributes as Record<string, unknown>)['type']).toBe('pd-ssd');
      expect((disk!.attributes as Record<string, unknown>)['size']).toBe(100);
    });

    it('should default to pd-balanced for non-gp3', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          attributes: { root_block_device: { volume_type: 'gp2' } },
        }),
      });
      const result = translateEc2(ctx);
      const disk = result.translated.find((r) => r.targetType === 'google_compute_disk');
      expect((disk!.attributes as Record<string, unknown>)['type']).toBe('pd-balanced');
    });

    it('should include metadata_startup_script when user_data present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: { user_data: '#!/bin/bash' } }),
      });
      const result = translateEc2(ctx);
      const instance = result.translated.find((r) => r.targetType === 'google_compute_instance');
      expect((instance!.attributes as Record<string, unknown>)['metadata_startup_script']).toBe('#!/bin/bash');
    });

    it('should include traceability with compound/ec2', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: {} }),
      });
      const result = translateEc2(ctx);
      for (const r of result.translated) {
        expect(r.traceability.engineUsed).toBe('compound/ec2');
        expect(r.traceability.mappingType).toBe('compound');
      }
    });

    it('should default disk size to 30 when root_block_device absent', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: {} }),
      });
      const result = translateEc2(ctx);
      const disk = result.translated.find((r) => r.targetType === 'google_compute_disk');
      expect((disk!.attributes as Record<string, unknown>)['size']).toBe(30);
    });
  });

  // -----------------------------------------------------------------------
  // OS family detection & hardening
  // -----------------------------------------------------------------------
  describe('OS family detection & hardening', () => {
    it('detects Linux OS family from AMI string containing "ubuntu"', () => {
      expect(detectOsFamily({ ami: 'ami-ubuntu-22.04-hvm' })).toBe('linux');
    });

    it('detects Windows OS family from AMI string containing "windows"', () => {
      expect(detectOsFamily({ ami: 'ami-windows-server-2022' })).toBe('windows');
    });

    it('emits IMAGE_RESOLUTION_REQUIRED finding with source AMI value', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { ami: 'ami-0123456789abcdef0' } }),
      });
      const result = translateEc2(ctx);
      const finding = result.findings.find((f) => f.code === 'IMAGE_RESOLUTION_REQUIRED');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('ami-0123456789abcdef0');
    });

    it('uses azurerm_windows_virtual_machine for Windows instances', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { ami: 'ami-windows-2022-base' } }),
      });
      const result = translateEc2(ctx);
      const vm = result.translated.find((r) =>
        r.targetType === 'azurerm_windows_virtual_machine',
      );
      expect(vm).toBeDefined();
    });

    it('uses windows-cloud image for GCP Windows instances', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: { ami: 'ami-windows-2022-base' } }),
      });
      const result = translateEc2(ctx);
      const instance = result.translated.find((r) => r.targetType === 'google_compute_instance');
      const bootDisk = (instance!.attributes as Record<string, unknown>)['boot_disk'] as Record<string, unknown>;
      const initParams = bootDisk['initialize_params'] as Record<string, unknown>;
      expect(initParams['image']).toBe('windows-cloud/windows-2022');
    });

    it('emits EC2_PUBLIC_IP_INTENT warning when associate_public_ip_address is true', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: { associate_public_ip_address: true, vpc_security_group_ids: ['sg-1'] } }),
      });
      const result = translateEc2(ctx);
      const finding = result.findings.find((f) => f.code === 'EC2_PUBLIC_IP_INTENT');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('warning');
    });

    it('adds access_config to GCP network_interface for public IP', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: { associate_public_ip_address: true, vpc_security_group_ids: ['sg-1'] } }),
      });
      const result = translateEc2(ctx);
      const instance = result.translated.find((r) => r.targetType === 'google_compute_instance');
      const netIf = (instance!.attributes as Record<string, unknown>)['network_interface'] as Record<string, unknown>;
      expect(netIf['access_config']).toEqual({});
    });

    it('emits EC2_ADDITIONAL_VOLUMES finding for extra EBS devices', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: {
            ebs_block_device: [
              { volume_size: 100, volume_type: 'gp3' },
              { volume_size: 50 },
            ],
          },
        }),
      });
      const result = translateEc2(ctx);
      const finding = result.findings.find((f) => f.code === 'EC2_ADDITIONAL_VOLUMES');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('2');
    });

    it('generates additional managed disks for EBS block devices on Azure', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: {
            ebs_block_device: [{ volume_size: 100, volume_type: 'gp3' }],
          },
        }),
      });
      const result = translateEc2(ctx);
      const dataDisks = result.translated.filter(
        (r) => r.targetType === 'azurerm_managed_disk' && r.targetName.includes('data_disk'),
      );
      expect(dataDisks).toHaveLength(1);
      expect((dataDisks[0]!.attributes as Record<string, unknown>)['disk_size_gb']).toBe(100);
      expect((dataDisks[0]!.attributes as Record<string, unknown>)['storage_account_type']).toBe('Premium_LRS');
    });

    it('uses variable reference for SSH key instead of file()', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceName: 'webserver',
          attributes: { key_name: 'my-key' },
        }),
      });
      const result = translateEc2(ctx);
      const vm = result.translated.find(
        (r) => r.targetType === 'azurerm_linux_virtual_machine',
      );
      const sshKey = (vm!.attributes as Record<string, unknown>)['admin_ssh_key'] as Record<string, unknown>;
      expect(sshKey['public_key']).toContain('var.ssh_public_key_webserver');
      expect(sshKey['public_key']).not.toContain('file(');
      const finding = result.findings.find((f) => f.code === 'EC2_SSH_KEY_MANUAL');
      expect(finding).toBeDefined();
    });

    it('emits EC2_SG_MANUAL_WIRING finding when security groups present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { vpc_security_group_ids: ['sg-123'] },
        }),
      });
      const result = translateEc2(ctx);
      const finding = result.findings.find((f) => f.code === 'EC2_SG_MANUAL_WIRING');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('info');
    });

    it('uses Ubuntu 22.04 image reference instead of 18.04', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: {} }),
      });
      const result = translateEc2(ctx);
      const vm = result.translated.find((r) => r.targetType === 'azurerm_linux_virtual_machine');
      const imgRef = (vm!.attributes as Record<string, unknown>)['source_image_reference'] as Record<string, string>;
      expect(imgRef['sku']).toContain('22_04');
      expect(imgRef['offer']).toContain('jammy');

      // GCP also uses 22.04
      const gcpCtx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: {} }),
      });
      const gcpResult = translateEc2(gcpCtx);
      const inst = gcpResult.translated.find((r) => r.targetType === 'google_compute_instance');
      const bootDisk = (inst!.attributes as Record<string, unknown>)['boot_disk'] as Record<string, unknown>;
      const initParams = bootDisk['initialize_params'] as Record<string, unknown>;
      expect(initParams['image']).toContain('2204');
    });
  });
});

// ===========================================================================
// translateAsg
// ===========================================================================

describe('translateAsg', () => {
  // -----------------------------------------------------------------------
  // Azure (1 VMSS)
  // -----------------------------------------------------------------------
  describe('Azure', () => {
    it('should emit 1 VMSS resource', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_autoscaling_group',
          sourceName: 'my_asg',
          attributes: {},
        }),
      });
      const result = translateAsg(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('azurerm_linux_virtual_machine_scale_set');
    });

    it('should use desired_capacity for instances', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_autoscaling_group',
          attributes: { desired_capacity: 5 },
        }),
      });
      const result = translateAsg(ctx);
      expect((result.translated[0]!.attributes as Record<string, unknown>)['instances']).toBe(5);
    });

    it('should default desired_capacity to 1', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_autoscaling_group',
          attributes: {},
        }),
      });
      const result = translateAsg(ctx);
      expect((result.translated[0]!.attributes as Record<string, unknown>)['instances']).toBe(1);
    });

    it('should resolve instance type from sibling launch template', () => {
      const ltResource = makeIrResource({
        id: 'lt-001',
        sourceType: 'aws_launch_template',
        sourceName: 'my_lt',
        attributes: { instance_type: 'm5.large' },
      });
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_autoscaling_group',
          sourceName: 'my_asg',
          attributes: {},
        }),
        relationships: [{ from: 'res-001', to: 'lt-001', type: 'references' } as IrRelationship],
        siblingResources: [ltResource],
      });
      const result = translateAsg(ctx);
      expect((result.translated[0]!.attributes as Record<string, unknown>)['sku']).toBe('Standard_D2s_v5');
    });

    it('should default to Standard_B1s when no sibling launch template', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_autoscaling_group',
          attributes: {},
        }),
      });
      const result = translateAsg(ctx);
      expect((result.translated[0]!.attributes as Record<string, unknown>)['sku']).toBe('Standard_B1s');
    });

    it('should emit COMPOUND_EXPANSION finding', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceType: 'aws_autoscaling_group', attributes: {} }),
      });
      const result = translateAsg(ctx);
      const expansion = result.findings.find((f) => f.code === 'COMPOUND_EXPANSION');
      expect(expansion).toBeDefined();
      expect(expansion!.message).toContain('1 azure');
    });

    it('should emit ASG_SCALING_ADVISORY finding', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_autoscaling_group',
          attributes: { min_size: 2, max_size: 10 },
        }),
      });
      const result = translateAsg(ctx);
      const advisory = result.findings.find((f) => f.code === 'ASG_SCALING_ADVISORY');
      expect(advisory).toBeDefined();
      expect(advisory!.message).toContain('min=2');
      expect(advisory!.message).toContain('max=10');
    });

    it('should include tags when present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_autoscaling_group',
          attributes: { tags: { Env: 'staging' } },
        }),
      });
      const result = translateAsg(ctx);
      expect((result.translated[0]!.attributes as Record<string, unknown>)['tags']).toEqual({ Env: 'staging' });
    });

    it('should have traceability with compound/asg', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ sourceType: 'aws_autoscaling_group', attributes: {} }),
      });
      const result = translateAsg(ctx);
      expect(result.translated[0]!.traceability.engineUsed).toBe('compound/asg');
      expect(result.translated[0]!.traceability.mappingType).toBe('compound');
    });
  });

  // -----------------------------------------------------------------------
  // GCP (3 resources)
  // -----------------------------------------------------------------------
  describe('GCP', () => {
    it('should emit 3 resources (template + IGM + autoscaler)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_autoscaling_group',
          sourceName: 'my_asg',
          attributes: {},
        }),
      });
      const result = translateAsg(ctx);
      expect(result.translated).toHaveLength(3);
    });

    it('should emit correct target types', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_autoscaling_group', attributes: {} }),
      });
      const result = translateAsg(ctx);
      const types = result.translated.map((r) => r.targetType);
      expect(types).toContain('google_compute_instance_template');
      expect(types).toContain('google_compute_region_instance_group_manager');
      expect(types).toContain('google_compute_region_autoscaler');
    });

    it('should name template with _tpl suffix', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_autoscaling_group',
          sourceName: 'web_asg',
          attributes: {},
        }),
      });
      const result = translateAsg(ctx);
      const tpl = result.translated.find((r) => r.targetType === 'google_compute_instance_template');
      expect(tpl!.targetName).toBe('web_asg_tpl');
    });

    it('should name autoscaler with _as suffix', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_autoscaling_group',
          sourceName: 'web_asg',
          attributes: {},
        }),
      });
      const result = translateAsg(ctx);
      const as = result.translated.find((r) => r.targetType === 'google_compute_region_autoscaler');
      expect(as!.targetName).toBe('web_asg_as');
    });

    it('should use min_size/max_size in autoscaler policy', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_autoscaling_group',
          attributes: { min_size: 2, max_size: 8 },
        }),
      });
      const result = translateAsg(ctx);
      const as = result.translated.find((r) => r.targetType === 'google_compute_region_autoscaler');
      const policy = (as!.attributes as Record<string, unknown>)['autoscaling_policy'] as Record<string, unknown>;
      expect(policy['min_replicas']).toBe(2);
      expect(policy['max_replicas']).toBe(8);
    });

    it('should use desired_capacity as target_size in IGM', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_autoscaling_group',
          attributes: { desired_capacity: 4 },
        }),
      });
      const result = translateAsg(ctx);
      const igm = result.translated.find((r) => r.targetType === 'google_compute_region_instance_group_manager');
      expect((igm!.attributes as Record<string, unknown>)['target_size']).toBe(4);
    });

    it('should resolve instance type from sibling launch template for GCP', () => {
      const ltResource = makeIrResource({
        id: 'lt-001',
        sourceType: 'aws_launch_template',
        sourceName: 'my_lt',
        attributes: { instance_type: 'c5.large' },
      });
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_autoscaling_group',
          attributes: {},
        }),
        relationships: [{ from: 'res-001', to: 'lt-001', type: 'references' } as IrRelationship],
        siblingResources: [ltResource],
      });
      const result = translateAsg(ctx);
      const tpl = result.translated.find((r) => r.targetType === 'google_compute_instance_template');
      expect((tpl!.attributes as Record<string, unknown>)['machine_type']).toBe('c2-standard-4');
    });

    it('should default to e2-micro when no sibling found', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_autoscaling_group', attributes: {} }),
      });
      const result = translateAsg(ctx);
      const tpl = result.translated.find((r) => r.targetType === 'google_compute_instance_template');
      expect((tpl!.attributes as Record<string, unknown>)['machine_type']).toBe('e2-micro');
    });

    it('should emit COMPOUND_EXPANSION with 3 gcp resources', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ sourceType: 'aws_autoscaling_group', attributes: {} }),
      });
      const result = translateAsg(ctx);
      const expansion = result.findings.find((f) => f.code === 'COMPOUND_EXPANSION');
      expect(expansion).toBeDefined();
      expect(expansion!.message).toContain('3 gcp');
    });

    it('should include labels on template when tags present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_autoscaling_group',
          attributes: { tags: { Name: 'asg-web' } },
        }),
      });
      const result = translateAsg(ctx);
      const tpl = result.translated.find((r) => r.targetType === 'google_compute_instance_template');
      expect((tpl!.attributes as Record<string, unknown>)['labels']).toBeDefined();
    });
  });
});

// ===========================================================================
// translateLb
// ===========================================================================

describe('translateLb', () => {
  function makeLbResource(attrs: Record<string, unknown> = {}): IrResource {
    return makeIrResource({
      sourceType: 'aws_lb',
      sourceName: 'my_lb',
      attributes: { load_balancer_type: 'application', ...attrs },
    });
  }

  // -----------------------------------------------------------------------
  // ALB Azure
  // -----------------------------------------------------------------------
  describe('ALB Azure', () => {
    it('should emit 2 resources (PIP + App Gateway) for external ALB', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeLbResource(),
      });
      const result = translateLb(ctx);
      expect(result.translated).toHaveLength(2);
    });

    it('should emit PIP and Application Gateway types', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeLbResource(),
      });
      const result = translateLb(ctx);
      const types = result.translated.map((r) => r.targetType);
      expect(types).toContain('azurerm_public_ip');
      expect(types).toContain('azurerm_application_gateway');
    });

    it('should skip PIP for internal ALB (1 resource)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeLbResource({ internal: true }),
      });
      const result = translateLb(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('azurerm_application_gateway');
    });

    it('should use private IP config for internal ALB', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeLbResource({ internal: true }),
      });
      const result = translateLb(ctx);
      const agw = result.translated[0]!;
      const feIp = (agw.attributes as Record<string, unknown>)['frontend_ip_configuration'] as Record<string, unknown>;
      expect(feIp['private_ip_address_allocation']).toBe('Dynamic');
      expect(feIp['subnet_id']).toBeDefined();
    });

    it('should reference PIP for external ALB', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeLbResource({ internal: false }),
      });
      const result = translateLb(ctx);
      const agw = result.translated.find((r) => r.targetType === 'azurerm_application_gateway');
      const feIp = (agw!.attributes as Record<string, unknown>)['frontend_ip_configuration'] as Record<string, unknown>;
      expect(feIp['public_ip_address_id']).toBeDefined();
    });

    it('should emit COMPOUND_EXPANSION finding for ALB Azure', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeLbResource(),
      });
      const result = translateLb(ctx);
      const expansion = result.findings.find((f) => f.code === 'COMPOUND_EXPANSION');
      expect(expansion).toBeDefined();
      expect(expansion!.message).toContain('azure');
    });

    it('should include tags on both PIP and gateway when present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeLbResource({ tags: { Env: 'prod' } }),
      });
      const result = translateLb(ctx);
      for (const r of result.translated) {
        expect((r.attributes as Record<string, unknown>)['tags']).toBeDefined();
      }
    });

    it('should have traceability compound/lb-alb', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeLbResource(),
      });
      const result = translateLb(ctx);
      for (const r of result.translated) {
        expect(r.traceability.engineUsed).toBe('compound/lb-alb');
      }
    });
  });

  // -----------------------------------------------------------------------
  // ALB GCP
  // -----------------------------------------------------------------------
  describe('ALB GCP', () => {
    it('should emit 4 resources', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeLbResource(),
      });
      const result = translateLb(ctx);
      expect(result.translated).toHaveLength(4);
    });

    it('should emit correct 4 target types', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeLbResource(),
      });
      const result = translateLb(ctx);
      const types = result.translated.map((r) => r.targetType);
      expect(types).toContain('google_compute_backend_service');
      expect(types).toContain('google_compute_url_map');
      expect(types).toContain('google_compute_target_http_proxy');
      expect(types).toContain('google_compute_global_forwarding_rule');
    });

    it('should emit COMPOUND_EXPANSION with 4 gcp resources', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeLbResource(),
      });
      const result = translateLb(ctx);
      const expansion = result.findings.find((f) => f.code === 'COMPOUND_EXPANSION');
      expect(expansion!.message).toContain('4 gcp');
    });

    it('should include labels on backend service when tags present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeLbResource({ tags: { Team: 'platform' } }),
      });
      const result = translateLb(ctx);
      const bap = result.translated.find((r) => r.targetType === 'google_compute_backend_service');
      expect((bap!.attributes as Record<string, unknown>)['labels']).toBeDefined();
    });

    it('should have traceability compound/lb-alb', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeLbResource(),
      });
      const result = translateLb(ctx);
      for (const r of result.translated) {
        expect(r.traceability.engineUsed).toBe('compound/lb-alb');
      }
    });
  });

  // -----------------------------------------------------------------------
  // NLB Azure
  // -----------------------------------------------------------------------
  describe('NLB Azure', () => {
    it('should emit 2 resources (PIP + LB) for external NLB', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeLbResource({ load_balancer_type: 'network' }),
      });
      const result = translateLb(ctx);
      expect(result.translated).toHaveLength(2);
    });

    it('should emit PIP and azurerm_lb types', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeLbResource({ load_balancer_type: 'network' }),
      });
      const result = translateLb(ctx);
      const types = result.translated.map((r) => r.targetType);
      expect(types).toContain('azurerm_public_ip');
      expect(types).toContain('azurerm_lb');
    });

    it('should skip PIP for internal NLB', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeLbResource({ load_balancer_type: 'network', internal: true }),
      });
      const result = translateLb(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('azurerm_lb');
    });

    it('should use private IP for internal NLB', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeLbResource({ load_balancer_type: 'network', internal: true }),
      });
      const result = translateLb(ctx);
      const lb = result.translated[0]!;
      const feIp = (lb.attributes as Record<string, unknown>)['frontend_ip_configuration'] as Record<string, unknown>;
      expect(feIp['private_ip_address_allocation']).toBe('Dynamic');
    });

    it('should have traceability compound/lb-nlb', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeLbResource({ load_balancer_type: 'network' }),
      });
      const result = translateLb(ctx);
      for (const r of result.translated) {
        expect(r.traceability.engineUsed).toBe('compound/lb-nlb');
      }
    });

    it('should include tags on NLB resources', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeLbResource({ load_balancer_type: 'network', tags: { Role: 'nlb' } }),
      });
      const result = translateLb(ctx);
      for (const r of result.translated) {
        expect((r.attributes as Record<string, unknown>)['tags']).toBeDefined();
      }
    });

    it('should emit COMPOUND_EXPANSION finding for NLB', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeLbResource({ load_balancer_type: 'network' }),
      });
      const result = translateLb(ctx);
      const expansion = result.findings.find((f) => f.code === 'COMPOUND_EXPANSION');
      expect(expansion).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // NLB GCP
  // -----------------------------------------------------------------------
  describe('NLB GCP', () => {
    it('should emit 3 resources (HC + backend + forwarding rule)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeLbResource({ load_balancer_type: 'network' }),
      });
      const result = translateLb(ctx);
      expect(result.translated).toHaveLength(3);
    });

    it('should emit correct 3 target types', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeLbResource({ load_balancer_type: 'network' }),
      });
      const result = translateLb(ctx);
      const types = result.translated.map((r) => r.targetType);
      expect(types).toContain('google_compute_health_check');
      expect(types).toContain('google_compute_region_backend_service');
      expect(types).toContain('google_compute_forwarding_rule');
    });

    it('should emit COMPOUND_EXPANSION with 3 gcp resources', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeLbResource({ load_balancer_type: 'network' }),
      });
      const result = translateLb(ctx);
      const expansion = result.findings.find((f) => f.code === 'COMPOUND_EXPANSION');
      expect(expansion!.message).toContain('3 gcp');
    });

    it('should include labels on backend and forwarding rule when tags present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeLbResource({ load_balancer_type: 'network', tags: { Env: 'prod' } }),
      });
      const result = translateLb(ctx);
      const backend = result.translated.find((r) => r.targetType === 'google_compute_region_backend_service');
      expect((backend!.attributes as Record<string, unknown>)['labels']).toBeDefined();
      const rule = result.translated.find((r) => r.targetType === 'google_compute_forwarding_rule');
      expect((rule!.attributes as Record<string, unknown>)['labels']).toBeDefined();
    });

    it('should have traceability compound/lb-nlb', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeLbResource({ load_balancer_type: 'network' }),
      });
      const result = translateLb(ctx);
      for (const r of result.translated) {
        expect(r.traceability.engineUsed).toBe('compound/lb-nlb');
      }
    });

    it('should use TCP protocol for NLB backend service', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeLbResource({ load_balancer_type: 'network' }),
      });
      const result = translateLb(ctx);
      const bap = result.translated.find((r) => r.targetType === 'google_compute_region_backend_service');
      expect((bap!.attributes as Record<string, unknown>)['protocol']).toBe('TCP');
    });
  });

  // -----------------------------------------------------------------------
  // Dispatch & defaults
  // -----------------------------------------------------------------------
  describe('dispatch', () => {
    it('should default to application when load_balancer_type absent', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_lb',
          sourceName: 'lb_no_type',
          attributes: {},
        }),
      });
      const result = translateLb(ctx);
      // Application gateway = ALB Azure path
      const types = result.translated.map((r) => r.targetType);
      expect(types).toContain('azurerm_application_gateway');
    });

    it('should default to application for GCP when type absent', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_lb',
          sourceName: 'lb_default',
          attributes: {},
        }),
      });
      const result = translateLb(ctx);
      expect(result.translated).toHaveLength(4); // ALB GCP = 4 resources
    });
  });
});

// ===========================================================================
// translateRds
// ===========================================================================

describe('translateRds', () => {
  function makeRdsResource(attrs: Record<string, unknown> = {}): IrResource {
    return makeIrResource({
      sourceType: 'aws_db_instance',
      sourceName: 'my_db',
      attributes: { engine: 'postgres', ...attrs },
    });
  }

  // -----------------------------------------------------------------------
  // Postgres Azure
  // -----------------------------------------------------------------------
  describe('postgres Azure', () => {
    it('should emit 1 flexible server resource', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ engine: 'postgres' }),
      });
      const result = translateRds(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('azurerm_postgresql_flexible_server');
    });

    it('should map db.t3.micro to B_Standard_B1ms', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ instance_class: 'db.t3.micro' }),
      });
      const result = translateRds(ctx);
      expect((result.translated[0]!.attributes as Record<string, unknown>)['sku_name']).toBe('B_Standard_B1ms');
    });

    it('should map db.m5.large to GP_Standard_D2ds_v4', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ instance_class: 'db.m5.large' }),
      });
      const result = translateRds(ctx);
      expect((result.translated[0]!.attributes as Record<string, unknown>)['sku_name']).toBe('GP_Standard_D2ds_v4');
    });

    it('should convert allocated_storage to storage_mb', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ allocated_storage: 50 }),
      });
      const result = translateRds(ctx);
      expect((result.translated[0]!.attributes as Record<string, unknown>)['storage_mb']).toBe(50 * 1024);
    });

    it('should use backup_retention_period as backup_retention_days', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ backup_retention_period: 14 }),
      });
      const result = translateRds(ctx);
      expect((result.translated[0]!.attributes as Record<string, unknown>)['backup_retention_days']).toBe(14);
    });

    it('should include version when engine_version present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ engine_version: '15.4' }),
      });
      const result = translateRds(ctx);
      expect((result.translated[0]!.attributes as Record<string, unknown>)['version']).toBe('15.4');
    });

    it('should emit COMPOUND_EXPANSION finding', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource(),
      });
      const result = translateRds(ctx);
      const expansion = result.findings.find((f) => f.code === 'COMPOUND_EXPANSION');
      expect(expansion).toBeDefined();
      expect(expansion!.message).toContain('1 azure');
    });

    it('should emit UNKNOWN_INSTANCE_CLASS for unmapped class', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ instance_class: 'db.x99.mega' }),
      });
      const result = translateRds(ctx);
      const warning = result.findings.find((f) => f.code === 'UNKNOWN_INSTANCE_CLASS');
      expect(warning).toBeDefined();
      expect(warning!.severity).toBe('warning');
    });

    it('should default to B_Standard_B1ms for unknown instance class', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ instance_class: 'db.unknown' }),
      });
      const result = translateRds(ctx);
      expect((result.translated[0]!.attributes as Record<string, unknown>)['sku_name']).toBe('B_Standard_B1ms');
    });

    it('should include tags when present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ tags: { Team: 'data' } }),
      });
      const result = translateRds(ctx);
      expect((result.translated[0]!.attributes as Record<string, unknown>)['tags']).toEqual({ Team: 'data' });
    });

    it('should have traceability with compound/rds', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource(),
      });
      const result = translateRds(ctx);
      expect(result.translated[0]!.traceability.engineUsed).toBe('compound/rds');
      expect(result.translated[0]!.traceability.mappingType).toBe('compound');
    });

    it('should use username and password from attributes', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ username: 'dbadmin', password: 'secret123' }),
      });
      const result = translateRds(ctx);
      const attrs = result.translated[0]!.attributes as Record<string, unknown>;
      expect(attrs['administrator_login']).toBe('dbadmin');
      expect(attrs['administrator_password']).toBe('secret123');
    });
  });

  // -----------------------------------------------------------------------
  // MySQL Azure
  // -----------------------------------------------------------------------
  describe('mysql Azure', () => {
    it('should emit 1 mysql flexible server', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ engine: 'mysql' }),
      });
      const result = translateRds(ctx);
      expect(result.translated).toHaveLength(1);
      expect(result.translated[0]!.targetType).toBe('azurerm_mysql_flexible_server');
    });

    it('should handle mariadb as mysql', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ engine: 'mariadb' }),
      });
      const result = translateRds(ctx);
      expect(result.translated[0]!.targetType).toBe('azurerm_mysql_flexible_server');
    });
  });

  // -----------------------------------------------------------------------
  // SQL Server Azure
  // -----------------------------------------------------------------------
  describe('sqlserver Azure', () => {
    it('should emit 2 resources (server + database)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ engine: 'sqlserver-ee' }),
      });
      const result = translateRds(ctx);
      expect(result.translated).toHaveLength(2);
    });

    it('should emit MSSQL server and database types', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ engine: 'sqlserver-se' }),
      });
      const result = translateRds(ctx);
      const types = result.translated.map((r) => r.targetType);
      expect(types).toContain('azurerm_mssql_server');
      expect(types).toContain('azurerm_mssql_database');
    });

    it('should use db_name for the database name', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ engine: 'sqlserver-ee', db_name: 'myapp' }),
      });
      const result = translateRds(ctx);
      const db = result.translated.find((r) => r.targetType === 'azurerm_mssql_database');
      expect((db!.attributes as Record<string, unknown>)['name']).toBe('myapp');
    });

    it('should default db_name to "default"', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ engine: 'sqlserver-ee' }),
      });
      const result = translateRds(ctx);
      const db = result.translated.find((r) => r.targetType === 'azurerm_mssql_database');
      expect((db!.attributes as Record<string, unknown>)['name']).toBe('default');
    });

    it('should emit COMPOUND_EXPANSION with 2 azure resources', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ engine: 'sqlserver-ee' }),
      });
      const result = translateRds(ctx);
      const expansion = result.findings.find((f) => f.code === 'COMPOUND_EXPANSION');
      expect(expansion!.message).toContain('2 azure');
    });

    it('should include tags on both resources', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ engine: 'sqlserver-ee', tags: { Env: 'prod' } }),
      });
      const result = translateRds(ctx);
      for (const r of result.translated) {
        expect((r.attributes as Record<string, unknown>)['tags']).toBeDefined();
      }
    });

    it('should handle sqlserver-web variant', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ engine: 'sqlserver-web' }),
      });
      const result = translateRds(ctx);
      expect(result.translated).toHaveLength(2);
      expect(result.translated[0]!.targetType).toBe('azurerm_mssql_server');
    });
  });

  // -----------------------------------------------------------------------
  // All GCP (3 resources)
  // -----------------------------------------------------------------------
  describe('GCP', () => {
    it('should emit 3 resources for postgres (instance + db + user)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource({ engine: 'postgres' }),
      });
      const result = translateRds(ctx);
      expect(result.translated).toHaveLength(3);
    });

    it('should emit correct GCP target types', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource({ engine: 'postgres' }),
      });
      const result = translateRds(ctx);
      const types = result.translated.map((r) => r.targetType);
      expect(types).toContain('google_sql_database_instance');
      expect(types).toContain('google_sql_database');
      expect(types).toContain('google_sql_user');
    });

    it('should emit 3 resources for mysql', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource({ engine: 'mysql' }),
      });
      const result = translateRds(ctx);
      expect(result.translated).toHaveLength(3);
    });

    it('should emit 3 resources for sqlserver', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource({ engine: 'sqlserver-ee' }),
      });
      const result = translateRds(ctx);
      expect(result.translated).toHaveLength(3);
    });

    it('should use POSTGRES_15 database version for postgres', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource({ engine: 'postgres' }),
      });
      const result = translateRds(ctx);
      const instance = result.translated.find((r) => r.targetType === 'google_sql_database_instance');
      expect((instance!.attributes as Record<string, unknown>)['database_version']).toBe('POSTGRES_15');
    });

    it('should use MYSQL_8_0 for mysql engine', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource({ engine: 'mysql' }),
      });
      const result = translateRds(ctx);
      const instance = result.translated.find((r) => r.targetType === 'google_sql_database_instance');
      expect((instance!.attributes as Record<string, unknown>)['database_version']).toBe('MYSQL_8_0');
    });

    it('should use SQLSERVER_2019_ENTERPRISE for sqlserver-ee', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource({ engine: 'sqlserver-ee' }),
      });
      const result = translateRds(ctx);
      const instance = result.translated.find((r) => r.targetType === 'google_sql_database_instance');
      expect((instance!.attributes as Record<string, unknown>)['database_version']).toBe('SQLSERVER_2019_ENTERPRISE');
    });

    it('should use SQLSERVER_2019_STANDARD for sqlserver-se', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource({ engine: 'sqlserver-se' }),
      });
      const result = translateRds(ctx);
      const instance = result.translated.find((r) => r.targetType === 'google_sql_database_instance');
      expect((instance!.attributes as Record<string, unknown>)['database_version']).toBe('SQLSERVER_2019_STANDARD');
    });

    it('should map db.t3.micro to db-f1-micro', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource({ instance_class: 'db.t3.micro' }),
      });
      const result = translateRds(ctx);
      const instance = result.translated.find((r) => r.targetType === 'google_sql_database_instance');
      const settings = (instance!.attributes as Record<string, unknown>)['settings'] as Record<string, unknown>;
      expect(settings['tier']).toBe('db-f1-micro');
    });

    it('should map db.r5.large to db-custom-2-16384', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource({ instance_class: 'db.r5.large' }),
      });
      const result = translateRds(ctx);
      const instance = result.translated.find((r) => r.targetType === 'google_sql_database_instance');
      const settings = (instance!.attributes as Record<string, unknown>)['settings'] as Record<string, unknown>;
      expect(settings['tier']).toBe('db-custom-2-16384');
    });

    it('should emit UNKNOWN_INSTANCE_CLASS for unmapped class', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource({ instance_class: 'db.z1.mega' }),
      });
      const result = translateRds(ctx);
      const warning = result.findings.find((f) => f.code === 'UNKNOWN_INSTANCE_CLASS');
      expect(warning).toBeDefined();
      expect(warning!.message).toContain('GCP');
    });

    it('should default to db-f1-micro for unknown instance class', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource({ instance_class: 'db.unknown' }),
      });
      const result = translateRds(ctx);
      const instance = result.translated.find((r) => r.targetType === 'google_sql_database_instance');
      const settings = (instance!.attributes as Record<string, unknown>)['settings'] as Record<string, unknown>;
      expect(settings['tier']).toBe('db-f1-micro');
    });

    it('should use allocated_storage as disk_size', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource({ allocated_storage: 100 }),
      });
      const result = translateRds(ctx);
      const instance = result.translated.find((r) => r.targetType === 'google_sql_database_instance');
      const settings = (instance!.attributes as Record<string, unknown>)['settings'] as Record<string, unknown>;
      expect(settings['disk_size']).toBe(100);
    });

    it('should use db_name for SQL Database name', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource({ db_name: 'appdb' }),
      });
      const result = translateRds(ctx);
      const db = result.translated.find((r) => r.targetType === 'google_sql_database');
      expect((db!.attributes as Record<string, unknown>)['name']).toBe('appdb');
    });

    it('should use username and password for SQL User', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource({ username: 'myuser', password: 'mypass' }),
      });
      const result = translateRds(ctx);
      const user = result.translated.find((r) => r.targetType === 'google_sql_user');
      expect((user!.attributes as Record<string, unknown>)['name']).toBe('myuser');
      expect((user!.attributes as Record<string, unknown>)['password']).toBe('mypass');
    });

    it('should emit COMPOUND_EXPANSION with 3 gcp resources', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource(),
      });
      const result = translateRds(ctx);
      const expansion = result.findings.find((f) => f.code === 'COMPOUND_EXPANSION');
      expect(expansion!.message).toContain('3 gcp');
    });

    it('should include labels when tags present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource({ tags: { Env: 'staging' } }),
      });
      const result = translateRds(ctx);
      const instance = result.translated.find((r) => r.targetType === 'google_sql_database_instance');
      expect((instance!.attributes as Record<string, unknown>)['labels']).toBeDefined();
    });

    it('should have traceability compound/rds', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource(),
      });
      const result = translateRds(ctx);
      for (const r of result.translated) {
        expect(r.traceability.engineUsed).toBe('compound/rds');
        expect(r.traceability.mappingType).toBe('compound');
      }
    });
  });

  // -----------------------------------------------------------------------
  // Engine defaults
  // -----------------------------------------------------------------------
  describe('engine defaults', () => {
    it('should default to postgres when engine absent', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          sourceType: 'aws_db_instance',
          sourceName: 'my_db',
          attributes: {},
        }),
      });
      const result = translateRds(ctx);
      expect(result.translated[0]!.targetType).toBe('azurerm_postgresql_flexible_server');
    });

    it('should default to POSTGRES_15 for GCP when engine absent', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          sourceType: 'aws_db_instance',
          sourceName: 'my_db',
          attributes: {},
        }),
      });
      const result = translateRds(ctx);
      const instance = result.translated.find((r) => r.targetType === 'google_sql_database_instance');
      expect((instance!.attributes as Record<string, unknown>)['database_version']).toBe('POSTGRES_15');
    });

    it('should default allocated_storage to 20', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource(),
      });
      const result = translateRds(ctx);
      expect((result.translated[0]!.attributes as Record<string, unknown>)['storage_mb']).toBe(20 * 1024);
    });

    it('should default backup_retention_period to 7', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource(),
      });
      const result = translateRds(ctx);
      expect((result.translated[0]!.attributes as Record<string, unknown>)['backup_retention_days']).toBe(7);
    });
  });

  // -----------------------------------------------------------------------
  // RDS encryption warning
  // -----------------------------------------------------------------------
  describe('encryption warning', () => {
    it('should emit RDS_NO_ENCRYPTION when storage_encrypted is absent', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ engine: 'postgres' }),
      });
      const result = translateRds(ctx);
      const finding = result.findings.find((f) => f.code === 'RDS_NO_ENCRYPTION');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('warning');
    });

    it('should emit RDS_NO_ENCRYPTION when storage_encrypted=false', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeRdsResource({ engine: 'mysql', storage_encrypted: false }),
      });
      const result = translateRds(ctx);
      const finding = result.findings.find((f) => f.code === 'RDS_NO_ENCRYPTION');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('warning');
    });

    it('should NOT emit RDS_NO_ENCRYPTION when storage_encrypted=true', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeRdsResource({ engine: 'postgres', storage_encrypted: true }),
      });
      const result = translateRds(ctx);
      const finding = result.findings.find((f) => f.code === 'RDS_NO_ENCRYPTION');
      expect(finding).toBeUndefined();
    });
  });
});

// ===========================================================================
// translateEc2 — security gates
// ===========================================================================

describe('translateEc2 — security gates', () => {
  function makeEc2Resource(attrs: Record<string, unknown> = {}): IrResource {
    return makeIrResource({
      sourceType: 'aws_instance',
      sourceName: 'my_server',
      attributes: { instance_type: 't3.micro', ...attrs },
    });
  }

  // -----------------------------------------------------------------------
  // EC2_PUBLIC_NO_SG blocker
  // -----------------------------------------------------------------------
  describe('EC2_PUBLIC_NO_SG blocker', () => {
    it('should block when public IP + no security group (Azure)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeEc2Resource({ associate_public_ip_address: true }),
      });
      const result = translateEc2(ctx);
      expect(result.translated).toHaveLength(0);
      const blocker = result.findings.find((f) => f.code === 'EC2_PUBLIC_NO_SG');
      expect(blocker).toBeDefined();
      expect(blocker!.severity).toBe('blocker');
    });

    it('should block when public IP + empty SG array (GCP)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeEc2Resource({
          associate_public_ip_address: true,
          vpc_security_group_ids: [],
        }),
      });
      const result = translateEc2(ctx);
      expect(result.translated).toHaveLength(0);
      expect(result.findings.find((f) => f.code === 'EC2_PUBLIC_NO_SG')).toBeDefined();
    });

    it('should NOT block when public IP + SG present', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeEc2Resource({
          associate_public_ip_address: true,
          vpc_security_group_ids: ['sg-12345'],
        }),
      });
      const result = translateEc2(ctx);
      expect(result.translated.length).toBeGreaterThan(0);
      expect(result.findings.find((f) => f.code === 'EC2_PUBLIC_NO_SG')).toBeUndefined();
    });

    it('should NOT block when no public IP', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeEc2Resource({ associate_public_ip_address: false }),
      });
      const result = translateEc2(ctx);
      expect(result.translated.length).toBeGreaterThan(0);
      expect(result.findings.find((f) => f.code === 'EC2_PUBLIC_NO_SG')).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // EC2_UNENCRYPTED_VOLUME warning
  // -----------------------------------------------------------------------
  describe('EC2_UNENCRYPTED_VOLUME warning', () => {
    it('should warn when root_block_device has encrypted=false', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeEc2Resource({
          root_block_device: { volume_size: 30, encrypted: false },
        }),
      });
      const result = translateEc2(ctx);
      const finding = result.findings.find((f) => f.code === 'EC2_UNENCRYPTED_VOLUME');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('warning');
    });

    it('should warn when root_block_device exists without encrypted field', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeEc2Resource({
          root_block_device: { volume_size: 50 },
        }),
      });
      const result = translateEc2(ctx);
      expect(result.findings.find((f) => f.code === 'EC2_UNENCRYPTED_VOLUME')).toBeDefined();
    });

    it('should NOT warn when root_block_device has encrypted=true', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeEc2Resource({
          root_block_device: { volume_size: 30, encrypted: true },
        }),
      });
      const result = translateEc2(ctx);
      expect(result.findings.find((f) => f.code === 'EC2_UNENCRYPTED_VOLUME')).toBeUndefined();
    });

    it('should NOT warn when root_block_device is absent', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeEc2Resource({}),
      });
      const result = translateEc2(ctx);
      expect(result.findings.find((f) => f.code === 'EC2_UNENCRYPTED_VOLUME')).toBeUndefined();
    });
  });
});
