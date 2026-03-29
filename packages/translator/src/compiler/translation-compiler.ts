import type {
  CanonicalIR,
  CompilerOptions,
  TranslatedResource,
  TranslationFinding,
  TranslationResult,
  TranslationManifest,
  ManifestEntry,
  TranslationStats,
  AuditLogger,
  TranslationContract,
} from '@tla/shared';
import {
  createComponentLogger,
  TranslationResultSchema,
} from '@tla/shared';
import type { RegistryApi } from '@tla/registry';
import { getEngine } from '../engines/index.js';
import { validateTopology } from '../engines/structural/topology-validator.js';
import type { TranslationContext } from '../engines/mapping-engine.js';
import { buildTranslationPlan } from './translation-planner.js';
import { assembleFiles } from './file-assembler.js';

const logger = createComponentLogger('translation-compiler');

/**
 * Orchestrates the full translation pipeline:
 * resolve -> plan -> emit -> assemble -> manifest.
 */
export class TranslationCompiler {
  private readonly audit: AuditLogger | undefined;

  constructor(private readonly registry: RegistryApi, audit?: AuditLogger) {
    this.audit = audit;
  }

  /**
   * Translates a Canonical IR into target-provider infrastructure code.
   *
   * @param ir - The source Canonical IR (never mutated)
   * @param options - Compiler options including target provider
   * @returns A validated TranslationResult
   * @throws {TranslationError} On unrecoverable errors
   */
  translate(ir: CanonicalIR, options: CompilerOptions): TranslationResult {
    const startTime = Date.now();

    logger.info(
      {
        resourceCount: ir.resources.length,
        targetProvider: options.targetProvider,
        registryVersion: options.registryVersion,
      },
      'Starting translation',
    );

    this.audit?.log('translation_start', {
      resourceCount: ir.resources.length,
      targetProvider: options.targetProvider,
      registryVersion: options.registryVersion,
    });

    // Phase 1: Plan
    const { plan, findings: planFindings, registryEntries } =
      buildTranslationPlan({
        ir,
        registry: this.registry,
        targetProvider: options.targetProvider,
      });

    const allFindings: TranslationFinding[] = [...planFindings];
    const allResources: TranslatedResource[] = [];
    const allContracts: TranslationContract[] = [];

    // Build resource lookup (do NOT mutate ir.resources)
    const resourceById = new Map(ir.resources.map((r) => [r.id, r]));

    // Phase 2: Emit (per-resource with error isolation)
    for (const item of plan.items) {
      if (item.status === 'blocked' || item.status === 'advisory') {
        continue;
      }

      const resource = resourceById.get(item.resourceId);
      if (!resource) continue;

      const entry = registryEntries.get(resource.sourceType);
      if (!entry) continue;

      try {
        const engine = getEngine(item.mappingType);

        // Gather relationships for this resource
        const relationships = ir.relationships.filter(
          (rel) => rel.from === resource.id || rel.to === resource.id,
        );

        const ctx: TranslationContext = {
          targetProvider: options.targetProvider,
          resource,
          registryEntry: entry,
          relationships,
          siblingResources: ir.resources.filter((r) => r.id !== resource.id),
          ir,
          registry: this.registry,
          options,
        };

        const result = engine.translate(ctx);
        allResources.push(...result.translated);
        allFindings.push(...result.findings);
        if (Array.isArray(result.contracts) && result.contracts.length > 0) {
          allContracts.push(...result.contracts);
        }

        this.audit?.log('engine_emit', {
          resourceId: resource.id,
          sourceType: resource.sourceType,
          mappingType: item.mappingType,
          translatedCount: result.translated.length,
          findingCount: result.findings.length,
          contractCount: result.contracts?.length ?? 0,
        });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Unknown engine error';
        allFindings.push({
          resourceId: resource.id,
          severity: 'blocker',
          code: 'ENGINE_ERROR',
          message: `Engine error translating ${resource.sourceType}: ${message}`,
        });
        logger.error(
          { resourceId: resource.id, error: message },
          'Engine error during translation',
        );
        this.audit?.log('engine_error', {
          resourceId: resource.id,
          sourceType: resource.sourceType,
          error: message,
        });
      }
    }

    // Phase 2.5: Post-translation topology validation
    const topologyResult = validateTopology(ir, allResources);
    allFindings.push(...topologyResult.findings);

    // Phase 3: Assemble files
    const fileMap = assembleFiles({
      targetProvider: options.targetProvider,
      resources: allResources,
      ir,
      options,
    });

    const files: Record<string, string> = {};
    for (const [name, content] of fileMap) {
      files[name] = content;
    }

    // Phase 4: Build manifest
    const manifest = this.buildManifest(
      ir,
      allResources,
      allFindings,
      allContracts,
      options,
    );

    // Phase 5: Build stats
    const durationMs = Date.now() - startTime;
    const stats = this.buildStats(ir, manifest, durationMs);

    logger.info(
      {
        translated: stats.translated,
        blocked: stats.blocked,
        durationMs: stats.durationMs,
      },
      'Translation complete',
    );

    this.audit?.log('translation_complete', {
      translated: stats.translated,
      expanded: stats.expanded,
      partial: stats.partial,
      blocked: stats.blocked,
      advisory: stats.advisory,
      durationMs: stats.durationMs,
      contractCount: allContracts.length,
    });

    // Validate output with Zod
    const result: TranslationResult = {
      target: options.targetProvider,
      resources: allResources,
      files,
      manifest,
      findings: allFindings,
      stats,
    };

    return TranslationResultSchema.parse(result);
  }

