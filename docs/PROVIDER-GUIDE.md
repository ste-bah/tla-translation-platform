# TLA Terraform Provider Guide

## What is the TLA Provider

The TLA Terraform provider exposes cloud-neutral `cloud_*` resources that generate native Terraform code for your chosen cloud platform. Write your infrastructure once using portable resource definitions, then deploy to AWS, Azure, or GCP by changing a single `target_provider` attribute.

On `terraform apply`, the provider does not create cloud infrastructure directly. Instead, it generates native `.tf` files (azurerm or google provider resources) in your specified `output_dir`. You then run a second `terraform apply` against the generated code to provision real infrastructure.

## Installation

### Build from source

```bash
cd packages/terraform-provider
go build -o terraform-provider-tla .
```

### Install locally

```bash
mkdir -p ~/.terraform.d/plugins/registry.terraform.io/tla/tla/0.1.0/darwin_arm64/
cp terraform-provider-tla ~/.terraform.d/plugins/registry.terraform.io/tla/tla/0.1.0/darwin_arm64/
```

Replace `darwin_arm64` with your platform (`linux_amd64`, `darwin_amd64`, etc.).

### Requirements

- Go 1.22+ (build only)
- Terraform 1.0+

## Provider Configuration

```hcl
terraform {
  required_providers {
    tla = {
      source  = "registry.terraform.io/tla/tla"
      version = "0.1.0"
    }
  }
}

provider "tla" {
  target_provider = "azure"    # "azure" or "gcp"
  output_dir      = "./generated"
}
```

| Attribute         | Required | Description                                              |
|-------------------|----------|----------------------------------------------------------|
| `target_provider` | Yes      | Target cloud: `azure` or `gcp`.                         |
| `output_dir`      | Yes      | Directory where generated `.tf` files will be written.  |

## Portable Resources

The provider ships three portable resource types. Each one maps to one or more native cloud resources depending on the target provider.

---

### cloud_object_storage

Generates a cloud storage bucket or account.

```hcl
resource "cloud_object_storage" "data_lake" {
  name               = "my-data-lake"
  region             = "us-east-1"
  versioning_enabled = true
  encryption_enabled = true
  encryption_key_id  = "my-kms-key"
  tags               = { env = "prod" }

  provider_overrides = {
    account_tier             = "Standard"
    account_replication_type = "GRS"
  }
}
```

**Schema:**

| Attribute           | Type          | Required | Description                                |
|---------------------|---------------|----------|--------------------------------------------|
| `name`              | string        | Yes      | Name of the storage bucket/account.       |
| `region`            | string        | Yes      | AWS region (translated to target region). |
| `versioning_enabled`| bool          | Yes      | Enable object versioning.                 |
| `encryption_enabled`| bool          | Yes      | Enable encryption at rest.                |
| `encryption_key_id` | string        | No       | KMS key ID for encryption.                |
| `tags`              | map(string)   | No       | Tags/labels to apply.                     |
| `provider_overrides`| map(string)   | No       | Provider-specific attribute overrides.    |
| `id`                | string        | Computed | Resource identifier (set to `name`).      |

**Generated output by target:**

| Target | Native resources                                               | Output file                          |
|--------|---------------------------------------------------------------|--------------------------------------|
| Azure  | `azurerm_storage_account` + `azurerm_storage_container`       | `object_storage_{name}.tf`           |
| GCP    | `google_storage_bucket`                                        | `object_storage_{name}.tf`           |

Azure names are sanitized to lowercase alphanumeric, 3-24 characters. Azure resources include `resource_group_name = var.resource_group_name`.

---

### cloud_container_registry

Generates a container image registry.

```hcl
resource "cloud_container_registry" "images" {
  name   = "myregistry"
  region = "us-east-1"
  tags   = { team = "platform" }
}
```

**Schema:**

| Attribute           | Type          | Required | Description                                |
|---------------------|---------------|----------|--------------------------------------------|
| `name`              | string        | Yes      | Name of the container registry.           |
| `region`            | string        | Yes      | AWS region (translated to target region). |
| `tags`              | map(string)   | No       | Tags/labels to apply.                     |
| `provider_overrides`| map(string)   | No       | Provider-specific attribute overrides.    |
| `id`                | string        | Computed | Resource identifier (set to `name`).      |

**Generated output by target:**

| Target | Native resource                           | Key defaults                         |
|--------|------------------------------------------|--------------------------------------|
| Azure  | `azurerm_container_registry`             | SKU `Standard`, admin disabled       |
| GCP    | `google_artifact_registry_repository`    | Format `DOCKER`                      |

---

### cloud_cache_redis

Generates a managed Redis cache using t-shirt size abstraction.

