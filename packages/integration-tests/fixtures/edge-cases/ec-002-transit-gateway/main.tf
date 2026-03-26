resource "aws_ec2_transit_gateway" "main" {
  description                     = "ec-002-tgw"
  amazon_side_asn                 = 64512
  default_route_table_association = "enable"
  default_route_table_propagation = "enable"

  tags = {
    Name = "ec-002-tgw"
  }
}
