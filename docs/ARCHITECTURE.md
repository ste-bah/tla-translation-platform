# TLA Translation Platform -- Architecture Deep Dive

> **Version**: 0.1.0 | **Last Updated**: 2026-03-26 | **Node**: >=22.0.0 | **Go**: 1.21+

---

## 1. System Overview

The TLA (Terraform Landing Zone Accelerator) platform translates AWS Terraform configurations into Azure or GCP equivalents. It is organized as a pnpm monorepo with 10 packages spanning TypeScript libraries, an MCP server, a Go-based Terraform provider, integration tests, and a VS Code extension.

```mermaid
graph TB
    subgraph "Monorepo: @tla/*"
        shared["@tla/shared<br/><i>Zod schemas, types,<br/>constants, errors,<br/>audit logger</i>"]
        registry["@tla/registry<br/><i>YAML-backed service<br/>mapping registry</i>"]
        ingestion["@tla/ingestion<br/><i>HCL parser, dependency<br/>graph, IR emitter</i>"]
        translator["@tla/translator<br/><i>5 mapping engines,<br/>codegen, state migration</i>"]
        validator["@tla/validator<br/><i>Equivalence, policy,<br/>compliance, confidence</i>"]
        mcp["@tla/mcp-server<br/><i>MCP stdio server,<br/>10 tools, resources</i>"]
        cli["@tla/cli<br/><i>CLI entry point</i>"]
        provider["terraform-provider-tla<br/><i>Go binary, cloud_*<br/>portable resources</i>"]
        ide["@tla/ide-extension<br/><i>VS Code extension</i>"]
        itests["@tla/integration-tests<br/><i>End-to-end test suite</i>"]
    end

    shared --> registry
    shared --> ingestion
    shared --> translator
    shared --> validator
    registry --> ingestion
    registry --> translator
    shared --> mcp
    ingestion --> mcp
    registry --> mcp
    translator --> mcp
    validator --> mcp

    mcp -.->|"stdio/SSE"| ide
    cli -.->|"imports"| ingestion
    cli -.->|"imports"| translator
    cli -.->|"imports"| validator
    provider -.->|"shells out to"| translator
    itests -.->|"exercises"| mcp
    itests -.->|"exercises"| translator

    style shared fill:#e1f5fe,stroke:#0288d1
    style registry fill:#e8f5e9,stroke:#388e3c
    style ingestion fill:#fff3e0,stroke:#f57c00
    style translator fill:#fce4ec,stroke:#c62828
    style validator fill:#f3e5f5,stroke:#7b1fa2
    style mcp fill:#e0f2f1,stroke:#00695c
    style provider fill:#fff9c4,stroke:#f9a825
```

---

## 2. Translation Pipeline

The full pipeline transforms raw `.tf` files into validated, target-provider infrastructure code through 9 discrete stages.

```mermaid
flowchart LR
    A["<b>1. HCL Parse</b><br/>@cdktf/hcl2json<br/>→ HclAst"] --> B["<b>2. Dependency<br/>Graph</b><br/>DependencyGraph<br/>+ analyzeGraph"]
    B --> C["<b>3. IR Emit</b><br/>IrEmitter<br/>detectIntents<br/>→ CanonicalIR"]
    C --> D["<b>4. Registry<br/>Lookup</b><br/>RegistryApi.lookup<br/>per sourceType"]
    D --> E["<b>5. Translation<br/>Planner</b><br/>Kahn's toposort<br/>→ TranslationPlan"]
    E --> F["<b>6. Engine<br/>Selection</b><br/>getEngine by<br/>mappingType"]
    F --> G["<b>7. Engine<br/>Emit</b><br/>engine.translate<br/>→ TranslatedResource[]"]
    G --> H["<b>8. Codegen +<br/>File Assembly</b><br/>Azure/GcpCodeGenerator<br/>→ .tf files"]
    H --> I["<b>9. Validation</b><br/>syntax → policy →<br/>compliance →<br/>semantic → confidence<br/>→ cost"]

    style A fill:#fff3e0,stroke:#f57c00
    style B fill:#fff3e0,stroke:#f57c00
    style C fill:#fff3e0,stroke:#f57c00
    style D fill:#e8f5e9,stroke:#388e3c
    style E fill:#fce4ec,stroke:#c62828
    style F fill:#fce4ec,stroke:#c62828
    style G fill:#fce4ec,stroke:#c62828
    style H fill:#fce4ec,stroke:#c62828
    style I fill:#f3e5f5,stroke:#7b1fa2
```

### Pipeline Detail

