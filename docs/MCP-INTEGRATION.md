# MCP Server & IDE Integration Guide

This guide covers two integration paths for the TLA (Terraform Landing Zone Accelerator) platform:

1. **MCP Server** -- Exposes the TLA registry, translation engine, and validation pipeline to AI agents (Claude Code, Cursor, etc.) via the Model Context Protocol.
2. **VS Code Extension** -- Provides inline diagnostics, completions, and confidence hints directly in the editor.

---

## 1. MCP Server Overview

The `@tla/mcp-server` package runs as a **stdio-transport** MCP server. An AI agent (or any MCP-compatible host) spawns the process and communicates over stdin/stdout using the MCP JSON-RPC protocol.

**Key characteristics:**

- **Read-only registry access** -- The server loads the registry YAML files from disk and caches them in memory. It never writes to the registry.
- **Full translation pipeline** -- The `translate` tool runs the complete ingestion-to-codegen pipeline (parse HCL, build IR, run TranslationCompiler, write output files).
- **Six-check validation suite** -- syntax, policy, compliance, semantic diff, confidence scoring, and cost estimation.
- **State migration planner** -- Generates `terraform state mv`, `import`, and `rm` commands for AWS-to-target migration.

### Architecture

```
 AI Agent (Claude Code / Cursor / etc.)
       |
       |  stdin/stdout (MCP JSON-RPC)
       v
  tla-mcp-server
       |
       +-- RegistryManager  (lazy-loaded, TTL-cached RegistryApi)
       +-- Tools (10)       (translate, validate, migrate-state, ...)
       +-- Resources (4)    (registry://version, registry://completeness, ...)
       |
       +-- @tla/ingestion   (HCL parser, IR emitter)
       +-- @tla/translator  (TranslationCompiler, codegen)
       +-- @tla/validator   (policy, compliance, confidence)
       +-- @tla/registry    (RegistryApi, YAML loader)
```

---

## 2. Starting the MCP Server

### Standalone (for testing)

```bash
# Uses default settings (empty registry path -- tools will return config errors)
npx tla-mcp

# With full configuration
TLA_REGISTRY_DIR=./packages/registry/data \
TLA_TERRAFORM_BIN=$(which terraform) \
TLA_LOG_LEVEL=info \
npx tla-mcp
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TLA_REGISTRY_DIR` | _(empty)_ | **Required.** Path to the directory containing registry YAML files. |
| `TLA_TERRAFORM_BIN` | `null` | Path to the `terraform` binary. When unset, HCL validation is skipped gracefully. |
| `TLA_LOG_LEVEL` | `info` | One of: `trace`, `debug`, `info`, `warn`, `error`, `silent`. |
| `TLA_SEARCH_LIMIT` | `50` | Maximum results returned by `registry-search`. |
| `TLA_CACHE_TTL_MS` | `30000` | Registry cache TTL in milliseconds. Set to `0` to reload on every request. |

---

## 3. Connecting to Claude Code

Add the server to your project-level or user-level Claude settings.

### Project-level (`.claude/settings.json`)

```json
{
  "mcpServers": {
    "tla": {
      "command": "npx",
      "args": ["tla-mcp"],
      "env": {
        "TLA_REGISTRY_DIR": "/absolute/path/to/packages/registry/data",
        "TLA_TERRAFORM_BIN": "/usr/local/bin/terraform",
        "TLA_LOG_LEVEL": "info"
      }
    }
  }
}
```

### User-level (`~/.claude/settings.json`)

Same structure. Use an absolute path for `TLA_REGISTRY_DIR` since the server does not resolve relative paths against the project root.

### Verification

After adding the config, restart Claude Code and verify the server is connected:

```
> What MCP tools are available from the tla server?
```

Claude should list all 10 tools and 4 resources.

---

## 4. MCP Tools Reference (10 Tools)

### 4.1 `translate`

**Description:** Translate a Terraform file or directory from AWS to the target cloud provider.

