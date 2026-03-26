module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "ec-001-vpc"
  cidr = "10.0.0.0/16"
}
