package resources

import (
	"testing"
)

func TestRegionMap_KnownRegions(t *testing.T) {
	tests := []struct {
		awsRegion string
		wantAzure string
		wantGCP   string
	}{
		{"us-east-1", "eastus", "us-east1"},
		{"us-west-2", "westus2", "us-west1"},
		{"eu-west-1", "westeurope", "europe-west1"},
		{"ap-southeast-1", "southeastasia", "asia-southeast1"},
	}

	for _, tt := range tests {
		t.Run(tt.awsRegion, func(t *testing.T) {
			target, ok := RegionMap[tt.awsRegion]
			if !ok {
				t.Fatalf("RegionMap missing key %q", tt.awsRegion)
			}
			if target.Azure != tt.wantAzure {
				t.Errorf("Azure: got %q, want %q", target.Azure, tt.wantAzure)
			}
			if target.GCP != tt.wantGCP {
				t.Errorf("GCP: got %q, want %q", target.GCP, tt.wantGCP)
			}
		})
	}
}

func TestSizeToRedisNode(t *testing.T) {
	tests := []struct {
		size string
		want string
	}{
		{"xs", "cache.t3.micro"},
		{"sm", "cache.m5.large"},
		{"md", "cache.r5.large"},
		{"lg", "cache.r5.xlarge"},
		{"xl", "cache.r5.2xlarge"},
	}

	for _, tt := range tests {
		t.Run(tt.size, func(t *testing.T) {
			got, ok := SizeToRedisNode[tt.size]
			if !ok {
				t.Fatalf("SizeToRedisNode missing key %q", tt.size)
			}
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestResolveRegion_Azure(t *testing.T) {
	got := ResolveRegion("us-east-1", "azure")
	if got != "eastus" {
		t.Errorf("got %q, want %q", got, "eastus")
	}
}

func TestResolveRegion_GCP(t *testing.T) {
	got := ResolveRegion("eu-west-1", "gcp")
	if got != "europe-west1" {
		t.Errorf("got %q, want %q", got, "europe-west1")
	}
}

func TestResolveRegion_UnknownRegion_Azure(t *testing.T) {
	got := ResolveRegion("unknown-region", "azure")
	if got != "eastus" {
		t.Errorf("got %q, want %q", got, "eastus")
	}
}

func TestResolveRegion_UnknownRegion_GCP(t *testing.T) {
	got := ResolveRegion("unknown-region", "gcp")
	if got != "us-central1" {
		t.Errorf("got %q, want %q", got, "us-central1")
	}
}

func TestAzureRedisSku_AllSizes(t *testing.T) {
	sizes := []string{"xs", "sm", "md", "lg", "xl"}
	for _, s := range sizes {
		if _, ok := AzureRedisSku[s]; !ok {
			t.Errorf("AzureRedisSku missing key %q", s)
		}
	}
}

func TestGcpRedisTier_AllSizes(t *testing.T) {
	sizes := []string{"xs", "sm", "md", "lg", "xl"}
	for _, s := range sizes {
		if _, ok := GcpRedisTier[s]; !ok {
			t.Errorf("GcpRedisTier missing key %q", s)
		}
	}
}
