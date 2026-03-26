resource "aws_vpc_endpoint" "ssm" {
  vpc_id              = "vpc-00000000000000001"
  service_name        = "com.amazonaws.us-east-1.ssm"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true

  tags = {
    Name = "ec-003-ssm-endpoint"
  }
}
