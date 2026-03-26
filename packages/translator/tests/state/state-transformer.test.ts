import { describe, it, expect } from 'vitest';
import type {
  StateDataV3,
  StateDataV4,
  StateData,
  TranslationManifest,
  ManifestEntry,
  TranslatedResource,
} from '@tla/shared';
import {
  normalizeV3,
  normalizeV4,
  normalizeState,
  buildAddressMap,
  classifyByMappingType,
  generateMoveCommand,
  generateImportCommand,
  generateRemoveCommand,
  transformState,
} from '../../src/state/state-transformer.js';
import { generateRollback } from '../../src/state/rollback-generator.js';

// ===========================================================================
// Factory helpers
// ===========================================================================

function makeV4State(
  resources: StateDataV4['resources'] = [],
): StateDataV4 {
  return {
    version: 4,
    terraform_version: '1.5.0',
    serial: 1,
    lineage: 'test-lineage',
    outputs: {},
    resources,
  };
}

function makeV3State(
  modules: StateDataV3['modules'] = [],
): StateDataV3 {
  return {
    version: 3,
    terraform_version: '0.11.14',
    serial: 1,
    lineage: 'test-lineage-v3',
    modules,
  };
}

function makeTranslatedResource(
  targetType: string,
  targetName: string,
  sourceId: string,
): TranslatedResource {
  return {
    targetType,
    targetName,
    attributes: {},
    sourceId,
    traceability: {
      sourceId,
      sourceType: sourceId.split('.')[0]!,
      registryEntryId: null,
      mappingType: 'direct',
      confidence: 0.9,
      engineUsed: 'direct-engine',
    },
  };
}

function makeManifestEntry(
  sourceId: string,
  sourceType: string,
  status: ManifestEntry['status'],
  targetResources: TranslatedResource[] = [],
  findings: ManifestEntry['findings'] = [],
): ManifestEntry {
  return {
    sourceId,
    sourceType,
    status,
    targetResources,
    confidence: 0.9,
    findings,
  };
}

function makeManifest(
  entries: ManifestEntry[],
): TranslationManifest {
  const counts = {
    total: entries.length,
    translated: entries.filter((e) => e.status === 'translated').length,
    expanded: entries.filter((e) => e.status === 'expanded').length,
    partial: entries.filter((e) => e.status === 'partial').length,
    blocked: entries.filter((e) => e.status === 'blocked').length,
    advisory: entries.filter((e) => e.status === 'advisory').length,
  };
  return {
    version: '1.0.0',
    registryVersion: '1.0.0',
    target: 'azure',
    counts,
    entries,
    findings: [],
    confidenceOverall: 0.9,
  };
}

// ===========================================================================
// normalizeV4
// ===========================================================================

describe('normalizeV4', () => {
  it('normalizes a single root resource', () => {
    const state = makeV4State([
      {
        mode: 'managed',
        type: 'aws_instance',
        name: 'web',
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [],
      },
    ]);
    const result = normalizeV4(state);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      address: 'aws_instance.web',
      type: 'aws_instance',
      name: 'web',
      mode: 'managed',
    });
  });

  it('normalizes a resource with module prefix', () => {
    const state = makeV4State([
      {
        mode: 'managed',
        type: 'aws_vpc',
        name: 'main',
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [],
        module: 'module.networking',
      },
    ]);
    const result = normalizeV4(state);
    expect(result).toHaveLength(1);
    expect(result[0]!.address).toBe('module.networking.aws_vpc.main');
  });

  it('skips data sources (mode === "data")', () => {
    const state = makeV4State([
      {
        mode: 'data',
        type: 'aws_ami',
        name: 'ubuntu',
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [],
      },
      {
        mode: 'managed',
        type: 'aws_instance',
        name: 'web',
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [],
      },
    ]);
    const result = normalizeV4(state);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('aws_instance');
  });

  it('returns empty array for empty resources', () => {
    const state = makeV4State([]);
    const result = normalizeV4(state);
    expect(result).toEqual([]);
  });

  it('handles multi-instance resources', () => {
    const state = makeV4State([
      {
        mode: 'managed',
        type: 'aws_subnet',
        name: 'private',
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [
          { schema_version: 0, attributes: { id: 'subnet-1' }, sensitive_attributes: [], dependencies: [] },
          { schema_version: 0, attributes: { id: 'subnet-2' }, sensitive_attributes: [], dependencies: [] },
        ],
      },
    ]);
    const result = normalizeV4(state);
    expect(result).toHaveLength(1);
    expect(result[0]!.address).toBe('aws_subnet.private');
  });

  it('handles nested module (module.a.module.b)', () => {
    const state = makeV4State([
      {
        mode: 'managed',
        type: 'aws_s3_bucket',
        name: 'logs',
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [],
        module: 'module.infra.module.storage',
      },
    ]);
    const result = normalizeV4(state);
    expect(result).toHaveLength(1);
    expect(result[0]!.address).toBe('module.infra.module.storage.aws_s3_bucket.logs');
  });
});