| Stage | Package | Key Function / Class | Input | Output |
|-------|---------|---------------------|-------|--------|
| 1. HCL Parse | `@tla/ingestion` | `parseHclFile`, `parseHclDirectory` | `.tf` files | `HclAst` |
| 2. Dependency Graph | `@tla/ingestion` | `DependencyGraph`, `analyzeGraph` | `HclAst` | `SerializedGraph`, `GraphAnalysis` |
| 3. IR Emit | `@tla/ingestion` | `IrEmitter.emit()`, `detectIntents` | `HclAst` + `GraphAnalysis` | `CanonicalIR` |
| 4. Registry Lookup | `@tla/registry` | `RegistryApi.lookup(sourceType)` | Resource type string | `RegistryEntry` |
| 5. Translation Plan | `@tla/translator` | `buildTranslationPlan()` | `CanonicalIR` + registry | `TranslationPlan` (toposorted) |
| 6. Engine Selection | `@tla/translator` | `getEngine(mappingType)` | `MappingType` enum | `MappingEngine` instance |
| 7. Engine Emit | `@tla/translator` | `engine.translate(ctx)` | `TranslationContext` | `EngineResult` (resources + findings) |
| 8. Codegen | `@tla/translator` | `AzureCodeGenerator` / `GcpCodeGenerator` | `TranslatedResource[]` | `.tf` file map |
| 9. Validation | `@tla/validator` | `checkEquivalence`, `evaluatePolicies`, etc. | Translated dir + IR | Validation reports |

---

## 3. Package Dependency Graph

All inter-package dependencies flow in one direction -- no cycles.

```mermaid
graph BT
    shared["@tla/shared<br/>(Zod schemas, types,<br/>errors, constants)"]

    registry["@tla/registry<br/>(YAML loader, RegistryApi,<br/>search, completeness)"]
    registry --> shared

    ingestion["@tla/ingestion<br/>(HCL parser, graph,<br/>IR emitter, modules,<br/>variables)"]
    ingestion --> shared
    ingestion --> registry

    translator["@tla/translator<br/>(5 engines, codegen,<br/>state migration,<br/>portable compiler)"]
    translator --> shared
    translator --> registry

    validator["@tla/validator<br/>(equivalence, policy,<br/>compliance, confidence,<br/>cost, drift)"]
    validator --> shared

    mcp["@tla/mcp-server<br/>(MCP stdio server,<br/>10 tools, resources)"]
    mcp --> shared
    mcp --> registry
    mcp --> ingestion
    mcp --> translator
    mcp --> validator

    cli["@tla/cli"]
    cli -.-> ingestion
    cli -.-> translator
    cli -.-> validator

    provider["terraform-provider-tla<br/>(Go binary)"]
    provider -.->|"shells out"| translator

    ide["@tla/ide-extension"]
    ide -.->|"stdio"| mcp

    itests["@tla/integration-tests"]
    itests -.-> mcp
    itests -.-> translator

    style shared fill:#e1f5fe,stroke:#0288d1
    style registry fill:#e8f5e9,stroke:#388e3c
    style ingestion fill:#fff3e0,stroke:#f57c00
    style translator fill:#fce4ec,stroke:#c62828
    style validator fill:#f3e5f5,stroke:#7b1fa2
    style mcp fill:#e0f2f1,stroke:#00695c
    style provider fill:#fff9c4,stroke:#f9a825
```

### Dependency Rules

- **`@tla/shared`** depends on nothing (leaf). Contains all Zod schemas, TypeScript types, error classes, constants, and the audit logger.
- **`@tla/registry`** depends only on `@tla/shared`. Loads YAML mapping files, provides `RegistryApi` with `lookup()`, `search()`, and `getCompleteness()`.
- **`@tla/ingestion`** depends on `shared` + `registry`. Parses HCL, builds dependency graphs, emits the Canonical IR.
- **`@tla/translator`** depends on `shared` + `registry`. Five mapping engines, two codegen backends (Azure/GCP), expression translation, state migration, portable compiler.
- **`@tla/validator`** depends only on `shared`. Equivalence checking, OPA policy engine, CIS compliance, confidence scoring, cost estimation, drift detection.
- **`@tla/mcp-server`** depends on all five core packages. Integrates everything behind an MCP stdio transport.

---

## 4. Canonical IR

The Canonical Intermediate Representation is the central data structure. All upstream parsing converges into it; all downstream translation reads from it. The IR is **immutable** once emitted -- engines never mutate it.

