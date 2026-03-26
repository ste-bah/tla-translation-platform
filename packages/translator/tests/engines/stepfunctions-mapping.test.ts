/**
 * Tests for structural/stepfunctions-mapping.ts
 *
 * Covers:
 * - aws_sfn_state_machine -> Azure: azurerm_logic_app_workflow
 * - aws_sfn_state_machine -> GCP:   google_workflows_workflow
 * - SFN_DEFINITION_MANUAL warning always emitted (ASL not in output)
 * - STRUCTURAL_TOPOLOGY info finding always emitted
 * - ASL definition content never in translated attributes
 * - role_arn -> SystemAssigned managed identity (Azure) / service_account ref (GCP)
 * - SFN_ROLE_ARN info finding when role_arn present
 * - SFN_TRACING info when tracing_configuration.enabled=true
 * - SFN_LOGGING info when logging_configuration present
 * - SFN_EXPRESS_TYPE warning for EXPRESS state machines
 * - Tags propagated for both providers
 * - Dispatch via structural engine
 *
 * @module tests/engines/stepfunctions-mapping
 */

import { describe, it, expect, vi } from 'vitest';
import { translateStepFunctions } from '../../src/engines/structural/stepfunctions-mapping.js';
import { structuralEngine } from '../../src/engines/structural-engine.js';
import type { TranslationContext } from '../../src/engines/mapping-engine.js';
import type {
  IrResource,
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
    id: 'res-sfn-001',
    sourceType: 'aws_sfn_state_machine',
    sourceName: 'my_state_machine',
    sourceModule: null,
    category: 'compute',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: 'SER-COMPUTE-SFN-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-COMPUTE-SFN-001',
    aws_service: 'aws_sfn_state_machine',
    aws_family: 'compute',
    azure_targets: ['azurerm_logic_app_workflow'],
    gcp_targets: ['google_workflows_workflow'],
    mapping_type: 'structural',
    output_mode: 'native_emit_only',
    band: 'S1',
    confidence: 0.7,
    portable_provider_candidate: false,
    behavioral_gaps: [],
    manual_review_required: true,
    review_domains: ['logic', 'execution'],
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

function makeCompilerOptions(provider: CloudProvider = 'azure'): CompilerOptions {
  return {
    targetProvider: provider,
    registryVersion: '2025.03.01',
    emitComments: true,
    sortKeys: true,
  };
}

function makeCtx(
  attrs: Record<string, unknown> = {},
  provider: CloudProvider = 'azure',
): TranslationContext {
  const resource = makeIrResource({ attributes: attrs });
  const entry = makeRegistryEntry();
  return {
    targetProvider: provider,
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
    options: makeCompilerOptions(provider),
  };
}

// ---------------------------------------------------------------------------
// A. Azure translation
// ---------------------------------------------------------------------------

describe('translateStepFunctions — Azure', () => {
  it('A1: emits 1 azurerm_logic_app_workflow resource', () => {
    const result = translateStepFunctions(makeCtx({}, 'azure'));
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_logic_app_workflow');
  });

  it('A2: resource name matches sourceName', () => {
    const ctx = makeCtx({ name: 'my_workflow' }, 'azure');
    const result = translateStepFunctions(ctx);
    expect(result.translated[0]!.attributes['name']).toBe('my_workflow');
  });

  it('A3: always emits SFN_DEFINITION_MANUAL warning', () => {
    const result = translateStepFunctions(makeCtx({}, 'azure'));
    const finding = result.findings.find((f) => f.code === 'SFN_DEFINITION_MANUAL');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
    expect(finding!.message).toContain('ASL');
  });

  it('A4: always emits STRUCTURAL_TOPOLOGY info', () => {
    const result = translateStepFunctions(makeCtx({}, 'azure'));
    const finding = result.findings.find((f) => f.code === 'STRUCTURAL_TOPOLOGY');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
  });

  it('A5: ASL definition content never in translated attributes', () => {
    const aslContent = '{"Comment":"My state machine","StartAt":"HelloWorld","States":{}}';
    const result = translateStepFunctions(makeCtx({ definition: aslContent }, 'azure'));
    const attrsJson = JSON.stringify(result.translated.map((t) => t.attributes));
    expect(attrsJson).not.toContain('HelloWorld');
    expect(attrsJson).not.toContain('"definition"');
  });

  it('A6: role_arn triggers SystemAssigned managed identity', () => {
    const result = translateStepFunctions(
      makeCtx({ role_arn: 'arn:aws:iam::123:role/StepFunctionsRole' }, 'azure'),
    );
    const identity = result.translated[0]!.attributes['identity'] as Record<string, unknown>;
    expect(identity).toBeDefined();
    expect(identity['type']).toBe('SystemAssigned');
  });

  it('A7: no identity block when role_arn absent', () => {
    const result = translateStepFunctions(makeCtx({}, 'azure'));
    expect(result.translated[0]!.attributes['identity']).toBeUndefined();
  });

  it('A8: emits SFN_ROLE_ARN info when role_arn present', () => {
    const result = translateStepFunctions(
      makeCtx({ role_arn: 'arn:aws:iam::123:role/Role' }, 'azure'),
    );
    const finding = result.findings.find((f) => f.code === 'SFN_ROLE_ARN');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.message).toContain('managed identity');
  });

  it('A9: no SFN_ROLE_ARN when role_arn absent', () => {
    const result = translateStepFunctions(makeCtx({}, 'azure'));
    expect(result.findings.some((f) => f.code === 'SFN_ROLE_ARN')).toBe(false);
  });

  it('A10: emits SFN_TRACING info when tracing enabled', () => {
    const result = translateStepFunctions(
      makeCtx({ tracing_configuration: { enabled: true } }, 'azure'),
    );
    const finding = result.findings.find((f) => f.code === 'SFN_TRACING');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.message).toContain('X-Ray');
  });

  it('A11: no SFN_TRACING when tracing disabled', () => {
    const result = translateStepFunctions(
      makeCtx({ tracing_configuration: { enabled: false } }, 'azure'),
    );
    expect(result.findings.some((f) => f.code === 'SFN_TRACING')).toBe(false);
  });

  it('A12: emits SFN_LOGGING info when logging_configuration present', () => {
    const result = translateStepFunctions(
      makeCtx(
        {
          logging_configuration: {
            level: 'ALL',
            log_destination: 'arn:aws:logs:us-east-1:123:log-group:my-group:*',
          },
        },
        'azure',
      ),
    );
    const finding = result.findings.find((f) => f.code === 'SFN_LOGGING');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
  });

  it('A13: emits SFN_EXPRESS_TYPE warning for EXPRESS state machines', () => {
    const result = translateStepFunctions(makeCtx({ type: 'EXPRESS' }, 'azure'));
    const finding = result.findings.find((f) => f.code === 'SFN_EXPRESS_TYPE');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
  });

  it('A14: no SFN_EXPRESS_TYPE for STANDARD state machines', () => {
    const result = translateStepFunctions(makeCtx({ type: 'STANDARD' }, 'azure'));
    expect(result.findings.some((f) => f.code === 'SFN_EXPRESS_TYPE')).toBe(false);
  });

  it('A15: propagates tags', () => {
    const result = translateStepFunctions(
      makeCtx({ tags: { env: 'prod', team: 'data' } }, 'azure'),
    );
    const tags = result.translated[0]!.attributes['tags'] as Record<string, string>;
    expect(tags['env']).toBe('prod');
    expect(tags['team']).toBe('data');
  });

  it('A16: traceability engine is structural/stepfunctions', () => {
    const result = translateStepFunctions(makeCtx({}, 'azure'));
    expect(result.translated[0]!.traceability.engineUsed).toBe('structural/stepfunctions');
    expect(result.translated[0]!.traceability.mappingType).toBe('structural');
  });

  it('A17: resource_group_name is present', () => {
    const result = translateStepFunctions(makeCtx({}, 'azure'));
    expect(result.translated[0]!.attributes['resource_group_name']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// B. GCP translation
// ---------------------------------------------------------------------------

describe('translateStepFunctions — GCP', () => {
  it('B1: emits 1 google_workflows_workflow resource', () => {
    const result = translateStepFunctions(makeCtx({}, 'gcp'));
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_workflows_workflow');
  });

  it('B2: always emits SFN_DEFINITION_MANUAL warning (GCP)', () => {
    const result = translateStepFunctions(makeCtx({}, 'gcp'));
    const finding = result.findings.find((f) => f.code === 'SFN_DEFINITION_MANUAL');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
  });

  it('B3: always emits STRUCTURAL_TOPOLOGY info (GCP)', () => {
    const result = translateStepFunctions(makeCtx({}, 'gcp'));
    const finding = result.findings.find((f) => f.code === 'STRUCTURAL_TOPOLOGY');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.message).toContain('GCP');
  });

  it('B4: source_contents contains TODO placeholder, not ASL content', () => {
    const aslContent = '{"StartAt":"Step1","States":{}}';
    const result = translateStepFunctions(makeCtx({ definition: aslContent }, 'gcp'));
    const sourceContents = result.translated[0]!.attributes['source_contents'] as string;
    expect(sourceContents).toContain('TODO');
    expect(sourceContents).not.toContain('Step1');
    expect(sourceContents).not.toContain(aslContent);
  });

  it('B5: service_account references workflows_sa', () => {
    const result = translateStepFunctions(makeCtx({}, 'gcp'));
    const sa = result.translated[0]!.attributes['service_account'] as string;
    expect(sa).toContain('google_service_account');
    expect(sa).toContain('workflows_sa');
  });

  it('B6: emits SFN_ROLE_ARN info when role_arn present (GCP)', () => {
    const result = translateStepFunctions(
      makeCtx({ role_arn: 'arn:aws:iam::123:role/Role' }, 'gcp'),
    );
    const finding = result.findings.find((f) => f.code === 'SFN_ROLE_ARN');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.message).toContain('service_account');
  });

  it('B7: emits SFN_TRACING info when tracing enabled (GCP)', () => {
    const result = translateStepFunctions(
      makeCtx({ tracing_configuration: { enabled: true } }, 'gcp'),
    );
    const finding = result.findings.find((f) => f.code === 'SFN_TRACING');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.message).toContain('Cloud Trace');
  });

  it('B8: emits SFN_LOGGING info when logging_configuration present (GCP)', () => {
    const result = translateStepFunctions(
      makeCtx({ logging_configuration: { level: 'ALL' } }, 'gcp'),
    );
    const finding = result.findings.find((f) => f.code === 'SFN_LOGGING');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.message).toContain('Cloud Logging');
  });

  it('B9: emits SFN_EXPRESS_TYPE warning for EXPRESS (GCP)', () => {
    const result = translateStepFunctions(makeCtx({ type: 'EXPRESS' }, 'gcp'));
    const finding = result.findings.find((f) => f.code === 'SFN_EXPRESS_TYPE');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
  });

  it('B10: propagates tags as labels', () => {
    const result = translateStepFunctions(
      makeCtx({ tags: { team: 'platform' } }, 'gcp'),
    );
    const labels = result.translated[0]!.attributes['labels'] as Record<string, string>;
    expect(labels['team']).toBe('platform');
  });

  it('B11: region is ${var.region}', () => {
    const result = translateStepFunctions(makeCtx({}, 'gcp'));
    expect(result.translated[0]!.attributes['region']).toBe('${var.region}');
  });
});