**Input schema:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `source` | string | yes | Absolute path to a `.tf` file/directory, or raw HCL when `sourceType` is `inline`. |
| `sourceType` | `file` \| `directory` \| `inline` | yes | How to interpret `source`. |
| `target` | `azure` \| `gcp` | yes | Target cloud provider. |
| `scope` | `full` \| `assessment` \| `selected` | yes | `full` = translate everything; `assessment` = inventory only; `selected` = scoped to specific resources. |
| `selectedResources` | string[] | no | Resource addresses when scope is `selected` (e.g. `["aws_instance.web"]`). |
| `outputDir` | string | no | Directory for output files. Defaults to a unique temp directory. |

**Example request:**

```json
{
  "source": "/home/user/infra/main.tf",
  "sourceType": "file",
  "target": "azure",
  "scope": "full"
}
```

**Example response:**

```json
{
  "success": true,
  "target": "azure",
  "outputDir": "/tmp/tla-output-azure-abc123",
  "files": ["main.tf", "providers.tf", "terraform.tf", "variables.tf", "outputs.tf", "manifest.json", "translation-report.md", "audit-log.jsonl", "confidence-report.json"],
  "manifest": {
    "translated": 8,
    "expanded": 2,
    "partial": 1,
    "blocked": 0,
    "advisory": 1
  },
  "confidence": 0.87,
  "findings": [
    {
      "resourceId": "aws_dynamodb_table.events",
      "severity": "warning",
      "code": "DYNAMODB_ADVISORY",
      "message": "DynamoDB has no direct equivalent -- see advisory notes."
    }
  ]
}
```

**Use cases:**
- Full infrastructure translation (file or directory)
- Quick assessment of an AWS codebase before committing to migration
- Selective translation of specific resources

---

### 4.2 `equivalence-lookup`

**Description:** Look up cloud-provider equivalents for one or more AWS resource types. Returns band, confidence, and target types. Not-found results include prefix-based nearest-match suggestions.

**Input schema:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `service` | string | no | Single AWS resource type (e.g. `aws_s3_bucket`). |
| `services` | string[] | no | Bulk lookup: array of AWS resource types. |
| `target` | `azure` \| `gcp` \| `both` | yes | Target provider(s). |
| `detail` | `summary` \| `full` | yes | `summary` = band/confidence/types; `full` = adds behavioral gaps and edge cases. |

Provide either `service` (single) or `services` (bulk), not both.

**Example request (single):**

```json
{
  "service": "aws_s3_bucket",
  "target": "both",
  "detail": "summary"
}
```

**Example response:**

```json
{
  "found": true,
  "aws_resource_type": "aws_s3_bucket",
  "azure": {
    "types": ["azurerm_storage_account", "azurerm_storage_container"],
    "band": "P1",
    "band_description": "Direct mapping, high confidence",
    "confidence": 0.92
  },
  "gcp": {
    "types": ["google_storage_bucket"],
    "band": "P1",
    "band_description": "Direct mapping, high confidence",
    "confidence": 0.92
  },
  "mapping_type": "direct",
  "manual_review_required": false
}
```

**Example response (not found):**

```json
{
  "found": false,
  "aws_resource_type": "aws_s3_bucket_foobar",
  "message": "No registry entry found for 'aws_s3_bucket_foobar'.",
  "suggestions": ["aws_s3_bucket", "aws_s3_bucket_policy", "aws_s3_bucket_acl"]
}
```

**Use cases:**
- Quick "what maps to what?" lookups during planning
- Bulk pre-flight check of all resource types in a codebase
- Discovering which resources need manual migration

---

### 4.3 `validate`

**Description:** Run validation checks on translated Terraform output. Executes up to six check types in dependency order.

**Input schema:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `translated_dir` | string | yes | Path to directory containing translated `.tf` files. |
| `provider` | `azure` \| `gcp` | yes | Target provider whose rules to apply. |
| `strict` | boolean | no | When `true`, treat warnings as failures. Default: `false`. |
| `irFile` | string | no | Path to a CanonicalIR JSON file. Enables semantic diff, confidence, and cost checks. |
| `checks` | string[] | no | Subset of checks: `syntax`, `policy`, `compliance`, `semantic`, `confidence`, `cost`. Default: all six. |
| `complianceProfile` | `cis-basic` \| `cis-advanced` \| `none` | no | CIS compliance profile. Default: `cis-basic`. |
| `policyDir` | string | no | Custom OPA policy directory (reserved for future use). |

**Example request:**

```json
{
  "translated_dir": "/tmp/tla-output-azure-abc123",
  "provider": "azure",
  "strict": false,
  "checks": ["syntax", "policy", "compliance"]
}
```