```mermaid
classDiagram
    class CanonicalIR {
        +string version (semver)
        +CloudProvider sourceProvider
        +IrResource[] resources
        +IrRelationship[] relationships
        +IrModule[] modules
        +InfraIntent[] intents
        +IrMetadata metadata
    }

    class IrResource {
        +string id
        +string sourceType
        +string sourceName
        +string|null sourceModule
        +ResourceCategory category
        +IrAttributes attributes
        +IrAttributes sourceAttributes
        +string|null registryEntryId
        +TranslationStatus translationStatus
        +number confidence [0..1]
        +Record~string,string~ tags
        +SourceLocation sourceLocation
    }

    class IrRelationship {
        +string from
        +string to
        +RelationshipType type
        +Record~string,unknown~ metadata
    }

    class IrModule {
        +string name
        +string source
        +string[] resources
    }

    class IrMetadata {
        +string generatedAt (ISO 8601)
        +string[] sourceFiles
        +string toolVersion
        +number resourceCount
        +number relationshipCount
    }

    class InfraIntent {
        <<discriminated union on kind>>
        +string kind
        +string subtype
        +string[] resources
        +Record~string,unknown~ properties
    }

    CanonicalIR "1" --> "*" IrResource
    CanonicalIR "1" --> "*" IrRelationship
    CanonicalIR "1" --> "*" IrModule
    CanonicalIR "1" --> "*" InfraIntent
    CanonicalIR "1" --> "1" IrMetadata
```

### IrResource Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier (e.g., `aws_instance.web`) |
| `sourceType` | `string` | AWS resource type (e.g., `aws_s3_bucket`) |
| `sourceName` | `string` | Terraform resource name label |
| `sourceModule` | `string \| null` | Module path if nested, null for root |
| `category` | `ResourceCategory` | Service family: compute, storage, database, networking, security, serverless, messaging, observability, containers, identity |
| `attributes` | `Record<string, unknown>` | Normalized attributes for translation |
| `sourceAttributes` | `Record<string, unknown>` | Raw HCL attributes preserved verbatim |
| `registryEntryId` | `string \| null` | Matched registry entry ID (SER-XXX-XXX-NNN) |
| `translationStatus` | `TranslationStatus` | pending, translated, expanded, partial, blocked, advisory |
| `confidence` | `number` | 0.0 to 1.0 base confidence score |
| `tags` | `Record<string, string>` | Resource tags (passthrough to target) |
| `sourceLocation` | `SourceLocation` | File path, line, column for diagnostics |

### Intent Types (Discriminated Union)

The IR captures 7 intent kinds that describe cross-cutting infrastructure concerns:

| Kind | Subtypes | Purpose |
|------|----------|---------|
| `networking` | vpc, subnet, security_group, load_balancer, nat, route_table, peering | Network topology preservation |
| `identity` | role, policy, user, group, service_account | IAM intent mapping |
| `encryption` | key_management, at_rest, in_transit | Encryption requirements |
| `scaling` | auto_scaling, application_scaling, scheduled | Elasticity intent |
| `resilience` | multi_az, backup, replication, failover | HA/DR requirements |
| `observability` | monitoring, logging, tracing, alerting | Monitoring intent |
| `secret` | secret_store, parameter_store, rotation | Secret management intent |

---

## 5. Engine Types

The translation compiler dispatches each resource to one of five mapping engines based on the `mapping_type` field in its registry entry.

### Dispatch Flow

```mermaid
flowchart TD
    Start["TranslationCompiler<br/>iterates plan items"] --> Lookup["getEngine(item.mappingType)"]

    Lookup -->|"'direct'"| Direct["<b>DirectEngine</b><br/>1:1 attribute mapping<br/>P1 band"]
    Lookup -->|"'parametric'"| Param["<b>ParametricEngine</b><br/>Attribute transformation<br/>with lookups, P2 band"]
    Lookup -->|"'compound'"| Compound["<b>CompoundEngine</b><br/>1:N resource expansion<br/>N1 band"]
    Lookup -->|"'structural'"| Structural["<b>StructuralEngine</b><br/>Topology reshaping<br/>N1 band"]
    Lookup -->|"'none'"| Advisory["<b>AdvisoryEngine</b><br/>Manual guidance stubs<br/>M1 band"]

    Direct --> Result["EngineResult<br/>{translated[], findings[]}"]
    Param --> Result
    Compound --> Result
    Structural --> Result
    Advisory --> Result

    style Direct fill:#c8e6c9,stroke:#2e7d32
    style Param fill:#fff9c4,stroke:#f9a825
    style Compound fill:#ffccbc,stroke:#bf360c
    style Structural fill:#d1c4e9,stroke:#4527a0
    style Advisory fill:#cfd8dc,stroke:#455a64
```

### Engine Comparison Table

