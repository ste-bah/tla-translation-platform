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

var _ resource.Resource = &CloudContainerRegistryResource{}

type CloudContainerRegistryResource struct {
	config *config.ProviderConfig
}

type CloudContainerRegistryModel struct {
	Name              types.String `tfsdk:"name"`
	Region            types.String `tfsdk:"region"`
	Tags              types.Map    `tfsdk:"tags"`
	ProviderOverrides types.Map    `tfsdk:"provider_overrides"`
	ID                types.String `tfsdk:"id"`
}

func NewCloudContainerRegistryResource() resource.Resource {
	return &CloudContainerRegistryResource{}
}

func (r *CloudContainerRegistryResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_cloud_container_registry"
}

func (r *CloudContainerRegistryResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Manages a cloud container registry translated to the target provider.",
		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				Computed: true,
			},
			"name": schema.StringAttribute{
				Required:    true,
				Description: "Name of the container registry.",
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

func (r *CloudContainerRegistryResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
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

func (r *CloudContainerRegistryResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var data CloudContainerRegistryModel
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
		attrs := map[string]any{
			"name":                sanitizeAzureName(name),
			"resource_group_name": "var.resource_group_name",
			"location":            region,
			"sku":                 "Standard",
			"admin_enabled":       false,
		}
		if len(tags) > 0 {
			attrs["tags"] = tags
		}
		attrs = ApplyOverrides(attrs, overrides)
		if err := WriteResourceBlock(&buf, "azurerm_container_registry", name, attrs); err != nil {
			resp.Diagnostics.AddError("HCL generation failed", err.Error())
			return
		}

	case "gcp":
		attrs := map[string]any{
			"location":      region,
			"repository_id": name,
			"format":        "DOCKER",
		}
		if len(tags) > 0 {
			attrs["labels"] = tags
		}
		attrs = ApplyOverrides(attrs, overrides)
		if err := WriteResourceBlock(&buf, "google_artifact_registry_repository", name, attrs); err != nil {
			resp.Diagnostics.AddError("HCL generation failed", err.Error())
			return
		}

	default:
		resp.Diagnostics.AddError("Unsupported target provider", r.config.TargetProvider)
		return
	}

	outputPath := filepath.Join(r.config.OutputDir, fmt.Sprintf("container_registry_%s.tf", name))
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

func (r *CloudContainerRegistryResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var data CloudContainerRegistryModel
	resp.Diagnostics.Append(req.State.Get(ctx, &data)...)
	if resp.Diagnostics.HasError() {
		return
	}

	name := data.Name.ValueString()
	outputPath := filepath.Join(r.config.OutputDir, fmt.Sprintf("container_registry_%s.tf", name))
	if _, err := os.Stat(outputPath); os.IsNotExist(err) {
		resp.State.RemoveResource(ctx)
		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *CloudContainerRegistryResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var data CloudContainerRegistryModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)
	if resp.Diagnostics.HasError() {
		return
	}
	data.ID = types.StringValue(data.Name.ValueString())
	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *CloudContainerRegistryResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var data CloudContainerRegistryModel
	resp.Diagnostics.Append(req.State.Get(ctx, &data)...)
	if resp.Diagnostics.HasError() {
		return
	}

	name := data.Name.ValueString()
	outputPath := filepath.Join(r.config.OutputDir, fmt.Sprintf("container_registry_%s.tf", name))
	_ = os.Remove(outputPath)
}
