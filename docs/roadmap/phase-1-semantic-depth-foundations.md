# Phase 1 — Semantic Depth Foundations

## Goal

Increase translation depth by making TLA preserve and explain behaviour more precisely for the highest-value workload domains.

## Why this phase comes first

The platform is already credible as an assisted migration tool, but its remaining weakness is semantic depth. Before more automation is added, the system needs stronger behavioural certainty in its core translation paths.

## Scope

Prioritise the domains where migration risk is highest and user value is greatest:

- EC2 and surrounding compute attachments
- VPC, subnet, routing, security boundaries
- RDS and managed relational database semantics
- S3 and storage behaviour
- ALB/NLB and ingress behaviour
- Lambda deployment/runtime/networking semantics

## Deliverables

### 1. Translation contracts per specialised handler

Each specialised handler should emit a contract object describing:

- preserved behaviour
- transformed behaviour
- degraded behaviour
- blockers
- review-required items
- confidence factors

Suggested shape:

```ts
interface TranslationContract {
  sourceId: string;
  targetIds: string[];
  preserved: string[];
  transformed: string[];
  degraded: string[];
  blockers: string[];
  reviewRequired: string[];
  confidenceFactors: string[];
}
```

### 2. Behavioural metadata in the manifest

Extend manifest entries so they can capture:

- exposure posture
- encryption posture
- backup / restore posture
- high availability posture
- routing intent
- identity / access posture

### 3. Intent extraction improvements

Add inference for workload intent such as:

- internet-facing application
- private internal service
- batch / worker tier
- stateful data plane
- compliance-sensitive workload
- dev / test transient workload

### 4. Domain-deep handler upgrades

Deepen existing specialised handlers rather than only adding more resource types.

Examples:

- EC2: IAM profile semantics, multi-disk intent, public exposure posture, bootstrap/runtime expectations
- VPC stack: route intent, subnet role inference, ingress/egress posture
- RDS: backup retention, encryption, failover posture, subnet placement intent
- S3: lifecycle, website behaviour, logging, retention, requester-pays, policy posture
- ALB/NLB: listener intent, target health, public/private ingress behaviour
- Lambda: trigger semantics, runtime packaging assumptions, VPC attachment implications

## Workstreams

### Workstream A — Contract model and schema changes

- add shared contract types
- persist contracts in translation result and manifest
- expose contracts in reports and MCP responses

### Workstream B — Intent inference engine

- infer workload role from topology and attributes
- assign confidence to inferred intent
- surface uncertain intent as review-required

### Workstream C — Handler deepening

- upgrade compute/storage/network/database special handlers
- replace silent defaults with explicit contract outputs
- move edge cases from implicit behaviour to explicit findings/contracts

### Workstream D — Reporting improvements

- add a preserved / transformed / degraded section to `translation-report.md`
- add contract summaries to `confidence-report.json`
- include contract-derived remediation steps in `migration-pack.md`

## Acceptance criteria

- all specialised handlers emit a `TranslationContract`
- manifest/report output explicitly distinguishes preserved vs degraded behaviour
- at least 6 core workload families have upgraded semantics
- confidence scoring incorporates contract evidence rather than mapping-only heuristics
- no specialised handler silently drops major behaviour without a surfaced contract item or finding

## Out of scope

- unattended execution
- approval workflows
- deployment automation
- broad expansion into long-tail AWS services without semantic depth

## Risks

- overfitting intent inference to current fixtures
- adding metadata without using it in validation/reporting
- widening surface area faster than semantics are deepened

## Exit condition

Phase 1 is complete when a reviewer can inspect a translation and understand not only *what resources were generated*, but also *which behaviours were preserved, changed, degraded, or blocked*.
