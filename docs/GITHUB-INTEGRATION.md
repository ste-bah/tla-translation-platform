# GitHub Repository Integration

Scan, assess, and translate existing Terraform repositories from GitHub using TLA.

> **See also**: [Getting Started](GETTING-STARTED.md) | [Architecture](ARCHITECTURE.md) | [MCP Integration](MCP-INTEGRATION.md)

---

## Overview

TLA can analyze any GitHub repository containing AWS Terraform configurations and produce equivalent Azure or GCP output. The workflow is:

1. Clone the repository locally
2. Run an assessment to inventory AWS resources and estimate coverage
3. Review confidence scores and gap analysis
4. Execute full or incremental translation
5. Validate the output with syntax, policy, and compliance checks

TLA never modifies your source repository. All output is written to a separate directory.

---

## Scanning a GitHub Repository

Clone the target repository and run TLA in assessment mode to get a resource inventory before committing to a full translation.

```bash
git clone https://github.com/your-org/infrastructure.git
cd infrastructure

# Assessment only — no files generated
npx tla translate . --target azure --scope assessment
```

For repositories with Terraform spread across subdirectories:

```bash
npx tla translate ./terraform --target azure --scope assessment
npx tla translate ./modules --target azure --scope assessment
```

---

## Assessment Report

The assessment produces a structured report covering:

| Section | Description |
|---------|-------------|
| **Resource Inventory** | Total resource count grouped by AWS service type |
| **Registry Coverage** | Which resources have TLA mappings (direct, parametric, compound, structural, advisory) and which are unmapped |
| **Confidence Scores** | Per-resource and per-service-family confidence (0.0 to 1.0) reflecting translation completeness |
| **Gap Analysis** | Findings by severity: blockers, warnings, and informational notes |
| **Recommended Approach** | Whether full translation or incremental (stack-by-stack) migration is advisable |
| **Manual Review Items** | Resources requiring human review (advisory-only services, opaque modules, provisioners) |

A high overall confidence score (above 0.85) with no blockers suggests the repository is a good candidate for full automated translation. Lower scores or blocker findings indicate incremental migration is safer.

---

## Full Translation Workflow

```bash
# Step 1: Assessment — understand what you are working with
npx tla translate ./terraform --target azure --scope assessment

# Step 2: Full translation — generate Azure-equivalent Terraform
npx tla translate ./terraform --target azure --output ./azure-terraform

# Step 3: Validate output — syntax, policy, compliance, and confidence checks
npx tla validate ./azure-terraform --target azure --checks syntax,policy,compliance,confidence

# Step 4: Review the translation report
cat ./azure-terraform/translation-report.md

# Step 5: (Optional) Run terraform plan with provider credentials
cd ./azure-terraform && terraform init && terraform plan
```

### What each step produces

- **Step 2** generates `.tf` files (main, providers, terraform, variables, outputs) plus `manifest.json` (machine-readable manifest), `translation-report.md` (human-readable summary), `audit-log.jsonl` (audit trail), and `confidence-report.json` (per-resource confidence).
- **Step 3** validates the generated HCL for syntactic correctness, checks for policy violations (e.g. public access, missing encryption), verifies compliance with cloud provider conventions, and flags low-confidence translations.
- **Step 5** requires provider credentials (`ARM_SUBSCRIPTION_ID`, `ARM_TENANT_ID`, etc. for Azure or `GOOGLE_PROJECT` for GCP). This is optional but recommended before applying.

---

## Incremental Translation

For large repositories, translate specific resources or stacks rather than everything at once.

### Selected resources

```bash
npx tla translate ./terraform --target azure \
  --scope selected \
  --selected aws_vpc.main aws_subnet.private aws_s3_bucket.data
```

### Stack-by-stack migration

```bash
npx tla migrate-state \
  --state terraform.tfstate \
  --target azure \
  --scope stack \
  --stacks module.networking
```

### Recommended incremental order

1. **Networking** first (VPC, subnets, security groups, NAT) -- most resources depend on these
2. **Data stores** next (S3, RDS, ElastiCache) -- stateful resources need careful validation
3. **Compute** (EC2, ECS, Lambda) -- depends on networking and data
4. **Edge / CDN / DNS** last (CloudFront, Route53) -- depends on everything else