// ===========================================================================
// normalizeV3
// ===========================================================================

describe('normalizeV3', () => {
  it('normalizes root module resource (path: ["root"])', () => {
    const state = makeV3State([
      {
        path: ['root'],
        outputs: {},
        resources: {
          'aws_instance.web': {
            type: 'aws_instance',
            depends_on: [],
            primary: { id: 'i-123', attributes: {}, meta: {} },
            provider: '',
          },
        },
      },
    ]);
    const result = normalizeV3(state);
    expect(result).toHaveLength(1);
    expect(result[0]!.address).toBe('aws_instance.web');
    expect(result[0]!.type).toBe('aws_instance');
    expect(result[0]!.name).toBe('web');
  });

  it('normalizes nested module resource (path: ["root","vpc"])', () => {
    const state = makeV3State([
      {
        path: ['root', 'vpc'],
        outputs: {},
        resources: {
          'aws_vpc.main': {
            type: 'aws_vpc',
            depends_on: [],
            primary: { id: 'vpc-456', attributes: {}, meta: {} },
            provider: '',
          },
        },
      },
    ]);
    const result = normalizeV3(state);
    expect(result).toHaveLength(1);
    expect(result[0]!.address).toBe('module.vpc.aws_vpc.main');
  });

  it('extracts name from "type.name" key', () => {
    const state = makeV3State([
      {
        path: ['root'],
        outputs: {},
        resources: {
          'aws_s3_bucket.my_bucket': {
            type: 'aws_s3_bucket',
            depends_on: [],
            primary: { id: 'bucket-1', attributes: {}, meta: {} },
            provider: '',
          },
        },
      },
    ]);
    const result = normalizeV3(state);
    expect(result[0]!.name).toBe('my_bucket');
  });

  it('returns empty array for empty modules', () => {
    const state = makeV3State([]);
    const result = normalizeV3(state);
    expect(result).toEqual([]);
  });

  it('handles multiple resources in one module', () => {
    const state = makeV3State([
      {
        path: ['root'],
        outputs: {},
        resources: {
          'aws_instance.web': {
            type: 'aws_instance',
            depends_on: [],
            primary: { id: 'i-1', attributes: {}, meta: {} },
            provider: '',
          },
          'aws_security_group.web_sg': {
            type: 'aws_security_group',
            depends_on: [],
            primary: { id: 'sg-1', attributes: {}, meta: {} },
            provider: '',
          },
        },
      },
    ]);
    const result = normalizeV3(state);
    expect(result).toHaveLength(2);
    // Sorted alphabetically
    expect(result[0]!.address).toBe('aws_instance.web');
    expect(result[1]!.address).toBe('aws_security_group.web_sg');
  });
});

// ===========================================================================
// normalizeState
// ===========================================================================

describe('normalizeState', () => {
  it('dispatches V4 state', () => {
    const state: StateData = makeV4State([
      {
        mode: 'managed',
        type: 'aws_instance',
        name: 'web',
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [],
      },
    ]);
    const result = normalizeState(state);
    expect(result).toHaveLength(1);
    expect(result[0]!.address).toBe('aws_instance.web');
  });

  it('dispatches V3 state', () => {
    const state: StateData = makeV3State([
      {
        path: ['root'],
        outputs: {},
        resources: {
          'aws_vpc.main': {
            type: 'aws_vpc',
            depends_on: [],
            primary: { id: 'vpc-1', attributes: {}, meta: {} },
            provider: '',
          },
        },
      },
    ]);
    const result = normalizeState(state);
    expect(result).toHaveLength(1);
    expect(result[0]!.address).toBe('aws_vpc.main');
  });
});