| Engine | Type | Band | Ratio | Description | Example Resources |
|--------|------|------|-------|-------------|-------------------|
| **Direct** | `direct` | P1 | 1:1 | Straightforward attribute mapping. Region/SKU lookups via `REGION_MAP` and `NODE_TYPE_SKU_MAP`. | S3, ECR, ElastiCache Redis, Route53 zones |
| **Parametric** | `parametric` | P2 | 1:1 | Attribute transformation with cross-resource lookups. Reads sibling resources for VPC/subnet references. | VPC, Subnet, NAT Gateway, KMS, Secrets Manager, EKS, Direct Connect, VPN |
| **Compound** | `compound` | N1 | 1:N | One AWS resource expands to multiple target resources. Internal Terraform interpolation refs between outputs. | EC2 (VM+NIC+Disk), ASG (VMSS/MIG), ALB/NLB (AppGW+PIP / LB+PIP), RDS (FlexServer+DB), API Gateway (APIM+API) |
| **Structural** | `structural` | N1 | M:N | Topology reshaping preserving security/behavioral intent. Intent-driven supplementary analysis. BLOCKER gate on rule broadening. | Security Groups, Lambda (trigger detection), ECS (launch type), SQS/SNS (FIFO), CloudWatch, WAF, Step Functions |
| **Advisory** | `none` | M1 | 0:0 | No automated translation. Generates manual task findings with migration guidance. | DynamoDB (pattern detection), IAM, CloudFront, Route53 health checks, ElastiCache Cluster |

### Direct Engine Dispatch

```mermaid
flowchart LR
    DE["DirectEngine.translate(ctx)"] --> DT{"ctx.resource<br/>.sourceType"}
    DT -->|"aws_s3_bucket"| S3["s3-mapping.ts"]
    DT -->|"aws_ecr_repository"| ECR["ecr-mapping.ts"]
    DT -->|"aws_elasticache_*"| EC["elasticache-mapping.ts"]
    DT -->|"aws_route53_zone"| R53["route53-mapping.ts"]
    DT -->|"aws_vpc_peering_*"| VPC["vpc-peering-mapping.ts"]
    DT -->|"other"| Fallback["Generic 1:1<br/>attribute copy"]
```

### Compound Expansion Example

```mermaid
flowchart LR
    subgraph AWS
        EC2["aws_instance<br/>(single resource)"]
    end

    subgraph "Azure (expanded)"
        VM["azurerm_linux_virtual_machine"]
        NIC["azurerm_network_interface"]
        DISK["azurerm_managed_disk"]
    end

    EC2 --> VM
    EC2 --> NIC
    EC2 --> DISK
    VM -.->|"network_interface_ids"| NIC
    VM -.->|"os_disk"| DISK
```

---

## 6. Registry Data Model

The registry is a set of YAML files, each containing one or more `RegistryEntry` records. The `RegistryApi` class provides lookup, search, and completeness reporting.

### RegistryEntry Fields

| Field | Type | Description |
|-------|------|-------------|
| `registry_entry_id` | `string` | Unique ID matching `SER-[FAMILY]-[CODE]-NNN` |
| `aws_service` | `string` | AWS resource type (e.g., `aws_s3_bucket`) |
| `aws_family` | `AwsServiceFamily` | compute, storage, database, networking, security, serverless, messaging, observability, containers, identity |
| `azure_targets` | `string[]` | Azure resource types this maps to |
| `gcp_targets` | `string[]` | GCP resource types this maps to |
| `mapping_type` | `MappingType` | direct, parametric, compound, structural, none |
| `output_mode` | `OutputMode` | portable, native_emit_only, advisory_manual |
| `band` | `TranslationBand` | P1 (highest confidence), P2, N1, M1 (manual-only) |
| `confidence` | `number` | 0.0 to 1.0 base translation confidence |
| `portable_provider_candidate` | `boolean` | Whether a `cloud_*` abstraction exists |
| `behavioral_gaps` | `BehavioralGap[]` | Known behavioral divergences |
| `manual_review_required` | `boolean` | Whether human review is mandatory |
| `review_domains` | `ReviewDomain[]` | Domains requiring review: networking, security, identity, data, compliance |
| `test_status` | `TestStatus` | untested, unit_tested, integration_validated, e2e_validated |
| `owner` | `string` | Team or individual responsible |
| `registry_version` | `string` | Date-based version (YYYY.MM.DD) |
| `last_updated` | `string` | ISO 8601 datetime |
| `related_requirements` | `string[]` | Requirement IDs (REQ-XXX-NNN) |
| `related_edge_cases` | `string[]` | Edge case IDs (EC-NNN) |

### BehavioralGap Fields

| Field | Type | Description |
|-------|------|-------------|
| `gap_id` | `string` | Unique ID matching `BGR-[FAMILY]-[CODE]-NNN` |
| `gap_type` | `GapType` | feature, topology, policy, runtime, data_model |
| `description` | `string` | Human-readable gap description |
| `severity` | `GapSeverity` | blocker, major, minor, informational |
| `affected_targets` | `CloudProvider[]` | Which targets are affected (azure, gcp, or both) |
| `workaround` | `string \| null` | Known workaround, if any |
| `requires_manual_review` | `boolean` | Whether this gap forces manual review |

