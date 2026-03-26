package provider

import (
	"context"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/tla/terraform-provider-tla/internal/config"
	"github.com/tla/terraform-provider-tla/internal/resources"
)

var _ provider.Provider = &TlaProvider{}

// TlaProvider defines the provider implementation.
type TlaProvider struct {
	version string
}

// TlaProviderModel describes the provider data model.
type TlaProviderModel struct {
	TargetProvider types.String `tfsdk:"target_provider"`
	OutputDir      types.String `tfsdk:"output_dir"`
}

func New() provider.Provider {
	return &TlaProvider{
		version: "0.1.0",
	}
}

func (p *TlaProvider) Metadata(_ context.Context, _ provider.MetadataRequest, resp *provider.MetadataResponse) {
	resp.TypeName = "tla"
	resp.Version = p.version
}

func (p *TlaProvider) Schema(_ context.Context, _ provider.SchemaRequest, resp *provider.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "TLA Terraform provider for multi-cloud resource translation.",
		Attributes: map[string]schema.Attribute{
			"target_provider": schema.StringAttribute{
				Required:    true,
				Description: "Target cloud provider: 'azure' or 'gcp'.",
			},
			"output_dir": schema.StringAttribute{
				Required:    true,
				Description: "Directory where generated .tf files will be written.",
			},
		},
	}
}

func (p *TlaProvider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
	var data TlaProviderModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &data)...)
	if resp.Diagnostics.HasError() {
		return
	}

	cfg := &config.ProviderConfig{
		TargetProvider: data.TargetProvider.ValueString(),
		OutputDir:      data.OutputDir.ValueString(),
	}

	resp.ResourceData = cfg
}

func (p *TlaProvider) Resources(_ context.Context) []func() resource.Resource {
	return []func() resource.Resource{
		resources.NewCloudObjectStorageResource,
		resources.NewCloudContainerRegistryResource,
		resources.NewCloudCacheRedisResource,
	}
}

func (p *TlaProvider) DataSources(_ context.Context) []func() datasource.DataSource {
	return nil
}