**Example response:**

```json
{
  "success": true,
  "overallResult": "pass",
  "checks": {
    "syntax": { "result": "pass", "filesChecked": 5, "duration": 12, "issues": [] },
    "policy": { "result": "pass", "passed": 14, "failed": 0, "warnings": 0, "duration": 45 },
    "compliance": { "result": "pass", "score": 100, "profile": "cis-basic", "duration": 8 }
  },
  "findings": [],
  "totalDuration": 65
}
```

**Use cases:**
- Post-translation validation before applying
- CI pipeline gate (use `strict: true` for zero-warning enforcement)
- Targeted checks (e.g., only `syntax` for a quick smoke test)

---

### 4.4 `migrate-state`

**Description:** Generate a Terraform state migration plan for moving AWS state to the translated target cloud infrastructure.

**Input schema:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `stateFile` | string | no | Path to the AWS `.tfstate` file. Omit for manifest-only plan. |
| `translationResultDir` | string | yes | Path to translated output directory (must contain `manifest.json`). |
| `target` | `azure` \| `gcp` | yes | Target cloud provider. |
| `scope` | `full` \| `stack` | yes | `full` = all resources; `stack` = scoped to module prefixes. |
| `selectedStacks` | string[] | no | Module name prefixes when scope is `stack`. |
| `generateBackend` | boolean | yes | Include target-provider backend HCL snippet. |
| `generateRollback` | boolean | yes | Include rollback manifest with inverse operations. |

**Example request:**

```json
{
  "stateFile": "/home/user/infra/terraform.tfstate",
  "translationResultDir": "/tmp/tla-output-azure-abc123",
  "target": "azure",
  "scope": "full",
  "generateBackend": true,
  "generateRollback": true
}
```

**Example response (abbreviated):**

```json
{
  "success": true,
  "target": "azure",
  "scope": "full",
  "summary": { "moves": 5, "imports": 2, "removes": 1, "orphans": 0, "warnings": 0 },
  "moves": [
    {
      "source": "aws_instance.web",
      "destination": "azurerm_linux_virtual_machine.web",
      "commandString": "terraform state mv aws_instance.web azurerm_linux_virtual_machine.web"
    }
  ],
  "imports": [],
  "removes": [],
  "backendConfig": {
    "provider": "azure",
    "hclSnippet": "terraform {\n  backend \"azurerm\" {\n    ...\n  }\n}"
  }
}
```

**Use cases:**
- Generate migration runbook from existing state
- Stack-scoped migration (e.g., only the networking module)
- Rollback planning before executing destructive operations

---

### 4.5 `assess`

**Description:** Assess a Terraform configuration -- produce an inventory, readiness report, and confidence summary without translating.

**Input schema:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `source_path` | string | yes | Absolute path to a `.tf` file or directory. |
| `target_provider` | `azure` \| `gcp` | yes | Target cloud provider. |

**Use cases:**
- Pre-migration assessment without running translation
- Executive summary of migration complexity

---

### 4.6 `registry-search`

**Description:** Search the registry with filters on family, band, mapping type, and minimum confidence.

**Input schema:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `family` | string | no | Filter by AWS service family: `compute`, `storage`, `database`, `networking`, `security`, `serverless`, `messaging`, `observability`, `containers`, `identity`. |
| `band` | `P1` \| `P2` \| `N1` \| `M1` | no | Filter by translation band. |
| `mapping_type` | `direct` \| `parametric` \| `compound` \| `structural` \| `none` | no | Filter by mapping type. |
| `min_confidence` | number (0-1) | no | Minimum confidence score. |
| `limit` | integer | no | Maximum results. Default: server-configured limit (50). |

**Example request:**

```json
{
  "family": "compute",
  "band": "P1",
  "min_confidence": 0.8
}
```

**Example response:**

```json
{
  "total": 3,
  "returned": 3,
  "entries": [
    {
      "registry_entry_id": "SER-COM-EC2-001",
      "aws_service": "aws_instance",
      "band": "P1",
      "confidence": 0.85,
      "mapping_type": "compound",
      "azure_targets": ["azurerm_linux_virtual_machine"],
      "gcp_targets": ["google_compute_instance"]
    }
  ]
}
```