### Band Classification

```mermaid
graph LR
    subgraph "Band Hierarchy"
        P1["<b>P1</b><br/>Direct mapping<br/>Confidence >= 0.85<br/>Fully automated"]
        P2["<b>P2</b><br/>Parametric<br/>Confidence 0.65-0.85<br/>Automated + lookups"]
        N1["<b>N1</b><br/>Compound / Structural<br/>Confidence 0.40-0.65<br/>Needs review"]
        M1["<b>M1</b><br/>Advisory only<br/>Confidence < 0.40<br/>Manual migration"]
    end

    P1 --> P2 --> N1 --> M1

    style P1 fill:#c8e6c9,stroke:#2e7d32
    style P2 fill:#fff9c4,stroke:#f9a825
    style N1 fill:#ffccbc,stroke:#bf360c
    style M1 fill:#cfd8dc,stroke:#455a64
```

---

## 7. Validation Pipeline

The validator runs up to 7 checks in strict dependency order. Each check can be individually selected. Downstream checks are skipped if an upstream dependency is unavailable.

```mermaid
flowchart TD
    Input["Translated .tf directory<br/>+ optional CanonicalIR JSON"]

    Input --> Syntax["<b>1. Syntax Check</b><br/>HCL parse validity<br/>(always runs)"]
    Syntax --> HCL["<b>2. HCL Validation</b><br/>terraform validate<br/>(skipped if binary missing)"]
    HCL --> Policy["<b>3. Policy Check</b><br/>OPA policy engine<br/>+ built-in rules"]
    Policy --> Compliance["<b>4. Compliance Check</b><br/>CIS Basic / Advanced<br/>8 built-in rules"]
    Compliance --> Semantic["<b>5. Semantic Diff</b><br/>Equivalence checking<br/>(requires IR file)"]
    Semantic --> Confidence["<b>6. Confidence Scoring</b><br/>Per-resource + stack-level<br/>(requires IR file)"]
    Confidence --> Cost["<b>7. Cost Estimation</b><br/>Delta analysis<br/>(requires IR file)"]

    Syntax -->|"fail"| Report["Validation Report"]
    HCL -->|"skip/fail"| Report
    Policy -->|"findings"| Report
    Compliance -->|"findings"| Report
    Semantic -->|"findings"| Report
    Confidence -->|"report"| Report
    Cost -->|"report"| Report

    style Syntax fill:#e8f5e9
    style HCL fill:#e8f5e9
    style Policy fill:#fff3e0
    style Compliance fill:#fff3e0
    style Semantic fill:#e1f5fe
    style Confidence fill:#f3e5f5
    style Cost fill:#fce4ec
```

### Check Details

| # | Check | Input Required | Key Module | Output |
|---|-------|----------------|-----------|--------|
| 1 | **Syntax** | `.tf` files | HCL parser | Parse errors |
| 2 | **HCL Validation** | `terraform` binary | `terraform validate` | Validation diagnostics |
| 3 | **Policy** | Translated resources | `evaluatePolicies`, `evaluateOpa` | `PolicyReport` with pass/fail per rule |
| 4 | **Compliance** | Translated resources | `checkCompliance` with CIS profiles | `ComplianceReport` (encryption, network, IAM, logging) |
| 5 | **Semantic Diff** | IR file | `checkEquivalence` (presence, attributes, intents, references) | `EquivalenceReport` per resource |
| 6 | **Confidence** | IR file + upstream results | `scoreConfidence` | `ConfidenceReport` with per-resource, family, and stack scores |
| 7 | **Cost** | IR file | `estimateCostDelta` | `CostDeltaReport` with per-resource cost comparisons |

### Built-in Compliance Rules (CIS)

| Rule ID | Check | Severity |
|---------|-------|----------|
| `encryptionAtRest` | Storage/DB encryption enabled | blocker |
| `encryptionInTransit` | TLS/HTTPS enforcement | blocker |
| `networkOpenIngress` | No 0.0.0.0/0 ingress on all ports | blocker |
| `networkSshRestricted` | SSH not open to world | major |
| `networkPublicIp` | Public IP association flagged | warning |
| `loggingEnabled` | Audit/access logging active | major |
| `iamAdminPolicy` | No admin-level IAM policies | blocker |
| `iamMfaRequired` | MFA enforcement on IAM | major |

---

## 8. Confidence Scoring

Confidence is computed at three levels: per-resource, per-service-family, and stack-wide. The formula ensures that validation failures, semantic drift, and policy violations all degrade the score.

