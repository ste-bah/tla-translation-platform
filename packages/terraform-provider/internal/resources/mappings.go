package resources

// RegionTarget holds Azure and GCP region equivalents for an AWS region.
type RegionTarget struct {
	Azure string
	GCP   string
}

// RegionMap maps AWS regions to their Azure and GCP equivalents.
var RegionMap = map[string]RegionTarget{
	"us-east-1":      {Azure: "eastus", GCP: "us-east1"},
	"us-west-2":      {Azure: "westus2", GCP: "us-west1"},
	"eu-west-1":      {Azure: "westeurope", GCP: "europe-west1"},
	"ap-southeast-1": {Azure: "southeastasia", GCP: "asia-southeast1"},
}

// SizeToRedisNode maps abstract size identifiers to AWS ElastiCache node types.
var SizeToRedisNode = map[string]string{
	"xs": "cache.t3.micro",
	"sm": "cache.m5.large",
	"md": "cache.r5.large",
	"lg": "cache.r5.xlarge",
	"xl": "cache.r5.2xlarge",
}

// AzureRedisSku maps abstract size identifiers to Azure Redis Cache SKU configurations.
var AzureRedisSku = map[string]struct {
	Family   string
	Capacity int
	SkuName  string
}{
	"xs": {Family: "C", Capacity: 0, SkuName: "Basic"},
	"sm": {Family: "C", Capacity: 1, SkuName: "Standard"},
	"md": {Family: "P", Capacity: 1, SkuName: "Premium"},
	"lg": {Family: "P", Capacity: 2, SkuName: "Premium"},
	"xl": {Family: "P", Capacity: 4, SkuName: "Premium"},
}

// GcpRedisTier maps abstract size identifiers to GCP Redis tier and memory size in GB.
var GcpRedisTier = map[string]struct {
	Tier     string
	MemoryGB int
}{
	"xs": {Tier: "BASIC", MemoryGB: 1},
	"sm": {Tier: "STANDARD_HA", MemoryGB: 5},
	"md": {Tier: "STANDARD_HA", MemoryGB: 16},
	"lg": {Tier: "STANDARD_HA", MemoryGB: 32},
	"xl": {Tier: "STANDARD_HA", MemoryGB: 64},
}

// ResolveRegion returns the target cloud region for a given AWS region and target provider.
func ResolveRegion(awsRegion, targetProvider string) string {
	target, ok := RegionMap[awsRegion]
	if !ok {
		// Fallback defaults
		if targetProvider == "gcp" {
			return "us-central1"
		}
		return "eastus"
	}
	if targetProvider == "gcp" {
		return target.GCP
	}
	return target.Azure
}
