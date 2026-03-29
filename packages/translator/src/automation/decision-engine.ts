import type { TranslationManifest } from '@tla/shared';
import type { ScenarioValidationReport } from '@tla/validator';

export type AutomationMode = 'assisted' | 'guarded-auto' | 'unattended';
export type AutomationDecisionStatus = 'approved' | 'approval_required' | 'blocked' | 'not_eligible';

export interface AutomationDecision {
  readonly mode: AutomationMode;
  readonly status: AutomationDecisionStatus;
  readonly reasons: string[];
  readonly summary: {
    blockers: number;
    advisory: number;
    partial: number;
    confidenceOverall: number;
    fallbackResources: number;
    reviewRequiredContracts: number;
    degradedContracts: number;
    scenarioWarnings: number;
    scenarioBlockers: number;
  };
}

export interface AutomationDecisionInput {
  readonly mode: AutomationMode;
  readonly manifest: TranslationManifest;
  readonly scenarioReport?: ScenarioValidationReport;
  readonly confidenceOverall?: number;
  readonly allowGenericFallback?: boolean;
}

function countFallbackResources(manifest: TranslationManifest): number {
  return manifest.entries.filter((entry) => entry.targetResources.some((r) => r.traceability.translationPath === 'generic-fallback')).length;
}

function countReviewRequiredContracts(manifest: TranslationManifest): number {
  return manifest.entries.filter((entry) => (entry.contract?.reviewRequired.length ?? 0) > 0).length;
}

function countDegradedContracts(manifest: TranslationManifest): number {
  return manifest.entries.filter((entry) => (entry.contract?.degraded.length ?? 0) > 0).length;
}

/**
 * Evaluate whether a translation result qualifies for automated progression.
 *
 * Decision logic:
 * - assisted mode: always approved (human-driven workflow)
 * - guarded-auto: approved only when zero blockers, zero degraded contracts,
 *   zero review-required contracts, zero generic fallbacks, confidence >= 0.75
 * - unattended: same gates as guarded-auto but status is 'not_eligible' instead
 *   of 'approval_required' when gates fail
 *
 * @param input - Mode, manifest, optional scenario report and confidence override.
 * @returns Machine-readable decision with status, reasons, and summary counts.
 */
export function evaluateAutomationDecision(input: AutomationDecisionInput): AutomationDecision {
  const confidenceOverall = input.confidenceOverall ?? input.manifest.confidenceOverall;
  const fallbackResources = countFallbackResources(input.manifest);
  const reviewRequiredContracts = countReviewRequiredContracts(input.manifest);
  const degradedContracts = countDegradedContracts(input.manifest);
  const scenarioWarnings = input.scenarioReport?.summary.warnings ?? 0;
  const scenarioBlockers = input.scenarioReport?.summary.blockers ?? 0;

  const summary = {
    blockers: input.manifest.counts.blocked,
    advisory: input.manifest.counts.advisory,
    partial: input.manifest.counts.partial,
    confidenceOverall,
    fallbackResources,
    reviewRequiredContracts,
    degradedContracts,
    scenarioWarnings,
    scenarioBlockers,
  };

  if (input.mode === 'assisted') {
    return { mode: input.mode, status: 'approved', reasons: ['assisted_mode'], summary };
  }

  const reasons: string[] = [];

  if (summary.blockers > 0) reasons.push('manifest_blockers');
  if (summary.scenarioBlockers > 0) reasons.push('scenario_blockers');

  if (reasons.length > 0) {
    return { mode: input.mode, status: 'blocked', reasons, summary };
  }

  if (summary.advisory > 0) reasons.push('advisory_entries');
  if (summary.partial > 0) reasons.push('partial_entries');
  if (summary.reviewRequiredContracts > 0) reasons.push('contract_review_required');
  if (summary.degradedContracts > 0) reasons.push('contract_degraded');
  if (!input.allowGenericFallback && summary.fallbackResources > 0) reasons.push('generic_fallback_present');
  if (summary.scenarioWarnings > 0) reasons.push('scenario_warnings');
  if (summary.confidenceOverall < 0.75) reasons.push('confidence_below_threshold');

  if (reasons.length > 0) {
    return {
      mode: input.mode,
      status: input.mode === 'unattended' ? 'not_eligible' : 'approval_required',
      reasons,
      summary,
    };
  }

  return { mode: input.mode, status: 'approved', reasons: ['all_gates_passed'], summary };
}