**Use cases:**
- Browse all supported services by family
- Find high-confidence mappings for automated pipelines
- Identify M1/N1 resources that need manual attention

---

### 4.7 `registry-stats`

**Description:** Return aggregate completeness metrics for the registry.

**Input schema:** No parameters.

**Example response:**

```json
{
  "totalEntries": 42,
  "byFamily": { "compute": 8, "storage": 5, "database": 6, "networking": 10, "security": 4, "serverless": 3, "messaging": 2, "observability": 2, "containers": 1, "identity": 1 },
  "byBand": { "P1": 15, "P2": 12, "N1": 8, "M1": 7 },
  "byMappingType": { "direct": 15, "parametric": 10, "compound": 6, "structural": 6, "none": 5 },
  "averageConfidence": 0.78
}
```

**Use cases:**
- Dashboard metrics for migration readiness
- Tracking registry growth over time

---

### 4.8 `explain-mapping`

**Description:** Get a detailed explanation of how an AWS resource type maps to the target provider, including gaps and review notes.

**Input schema:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `aws_resource_type` | string | yes | AWS resource type (e.g. `aws_instance`). |
| `target_provider` | `azure` \| `gcp` | yes | Target cloud provider. |

**Example request:**

```json
{
  "aws_resource_type": "aws_security_group",
  "target_provider": "azure"
}
```

**Example response:**

```json
{
  "registry_entry_id": "SER-NET-SG-001",
  "aws_service": "aws_security_group",
  "target_provider": "azure",
  "targets": ["azurerm_network_security_group", "azurerm_network_security_rule"],
  "mapping_type": "structural",
  "band": "P2",
  "confidence": 0.82,
  "behavioral_gaps": [
    {
      "description": "Rule broadening: 0.0.0.0/0 with protocol -1 is a BLOCKER",
      "severity": "blocker",
      "affected_targets": ["azure", "gcp"]
    }
  ],
  "manual_review_required": true,
  "review_domains": ["security"]
}
```

**Use cases:**
- Deep-dive into a specific resource's translation strategy
- Understanding why a resource has low confidence
- Identifying blockers before translation

---

### 4.9 `list-gaps`

**Description:** List behavioral gaps across all or specific AWS services.

**Input schema:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `aws_resource_type` | string | no | Filter to a specific AWS resource type. |
| `severity` | `minor` \| `major` \| `blocker` | no | Filter by gap severity. |
| `target_provider` | `azure` \| `gcp` | no | Filter gaps relevant to a target provider. |

**Example request:**

```json
{
  "severity": "blocker",
  "target_provider": "azure"
}
```

**Example response:**

```json
{
  "total": 2,
  "gaps": [
    {
      "description": "Security group rule broadening to 0.0.0.0/0 with unrestricted protocol",
      "severity": "blocker",
      "affected_targets": ["azure", "gcp"],
      "registry_entry_id": "SER-NET-SG-001",
      "aws_service": "aws_security_group"
    }
  ]
}
```

**Use cases:**
- Pre-migration risk assessment
- Generating a blockers report for stakeholders
- Filtering to provider-specific gaps

---

### 4.10 `confidence-check`

**Description:** Return the confidence score and contributing factors for translating a specific AWS resource type.

**Input schema:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `aws_resource_type` | string | yes | AWS resource type. |
| `target_provider` | `azure` \| `gcp` | yes | Target cloud provider. |

**Example request:**

```json
{
  "aws_resource_type": "aws_rds_cluster",
  "target_provider": "azure"
}
```

**Example response:**

```json
{
  "registry_entry_id": "SER-DB-RDS-001",
  "aws_resource_type": "aws_rds_cluster",
  "target_provider": "azure",
  "confidence": 0.78,
  "band": "P2",
  "mapping_type": "compound",
  "manual_review_required": true,
  "gap_summary": { "blockers": 1, "majors": 2, "minors": 1 }
}
```

**Use cases:**
- Quick go/no-go check for a specific resource
- Building confidence heat maps across a codebase
- Identifying resources that need manual review

---

## 5. MCP Resources (4 Resources)

Resources provide read-only, URI-addressable data from the registry.

### 5.1 `registry://version`

Returns the current registry version string loaded from the YAML files.

```json
{ "version": "1.0.0" }
```

