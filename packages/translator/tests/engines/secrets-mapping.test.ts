import { describe, it, expect, vi } from 'vitest';
import { translateSecrets, translateSecretVersion } from '../../src/engines/parametric/secrets-mapping.js';
import { parametricEngine } from '../../src/engines/parametric-engine.js';
import type { TranslationContext } from '../../src/engines/mapping-engine.js';
import type {
  IrResource,
  RegistryEntry,
  CanonicalIR,
  CloudProvider,
  CompilerOptions,
  BehavioralGap,
} from '@tla/shared';
import type { RegistryApi } from '@tla/registry';

// ---------------------------------------------------------------------------
// Factory helpers (mirroring parametric-engine.test.ts)
// ---------------------------------------------------------------------------

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'res-secret-001',
    sourceType: 'aws_secretsmanager_secret',
    sourceName: 'my_secret',
    sourceModule: null,
    category: 'security',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: 'SER-SEC-SECRETS-001',
    translationStatus: 'pending',
    confidence: 0,
    tags: {},
    sourceLocation: { file: 'main.tf', line: 1, column: 0 },
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    registry_entry_id: 'SER-SEC-SECRETS-001',
    aws_service: 'aws_secretsmanager_secret',
    aws_family: 'security',
    azure_targets: ['azurerm_key_vault_secret'],
    gcp_targets: ['google_secret_manager_secret'],
    mapping_type: 'parametric',
    output_mode: 'native_emit_only',
    band: 'P2',
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

// ---------------------------------------------------------------------------
// A. translateSecrets enhancements
// ---------------------------------------------------------------------------