### Per-Resource Formula

```
resource_score = registry_confidence
               * validation_factor
               * semantic_factor
               * policy_factor
```

| Factor | Source | Values |
|--------|--------|--------|
| `registry_confidence` | `RegistryEntry.confidence` | 0.0 -- 1.0 (0.5 if unknown) |
| `validation_factor` | HCL validation status | clean=1.0, warnings=0.5, errors=0.0 |
| `semantic_factor` | Equivalence classification | preserved=1.0, transformed=0.8, partial=0.5, missing=0.2 |
| `policy_factor` | Policy evaluation | `max(0, 1 - 0.2*warnings - 0.5*failures)` |

### Semantic Status Mapping

| Equivalence Classification | Semantic Status | Factor |
|---------------------------|-----------------|--------|
| equivalent | preserved | 1.0 |
| partial | transformed | 0.8 |
| degraded | partial | 0.5 |
| missing | missing | 0.2 |

### Stack-Level Aggregation

```mermaid
flowchart TD
    R1["Resource A<br/>score=0.85<br/>review_critical=true"] --> W1["Weighted: 0.85 * 1.5 = 1.275"]
    R2["Resource B<br/>score=0.72<br/>review_critical=false"] --> W2["Weighted: 0.72 * 1.0 = 0.72"]
    R3["Resource C<br/>score=0.91<br/>review_critical=true"] --> W3["Weighted: 0.91 * 1.5 = 1.365"]
    R4["Resource D<br/>score=0.55<br/>review_critical=false"] --> W4["Weighted: 0.55 * 1.0 = 0.55"]

    W1 --> Agg["Weighted Average<br/>(1.275 + 0.72 + 1.365 + 0.55) / (1.5 + 1.0 + 1.5 + 1.0)<br/>= 3.91 / 5.0 = <b>0.782</b>"]
    W2 --> Agg
    W3 --> Agg
    W4 --> Agg

    R4 -->|"score < 0.60"| Esc["escalationRequired = true"]

    style Esc fill:#ffcdd2,stroke:#c62828
```

**Review-critical domains** (security, identity, networking) receive **1.5x weighting** in stack aggregation because errors in these domains have outsized operational risk.

**Escalation rule**: If any single resource scores below 0.60, the entire stack report sets `escalationRequired = true`.

### Confidence Bands

| Band | Score Range | Meaning |
|------|------------|---------|
| **high** | >= 0.80 | Safe for automated deployment |
| **medium** | 0.60 -- 0.79 | Review recommended |
| **low** | 0.40 -- 0.59 | Significant manual review required |
| **critical** | < 0.40 | Manual migration or redesign needed |

---

## 9. MCP Server Architecture

The MCP server exposes the full TLA pipeline over the Model Context Protocol stdio transport, making it directly usable from Claude Code, VS Code, and other MCP-compatible clients.

```mermaid
flowchart TB
    subgraph "MCP Client (Claude Code / IDE)"
        Client["MCP Client"]
    end

    subgraph "tla-mcp-server (Node.js)"
        Transport["StdioServerTransport"]
        Server["McpServer<br/>name: tla-mcp-server<br/>version: 0.1.0"]
        RM["RegistryManager<br/>(lazy load + TTL cache)"]

        subgraph "10 Tools"
            T1["translate"]
            T2["equivalence-lookup"]
            T3["validate"]
            T4["migrate-state"]
            T5["assess"]
            T6["registry-search"]
            T7["registry-stats"]
            T8["explain-mapping"]
            T9["list-gaps"]
            T10["confidence-check"]
        end

        subgraph "Resources"
            Res["registry://entries<br/>registry://completeness"]
        end
    end

    subgraph "Core Packages"
        Ing["@tla/ingestion"]
        Reg["@tla/registry"]
        Tr["@tla/translator"]
        Val["@tla/validator"]
    end

    Client <-->|"JSON-RPC over stdio"| Transport
    Transport <--> Server
    Server --> T1 & T2 & T3 & T4 & T5 & T6 & T7 & T8 & T9 & T10
    Server --> Res
    T1 & T2 & T3 & T4 --> RM
    T5 & T6 & T7 & T8 & T9 & T10 --> RM
    RM -->|"load + validate"| Reg
    T1 -->|"parseHcl + emit IR"| Ing
    T1 -->|"TranslationCompiler"| Tr
    T3 -->|"checkEquivalence +<br/>evaluatePolicies"| Val
    T4 -->|"transformState +<br/>generateRollback"| Tr

    style RM fill:#e8f5e9,stroke:#388e3c
    style Server fill:#e0f2f1,stroke:#00695c
```

### Tool Summary