  /**
   * Builds the translation manifest from emit results.
   */
  private buildManifest(
    ir: CanonicalIR,
    resources: readonly TranslatedResource[],
    findings: readonly TranslationFinding[],
    contracts: readonly TranslationContract[],
    options: CompilerOptions,
  ): TranslationManifest {
    // Group resources and findings by source ID
    const resourcesBySource = new Map<string, TranslatedResource[]>();
    for (const r of resources) {
      const list = resourcesBySource.get(r.sourceId) ?? [];
      list.push(r);
      resourcesBySource.set(r.sourceId, list);
    }

    const findingsByResource = new Map<string, TranslationFinding[]>();
    for (const f of findings) {
      const list = findingsByResource.get(f.resourceId) ?? [];
      list.push(f);
      findingsByResource.set(f.resourceId, list);
    }

    const contractsByResource = new Map<string, TranslationContract>();
    for (const contract of contracts) {
      if (!contractsByResource.has(contract.sourceId)) {
        contractsByResource.set(contract.sourceId, contract);
      }
    }

    // Build manifest entries
    const counts = {
      total: ir.resources.length,
      translated: 0,
      expanded: 0,
      partial: 0,
      blocked: 0,
      advisory: 0,
    };

    const entries: ManifestEntry[] = [];
    let totalConfidence = 0;

    for (const irResource of ir.resources) {
      const targetResources = resourcesBySource.get(irResource.id) ?? [];
      const resourceFindings = findingsByResource.get(irResource.id) ?? [];
      const contract = contractsByResource.get(irResource.id) ?? null;

      const hasBlocker = resourceFindings.some((f) => f.severity === 'blocker');
      const hasTargets = targetResources.length > 0;

      let status: ManifestEntry['status'];
      if (hasBlocker && !hasTargets) {
        status = 'blocked';
      } else if (hasBlocker && hasTargets) {
        status = 'partial';
      } else if (targetResources.length > 1) {
        status = 'expanded';
      } else if (hasTargets) {
        status = 'translated';
      } else {
        status = 'advisory';
      }

      counts[status as keyof typeof counts]++;

      const confidence =
        targetResources.length > 0
          ? targetResources.reduce((sum, r) => sum + r.traceability.confidence, 0) /
            targetResources.length
          : 0;
      totalConfidence += confidence;

      entries.push({
        sourceId: irResource.id,
        sourceType: irResource.sourceType,
        status,
        targetResources,
        confidence,
        findings: resourceFindings,
        contract,
      });
    }

    const confidenceOverall =
      ir.resources.length > 0 ? totalConfidence / ir.resources.length : 0;

    // Count generic-fallback translations across all entries
    const allFindings = [...findings];
    let fallbackCount = 0;
    for (const entry of entries) {
      const hasFallback = entry.targetResources.some(
        (r) => r.traceability.translationPath === 'generic-fallback',
      );
      if (hasFallback) fallbackCount++;
    }
    if (fallbackCount > 0) {
      allFindings.push({
        resourceId: '__manifest__',
        severity: 'info',
        code: 'TRANSLATION_FALLBACK_SUMMARY',
        message: `${fallbackCount} of ${entries.length} resources translated via generic fallback — review recommended`,
      });
    }

    return {
      version: '1.0.0',
      registryVersion: options.registryVersion,
      target: options.targetProvider,
      counts,
      entries,
      findings: allFindings,
      confidenceOverall,
    };
  }

  /**
   * Builds translation statistics from the manifest.
   */
  private buildStats(
    ir: CanonicalIR,
    manifest: TranslationManifest,
    durationMs: number,
  ): TranslationStats {
    return {
      totalResources: ir.resources.length,
      translated: manifest.counts.translated,
      expanded: manifest.counts.expanded,
      partial: manifest.counts.partial,
      blocked: manifest.counts.blocked,
      advisory: manifest.counts.advisory,
      durationMs,
    };
  }
}