describe('translateSecrets enhancements', () => {
  // -- A1: SECRET_CMEK info when kms_key_id present (Azure) --
  describe('SECRET_CMEK', () => {
    it('A1: should emit SECRET_CMEK info when kms_key_id present (Azure)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { kms_key_id: 'arn:aws:kms:us-east-1:123:key/abc' },
        }),
      });

      const result = translateSecrets(ctx);
      const finding = result.findings.find((f) => f.code === 'SECRET_CMEK');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('info');
      expect(finding!.message).toContain('Azure');
    });

    // -- A2: SECRET_CMEK info when kms_key_id present (GCP) --
    it('A2: should emit SECRET_CMEK info when kms_key_id present (GCP)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          attributes: { kms_key_id: 'arn:aws:kms:us-east-1:123:key/abc' },
        }),
      });

      const result = translateSecrets(ctx);
      const finding = result.findings.find((f) => f.code === 'SECRET_CMEK');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('info');
      expect(finding!.message).toContain('GCP');
    });

    // -- A10 partial: no CMEK finding when attr absent --
    it('A10a: should not emit SECRET_CMEK when kms_key_id absent', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: {} }),
      });

      const result = translateSecrets(ctx);
      expect(result.findings.some((f) => f.code === 'SECRET_CMEK')).toBe(false);
    });
  });

  // -- A3/A4: SECRET_RECOVERY_WINDOW --
  describe('SECRET_RECOVERY_WINDOW', () => {
    it('A3: should emit SECRET_RECOVERY_WINDOW info when recovery_window_in_days present (Azure)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { recovery_window_in_days: 30 },
        }),
      });

      const result = translateSecrets(ctx);
      const finding = result.findings.find((f) => f.code === 'SECRET_RECOVERY_WINDOW');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('info');
      expect(finding!.message).toContain('Azure');
    });

    it('A4: should emit SECRET_RECOVERY_WINDOW info when recovery_window_in_days present (GCP)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          attributes: { recovery_window_in_days: 7 },
        }),
      });

      const result = translateSecrets(ctx);
      const finding = result.findings.find((f) => f.code === 'SECRET_RECOVERY_WINDOW');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('info');
      expect(finding!.message).toContain('GCP');
    });

    it('A10b: should not emit SECRET_RECOVERY_WINDOW when absent', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: {} }),
      });

      const result = translateSecrets(ctx);
      expect(result.findings.some((f) => f.code === 'SECRET_RECOVERY_WINDOW')).toBe(false);
    });
  });

  // -- A5/A6: SECRET_POLICY --
  describe('SECRET_POLICY', () => {
    it('A5: should emit SECRET_POLICY warning when policy present (Azure)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { policy: '{"Version":"2012-10-17","Statement":[]}' },
        }),
      });

      const result = translateSecrets(ctx);
      const finding = result.findings.find((f) => f.code === 'SECRET_POLICY');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('warning');
      expect(finding!.message).toContain('Azure');
    });

    it('A6: should emit SECRET_POLICY warning when policy present (GCP)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          attributes: { policy: '{"Version":"2012-10-17","Statement":[]}' },
        }),
      });

      const result = translateSecrets(ctx);
      const finding = result.findings.find((f) => f.code === 'SECRET_POLICY');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('warning');
      expect(finding!.message).toContain('GCP');
    });

    // -- A9: policy content NEVER in translated attributes --
    it('A9: should not include policy content in translated attributes (Azure)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: { policy: '{"secret":"dangerous"}' },
        }),
      });

      const result = translateSecrets(ctx);
      const allAttrs = JSON.stringify(result.translated.map((t) => t.attributes));
      expect(allAttrs).not.toContain('dangerous');
      expect(allAttrs).not.toContain('"policy"');
    });

    it('A9: should not include policy content in translated attributes (GCP)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({
          attributes: { policy: '{"secret":"dangerous"}' },
        }),
      });

      const result = translateSecrets(ctx);
      const allAttrs = JSON.stringify(result.translated.map((t) => t.attributes));
      expect(allAttrs).not.toContain('dangerous');
      expect(allAttrs).not.toContain('"policy"');
    });

    it('A10c: should not emit SECRET_POLICY when policy absent', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: {} }),
      });

      const result = translateSecrets(ctx);
      expect(result.findings.some((f) => f.code === 'SECRET_POLICY')).toBe(false);
    });
  });

  // -- A7/A8: SECRET_RBAC always emitted --
  describe('SECRET_RBAC', () => {
    it('A7: should always emit SECRET_RBAC warning (Azure)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: {} }),
      });

      const result = translateSecrets(ctx);
      const finding = result.findings.find((f) => f.code === 'SECRET_RBAC');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('warning');
      expect(finding!.message).toContain('Azure');
    });

    it('A8: should always emit SECRET_RBAC warning (GCP)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'gcp',
        resource: makeIrResource({ attributes: {} }),
      });

      const result = translateSecrets(ctx);
      const finding = result.findings.find((f) => f.code === 'SECRET_RBAC');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('warning');
      expect(finding!.message).toContain('GCP');
    });

    it('A7b: SECRET_RBAC emitted even when all optional attrs present (Azure)', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({
          attributes: {
            name: 'test',
            kms_key_id: 'key',
            recovery_window_in_days: 7,
            policy: '{}',
            rotation_rules: {},
            tags: { env: 'prod' },
          },
        }),
      });

      const result = translateSecrets(ctx);
      expect(result.findings.filter((f) => f.code === 'SECRET_RBAC')).toHaveLength(1);
    });
  });

  // -- A10: no enhanced findings when attrs absent --
  describe('no findings when attrs absent', () => {
    it('A10: should emit no CMEK/RECOVERY/POLICY findings when those attrs are absent', () => {
      const ctx = makeTranslationContext({
        targetProvider: 'azure',
        resource: makeIrResource({ attributes: {} }),
      });

      const result = translateSecrets(ctx);
      const enhancedCodes = ['SECRET_CMEK', 'SECRET_RECOVERY_WINDOW', 'SECRET_POLICY'];
      for (const code of enhancedCodes) {
        expect(result.findings.some((f) => f.code === code)).toBe(false);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// B. translateSecretVersion -- Azure
// ---------------------------------------------------------------------------

describe('translateSecretVersion — Azure', () => {
  function makeVersionCtx(attrs: Record<string, unknown> = {}): TranslationContext {
    return makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        id: 'res-ver-001',
        sourceType: 'aws_secretsmanager_secret_version',
        sourceName: 'my_secret_version',
        attributes: attrs,
      }),
    });
  }

  // -- B1: translated is empty (0 resources) --
  it('B1: should produce 0 translated resources', () => {
    const result = translateSecretVersion(makeVersionCtx());
    expect(result.translated).toHaveLength(0);
  });

  // -- B2: SECRET_VERSION_MERGED info always emitted --
  it('B2: should emit SECRET_VERSION_MERGED info', () => {
    const result = translateSecretVersion(makeVersionCtx());
    const finding = result.findings.find((f) => f.code === 'SECRET_VERSION_MERGED');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.message).toContain('Azure Key Vault');
  });

  // -- B3: SECRET_BINARY info when secret_binary present --
  it('B3: should emit SECRET_BINARY info when secret_binary present', () => {
    const result = translateSecretVersion(makeVersionCtx({ secret_binary: 'base64data' }));
    const finding = result.findings.find((f) => f.code === 'SECRET_BINARY');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.message).toContain('Azure');
  });

  // -- B4: no SECRET_BINARY when absent --
  it('B4: should not emit SECRET_BINARY when secret_binary absent', () => {
    const result = translateSecretVersion(makeVersionCtx());
    expect(result.findings.some((f) => f.code === 'SECRET_BINARY')).toBe(false);
  });

  // -- B5: secret_string value NEVER in findings --
  it('B5: should never include secret_string value in findings', () => {
    const secretVal = 'super-secret-password-12345';
    const result = translateSecretVersion(makeVersionCtx({ secret_string: secretVal }));
    const allFindings = JSON.stringify(result.findings);
    expect(allFindings).not.toContain(secretVal);
  });

  // -- B6: unmapped attrs collected --
  it('B6: should collect unmapped attrs via MAPPED_KEYS_VERSION', () => {
    const result = translateSecretVersion(
      makeVersionCtx({ unknown_field: 'value', another: 42 }),
    );
    const unmapped = result.findings.filter((f) => f.code === 'UNMAPPED_ATTRIBUTE');
    expect(unmapped.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// C. translateSecretVersion -- GCP
// ---------------------------------------------------------------------------

describe('translateSecretVersion — GCP', () => {
  function makeVersionCtxGcp(
    attrs: Record<string, unknown> = {},
    siblingResources: IrResource[] = [],
  ): TranslationContext {
    const resource = makeIrResource({
      id: 'res-ver-gcp-001',
      sourceType: 'aws_secretsmanager_secret_version',
      sourceName: 'my_secret_version',
      attributes: attrs,
    });
    return makeTranslationContext({
      targetProvider: 'gcp',
      resource,
      siblingResources,
      ir: {
        version: '1.0.0',
        sourceProvider: 'aws',
        resources: [resource, ...siblingResources],
        relationships: [],
        modules: [],
        intents: [],
        metadata: {
          generatedAt: new Date().toISOString(),
          sourceFiles: ['main.tf'],
          toolVersion: '0.1.0',
        },
      } as CanonicalIR,
    });
  }

  // -- C1: emits 1 google_secret_manager_secret_version --
  it('C1: should emit 1 google_secret_manager_secret_version resource', () => {
    const result = translateSecretVersion(makeVersionCtxGcp());
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_secret_manager_secret_version');
  });

  // -- C2: secret_data = ${var.secret_value} --
  it('C2: should set secret_data to ${var.secret_value}', () => {
    const result = translateSecretVersion(makeVersionCtxGcp());
    expect(result.translated[0]!.attributes['secret_data']).toBe('${var.secret_value}');
  });

  // -- C3: parent ref via findSiblingByType — correct interpolation --
  it('C3: should use parent sibling for secret reference when found', () => {
    const parentSecret = makeIrResource({
      id: 'res-parent-001',
      sourceType: 'aws_secretsmanager_secret',
      sourceName: 'parent_secret',
    });
    const result = translateSecretVersion(makeVersionCtxGcp({}, [parentSecret]));
    expect(result.translated[0]!.attributes['secret']).toBe(
      '${google_secret_manager_secret.parent_secret.id}',
    );
  });

  // -- C4: fallback ref when no parent sibling --
  it('C4: should use default reference when no parent sibling found', () => {
    const result = translateSecretVersion(makeVersionCtxGcp());
    expect(result.translated[0]!.attributes['secret']).toBe(
      '${google_secret_manager_secret.main.id}',
    );
  });

  // -- C5: SECRET_VERSION_ORPHAN warning when no parent --
  it('C5: should emit SECRET_VERSION_ORPHAN warning when no parent found', () => {
    const result = translateSecretVersion(makeVersionCtxGcp());
    const finding = result.findings.find((f) => f.code === 'SECRET_VERSION_ORPHAN');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
    expect(finding!.message).toContain('default reference');
  });

  // -- C6: no SECRET_VERSION_ORPHAN when parent found --
  it('C6: should not emit SECRET_VERSION_ORPHAN when parent sibling exists', () => {
    const parentSecret = makeIrResource({
      id: 'res-parent-002',
      sourceType: 'aws_secretsmanager_secret',
      sourceName: 'found_parent',
    });
    const result = translateSecretVersion(makeVersionCtxGcp({}, [parentSecret]));
    expect(result.findings.some((f) => f.code === 'SECRET_VERSION_ORPHAN')).toBe(false);
  });

  // -- C7: SECRET_BINARY info when secret_binary present --
  it('C7: should emit SECRET_BINARY info when secret_binary present', () => {
    const result = translateSecretVersion(makeVersionCtxGcp({ secret_binary: 'binarydata' }));
    const finding = result.findings.find((f) => f.code === 'SECRET_BINARY');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.message).toContain('GCP');
  });

  // -- C8: secret_string value NEVER in attributes --
  it('C8: should never include secret_string value in translated attributes', () => {
    const secretVal = 'my-super-secret-password';
    const result = translateSecretVersion(
      makeVersionCtxGcp({ secret_string: secretVal }),
    );
    const allAttrs = JSON.stringify(result.translated.map((t) => t.attributes));
    expect(allAttrs).not.toContain(secretVal);
    // Should use placeholder instead
    expect(result.translated[0]!.attributes['secret_data']).toBe('${var.secret_value}');
  });

  // -- C9: traceability engine = parametric/secrets-version --
  it('C9: should set traceability engine to parametric/secrets-version', () => {
    const result = translateSecretVersion(makeVersionCtxGcp());
    expect(result.translated[0]!.traceability.engineUsed).toBe('parametric/secrets-version');
    expect(result.translated[0]!.traceability.mappingType).toBe('parametric');
  });
});

// ---------------------------------------------------------------------------
// D. Invariants
// ---------------------------------------------------------------------------

describe('invariants', () => {
  const providers: CloudProvider[] = ['azure', 'gcp'];

  for (const provider of providers) {
    describe(`${provider} — translateSecrets`, () => {
      it('all findings should be warning or info severity (never blocker)', () => {
        const ctx = makeTranslationContext({
          targetProvider: provider,
          resource: makeIrResource({
            attributes: {
              name: 'inv-secret',
              kms_key_id: 'key-123',
              recovery_window_in_days: 14,
              policy: '{}',
              rotation_rules: { automatically_after_days: 30 },
              tags: { env: 'test' },
            },
          }),
        });

        const result = translateSecrets(ctx);
        for (const finding of result.findings) {
          expect(['warning', 'info']).toContain(finding.severity);
          expect(finding.severity).not.toBe('blocker');
        }
      });

      it('translated resources should have correct targetType', () => {
        const ctx = makeTranslationContext({
          targetProvider: provider,
          resource: makeIrResource({ attributes: {} }),
        });

        const result = translateSecrets(ctx);
        expect(result.translated).toHaveLength(1);
        if (provider === 'azure') {
          expect(result.translated[0]!.targetType).toBe('azurerm_key_vault_secret');
        } else {
          expect(result.translated[0]!.targetType).toBe('google_secret_manager_secret');
        }
      });

      it('should use ${var.secret_value} placeholder, never literal secrets', () => {
        const ctx = makeTranslationContext({
          targetProvider: provider,
          resource: makeIrResource({
            attributes: { name: 'test-secret' },
          }),
        });

        const result = translateSecrets(ctx);
        const attrs = result.translated[0]!.attributes;
        if (provider === 'azure') {
          expect(attrs['value']).toBe('${var.secret_value}');
        }
        // GCP secret resource doesn't have a value field (that's in the version)
      });
    });

    describe(`${provider} — translateSecretVersion`, () => {
      it('all findings should be warning or info severity (never blocker)', () => {
        const ctx = makeTranslationContext({
          targetProvider: provider,
          resource: makeIrResource({
            id: 'res-inv-ver',
            sourceType: 'aws_secretsmanager_secret_version',
            sourceName: 'inv_version',
            attributes: {
              secret_string: 'literal-secret-value',
              secret_binary: 'binary-data',
              secret_id: 'ref-123',
              version_stages: ['AWSCURRENT'],
              unknown_attr: 'unmapped',
            },
          }),
        });

        const result = translateSecretVersion(ctx);
        for (const finding of result.findings) {
          expect(['warning', 'info']).toContain(finding.severity);
          expect(finding.severity).not.toBe('blocker');
        }
      });

      it('should never include literal secret values in output', () => {
        const secretString = 'password-should-not-leak';
        const secretBinary = 'binary-should-not-leak';
        const ctx = makeTranslationContext({
          targetProvider: provider,
          resource: makeIrResource({
            sourceType: 'aws_secretsmanager_secret_version',
            attributes: {
              secret_string: secretString,
              secret_binary: secretBinary,
            },
          }),
        });

        const result = translateSecretVersion(ctx);
        const fullOutput = JSON.stringify(result);
        expect(fullOutput).not.toContain(secretString);
        expect(fullOutput).not.toContain(secretBinary);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// E. Dispatch — parametric engine routes secret_version correctly
// ---------------------------------------------------------------------------

describe('parametric engine dispatch', () => {
  it('E1: should dispatch aws_secretsmanager_secret_version through parametric engine', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'gcp',
      resource: makeIrResource({
        sourceType: 'aws_secretsmanager_secret_version',
        sourceName: 'dispatch_test',
        attributes: {},
      }),
    });

    const result = parametricEngine.translate(ctx);
    // Should get a real result (not generic fallback)
    // GCP version should produce 1 translated resource
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.targetType).toBe('google_secret_manager_secret_version');
  });

  it('E1b: should dispatch aws_secretsmanager_secret_version to Azure (merged, 0 resources)', () => {
    const ctx = makeTranslationContext({
      targetProvider: 'azure',
      resource: makeIrResource({
        sourceType: 'aws_secretsmanager_secret_version',
        sourceName: 'dispatch_azure_test',
        attributes: {},
      }),
    });

    const result = parametricEngine.translate(ctx);
    expect(result.translated).toHaveLength(0);
    expect(result.findings.some((f) => f.code === 'SECRET_VERSION_MERGED')).toBe(true);
  });
});