| Tool | Input | Pipeline Stages Used | Output |
|------|-------|---------------------|--------|
| `translate` | source path/content, target, scope | Parse -> Graph -> IR -> Plan -> Emit -> Codegen | TranslationResult (files + manifest) |
| `equivalence-lookup` | service type(s), target, detail level | Registry lookup only | Mapping summary or full entry |
| `validate` | translated dir, provider, optional IR | Syntax -> HCL -> Policy -> Compliance -> Semantic -> Confidence -> Cost | Validation report |
| `migrate-state` | state file, translation dir, target | State transformer | Move/import/remove commands + rollback |
| `assess` | source path, target | Parse -> Inventory (stub) | Assessment report |
| `registry-search` | family, band, mapping_type, min_confidence | Registry search | Filtered entries |
| `registry-stats` | (none) | Registry completeness | Aggregate statistics |
| `explain-mapping` | AWS type, target | Registry lookup | Detailed mapping explanation |
| `list-gaps` | optional type, severity, target | Registry gap scan | Behavioral gap list |
| `confidence-check` | AWS type, target | Registry lookup + gap analysis | Confidence factors |

### RegistryManager Caching

The `RegistryManager` implements lazy-load with TTL-based cache invalidation:

1. First tool call triggers `loadRegistryFromDirectory()` + `validateRegistryEntries()`
2. Subsequent calls within the TTL window return the cached `RegistryApi`
3. After TTL expiry, next call re-loads from disk
4. If `registryDir` is not configured, all tools return a structured error

---

## 10. State Migration

The state transformer converts AWS Terraform state into target-provider state commands, enabling `terraform state mv`/`import`/`rm` workflows.

```mermaid
flowchart TD
    subgraph Input
        State["AWS .tfstate<br/>(v3 or v4)"]
        Manifest["Translation Manifest<br/>(manifest.json from translate)"]
    end

    State --> Parse["<b>1. Parse State</b><br/>parseStateJson<br/>→ StateData"]
    Parse --> Normalize["<b>2. Normalize</b><br/>normalizeV3 / normalizeV4<br/>→ unified resource list"]
    Normalize --> AddrMap["<b>3. Build Address Map</b><br/>buildAddressMap<br/>source → target address pairs"]
    AddrMap --> Classify["<b>4. Classify by<br/>Mapping Type</b><br/>classifyByMappingType<br/>direct=move, compound=import,<br/>advisory=remove"]

    Classify --> Move["<b>terraform state mv</b><br/>StateMoveCommand[]<br/>(direct/parametric)"]
    Classify --> Import["<b>terraform import</b><br/>StateImportCommand[]<br/>(compound/structural)"]
    Classify --> Remove["<b>terraform state rm</b><br/>StateRemoveCommand[]<br/>(advisory/orphans)"]

    Move & Import & Remove --> Plan["StateTransformPlan"]

    Plan --> Rollback["<b>5. Rollback Manifest</b><br/>generateRollback<br/>→ inverse operations"]
    Plan --> Backend["<b>6. Backend Config</b><br/>generateAzureBackend /<br/>generateGcpBackend<br/>→ backend.tf"]

    Manifest --> AddrMap

    style Parse fill:#fff3e0
    style Normalize fill:#fff3e0
    style AddrMap fill:#e1f5fe
    style Classify fill:#e1f5fe
    style Move fill:#c8e6c9
    style Import fill:#fff9c4
    style Remove fill:#ffcdd2
    style Rollback fill:#f3e5f5
    style Backend fill:#e0f2f1
```

### Command Generation Rules

| Mapping Type | Command | Notes |
|--------------|---------|-------|
| direct / parametric | `terraform state mv` | Address rename only |
| compound | `terraform import` | New resources need import; may be `manualTask=true` |
| structural | `terraform import` | Topology reshape requires fresh import |
| advisory / none | `terraform state rm` | Source resource removed from state |

### Rollback Manifest

The rollback generator produces inverse operations for every forward command:

- `mv A B` generates `mv B A` (inverse move)
- `import addr id` generates `state rm addr` (inverse import)
- `rm addr` records the original address for manual re-import

### Backend Migration

Two backend generators produce target-provider HCL:

- **Azure**: `azurerm` backend with `resource_group_name`, `storage_account_name`, `container_name`, `key`
- **GCP**: `gcs` backend with `bucket`, `prefix`

The `migrateBackend` function orchestrates S3 detection + backend generation + state migration commands.

---

## 11. Portable Provider

The portable provider introduces `cloud_*` resources -- provider-agnostic Terraform resource types that compile down to native provider HCL at plan/apply time.

### Architecture