// ---------------------------------------------------------------------------
// C. Invariants
// ---------------------------------------------------------------------------

describe('invariants', () => {
  const providers: CloudProvider[] = ['azure', 'gcp'];

  for (const provider of providers) {
    it(`${provider}: always produces exactly 1 translated resource`, () => {
      const result = translateStepFunctions(makeCtx({}, provider));
      expect(result.translated).toHaveLength(1);
    });

    it(`${provider}: SFN_DEFINITION_MANUAL always emitted`, () => {
      const result = translateStepFunctions(makeCtx({}, provider));
      expect(result.findings.some((f) => f.code === 'SFN_DEFINITION_MANUAL')).toBe(true);
    });

    it(`${provider}: ASL definition never in translated output`, () => {
      const sensitiveAsl = '{"Comment":"Secret logic","StartAt":"SecretStep","States":{}}';
      const result = translateStepFunctions(makeCtx({ definition: sensitiveAsl }, provider));
      const fullOutput = JSON.stringify(result.translated);
      expect(fullOutput).not.toContain('SecretStep');
      expect(fullOutput).not.toContain('Secret logic');
    });

    it(`${provider}: all findings have valid severity`, () => {
      const result = translateStepFunctions(
        makeCtx(
          {
            name: 'test-machine',
            definition: '{}',
            role_arn: 'arn:aws:iam::123:role/Role',
            type: 'EXPRESS',
            logging_configuration: { level: 'ALL' },
            tracing_configuration: { enabled: true },
            tags: { env: 'test' },
          },
          provider,
        ),
      );
      for (const finding of result.findings) {
        expect(['info', 'warning', 'blocker']).toContain(finding.severity);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// D. Structural engine dispatch
// ---------------------------------------------------------------------------

describe('structural engine dispatch', () => {
  it('D1: dispatches aws_sfn_state_machine to Azure Logic App', () => {
    const ctx = makeCtx({}, 'azure');
    const result = structuralEngine.translate(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('azurerm_logic_app_workflow');
  });

  it('D2: dispatches aws_sfn_state_machine to GCP Workflows', () => {
    const ctx = makeCtx({}, 'gcp');
    const result = structuralEngine.translate(ctx);
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_workflows_workflow');
  });

  it('D3: dispatch result includes SFN_DEFINITION_MANUAL finding', () => {
    const ctx = makeCtx({ definition: '{"StartAt":"S1","States":{}}' }, 'azure');
    const result = structuralEngine.translate(ctx);
    expect(result.findings.some((f) => f.code === 'SFN_DEFINITION_MANUAL')).toBe(true);
  });
});
