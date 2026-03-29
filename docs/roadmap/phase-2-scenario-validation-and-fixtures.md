# Phase 2 — Scenario Validation and Golden Fixtures

## Goal

Move validation from largely per-resource checks to scenario-aware validation for compound workload shapes.

## Why this phase matters

Real migration risk lives in workload combinations, not isolated resources. A believable automation story requires validators and fixtures that understand whole workload shapes and the behaviours they imply.

## Scope

Build golden scenario coverage for the highest-value end-to-end shapes:

- public web application
- private internal service
- worker / batch fleet
- stateful application with managed database
- event-driven application
- hybrid network-connected application

## Deliverables

### 1. Scenario validators

Add cross-resource validators for:

- ingress exposure posture
- subnet and network isolation posture
- encryption coverage
- backup / restore coverage
- HA / failover posture
- identity boundary correctness
- autoscaling intent preservation
- lifecycle / retention coverage

### 2. Golden fixtures

Create realistic end-to-end fixtures for both Azure and GCP target paths.

Suggested baseline fixtures:

- EC2 + subnet + SG + IAM profile + EBS
- ALB + listener + target group + autoscaling
- RDS + subnet group + backups + encryption
- S3 + lifecycle + logging + website + encryption
- Lambda + triggers + networking + IAM
- NAT / routing / private subnet service topology

### 3. Expected contract snapshots

For each golden fixture, assert:

- generated HCL files
- manifest output
- translation contracts
- blocker / warning expectations
- semantic score range
- confidence score range
- deterministic output hashes where appropriate

### 4. Scenario-level reports

Add reporting that groups findings by scenario rather than by resource only.

## Workstreams

### Workstream A — Scenario model

Define a scenario abstraction that groups related resources into a workload shape with explicit expected behaviour.

### Workstream B — Validator library

Implement validators that operate over grouped topology and contract metadata.

### Workstream C — Fixture harness

Create a fixture runner that can:

- ingest source Terraform fixtures
- run translation
- run validation
- compare against expected contract / manifest / score snapshots

### Workstream D — Regression tracking

Add regression dashboards or summary output for:

- scenario pass/fail counts
- degraded behaviour counts
- blocker counts
- determinism breaks

## Acceptance criteria

- at least 6 golden scenario families exist
- scenario validators are wired into the validation suite
- end-to-end fixture tests assert contracts, findings, and confidence ranges
- regressions in major workload shapes are visible in CI output
- major supported scenarios can be evaluated as whole workload shapes rather than loose resource sets

## Out of scope

- unattended deployment execution
- approval workflow logic
- broad support expansion without scenario coverage

## Risks

- fixtures becoming too synthetic to reflect real migration workloads
- brittle snapshot tests with low semantic value
- scenario grouping logic becoming opaque or non-deterministic

## Exit condition

Phase 2 is complete when the platform can prove that major workload shapes behave as expected across translation, validation, and reporting — not just that individual resources were emitted.