```mermaid
flowchart TB
    subgraph "User Configuration"
        HCL["resource \"cloud_object_storage\" \"data\" {<br/>  name = \"my-bucket\"<br/>  versioning = true<br/>  encryption { algorithm = \"AES256\" }<br/>}"]
    end

    subgraph "TypeScript Compiler"
        PC["portable-compiler.ts<br/>compilePortableResource()"]
        PC --> AWS_E["AWS emitter:<br/>aws_s3_bucket +<br/>aws_s3_bucket_versioning"]
        PC --> AZ_E["Azure emitter:<br/>azurerm_storage_account +<br/>azurerm_storage_container"]
        PC --> GCP_E["GCP emitter:<br/>google_storage_bucket"]
    end

    subgraph "Go Terraform Provider"
        Prov["terraform-provider-tla<br/>(Go binary)"]
        Prov --> COS["cloud_object_storage<br/>resource"]
        Prov --> CCR["cloud_container_registry<br/>resource"]
        Prov --> CCRedis["cloud_cache_redis<br/>resource"]
        Prov --> HW["hcl_writer.go<br/>+ mappings.go"]
    end

    subgraph "Exit Path"
        EP["exit-path.ts<br/>emitNativeEquivalent()"]
        EP -->|"produces"| NativeHCL["Native .tf files<br/>(no cloud_* dependency)"]
    end

    HCL --> Prov
    HCL --> PC
    PC --> NativeHCL2["Native .tf output"]
    Prov -->|"plan/apply"| Created["Cloud Resources"]

    style PC fill:#fce4ec,stroke:#c62828
    style Prov fill:#fff9c4,stroke:#f9a825
    style EP fill:#e8f5e9,stroke:#388e3c
```

### Supported Portable Resource Types

| Portable Type | AWS Target | Azure Target | GCP Target |
|--------------|------------|--------------|------------|
| `cloud_object_storage` | `aws_s3_bucket` + versioning + encryption | `azurerm_storage_account` + `azurerm_storage_container` | `google_storage_bucket` |
| `cloud_container_registry` | `aws_ecr_repository` | `azurerm_container_registry` | `google_artifact_registry_repository` |
| `cloud_cache_redis` | `aws_elasticache_replication_group` | `azurerm_redis_cache` | `google_redis_instance` |

### Go Provider Schema

The Go provider (`terraform-provider-tla`) implements the Terraform Plugin Framework:

```
provider "tla" {
  target_provider = "azure"   # or "gcp"
  output_dir      = "./out"
}
```

Resources are defined in `internal/resources/` with provider-specific attribute mapping in `mappings.go`. The `hcl_writer.go` module emits syntactically correct HCL blocks (with the block-vs-attribute distinction required by providers like `azurerm`).

### Exit Path

The exit path (`emitNativeEquivalent()`) is the escape hatch: it takes `cloud_*` resources and produces pure native-provider HCL with zero dependency on the TLA provider binary. This allows teams to adopt the portable abstraction for migration and then "eject" to standard Terraform when ready.

```mermaid
flowchart LR
    Cloud["cloud_object_storage<br/>(portable)"] -->|"emitNativeEquivalent()"| Native["azurerm_storage_account<br/>+ azurerm_storage_container<br/>(native HCL)"]
    Cloud2["cloud_cache_redis<br/>(portable)"] -->|"emitNativeEquivalent()"| Native2["google_redis_instance<br/>(native HCL)"]
```

---

## Appendix A: Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | >= 22.0.0 |
| Language (TS) | TypeScript | ~5.8.3 |
| Language (Go) | Go | 1.21+ |
| Schema Validation | Zod | ^3.24.4 |
| HCL Parsing | @cdktf/hcl2json | ^0.21.0 |
| Registry Format | YAML | via `yaml` ^2.8.2 |
| Logging | Pino | ^9.6.0 |
| MCP SDK | @modelcontextprotocol/sdk | ^1.27.1 |
| TF Provider Framework | terraform-plugin-framework | (Go module) |
| Build (TS) | tsup / tsc | ^8.5.1 |
| Test | Vitest | ^3.1.1 |
| Monorepo | pnpm workspaces | -- |

## Appendix B: File Output Structure

A full translation produces the following file tree in the output directory:

```
output/
  main.tf              # Translated resources
  providers.tf         # Provider block (azurerm/google)
  terraform.tf         # Required providers + version constraints
  variables.tf         # Input variables (subscription_id, region, etc.)
  outputs.tf           # Output values
  manifest.json        # Translation manifest with per-resource status
  ir.json              # Source CanonicalIR (when --save-ir is set)
  remediation.json     # Remediation pack (when gaps exist)
  backend.tf           # Target backend config (when --migrate-state)
  rollback.json        # Rollback manifest (when --migrate-state --rollback)
```
