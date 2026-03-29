# Phase 4 — Unattended Proven Subsets

## Goal

Enable fully automated operation only for a narrow, explicitly supported subset of migration scenarios that have strong semantic evidence and validation coverage.

## Why this phase is last

Unattended automation should be the result of accumulated proof, not an optimistic feature flag. This phase is only credible once semantic contracts, scenario validation, and guarded automation gates already exist.

## Scope

Define and implement a constrained unattended subset such as:

- approved public web app blueprint
- approved private service blueprint
- approved worker blueprint
- approved managed database attachment pattern
- approved object storage blueprint

Only scenario classes with strong fixture coverage and no unresolved semantic ambiguity should enter this mode.

## Deliverables

### 1. Supported unattended scenario catalogue

Create a machine-readable catalogue of unattended-eligible scenarios with:

- supported source shapes
- required target blueprint
- forbidden features
- required confidence thresholds
- required semantic thresholds
- required policy/compliance results

### 2. Unattended execution policy

Define a policy that forbids unattended execution when:

- generic fallback is used
- any blocker exists
- any required validator fails
- confidence is below threshold
- semantic score is below threshold
- review-critical domains are unresolved
- unsupported features are present

### 3. Deployability status and rollback metadata

Unattended output should include:

- explicit deployability status
- execution provenance
- scenario class
- rollback / remediation metadata
- audit-quality decision record

### 4. CI / benchmark proof for unattended subsets

Every unattended scenario class should have:

- stable golden fixtures
- deterministic output checks
- repeated validation pass evidence
- cost and compliance threshold evidence

## Workstreams

### Workstream A — Scenario eligibility engine

Implement the eligibility check that decides whether a translated workload belongs to a proven unattended subset.

### Workstream B — Unattended runtime contract

Define what the system guarantees before automatic continuation is allowed.

### Workstream C — Proven subset benchmarks

Add repeatable benchmark and soak-style validation for unattended scenario classes.

### Workstream D — Operational safety controls

Add safety controls for:

- auditability
- dry-run-only mode
- explicit apply/no-apply boundaries
- rollback instruction generation

## Acceptance criteria

- unattended mode is available only for named supported scenario classes
- unsupported workloads are deterministically downgraded to guarded mode or assisted mode
- no generic fallback path is allowed in unattended mode
- all unattended scenario classes have golden fixtures and repeated validation evidence
- unattended decisions emit a complete audit-quality reason trail

## Out of scope

- arbitrary unattended migration of all AWS Terraform
- long-tail unsupported services
- bypassing guarded mode for scenarios without proof coverage

## Risks

- pressure to over-broaden unattended eligibility too early
- misclassification of scenarios into the unattended subset
- insufficient rollback / remediation metadata for operational use

## Exit condition

Phase 4 is complete when TLA can fully automate a constrained set of high-confidence workload classes and can also prove why anything outside that set is not eligible.
