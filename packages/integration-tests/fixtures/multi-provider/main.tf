# TASK-INT-004: Multi-Provider Source Handling fixture
#
# Contains resources from five different provider categories to exercise the
# classifyProvider / classifyResources logic end-to-end:
#
#   aws_s3_bucket  → 'aws'         (translate normally)
#   null_resource  → 'procedural'  (emit advisory stub)
#   random_id      → 'utility'     (preserve as-is)
#   helm_release   → 'orchestration' (skip)

# ── AWS resource — should be translated ──────────────────────────────────────
resource "aws_s3_bucket" "assets" {
  bucket = "mp-test-assets"

  tags = {
    Name = "mp-test-assets"
    Env  = "test"
  }
}

# ── Procedural — null_resource with a side-effect command ────────────────────
resource "null_resource" "bootstrap" {
  triggers = {
    bucket_id = aws_s3_bucket.assets.id
  }

  provisioner "local-exec" {
    command = "echo bootstrapped"
  }
}

# ── Utility — random suffix for unique naming ────────────────────────────────
resource "random_id" "suffix" {
  byte_length = 4
}

# ── Orchestration — Helm chart deployment (out-of-scope) ─────────────────────
resource "helm_release" "nginx" {
  name       = "nginx"
  repository = "https://charts.bitnami.com/bitnami"
  chart      = "nginx"
  version    = "13.2.0"

  set {
    name  = "service.type"
    value = "ClusterIP"
  }
}

# ── External data source (procedural data provider) ──────────────────────────
# NOTE: `data "external"` blocks are not emitted as IR resources by the
# IrEmitter (only `resource` blocks are). They are included here as
# documentation of the full provider mix and to allow direct classifyProvider()
# testing in the test suite.
data "external" "version_check" {
  program = ["python3", "-c", "import sys, json; json.dump({'version': '1.0'}, sys.stdout)"]
}
