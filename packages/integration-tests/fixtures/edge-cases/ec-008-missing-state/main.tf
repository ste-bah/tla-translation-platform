resource "aws_s3_bucket" "assets" {
  bucket = "ec-008-assets"

  tags = {
    Name = "ec-008-assets"
  }
}
