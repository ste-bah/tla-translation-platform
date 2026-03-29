# Phase 3 — Guarded Automation

## Goal

Introduce safe semi-automated execution by adding hard decision gates, blueprint-driven output, and approval boundaries.

## Why this phase matters

The platform should not jump from assisted migration directly to unattended execution. The intermediate step is guarded automation: the system does the heavy lifting automatically, but pauses whenever evidence is insufficient.

## Scope

Build automation control around the proven semantic and scenario foundations from phases 1 and 2.

## Deliverables

### 1. Execution modes

Add explicit operating modes:

- **Assisted mode** — current review-led workflow
- **Guarded auto mode** — automatic translate + validate + classify, then pause on uncertainty
- **Unattended mode** — reserved for phase 4 proven subsets only

### 2. Decision gates

Guarded automation should stop or require approval when any of the following are true:

- blocker findings exist
- scenario validators fail
- semantic score falls below threshold
- confidence score falls below threshold
- compliance fails
- policy fails
- degraded behaviour exceeds allowed tolerance
- generic fallback is used in a restricted domain
- cost delta exceeds configured band

### 3. Blueprint-driven output

Constrain automation by generating into approved target patterns such as:

- public web app blueprint
- private service blueprint
- worker blueprint
- managed database blueprint
- object storage blueprint

This reduces arbitrary output shape and makes unattended execution more realistic.

### 4. Approval artefacts

Generate an automation decision pack containing:

- scenario classification
- gate results
- preserved / transformed / degraded summary
- approval recommendation
- deployability status
- remediation tasks

## Workstreams

### Workstream A — Automation policy engine

Define the gate model and per-mode thresholds.

### Workstream B — Blueprint catalogue

Create target-cloud blueprint families that the compiler can select or map into.

### Workstream C — Decision reporting

Add machine-readable and human-readable automation decision artefacts.

### Workstream D — CLI / MCP mode support

Expose guarded mode through CLI and MCP with a stable contract.

Suggested future CLI shape:

```bash
npx tla translate ./source --target azure --mode guarded-auto
```

## Acceptance criteria

- guarded mode exists as a first-class execution mode
- all major validation gates are enforced before approval is granted
- blueprint-based generation is available for core scenario families
- approval artefacts explain exactly why a translation is approved, paused, or blocked
- generic fallback can be forbidden in guarded mode for selected domains

## Out of scope

- unattended apply to live infrastructure
- automatic execution for unproven scenario classes
- fully open-ended arbitrary target generation in guarded mode

## Risks

- false confidence from poorly tuned thresholds
- blueprint drift between code generation and validation assumptions
- overly strict gates making guarded automation unusable

## Exit condition

Phase 3 is complete when TLA can automatically translate and validate a workload, then deterministically decide whether it is safe to proceed, safe only with approval, or blocked pending remediation.
