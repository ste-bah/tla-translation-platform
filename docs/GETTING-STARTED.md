# Getting Started with TLA Translation Platform

Translate Terraform configurations from AWS to Azure or GCP with confidence scoring, gap analysis, and actionable findings.

## Prerequisites

| Tool | Version | Required | Purpose |
|------|---------|----------|---------|
| Node.js | 22+ | Yes | Runtime for all packages |
| pnpm | 10+ | Yes | Monorepo package manager |
| Go | 1.22+ | No | Terraform provider plugin (optional) |
| Terraform / OpenTofu | 1.5+ | No | Validate generated output (optional) |

Verify your environment:

```bash
node --version   # v22.x.x or higher
pnpm --version   # 10.x.x or higher
```

## Installation

```bash
git clone https://github.com/your-org/Translation_Platform.git
cd Translation_Platform

pnpm install
pnpm build
```

The monorepo contains these packages:

| Package | Description |
|---------|-------------|
| `@tla/cli` | Command-line interface (`tla` binary) |
| `@tla/translator` | Core translation engines (direct, parametric, compound, structural, advisory) |
| `@tla/ingestion` | HCL parser, IR model, dependency graph |
| `@tla/registry` | Resource mapping registry (AWS to Azure/GCP) |
| `@tla/validator` | Syntax, policy, and compliance checks |
| `@tla/shared` | Shared types and Zod schemas |
| `@tla/mcp-server` | MCP server integration |
| `@tla/terraform-provider` | Terraform provider plugin (Go) |
| `@tla/ide-extension` | IDE extension |

## Your First Translation

### 1. Create a sample Terraform configuration

Create a directory with a simple AWS setup:

```bash
mkdir -p sample
```

Write `sample/main.tf`:

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name        = "main-vpc"
    Environment = "production"
  }
}

resource "aws_s3_bucket" "assets" {
  bucket = "my-app-assets-bucket"

  tags = {
    Name        = "assets"
    Environment = "production"
  }
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id

  versioning_configuration {
    status = "Enabled"
  }
}
```

### 2. Run an assessment

An assessment analyzes the configuration without generating output files. It tells you what TLA can translate, what needs attention, and what requires manual work.

```bash
npx tla translate ./sample --target azure --scope assessment
```

The assessment prints a summary like:

```
Translation Assessment for ./sample -> azure
=============================================
Resources found: 3
  aws_vpc          -> azurerm_virtual_network   [P2 parametric]  confidence: 0.85
  aws_s3_bucket    -> azurerm_storage_account   [P1 direct]      confidence: 0.92
  aws_s3_bucket_versioning -> (merged into storage_account) [compound]

