# Automation and Semantic Depth Roadmap

This roadmap defines the next four delivery phases required to take TLA from a strong assisted migration platform to a more deeply validated and increasingly automated system.

## Guiding principles

1. **Preserve behaviour, not just resources**
   Translation quality is measured by preserved operational behaviour, security posture, resilience, and lifecycle semantics.
2. **Automate only the proven subset**
   Unattended execution should only be available for scenarios with strong fixture coverage and hard validation gates.
3. **Prefer scenario confidence over per-resource confidence**
   Compound workload shapes are the real unit of migration risk.
4. **No silent degradation**
   Anything not preserved must be surfaced as a contract item, warning, blocker, or review task.

## Phase summary

- **Phase 1 — Semantic depth foundations**
  Add translation contracts, richer behaviour metadata, and deeper service-level semantics for the highest-value domains.
- **Phase 2 — Scenario validation and golden fixtures**
  Add workload-shape validators and golden end-to-end fixtures for compound migration scenarios.
- **Phase 3 — Guarded automation**
  Add decision gates, approval thresholds, and blueprint-driven target generation for safe semi-automated operation.
- **Phase 4 — Unattended proven subsets**
  Enable fully automated execution only for explicitly supported, validated, high-confidence scenario classes.

## Delivery model

Each phase has its own planning document under `docs/roadmap/`:

- `phase-1-semantic-depth-foundations.md`
- `phase-2-scenario-validation-and-fixtures.md`
- `phase-3-guarded-automation.md`
- `phase-4-unattended-proven-subsets.md`

## Success criteria for the overall programme

The roadmap should only be considered complete when TLA can:

- explain preserved vs transformed vs degraded behaviour for each translation unit
- validate compound workload shapes rather than isolated resources only
- gate automation through explicit policy, compliance, semantic, and confidence thresholds
- run unattended only on a constrained, documented, and heavily tested subset of scenarios
