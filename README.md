# AWS Terraform Translation Platform (TLA)

> Translate AWS Terraform to Azure and GCP with full service equivalence registry, validation, and portable authoring.

![Tests](https://img.shields.io/badge/tests-3130%2B%20passing-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-90%25%2B-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-22%2B-green)
![Go](https://img.shields.io/badge/go-1.22%2B-00ADD8)

---

## What It Does

The TLA platform ingests AWS Terraform HCL configurations and translates them into native Azure (`azurerm`) and GCP (`google`) Terraform code. It does not produce abstraction layers or wrappers -- every output file is idiomatic, provider-native HCL that you can `terraform plan` and `terraform apply` directly.

The translation engine covers **22 AWS services** across **5 engine types**: direct (1:1 attribute mapping), parametric (cross-resource reference resolution), compound (1:N resource expansion), structural (topology reshaping with intent analysis), and advisory (human-guided migration stubs). Each translated resource carries a confidence score, traceability metadata linking it back to the source, and a manifest of behavioral gaps that require attention.

Beyond translation, the platform includes a full **validation suite** (semantic diff, policy evaluation, compliance checking, confidence scoring, and cost estimation), an **MCP server** exposing 10 tools for AI agent integration (Claude Code, Cursor, etc.), a **VS Code extension** for inline translation hints and diagnostics, and a **Go Terraform provider** that lets you author portable `cloud_*` resources targeting any supported cloud.

---

## Architecture

```mermaid
graph LR
    A["AWS .tf Files"] --> B["HCL Parser"]
    B --> C["Dependency Graph"]
    C --> D["IR Emitter"]
    D --> E["Translation Planner"]
    E --> F{"5 Engine Types"}
    F --> G["Azure Codegen"]
    F --> H["GCP Codegen"]
    G --> I["Validation Suite"]
    H --> I
    I --> J["Translation Report"]

    style A fill:#f9f,stroke:#333
    style J fill:#9f9,stroke:#333
    style F fill:#ff9,stroke:#333
```

---

## Quick Start

```bash
# Clone and install
git clone <repo-url>
cd Translation_Platform
pnpm install
pnpm build

# Translate AWS to Azure
npx tla translate ./my-aws-terraform --target azure --output ./azure-output

# Translate AWS to GCP
npx tla translate ./my-aws-terraform --target gcp --output ./gcp-output

# Assessment only (no translation output, just the report)
npx tla translate ./my-aws-terraform --target azure --scope assessment

# Validate an existing translation
npx tla validate ./azure-output --source ./my-aws-terraform

# Registry report
npx tla registry-report --format table
```

---

## Package Overview

| Package | Path | Description | Key Exports |
|---------|------|-------------|-------------|
| **@tla/shared** | `packages/shared` | Shared types, Zod schemas, audit trail | `CanonicalIR`, `TranslationManifest`, `AuditLogger` |
| **@tla/ingestion** | `packages/ingestion` | HCL parsing, dependency graph, IR generation | `parseHclDirectory`, `IrEmitter`, `DependencyGraph` |
| **@tla/registry** | `packages/registry` | Service equivalence registry (22 AWS services) | `RegistryApi`, `loadRegistryFromDirectory` |
| **@tla/translator** | `packages/translator` | Translation engines + Azure/GCP codegen | `TranslationCompiler`, `AzureCodeGenerator`, `GcpCodeGenerator` |
| **@tla/validator** | `packages/validator` | Validation, policy, compliance, cost estimation | `checkEquivalence`, `evaluatePolicies`, `checkCompliance`, `scoreConfidence` |
| **@tla/mcp-server** | `packages/mcp-server` | MCP server (10 tools) for AI agent integration | `translate`, `equivalence-lookup`, `validate`, `migrate-state` |
| **@tla/cli** | `packages/cli` | Command-line interface | `tla translate`, `tla validate-registry`, `tla registry-report` |
| **ide-extension** | `packages/ide-extension` | VS Code extension for inline hints | Completions, diagnostics, lint rules |
| **terraform-provider** | `packages/terraform-provider` | Go Terraform provider for portable resources | `cloud_object_storage`, `cloud_container_registry`, `cloud_cache_redis` |
| **integration-tests** | `packages/integration-tests` | End-to-end test suite | Azure E2E, GCP E2E, edge case fixtures |

---

## Translation Pipeline

The compiler executes a 7-phase pipeline for each translation:

```mermaid
flowchart TD
    P1["Phase 1: Parse"]
    P2["Phase 2: Resolve"]
    P3["Phase 3: Plan"]
    P4["Phase 4: Translate"]
    P5["Phase 5: Emit"]
    P6["Phase 6: Assemble"]
    P7["Phase 7: Manifest"]

    P1 -->|"HCL -> AST -> IR"| P2
    P2 -->|"Flatten modules, resolve variables"| P3
    P3 -->|"Topological sort, engine dispatch"| P4
    P4 -->|"5 engine types process resources"| P5
    P5 -->|"Expression translation, reference rewriting"| P6
    P6 -->|"HCL file assembly (main, providers, variables, outputs, terraform)"| P7
    P7 -->|"Confidence scoring, gap analysis, manifest generation"| P7

    style P1 fill:#e1f5fe
    style P4 fill:#fff3e0
    style P7 fill:#e8f5e9
```

### Engine Types

| Engine | Band | Description | Example Services |
|--------|------|-------------|-----------------|
| **Direct** | P1 | 1:1 attribute mapping | S3, ECR, ElastiCache Redis, Route53, VPC Peering |
| **Parametric** | P2 | Cross-resource reference resolution | VPC, Subnet, NAT Gateway, KMS, Secrets Manager, EKS |
| **Compound** | P2 | 1:N resource expansion | EC2 (VM+NIC+Disk), ASG, ALB/NLB, RDS |
| **Structural** | P2 | Topology reshaping with intent analysis | Security Groups, Lambda, ECS, SQS, SNS, CloudWatch |
| **Advisory** | M1 | Human-guided migration stubs | DynamoDB, IAM, CloudFront, Route53 Health, ElastiCache Cluster |

---

## MCP Server Tools

The MCP server exposes 10 tools for AI agent integration:

| Tool | Description |
|------|-------------|
| `translate` | Translate an AWS Terraform directory to Azure or GCP |
| `equivalence-lookup` | Look up the Azure/GCP equivalent for an AWS resource type |
| `validate` | Run the full validation suite on a translation |
| `migrate-state` | Generate state migration commands for an existing deployment |
| `list-services` | List all mapped AWS services and their translation bands |
| `assess` | Run assessment-only mode (no file output) |
| `explain-gap` | Explain a specific behavioral gap finding |
| `cost-estimate` | Estimate cost differences between source and target |
| `compliance-check` | Run CIS compliance checks against translated output |
| `registry-report` | Generate a registry coverage report |

### MCP Configuration

```json
{
  "mcpServers": {
    "tla": {
      "command": "npx",
      "args": ["@tla/mcp-server", "start"],
      "env": {
        "TLA_REGISTRY_DIR": "./packages/registry/data"
      }
    }
  }
}
```

---

## Registry Coverage

### 22 AWS Services Mapped

| Band | Services | Count |
|------|----------|-------|
| **P1 -- Direct** | S3, ECR, ElastiCache Redis, Route53 Zones, VPC Peering | 5 |
| **P2 -- Parametric** | VPC, Subnet, NAT Gateway, KMS, Secrets Manager, EKS | 6 |
| **P2 -- Compound** | EC2, Auto Scaling Groups, ALB, NLB, RDS | 5 |
| **P2 -- Structural** | Security Groups, Lambda, ECS, SQS, SNS, CloudWatch | 6 |
| **N1 -- Manual** | Transit Gateway, PrivateLink, DNS (complex records) | 3 |
| **M1 -- Advisory** | DynamoDB, IAM, CloudFront, Route53 Health, ElastiCache Cluster | 5 |

> Note: Some services span multiple bands depending on the specific resource type and configuration complexity.

---

## Validation Suite

The platform includes 7 validation checks that run against every translation:

| Check | Description |
|-------|-------------|
| **Syntax Validation** | Verifies generated HCL is syntactically valid |
| **HCL Validation** | Runs `terraform validate` against generated output |
| **Policy Evaluation** | Evaluates custom policy rules (e.g., no public endpoints) |
| **Compliance Checking** | CIS benchmark compliance (Basic: 5 rules, Advanced: 8 rules) |
| **Semantic Diff** | Compares source and target resource graphs for equivalence |
| **Confidence Scoring** | Aggregate confidence score with per-resource breakdown |
| **Cost Estimation** | Estimates monthly cost delta between source and target |

### Compliance Profiles

- **CIS-Basic** (5 rules): Encryption at rest, encryption in transit, no public access, logging enabled, tagging required
- **CIS-Advanced** (8 rules): All Basic rules plus network segmentation, key rotation, access logging

---

## Test Suite

- **3,130+ tests** across 8 packages
- **TypeScript** tests via Vitest, **Go** tests via `go test`
- **End-to-end tests** for both Azure and GCP translation targets
- **12 edge case fixtures** derived from PRD Section 13
- **Performance benchmarks** against a 500-resource fixture
- **Determinism verification** via hash comparison across runs

```bash
# Run all tests
pnpm test

# Run specific package tests
pnpm --filter @tla/translator test
pnpm --filter @tla/validator test

# Run Go provider tests
cd packages/terraform-provider && go test ./...

# Run E2E tests
pnpm --filter @tla/integration-tests test

# Run with coverage
pnpm test -- --coverage
```

---

## Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TLA_REGISTRY_DIR` | `./packages/registry/data` | Path to service equivalence registry YAML files |
| `TLA_TERRAFORM_BIN` | `terraform` | Path to Terraform or OpenTofu binary (used by validator) |
| `TLA_LOG_LEVEL` | `info` | Logging level: `debug`, `info`, `warn`, `error` |
| `TLA_COMPLIANCE_PROFILE` | `cis-basic` | Default compliance profile: `cis-basic`, `cis-advanced` |
| `TLA_MAX_CONCURRENCY` | `4` | Maximum parallel resource translations |
| `TLA_OUTPUT_FORMAT` | `hcl` | Output format: `hcl`, `json` |

### MCP Server Configuration

```json
{
  "mcpServers": {
    "tla": {
      "command": "npx",
      "args": ["@tla/mcp-server", "start"],
      "env": {
        "TLA_REGISTRY_DIR": "./packages/registry/data",
        "TLA_LOG_LEVEL": "info",
        "TLA_COMPLIANCE_PROFILE": "cis-basic"
      }
    }
  }
}
```

### Compliance Profile Selection

```bash
# Use CIS-Basic (default)
npx tla validate ./output --compliance cis-basic

# Use CIS-Advanced
npx tla validate ./output --compliance cis-advanced
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started Guide](docs/GETTING-STARTED.md) | Step-by-step setup, first translation walkthrough |
| [Architecture Deep Dive](docs/ARCHITECTURE.md) | Internal pipeline, engine design, IR schema |
| [MCP & IDE Integration](docs/MCP-INTEGRATION.md) | MCP server setup, VS Code extension, AI agent workflows |
| [GitHub Repository Scanning](docs/GITHUB-INTEGRATION.md) | Scan GitHub repos for AWS Terraform and translate in CI |
| [Portable Provider Guide](docs/PROVIDER-GUIDE.md) | Using `cloud_*` resources in the Go Terraform provider |

---

## Contributing

### Prerequisites

- **Node.js** 22+ with **pnpm**
- **Go** 1.22+ (for the Terraform provider)
- **Terraform** or **OpenTofu** (optional, for validation checks)

### Development Workflow

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type checking
pnpm typecheck

# Lint
pnpm lint

# Build the Go provider
cd packages/terraform-provider
go build ./...
go test ./...
```

### Project Structure

```
Translation_Platform/
  packages/
    shared/           # Shared types, Zod schemas, audit trail
    ingestion/        # HCL parser, dependency graph, IR emitter
    registry/         # Service equivalence registry (YAML)
    translator/       # 5 engine types + Azure/GCP codegen
    validator/        # Validation, policy, compliance
    mcp-server/       # MCP server (10 tools)
    cli/              # Command-line interface
    ide-extension/    # VS Code extension
    terraform-provider/ # Go Terraform provider
    integration-tests/  # E2E test suite
  docs/               # Documentation
```

### Architecture Reference

This project follows **PRD-CTP-002 v3.0**. All translation engines implement the `MappingEngine` plugin interface. The `TranslationCompiler` orchestrates the 7-phase pipeline. Codegen is provider-specific (`AzureCodeGenerator`, `GcpCodeGenerator`) and produces idiomatic HCL via the shared `hcl-writer`.

---

## License

This project is licensed under the [MIT License](LICENSE).