Findings: 2 info, 0 warnings, 0 blockers
Overall confidence: 0.88
```

### 3. Run the full translation

```bash
npx tla translate ./sample --target azure --output ./azure-output
```

This runs the five-phase pipeline: **resolve** (dependency graph) -> **plan** (topological sort and engine selection) -> **emit** (per-resource translation) -> **assemble** (HCL generation) -> **manifest** (summary and findings).

### 4. Review the manifest

Open `azure-output/manifest.json`. It contains:

```json
{
  "version": "1.0.0",
  "registryVersion": "1.0.0",
  "target": "azure",
  "counts": {
    "total": 3,
    "translated": 2,
    "expanded": 0,
    "partial": 0,
    "blocked": 0,
    "advisory": 1
  },
  "entries": [
    {
      "sourceId": "main",
      "sourceType": "aws_vpc",
      "status": "translated",
      "targetResources": [
        {
          "targetType": "azurerm_virtual_network",
          "targetName": "main",
          "attributes": {},
          "sourceId": "main",
          "traceability": { "sourceId": "main", "engine": "parametric", "confidence": 0.85 }
        }
      ],
      "confidence": 0.85,
      "findings": []
    }
  ],
  "findings": [],
  "confidenceOverall": 0.88
}
```

Key fields:
- **status** -- translation outcome: translated, expanded, partial, blocked, or advisory
- **confidence** -- 0.0 to 1.0 score for translation completeness
- **findings** -- per-resource warnings, blockers, or informational notes
- **targetResources** -- the Azure/GCP resources generated for this source resource
- **traceability** -- links back to the source resource and engine used

## Understanding the Output

The output directory contains five files:

| File | Purpose |
|------|---------|
| `main.tf` | Translated resource definitions |
| `providers.tf` | Target provider configuration (e.g. `azurerm` with `features {}`) |
| `terraform.tf` | Terraform version and required providers block |
| `variables.tf` | Input variables (subscription_id, region, etc.) |
| `outputs.tf` | Output values carried over from the source |
| `manifest.json` | Translation metadata, confidence scores, findings |
| `translation-report.md` | Human-readable translation summary with findings |
| `audit-log.jsonl` | Append-only audit trail for compliance |
| `confidence-report.json` | Per-resource confidence scores and escalation flags |
| `migration-pack.md` | Remediation tasks for blocked/advisory resources (conditional) |

For Azure, `providers.tf` includes the required `features {}` block. For GCP, it includes `project` and `region` from variables.

> **Note:** Translation now also produces `translation-report.md` (human-readable summary), `audit-log.jsonl` (compliance audit trail), `confidence-report.json` (per-resource confidence with escalation flags), and conditionally `migration-pack.md` (remediation tasks when blocked or advisory resources exist).

## Translation Bands

Every resource maps to one of four translation bands. The band determines the confidence level and how much manual review is needed.

| Band | Name | Confidence | What It Means |
|------|------|-----------|---------------|
| **P1** | Direct | 0.85 -- 0.95 | 1:1 attribute mapping. Minimal review needed. Examples: S3, ECR, ElastiCache Redis, Route53 zones, VPC Peering. |
| **P2** | Parametric | 0.70 -- 0.90 | Requires cross-resource references or parameter transformation. Review variable wiring. Examples: VPC, Subnet, NAT Gateway, KMS, Secrets Manager, EKS. |
| **N1** | Needs Attention | 0.40 -- 0.70 | Structural reshaping or topology changes. Review the generated code carefully. Examples: Security Groups (may contain BLOCKER findings), Lambda, ECS, SQS FIFO, SNS FIFO. |
| **M1** | Manual / Advisory | 0.0 -- 0.40 | No direct equivalent. TLA generates advisory stubs with migration guidance in the findings. Examples: DynamoDB, IAM policies, CloudFront, Route53 health checks. |

When you see a **BLOCKER** finding (e.g., a security group with `0.0.0.0/0` and protocol `-1`), the resource is excluded from output and must be addressed manually. This is intentional -- TLA refuses to translate configurations that would create security vulnerabilities.

## Running Validation

After translation, validate the output:

```bash
npx tla validate ./azure-output --target azure --checks syntax,policy,compliance
```

Check types:

| Check | What It Does |
|-------|--------------|
| `syntax` | Parses the generated HCL for structural correctness |
| `policy` | Verifies security policies (no public access by default, encryption enabled) |
| `compliance` | Checks provider-specific requirements (Azure `features {}` block, GCP API enablement) |

If you have Terraform or OpenTofu installed, you can also run native validation:

```bash
cd azure-output
terraform init
terraform validate
```

## Running a Standalone Assessment

```bash
npx tla assess ./sample --target azure
```

Assessment produces a readiness report with per-resource risk classification (safe/review/blocked), overall readiness score, and estimated manual effort -- without generating translation output.

## Generating State Migration Commands

After translating, generate Terraform state migration commands:

```bash
npx tla migrate-state --state terraform.tfstate --translated-dir ./azure-output --target azure
```

This produces move, import, and remove commands for migrating existing Terraform state to the new target provider structure.

## Translating to GCP

The same workflow works for GCP:

```bash
npx tla translate ./sample --target gcp --output ./gcp-output
```

GCP-specific behavior:
- AWS tags become GCP labels (63-char limit, lowercase-only, reserved prefix dropping)
- Regions map through `AWS_TO_GCP_REGION` (e.g., `us-east-1` -> `us-east1`)
- The provider block includes `project` (from `var.project_id`) and `region`
- Required API comments are added per resource type

## Next Steps

- **Architecture**: See `packages/translator/src/` for the five-phase compiler pipeline and engine implementations
- **MCP Integration**: The `@tla/mcp-server` package exposes translation as MCP tools for IDE and agent workflows
- **Terraform Provider**: The `packages/terraform-provider/` directory contains a Go-based Terraform provider for running translations as `terraform plan/apply`
- **Validation**: The `@tla/validator` package provides programmatic access to syntax, policy, and compliance checks
- **Registry**: The `@tla/registry` package contains all resource mappings and can be extended with new AWS resource types
- **Integration Tests**: Run `pnpm test` from the root or `cd packages/integration-tests && pnpm test` for end-to-end scenarios