---

## Multi-Provider Repositories

Many repositories contain resources from multiple Terraform providers. TLA classifies each resource:

| Provider / Type | TLA Behavior | Example |
|-----------------|-------------|---------|
| `aws_*` | Translated (direct, parametric, compound, or structural mapping) | `aws_vpc`, `aws_s3_bucket`, `aws_lambda_function` |
| `aws_dynamodb_table`, `aws_iam_*` | Advisory only -- produces manual migration guidance, no generated HCL | `aws_dynamodb_table`, `aws_iam_role` |
| `null_resource`, `random_*`, `template_*` | Classified as procedural/utility -- passed through or flagged for review | `null_resource.provisioner`, `random_id.suffix` |
| `helm_*`, `kubernetes_*` | Skipped -- orchestration-layer resources not translated | `helm_release.nginx`, `kubernetes_deployment.app` |
| Unknown providers | Marked as review-required with an informational finding | `datadog_monitor.alert`, `pagerduty_service.web` |

The translation report clearly separates translated, advisory, passed-through, skipped, and review-required resources.

---

## CI/CD Integration

Add TLA as a GitHub Actions check on pull requests to catch translation regressions or new unmapped resources.

```yaml
name: TLA Translation Check
on:
  pull_request:
    paths:
      - 'terraform/**'
      - 'modules/**'

jobs:
  assess:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Run TLA assessment
        run: npx tla translate ./terraform --target azure --scope assessment

      - name: Validate translation output
        run: npx tla validate ./azure-output --target azure --checks syntax,policy,compliance

      - name: Upload translation report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: tla-report
          path: ./azure-output/translation-report.md
```

### Multi-target matrix

To validate against both Azure and GCP:

```yaml
jobs:
  assess:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        target: [azure, gcp]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npx tla translate ./terraform --target ${{ matrix.target }} --scope assessment
      - run: npx tla validate ./output --target ${{ matrix.target }} --checks syntax,policy,compliance
```

---

## Handling Edge Cases

### Opaque modules

Remote modules (`source = "git::https://..."` or registry modules) cannot be expanded locally. TLA:
- Flags them as `review-required` with an informational finding
- Reports the module source and any known input/output variables
- Recommends pinning to a specific version and translating the module separately

### local-exec provisioners

Provisioners with `local-exec` or `remote-exec` are inherently imperative. TLA:
- Preserves the provisioner block in the output with a warning finding
- Does not attempt to translate shell commands
- Recommends replacing provisioners with cloud-native alternatives (e.g. Azure VM extensions, GCP startup scripts)

### Missing Terraform state

TLA translates HCL source files, not Terraform state. If the repository has no `.tfstate`:
- Translation proceeds normally from the `.tf` files
- The `migrate-state` command will report an error if invoked without a state file
- Resource import commands are included in the translation report to help bootstrap state for the target provider

### Advisory-only services (DynamoDB, IAM, CloudFront)

Some AWS services have no direct cloud equivalent or require architectural decisions that cannot be automated. TLA:
- Produces detailed advisory findings (pattern detection for DynamoDB, policy analysis for IAM)
- Generates no HCL output for advisory resources (`translated: []`)
- Sets manifest status to `advisory` for these resources
- Includes recommended target-provider alternatives in the findings detail

---

## Assessment Mode

See what translation will produce without generating any files:

```bash
npx tla translate ./terraform --target azure --scope assessment
```

Assessment output includes:
- Resource count and mapping type breakdown (direct, parametric, compound, structural, advisory, none)
- Estimated confidence score per resource
- Blocker findings that would prevent clean translation
- File list that would be generated

This is useful for quick feasibility checks before committing to a full translation run.

---

## Related Documentation

- [Getting Started](GETTING-STARTED.md) -- Installation, prerequisites, and first translation
- [Architecture](ARCHITECTURE.md) -- Internal pipeline design and engine types
- [MCP Integration](MCP-INTEGRATION.md) -- Using TLA through MCP tool servers