### 5.2 `registry://completeness`

Returns aggregate completeness metrics: entry counts by family, band, mapping type, and average confidence. Same data as the `registry-stats` tool but accessible as a static resource.

### 5.3 `registry://entry/{entry_id}`

Returns a single registry entry by its `registry_entry_id` (e.g. `SER-COM-EC2-001`).

**Example URI:** `registry://entry/SER-COM-EC2-001`

Returns the full registry entry JSON including `aws_service`, `azure_targets`, `gcp_targets`, `band`, `confidence`, `behavioral_gaps`, and all other fields.

### 5.4 `registry://family/{family}`

Returns all registry entries belonging to a specific AWS service family.

**Example URI:** `registry://family/compute`

**Valid families:** `compute`, `storage`, `database`, `networking`, `security`, `serverless`, `messaging`, `observability`, `containers`, `identity`.

---

## 6. VS Code Extension Setup

The `tla-terraform-extension` provides real-time feedback while editing Terraform files.

### Installation

**From `.vsix` file (local build):**

```bash
cd packages/ide-extension
npm run build
npm run package
# Install in VS Code:
code --install-extension tla-terraform-extension-0.1.0.vsix
```

**From marketplace:** (when published) Search for "TLA Terraform Translation" in the Extensions panel.

### Configuration

Open VS Code Settings (Cmd+Comma / Ctrl+Comma) and search for "TLA":

| Setting | Type | Default | Description |
|---|---|---|---|
| `tla.targetProvider` | `azure` \| `gcp` \| `both` | `both` | Which target provider(s) to show diagnostics for. |
| `tla.enableDiagnostics` | boolean | `true` | Enable/disable inline diagnostics. |

**settings.json example:**

```json
{
  "tla.targetProvider": "azure",
  "tla.enableDiagnostics": true
}
```

### Features

#### Cloud-agnostic Completions (`cloud_*`)

When typing inside a `resource` block, the extension offers portable abstract resource names:

- `cloud_object_storage` -- Maps to aws_s3_bucket / azurerm_storage_account / google_storage_bucket
- `cloud_container_registry` -- Maps to aws_ecr_repository / azurerm_container_registry / google_artifact_registry_repository
- `cloud_cache_redis` -- Maps to aws_elasticache_replication_group / azurerm_redis_cache / google_redis_instance

Completions trigger when you type `cloud_` or open a quote after `resource "`.

#### AWS Resource Confidence Hints

For every `resource "aws_*" "name" {}` block in a `.tf` file, the extension looks up the resource in the bundled registry snapshot and shows:

- **P1/P2 resources:** No diagnostic (high confidence, automated translation available).
- **N1 resources:** Information-level hint with confidence score and mapping type: _"aws_lambda_function is band N1 (structural mapping). Translation available but may need review. Confidence: 0.75."_
- **M1 resources:** Warning-level diagnostic: _"aws_dynamodb_table is band M1 (advisory/manual). No automated translation -- manual migration required."_
- **Unknown resources:** Information hint: _"aws_foobar is not in the TLA registry. Translation unavailable."_

#### Non-portable Pattern Warnings

The extension flags patterns that reduce portability:

| Code | Severity | Pattern | Message |
|---|---|---|---|
| `TLA-PROV-LOCAL` | Warning | `provisioner "local-exec"` | local-exec provisioner is not portable across cloud providers. |
| `TLA-PROV-REMOTE` | Warning | `provisioner "remote-exec"` | remote-exec provisioner is not portable across cloud providers. |
| `TLA-DATA-EXT` | Information | `data "external"` | external data source may not be portable across cloud providers. |
| `TLA-REGION-HARDCODED` | Warning | `region = "us-east-1"` (etc.) | Hardcoded AWS region detected. Use a variable for portability. |

Diagnostics refresh automatically on file open, save, and change.

---

## 7. AI Agent Workflows

These are common multi-tool workflows an AI agent uses when working with the MCP server.

### Assessment Workflow

Goal: Understand migration complexity before committing.

```
1. equivalence-lookup
   { services: ["aws_instance", "aws_s3_bucket", "aws_rds_cluster", ...],
     target: "both", detail: "full" }
   --> Understand per-resource mapping status

2. registry-stats
   {}
   --> Get overall registry coverage

3. confidence-check  (for each resource with low confidence)
   { aws_resource_type: "aws_rds_cluster", target_provider: "azure" }
   --> Understand gap breakdown

4. list-gaps
   { severity: "blocker" }
   --> Surface all blockers before proceeding
```

