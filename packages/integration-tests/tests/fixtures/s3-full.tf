resource "aws_s3_bucket" "data" {
  bucket = "my-app-data-bucket"
  versioning { enabled = true }
  server_side_encryption_configuration {
    rule {
      apply_server_side_encryption_by_default {
        sse_algorithm = "aws:kms"
        kms_master_key_id = "arn:aws:kms:us-east-1:123:key/abc"
      }
    }
  }
  lifecycle_rule {
    enabled = true
    expiration { days = 90 }
  }
  tags = { Name = "data" }
}
