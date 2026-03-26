package resources

import (
	"bytes"
	"strings"
	"testing"
)

func TestWriteResourceBlock_SimpleAttrs(t *testing.T) {
	var buf bytes.Buffer
	attrs := map[string]any{
		"name":     "mybucket",
		"location": "eastus",
	}

	err := WriteResourceBlock(&buf, "azurerm_storage_account", "mybucket", attrs)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got := buf.String()

	if !strings.Contains(got, `resource "azurerm_storage_account" "mybucket"`) {
		t.Errorf("missing resource header, got:\n%s", got)
	}
	if !strings.Contains(got, `location = "eastus"`) {
		t.Errorf("missing location attr, got:\n%s", got)
	}
	if !strings.Contains(got, `name = "mybucket"`) {
		t.Errorf("missing name attr, got:\n%s", got)
	}
}

func TestWriteResourceBlock_NestedBlock(t *testing.T) {
	var buf bytes.Buffer
	attrs := map[string]any{
		"name": "test",
		"versioning": map[string]any{
			"enabled": true,
		},
	}

	err := WriteResourceBlock(&buf, "google_storage_bucket", "test", attrs)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got := buf.String()

	if !strings.Contains(got, "versioning {") {
		t.Errorf("missing nested block, got:\n%s", got)
	}
	if !strings.Contains(got, "enabled = true") {
		t.Errorf("missing nested attr, got:\n%s", got)
	}
}

func TestWriteResourceBlock_BoolAndInt(t *testing.T) {
	var buf bytes.Buffer
	attrs := map[string]any{
		"enable_non_ssl_port": false,
		"capacity":            2,
	}

	err := WriteResourceBlock(&buf, "azurerm_redis_cache", "test", attrs)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got := buf.String()

	if !strings.Contains(got, "enable_non_ssl_port = false") {
		t.Errorf("missing bool attr, got:\n%s", got)
	}
	if !strings.Contains(got, "capacity = 2") {
		t.Errorf("missing int attr, got:\n%s", got)
	}
}

func TestWriteResourceBlock_Tags(t *testing.T) {
	var buf bytes.Buffer
	attrs := map[string]any{
		"tags": map[string]string{
			"env":  "prod",
			"team": "platform",
		},
	}

	err := WriteResourceBlock(&buf, "azurerm_storage_account", "test", attrs)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got := buf.String()

	if !strings.Contains(got, "tags = {") {
		t.Errorf("missing tags block, got:\n%s", got)
	}
	if !strings.Contains(got, `env = "prod"`) {
		t.Errorf("missing env tag, got:\n%s", got)
	}
	if !strings.Contains(got, `team = "platform"`) {
		t.Errorf("missing team tag, got:\n%s", got)
	}
}

func TestWriteResourceBlock_EmptyAttrs(t *testing.T) {
	var buf bytes.Buffer
	attrs := map[string]any{}

	err := WriteResourceBlock(&buf, "null_resource", "empty", attrs)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got := buf.String()
	if !strings.Contains(got, `resource "null_resource" "empty" {`) {
		t.Errorf("missing resource header, got:\n%s", got)
	}
	if !strings.HasSuffix(strings.TrimSpace(got), "}") {
		t.Errorf("missing closing brace, got:\n%s", got)
	}
}

func TestWriteResourceBlock_DeterministicOrder(t *testing.T) {
	attrs := map[string]any{
		"zebra": "z",
		"alpha": "a",
		"mid":   "m",
	}

	// Run multiple times to verify deterministic ordering.
	for i := 0; i < 5; i++ {
		var buf bytes.Buffer
		err := WriteResourceBlock(&buf, "test_resource", "test", attrs)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		got := buf.String()
		alphaIdx := strings.Index(got, "alpha")
		midIdx := strings.Index(got, "mid")
		zebraIdx := strings.Index(got, "zebra")
		if alphaIdx > midIdx || midIdx > zebraIdx {
			t.Errorf("keys not sorted, got:\n%s", got)
		}
	}
}