### Translation Workflow

Goal: Translate and validate an AWS Terraform codebase.

```
1. translate
   { source: "/path/to/infra", sourceType: "directory",
     target: "azure", scope: "full" }
   --> Produces translated files in outputDir

2. validate
   { translated_dir: "<outputDir from step 1>",
     provider: "azure", strict: false }
   --> Run all six validation checks

3. confidence-check  (for any flagged resources)
   { aws_resource_type: "aws_lambda_function", target_provider: "azure" }
   --> Drill into specific confidence concerns
```

### Migration Workflow

Goal: Translate, plan state migration, and validate.

```
1. translate
   { source: "/path/to/infra", sourceType: "directory",
     target: "azure", scope: "full", outputDir: "/path/to/output" }

2. migrate-state
   { stateFile: "/path/to/terraform.tfstate",
     translationResultDir: "/path/to/output",
     target: "azure", scope: "full",
     generateBackend: true, generateRollback: true }
   --> Generates move/import/remove commands + backend config + rollback plan

3. validate
   { translated_dir: "/path/to/output", provider: "azure" }
   --> Final validation before applying
```

### Exploration Workflow

Goal: Browse registry capabilities.

```
1. registry-search
   { family: "networking" }
   --> See all networking-related mappings

2. explain-mapping
   { aws_resource_type: "aws_security_group", target_provider: "azure" }
   --> Deep-dive into a specific mapping

3. list-gaps
   { aws_resource_type: "aws_security_group", target_provider: "azure" }
   --> See all gaps for that resource
```

---

## 8. Troubleshooting

### Registry not found

**Symptom:** Every tool returns `"Registry directory is not configured."`

**Fix:** Set `TLA_REGISTRY_DIR` to the absolute path of the registry data directory:

```json
{
  "env": {
    "TLA_REGISTRY_DIR": "/Volumes/Externalwork/Translation_Platform/packages/registry/data"
  }
}
```

Verify the directory contains `.yaml` or `.yml` files.

### Terraform binary missing

**Symptom:** `validate` tool skips HCL validation with a note about Terraform not being configured.

**Fix:** Set `TLA_TERRAFORM_BIN`:

```bash
TLA_TERRAFORM_BIN=$(which terraform) npx tla-mcp
```

Or in settings:

```json
{
  "env": {
    "TLA_TERRAFORM_BIN": "/usr/local/bin/terraform"
  }
}
```

This is not a hard requirement -- the validate tool degrades gracefully and runs the remaining five checks.

### MCP server fails to start

**Symptom:** Claude Code reports "MCP server tla failed to start" or similar.

**Checks:**

1. Ensure Node.js >= 22 is installed: `node --version`
2. Ensure the package is built: `cd packages/mcp-server && npm run build`
3. Test manually: `TLA_REGISTRY_DIR=... node packages/mcp-server/dist/server.js`
4. Check for missing dependencies: `pnpm install` from the monorepo root.

### translate tool returns "No .tf files found"

**Symptom:** `{ "success": false, "error": "No .tf files found in the specified source." }`

**Checks:**

- For `sourceType: "file"`, ensure the path points to a `.tf` file (not a directory).
- For `sourceType: "directory"`, ensure the directory contains at least one `.tf` file.
- For `sourceType: "inline"`, ensure the `source` field contains valid HCL content (not a path).

### VS Code extension diagnostics not appearing

**Checks:**

1. Ensure the file is recognized as Terraform: bottom-right corner of VS Code should show "Terraform" or the file ends in `.tf`.
2. Check that `tla.enableDiagnostics` is `true` in settings.
3. Open the Output panel (View > Output) and select "TLA" from the dropdown to see extension logs.
4. Reload the window: Cmd+Shift+P > "Developer: Reload Window".

### Cache staleness

**Symptom:** Registry changes are not reflected in tool responses.

**Fix:** The registry is cached with a 30-second TTL by default. Either wait for the TTL to expire, or set `TLA_CACHE_TTL_MS=0` to disable caching entirely (useful during development).