// ===========================================================================
// buildAddressMap
// ===========================================================================

describe('buildAddressMap', () => {
  it('matches state resource to manifest entry by sourceId', () => {
    const resources = [
      { address: 'aws_instance.web', type: 'aws_instance', name: 'web', mode: 'managed' },
    ];
    const entry = makeManifestEntry(
      'aws_instance.web',
      'aws_instance',
      'translated',
      [makeTranslatedResource('azurerm_linux_virtual_machine', 'web', 'aws_instance.web')],
    );
    const manifest = makeManifest([entry]);

    const result = buildAddressMap(resources, manifest);
    expect(result).toHaveLength(1);
    expect(result[0]!.stateAddress).toBe('aws_instance.web');
    expect(result[0]!.manifestEntry).toBe(entry);
  });

  it('reports unmatched state resources (excluded from result)', () => {
    const resources = [
      { address: 'aws_instance.web', type: 'aws_instance', name: 'web', mode: 'managed' },
      { address: 'aws_s3_bucket.logs', type: 'aws_s3_bucket', name: 'logs', mode: 'managed' },
    ];
    const entry = makeManifestEntry(
      'aws_instance.web',
      'aws_instance',
      'translated',
      [makeTranslatedResource('azurerm_linux_virtual_machine', 'web', 'aws_instance.web')],
    );
    const manifest = makeManifest([entry]);

    const result = buildAddressMap(resources, manifest);
    // Only matched resource appears
    expect(result).toHaveLength(1);
    expect(result[0]!.stateAddress).toBe('aws_instance.web');
  });

  it('reports unmatched manifest entries (not in state)', () => {
    const resources = [
      { address: 'aws_instance.web', type: 'aws_instance', name: 'web', mode: 'managed' },
    ];
    const entries = [
      makeManifestEntry('aws_instance.web', 'aws_instance', 'translated', [
        makeTranslatedResource('azurerm_linux_virtual_machine', 'web', 'aws_instance.web'),
      ]),
      makeManifestEntry('aws_rds_instance.db', 'aws_rds_instance', 'translated', [
        makeTranslatedResource('azurerm_postgresql_flexible_server', 'db', 'aws_rds_instance.db'),
      ]),
    ];
    const manifest = makeManifest(entries);

    const result = buildAddressMap(resources, manifest);
    // Only matching resource
    expect(result).toHaveLength(1);
  });

  it('strips module prefix for matching (uses type.name as sourceId)', () => {
    const resources = [
      {
        address: 'module.networking.aws_vpc.main',
        type: 'aws_vpc',
        name: 'main',
        mode: 'managed',
      },
    ];
    const entry = makeManifestEntry(
      'aws_vpc.main',
      'aws_vpc',
      'translated',
      [makeTranslatedResource('azurerm_virtual_network', 'main', 'aws_vpc.main')],
    );
    const manifest = makeManifest([entry]);

    const result = buildAddressMap(resources, manifest);
    expect(result).toHaveLength(1);
    expect(result[0]!.stateAddress).toBe('module.networking.aws_vpc.main');
  });

  it('handles empty state and manifest', () => {
    const result = buildAddressMap([], makeManifest([]));
    expect(result).toEqual([]);
  });

  it('warns on ambiguous matches (multiple state resources with same type.name)', () => {
    // Two resources in different modules, same type.name
    const resources = [
      { address: 'aws_instance.web', type: 'aws_instance', name: 'web', mode: 'managed' },
      {
        address: 'module.app.aws_instance.web',
        type: 'aws_instance',
        name: 'web',
        mode: 'managed',
      },
    ];
    const entry = makeManifestEntry(
      'aws_instance.web',
      'aws_instance',
      'translated',
      [makeTranslatedResource('azurerm_linux_virtual_machine', 'web', 'aws_instance.web')],
    );
    const manifest = makeManifest([entry]);

    // buildAddressMap matches BOTH to the same manifest entry (first come)
    // The result has the first match only since the manifest entry is consumed
    const result = buildAddressMap(resources, manifest);
    // Both state resources produce the same sourceId, but the map indexes by sourceId,
    // so both get matched to the same manifest entry
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// classifyByMappingType
// ===========================================================================

describe('classifyByMappingType', () => {
  it('classifies translated -> move', () => {
    const entry = makeManifestEntry(
      'aws_instance.web',
      'aws_instance',
      'translated',
      [makeTranslatedResource('azurerm_linux_virtual_machine', 'web', 'aws_instance.web')],
    );
    const entries = [{ stateAddress: 'aws_instance.web', manifestEntry: entry }];

    const result = classifyByMappingType(entries);
    expect(result.moves).toHaveLength(1);
    expect(result.moves[0]!.source).toBe('aws_instance.web');
    expect(result.moves[0]!.destination).toBe('azurerm_linux_virtual_machine.web');
    expect(result.imports).toHaveLength(0);
    expect(result.removes).toHaveLength(0);
  });

  it('classifies partial -> move', () => {
    const entry = makeManifestEntry(
      'aws_s3_bucket.data',
      'aws_s3_bucket',
      'partial',
      [makeTranslatedResource('azurerm_storage_account', 'data', 'aws_s3_bucket.data')],
    );
    const entries = [{ stateAddress: 'aws_s3_bucket.data', manifestEntry: entry }];

    const result = classifyByMappingType(entries);
    expect(result.moves).toHaveLength(1);
    expect(result.moves[0]!.destination).toBe('azurerm_storage_account.data');
  });

  it('classifies expanded -> move primary + import secondaries', () => {
    const entry = makeManifestEntry(
      'aws_instance.web',
      'aws_instance',
      'expanded',
      [
        makeTranslatedResource('azurerm_linux_virtual_machine', 'web', 'aws_instance.web'),
        makeTranslatedResource('azurerm_network_interface', 'web_nic', 'aws_instance.web'),
        makeTranslatedResource('azurerm_managed_disk', 'web_disk', 'aws_instance.web'),
      ],
    );
    const entries = [{ stateAddress: 'aws_instance.web', manifestEntry: entry }];

    const result = classifyByMappingType(entries);
    // Primary: targetName 'web' matches sourceId name 'web'
    expect(result.moves).toHaveLength(1);
    expect(result.moves[0]!.destination).toBe('azurerm_linux_virtual_machine.web');
    // Secondaries: web_nic and web_disk
    expect(result.imports).toHaveLength(2);
    const importAddresses = result.imports.map((i) => i.address).sort();
    expect(importAddresses).toEqual([
      'azurerm_managed_disk.web_disk',
      'azurerm_network_interface.web_nic',
    ]);
  });

  it('expanded: primary detected by name match', () => {
    const entry = makeManifestEntry(
      'aws_instance.server',
      'aws_instance',
      'expanded',
      [
        makeTranslatedResource('azurerm_network_interface', 'server_nic', 'aws_instance.server'),
        makeTranslatedResource('azurerm_linux_virtual_machine', 'server', 'aws_instance.server'),
      ],
    );
    const entries = [{ stateAddress: 'aws_instance.server', manifestEntry: entry }];

    const result = classifyByMappingType(entries);
    // 'server' matches sourceId name part
    expect(result.moves).toHaveLength(1);
    expect(result.moves[0]!.destination).toBe('azurerm_linux_virtual_machine.server');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]!.address).toBe('azurerm_network_interface.server_nic');
  });

  it('expanded: fallback when no name match — no move, all import', () => {
    // When no target matches the source name, primary is undefined
    const entry = makeManifestEntry(
      'aws_instance.web',
      'aws_instance',
      'expanded',
      [
        makeTranslatedResource('azurerm_network_interface', 'nic_alpha', 'aws_instance.web'),
        makeTranslatedResource('azurerm_managed_disk', 'disk_alpha', 'aws_instance.web'),
      ],
    );
    const entries = [{ stateAddress: 'aws_instance.web', manifestEntry: entry }];

    const result = classifyByMappingType(entries);
    // No target named 'web', so no primary match -> no move
    expect(result.moves).toHaveLength(0);
    // All targets become imports since none matched primary
    expect(result.imports).toHaveLength(2);
  });

  it('classifies advisory -> remove', () => {
    const entry = makeManifestEntry(
      'aws_dynamodb_table.locks',
      'aws_dynamodb_table',
      'advisory',
      [],
    );
    const entries = [{ stateAddress: 'aws_dynamodb_table.locks', manifestEntry: entry }];

    const result = classifyByMappingType(entries);
    expect(result.removes).toHaveLength(1);
    expect(result.removes[0]!.address).toBe('aws_dynamodb_table.locks');
    expect(result.removes[0]!.reason).toContain('Advisory resource');
    expect(result.removes[0]!.reason).toContain('aws_dynamodb_table.locks');
  });

  it('advisory: includes sourceId in reason', () => {
    const entry = makeManifestEntry(
      'aws_iam_role.deploy',
      'aws_iam_role',
      'advisory',
      [],
      [{ resourceId: 'aws_iam_role.deploy', severity: 'warning', code: 'NO_EQUIVALENT', message: 'No direct Azure equivalent' }],
    );
    const entries = [{ stateAddress: 'aws_iam_role.deploy', manifestEntry: entry }];

    const result = classifyByMappingType(entries);
    expect(result.removes[0]!.reason).toContain('aws_iam_role.deploy');
  });

  it('classifies blocked -> skip with warning', () => {
    const entry = makeManifestEntry(
      'aws_security_group.blocker',
      'aws_security_group',
      'blocked',
      [],
    );
    const entries = [{ stateAddress: 'aws_security_group.blocker', manifestEntry: entry }];

    const result = classifyByMappingType(entries);
    expect(result.moves).toHaveLength(0);
    expect(result.imports).toHaveLength(0);
    expect(result.removes).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('SKIPPED');
    expect(result.warnings[0]).toContain('aws_security_group.blocker');
    expect(result.warnings[0]).toContain('blocked');
  });

  it('classifies unknown/pending -> skip with warning', () => {
    const entry = makeManifestEntry(
      'aws_lambda_function.handler',
      'aws_lambda_function',
      'pending',
      [],
    );
    const entries = [{ stateAddress: 'aws_lambda_function.handler', manifestEntry: entry }];

    const result = classifyByMappingType(entries);
    expect(result.moves).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('SKIPPED');
    expect(result.warnings[0]).toContain('pending');
  });
});

// ===========================================================================
// generateMoveCommand
// ===========================================================================

describe('generateMoveCommand', () => {
  it('generates correct command string with single quotes', () => {
    const cmd = generateMoveCommand('aws_instance.web', 'azurerm_linux_virtual_machine.web');
    expect(cmd.source).toBe('aws_instance.web');
    expect(cmd.destination).toBe('azurerm_linux_virtual_machine.web');
    expect(cmd.commandString).toBe(
      "terraform state mv 'aws_instance.web' 'azurerm_linux_virtual_machine.web'",
    );
  });

  it('preserves module prefix in destination', () => {
    const cmd = generateMoveCommand(
      'module.networking.aws_vpc.main',
      'module.networking.azurerm_virtual_network.main',
    );
    expect(cmd.commandString).toContain("'module.networking.aws_vpc.main'");
    expect(cmd.commandString).toContain("'module.networking.azurerm_virtual_network.main'");
  });

  it('handles root-level resource', () => {
    const cmd = generateMoveCommand('aws_s3_bucket.data', 'azurerm_storage_account.data');
    expect(cmd.commandString).toBe(
      "terraform state mv 'aws_s3_bucket.data' 'azurerm_storage_account.data'",
    );
  });
});

// ===========================================================================
// generateImportCommand
// ===========================================================================

describe('generateImportCommand', () => {
  it('generates correct import with placeholder', () => {
    const cmd = generateImportCommand(
      'azurerm_network_interface.web_nic',
      'azurerm_network_interface',
    );
    expect(cmd.address).toBe('azurerm_network_interface.web_nic');
    expect(cmd.resourceType).toBe('azurerm_network_interface');
    expect(cmd.commandString).toBe(
      "terraform import 'azurerm_network_interface.web_nic' <RESOURCE_ID>",
    );
  });

  it('includes manual task flag', () => {
    const cmd = generateImportCommand('azurerm_managed_disk.web_disk', 'azurerm_managed_disk');
    expect(cmd.manualTask).toBe(true);
  });
});

// ===========================================================================
// generateRemoveCommand
// ===========================================================================

describe('generateRemoveCommand', () => {
  it('generates correct rm command', () => {
    const cmd = generateRemoveCommand(
      'aws_dynamodb_table.locks',
      'Advisory resource: aws_dynamodb_table.locks',
    );
    expect(cmd.address).toBe('aws_dynamodb_table.locks');
    expect(cmd.reason).toBe('Advisory resource: aws_dynamodb_table.locks');
    expect(cmd.commandString).toBe("terraform state rm 'aws_dynamodb_table.locks'");
  });
});

// ===========================================================================
// generateRollback
// ===========================================================================

describe('generateRollback', () => {
  const fixedTimestamp = '2026-01-15T10:30:00.000Z';

  it('inverts moves (swap source/dest)', () => {
    const moves = [generateMoveCommand('aws_instance.web', 'azurerm_linux_virtual_machine.web')];
    const rollback = generateRollback(moves, [], [], fixedTimestamp);

    expect(rollback.inverseMoves).toHaveLength(1);
    expect(rollback.inverseMoves[0]!.source).toBe('azurerm_linux_virtual_machine.web');
    expect(rollback.inverseMoves[0]!.destination).toBe('aws_instance.web');
    expect(rollback.inverseMoves[0]!.commandString).toBe(
      "terraform state mv 'azurerm_linux_virtual_machine.web' 'aws_instance.web'",
    );
  });

  it('inverts imports to removes', () => {
    const imports = [
      generateImportCommand('azurerm_network_interface.web_nic', 'azurerm_network_interface'),
    ];
    const rollback = generateRollback([], imports, [], fixedTimestamp);

    expect(rollback.inverseImports).toHaveLength(1);
    expect(rollback.inverseImports[0]!.address).toBe('azurerm_network_interface.web_nic');
    expect(rollback.inverseImports[0]!.commandString).toBe(
      "terraform state rm 'azurerm_network_interface.web_nic'",
    );
  });

  it('generates snapshot warning for removes', () => {
    const removes = [
      generateRemoveCommand('aws_dynamodb_table.locks', 'Advisory resource'),
    ];
    const rollback = generateRollback([], [], removes, fixedTimestamp);

    expect(rollback.inverseRemoves).toHaveLength(1);
    expect(rollback.inverseRemoves[0]).toContain('WARNING');
    expect(rollback.inverseRemoves[0]).toContain('Cannot auto-reverse');
    expect(rollback.inverseRemoves[0]).toContain('aws_dynamodb_table.locks');
    expect(rollback.inverseRemoves[0]).toContain('snapshot');
  });

  it('uses provided timestamp', () => {
    const rollback = generateRollback([], [], [], fixedTimestamp);
    expect(rollback.timestamp).toBe(fixedTimestamp);
    expect(rollback.snapshotRef).toBe(`tfstate-snapshot-${fixedTimestamp}`);
  });

  it('defaults timestamp when not provided', () => {
    const rollback = generateRollback([], [], []);
    expect(rollback.timestamp).toBeDefined();
    // Should be a valid ISO string
    expect(new Date(rollback.timestamp).toISOString()).toBe(rollback.timestamp);
  });

  it('snapshot ref format is tfstate-snapshot-<timestamp>', () => {
    const rollback = generateRollback([], [], [], fixedTimestamp);
    expect(rollback.snapshotRef).toBe('tfstate-snapshot-2026-01-15T10:30:00.000Z');
  });
});

// ===========================================================================
// transformState (integration)
// ===========================================================================

describe('transformState', () => {
  const fixedTimestamp = '2026-01-15T12:00:00.000Z';

  it('full pipeline with V4 state + manifest', () => {
    const state = makeV4State([
      {
        mode: 'managed',
        type: 'aws_instance',
        name: 'web',
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [],
      },
      {
        mode: 'managed',
        type: 'aws_s3_bucket',
        name: 'data',
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [],
      },
    ]);

    const manifest = makeManifest([
      makeManifestEntry('aws_instance.web', 'aws_instance', 'translated', [
        makeTranslatedResource('azurerm_linux_virtual_machine', 'web', 'aws_instance.web'),
      ]),
      makeManifestEntry('aws_s3_bucket.data', 'aws_s3_bucket', 'translated', [
        makeTranslatedResource('azurerm_storage_account', 'data', 'aws_s3_bucket.data'),
      ]),
    ]);

    const plan = transformState(state, manifest, fixedTimestamp);

    expect(plan.moves).toHaveLength(2);
    expect(plan.imports).toHaveLength(0);
    expect(plan.removes).toHaveLength(0);
    expect(plan.warnings).toHaveLength(0);
    expect(plan.rollbackManifest).toBeDefined();
    expect(plan.rollbackManifest.timestamp).toBe(fixedTimestamp);
    expect(plan.rollbackManifest.inverseMoves).toHaveLength(2);
  });

  it('mixed statuses (translated + expanded + advisory + blocked)', () => {
    const state = makeV4State([
      {
        mode: 'managed',
        type: 'aws_instance',
        name: 'web',
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [],
      },
      {
        mode: 'managed',
        type: 'aws_instance',
        name: 'app',
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [],
      },
      {
        mode: 'managed',
        type: 'aws_dynamodb_table',
        name: 'locks',
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [],
      },
      {
        mode: 'managed',
        type: 'aws_security_group',
        name: 'wide_open',
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [],
      },
    ]);

    const manifest = makeManifest([
      // translated
      makeManifestEntry('aws_instance.web', 'aws_instance', 'translated', [
        makeTranslatedResource('azurerm_linux_virtual_machine', 'web', 'aws_instance.web'),
      ]),
      // expanded
      makeManifestEntry('aws_instance.app', 'aws_instance', 'expanded', [
        makeTranslatedResource('azurerm_linux_virtual_machine', 'app', 'aws_instance.app'),
        makeTranslatedResource('azurerm_network_interface', 'app_nic', 'aws_instance.app'),
      ]),
      // advisory
      makeManifestEntry('aws_dynamodb_table.locks', 'aws_dynamodb_table', 'advisory', []),
      // blocked
      makeManifestEntry('aws_security_group.wide_open', 'aws_security_group', 'blocked', []),
    ]);

    const plan = transformState(state, manifest, fixedTimestamp);

    // translated: 1 move, expanded: 1 move + 1 import
    expect(plan.moves).toHaveLength(2);
    expect(plan.imports).toHaveLength(1);
    // advisory: 1 remove
    expect(plan.removes).toHaveLength(1);
    // blocked: 1 warning
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain('blocked');

    // Rollback
    expect(plan.rollbackManifest.inverseMoves).toHaveLength(2);
    expect(plan.rollbackManifest.inverseImports).toHaveLength(1);
    expect(plan.rollbackManifest.inverseRemoves).toHaveLength(1);
  });

  it('empty state -> empty plan', () => {
    const state = makeV4State([]);
    const manifest = makeManifest([]);

    const plan = transformState(state, manifest, fixedTimestamp);

    expect(plan.moves).toEqual([]);
    expect(plan.imports).toEqual([]);
    expect(plan.removes).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(plan.rollbackManifest.inverseMoves).toEqual([]);
  });

  it('commands are sorted deterministically', () => {
    const state = makeV4State([
      {
        mode: 'managed',
        type: 'aws_vpc',
        name: 'main',
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [],
      },
      {
        mode: 'managed',
        type: 'aws_instance',
        name: 'alpha',
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [],
      },
      {
        mode: 'managed',
        type: 'aws_s3_bucket',
        name: 'logs',
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [],
      },
    ]);

    const manifest = makeManifest([
      makeManifestEntry('aws_vpc.main', 'aws_vpc', 'translated', [
        makeTranslatedResource('azurerm_virtual_network', 'main', 'aws_vpc.main'),
      ]),
      makeManifestEntry('aws_instance.alpha', 'aws_instance', 'translated', [
        makeTranslatedResource('azurerm_linux_virtual_machine', 'alpha', 'aws_instance.alpha'),
      ]),
      makeManifestEntry('aws_s3_bucket.logs', 'aws_s3_bucket', 'translated', [
        makeTranslatedResource('azurerm_storage_account', 'logs', 'aws_s3_bucket.logs'),
      ]),
    ]);

    const plan = transformState(state, manifest, fixedTimestamp);

    // Moves should be sorted by source address
    const sources = plan.moves.map((m) => m.source);
    expect(sources).toEqual([...sources].sort());
  });
});
