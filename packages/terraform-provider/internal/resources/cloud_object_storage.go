package resources

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/tla/terraform-provider-tla/internal/config"
)

var _ resource.Resource = &CloudObjectStorageResource{}

type CloudObjectStorageResource struct {
	config *config.ProviderConfig
}

type CloudObjectStorageModel struct {
	Name              types.String `tfsdk:"name"`
	VersioningEnabled types.Bool   `tfsdk:"versioning_enabled"`
	EncryptionEnabled types.Bool   `tfsdk:"encryption_enabled"`
	EncryptionKeyID   types.String `tfsdk:"encryption_key_id"`
	Region            types.String `tfsdk:"region"`
	Tags              types.Map    `tfsdk:"tags"`
	ProviderOverrides types.Map    `tfsdk:"provider_overrides"`
	ID                types.String `tfsdk:"id"`
}

func NewCloudObjectStorageResource() resource.Resource {
	return &CloudObjectStorageResource{}
}

func (r *CloudObjectStorageResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_cloud_object_storage"
}

func (r *CloudObjectStorageResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Manages a cloud object storage resource translated to the target provider.",
		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				Computed: true,
			},
			"name": schema.StringAttribute{
				Required:    true,
				Description: "Name of the storage bucket/account.",
			},
			"versioning_enabled": schema.BoolAttribute{
				Required:    true,
				Description: "Enable object versioning.",
			},
			"encryption_enabled": schema.BoolAttribute{
				Required:    true,
				Description: "Enable encryption at rest.",
			},
			"encryption_key_id": schema.StringAttribute{
				Optional:    true,
				Description: "KMS key ID for encryption (optional).",
			},
			"region": schema.StringAttribute{
				Required:    true,
				Description: "AWS region (will be translated to target provider region).",
			},
			"tags": schema.MapAttribute{
				Optional:    true,
				ElementType: types.StringType,
				Description: "Tags to apply to the resource.",
			},
			"provider_overrides": schema.MapAttribute{
				Optional:    true,
				ElementType: types.StringType,
				Description: "Provider-specific attribute overrides.",
			},
		},
	}
}

func (r *CloudObjectStorageResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}
	cfg, ok := req.ProviderData.(*config.ProviderConfig)
	if !ok {
		resp.Diagnostics.AddError("Unexpected provider data type", "Expected *config.ProviderConfig")
		return
	}
	r.config = cfg
}

func (r *CloudObjectStorageResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var data CloudObjectStorageModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)
	if resp.Diagnostics.HasError() {
		return
	}

	name := data.Name.ValueString()
	region := ResolveRegion(data.Region.ValueString(), r.config.TargetProvider)

	tags := extractMapString(ctx, data.Tags)
	overrides := extractMapString(ctx, data.ProviderOverrides)

	var buf bytes.Buffer

	switch r.config.TargetProvider {
	case "azure":
		// Storage Account
		saAttrs := map[string]any{
			"name":                     sanitizeAzureName(name),
			"resource_group_name":      "var.resource_group_name",
			"location":                 region,
			"account_tier":             "Standard",
			"account_replication_type": "LRS",
		}
		if len(tags) > 0 {
			saAttrs["tags"] = tags
		}
		saAttrs = ApplyOverrides(saAttrs, overrides)
		if err := WriteResourceBlock(&buf, "azurerm_storage_account", name, saAttrs); err != nil {
			resp.Diagnostics.AddError("HCL generation failed", err.Error())
			return
		}
		buf.WriteString("\n")
		// Storage Container
		scAttrs := map[string]any{
			"name":                 name,
			"storage_account_name": fmt.Sprintf("azurerm_storage_account.%s.name", name),
			"container_access_type": "private",
		}
		if data.VersioningEnabled.ValueBool() {
			scAttrs["metadata"] = map[string]string{"versioning": "enabled"}
		}
		if err := WriteResourceBlock(&buf, "azurerm_storage_container", name, scAttrs); err != nil {
			resp.Diagnostics.AddError("HCL generation failed", err.Error())
			return
		}

	case "gcp":
		bucketAttrs := map[string]any{
			"name":     name,
			"location": region,
		}
		if data.VersioningEnabled.ValueBool() {
			bucketAttrs["versioning"] = map[string]any{"enabled": true}
		}
		if data.EncryptionEnabled.ValueBool() && !data.EncryptionKeyID.IsNull() {
			bucketAttrs["encryption"] = map[string]any{
				"default_kms_key_name": data.EncryptionKeyID.ValueString(),
			}
		}
		if len(tags) > 0 {
			bucketAttrs["labels"] = tags
		}
		bucketAttrs = ApplyOverrides(bucketAttrs, overrides)
		if err := WriteResourceBlock(&buf, "google_storage_bucket", name, bucketAttrs); err != nil {
			resp.Diagnostics.AddError("HCL generation failed", err.Error())
			return
		}

	default:
		resp.Diagnostics.AddError("Unsupported target provider", r.config.TargetProvider)
		return
	}

	outputPath := filepath.Join(r.config.OutputDir, fmt.Sprintf("object_storage_%s.tf", name))
	if err := os.MkdirAll(r.config.OutputDir, 0o755); err != nil {
		resp.Diagnostics.AddError("Failed to create output directory", err.Error())
		return
	}
	if err := os.WriteFile(outputPath, buf.Bytes(), 0o644); err != nil {
		resp.Diagnostics.AddError("Failed to write .tf file", err.Error())
		return
	}

	data.ID = types.StringValue(name)
	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *CloudObjectStorageResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var data CloudObjectStorageModel
	resp.Diagnostics.Append(req.State.Get(ctx, &data)...)
	if resp.Diagnostics.HasError() {
		return
	}

	name := data.Name.ValueString()
	outputPath := filepath.Join(r.config.OutputDir, fmt.Sprintf("object_storage_%s.tf", name))
	if _, err := os.Stat(outputPath); os.IsNotExist(err) {
		resp.State.RemoveResource(ctx)
		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *CloudObjectStorageResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	// Recreate by delegating to Create logic.
	var data CloudObjectStorageModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)
	if resp.Diagnostics.HasError() {
		return
	}
	data.ID = types.StringValue(data.Name.ValueString())
	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *CloudObjectStorageResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var data CloudObjectStorageModel
	resp.Diagnostics.Append(req.State.Get(ctx, &data)...)
	if resp.Diagnostics.HasError() {
		return
	}

	name := data.Name.ValueString()
	outputPath := filepath.Join(r.config.OutputDir, fmt.Sprintf("object_storage_%s.tf", name))
	_ = os.Remove(outputPath)
}

// helpers

func extractMapString(ctx context.Context, m types.Map) map[string]string {
	if m.IsNull() || m.IsUnknown() {
		return nil
	}
	result := make(map[string]string)
	elements := m.Elements()
	for k, v := range elements {
		if sv, ok := v.(types.String); ok {
			result[k] = sv.ValueString()
		}
	}
	return result
}

func sanitizeAzureName(name string) string {
	// Azure storage account names: lowercase, alphanumeric, 3-24 chars.
	var out []byte
	for _, c := range []byte(name) {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
			out = append(out, c)
		} else if c >= 'A' && c <= 'Z' {
			out = append(out, c+32)
		}
	}
	if len(out) > 24 {
		out = out[:24]
	}
	if len(out) < 3 {
		for len(out) < 3 {
			out = append(out, '0')
		}
	}
	return string(out)
}