```hcl
resource "cloud_cache_redis" "session_store" {
  name   = "session-cache"
  region = "us-east-1"
  size   = "md"
  tags   = { service = "auth" }
}
```

**Schema:**

| Attribute           | Type          | Required | Description                                         |
|---------------------|---------------|----------|-----------------------------------------------------|
| `name`              | string        | Yes      | Name of the Redis cache.                           |
| `region`            | string        | Yes      | AWS region (translated to target region).          |
| `size`              | string        | Yes      | Size tier: `xs`, `sm`, `md`, `lg`, or `xl`.       |
| `tags`              | map(string)   | No       | Tags/labels to apply.                              |
| `provider_overrides`| map(string)   | No       | Provider-specific attribute overrides.             |
| `id`                | string        | Computed | Resource identifier (set to `name`).               |

**Generated output by target:**

| Target | Native resource           | Key defaults                                     |
|--------|--------------------------|--------------------------------------------------|
| Azure  | `azurerm_redis_cache`    | TLS 1.2, non-SSL port disabled                   |
| GCP    | `google_redis_instance`  | Redis version `REDIS_7_0`                        |

## Size Mapping (Redis)

The `size` attribute maps to provider-specific SKU and capacity settings:

| Size | Azure SKU / Family / Capacity | GCP Tier / Memory       |
|------|-------------------------------|-------------------------|
| `xs` | Basic / C / 0                 | BASIC / 1 GB            |
| `sm` | Standard / C / 1              | STANDARD_HA / 5 GB      |
| `md` | Premium / P / 1               | STANDARD_HA / 16 GB     |
| `lg` | Premium / P / 2               | STANDARD_HA / 32 GB     |
| `xl` | Premium / P / 4               | STANDARD_HA / 64 GB     |

## Provider Overrides

Every portable resource accepts a `provider_overrides` attribute. This is a flat `map(string)` that lets you inject cloud-specific attributes into the generated code.

```hcl
resource "cloud_object_storage" "bucket" {
  name               = "my-bucket"
  region             = "us-east-1"
  versioning_enabled = true
  encryption_enabled = true

  provider_overrides = {
    account_tier             = "Premium"
    account_replication_type = "ZRS"
  }
}
```

**Semantics:**

- **Shallow merge**: override values take precedence over base values on key conflict.
- **Active target only**: overrides are applied unconditionally to the generated resource. To scope overrides to a single provider, use separate Terraform configurations or conditional logic in a wrapper module.
- **String values only**: the override map is typed `map(string)`, so all values are strings.

## Region Mapping

AWS regions specified in `region` are translated to the target provider's equivalent:

| AWS               | Azure            | GCP                |
|-------------------|------------------|--------------------|
| `us-east-1`       | `eastus`         | `us-east1`         |
| `us-west-2`       | `westus2`        | `us-west1`         |
| `eu-west-1`       | `westeurope`     | `europe-west1`     |
| `ap-southeast-1`  | `southeastasia`  | `asia-southeast1`  |

**Fallback**: if the AWS region is not in the mapping table, Azure defaults to `eastus` and GCP defaults to `us-central1`.

## Exit Path (Eject to Native)

The generated `.tf` files in `output_dir` are standard Terraform and can be maintained without the TLA provider. To eject:

1. Run `terraform apply` with the TLA provider to generate files into `output_dir`.
2. Copy the generated directory to a new project.
3. Add the appropriate native provider block (`azurerm` or `google`).
4. Run `terraform init && terraform plan` against the native code.

> **Note:** A dedicated `tla eject` CLI command is not yet implemented. To generate native HCL from portable resources, use the Go provider's `output_dir` attribute — it writes native .tf files during `terraform apply`. Alternatively, use the `emitNativeEquivalent()` function from `@tla/translator` programmatically.

## Limitations

- **Three resource types only**: `cloud_object_storage`, `cloud_container_registry`, and `cloud_cache_redis` (P1 band services).
- **Code generator, not cloud manager**: the provider generates `.tf` files; it does not call cloud APIs directly.
- **Destroy removes files**: `terraform destroy` deletes generated `.tf` files, not cloud infrastructure. Cloud resources must be destroyed by running `terraform destroy` against the generated native code.
- **No import support**: resources are code-generated, not API-managed, so `terraform import` is not available.
- **Two targets only**: `azure` and `gcp`. AWS is the source notation, not a deployment target.
- **String-only overrides**: `provider_overrides` is `map(string)`, so nested blocks cannot be injected via overrides.

## Related Documentation

- [README](../README.md) -- project overview
- [Architecture](./ARCHITECTURE.md) -- system design and translation pipeline
- [Getting Started](./GETTING-STARTED.md) -- setup and first translation
