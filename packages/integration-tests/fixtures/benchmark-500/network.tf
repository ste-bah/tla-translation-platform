resource "aws_vpc" "vpc_001" {
  cidr_block           = "10.1.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-001", Project = var.project }
}

resource "aws_vpc" "vpc_002" {
  cidr_block           = "10.2.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-002", Project = var.project }
}

resource "aws_vpc" "vpc_003" {
  cidr_block           = "10.3.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-003", Project = var.project }
}

resource "aws_vpc" "vpc_004" {
  cidr_block           = "10.4.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-004", Project = var.project }
}

resource "aws_vpc" "vpc_005" {
  cidr_block           = "10.5.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-005", Project = var.project }
}

resource "aws_vpc" "vpc_006" {
  cidr_block           = "10.6.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-006", Project = var.project }
}

resource "aws_vpc" "vpc_007" {
  cidr_block           = "10.7.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-007", Project = var.project }
}

resource "aws_vpc" "vpc_008" {
  cidr_block           = "10.8.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-008", Project = var.project }
}

resource "aws_vpc" "vpc_009" {
  cidr_block           = "10.9.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-009", Project = var.project }
}

resource "aws_vpc" "vpc_010" {
  cidr_block           = "10.10.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-010", Project = var.project }
}

resource "aws_vpc" "vpc_011" {
  cidr_block           = "10.11.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-011", Project = var.project }
}

resource "aws_vpc" "vpc_012" {
  cidr_block           = "10.12.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-012", Project = var.project }
}

resource "aws_vpc" "vpc_013" {
  cidr_block           = "10.13.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-013", Project = var.project }
}

resource "aws_vpc" "vpc_014" {
  cidr_block           = "10.14.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-014", Project = var.project }
}

resource "aws_vpc" "vpc_015" {
  cidr_block           = "10.15.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-015", Project = var.project }
}

resource "aws_vpc" "vpc_016" {
  cidr_block           = "10.16.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-016", Project = var.project }
}

resource "aws_vpc" "vpc_017" {
  cidr_block           = "10.17.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-017", Project = var.project }
}

resource "aws_vpc" "vpc_018" {
  cidr_block           = "10.18.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-018", Project = var.project }
}

resource "aws_vpc" "vpc_019" {
  cidr_block           = "10.19.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-019", Project = var.project }
}

resource "aws_vpc" "vpc_020" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-020", Project = var.project }
}

resource "aws_vpc" "vpc_021" {
  cidr_block           = "10.21.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-021", Project = var.project }
}

resource "aws_vpc" "vpc_022" {
  cidr_block           = "10.22.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-022", Project = var.project }
}

resource "aws_vpc" "vpc_023" {
  cidr_block           = "10.23.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-023", Project = var.project }
}

resource "aws_vpc" "vpc_024" {
  cidr_block           = "10.24.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-024", Project = var.project }
}

resource "aws_vpc" "vpc_025" {
  cidr_block           = "10.25.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-025", Project = var.project }
}

resource "aws_vpc" "vpc_026" {
  cidr_block           = "10.26.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-026", Project = var.project }
}

resource "aws_vpc" "vpc_027" {
  cidr_block           = "10.27.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-027", Project = var.project }
}

resource "aws_vpc" "vpc_028" {
  cidr_block           = "10.28.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-028", Project = var.project }
}

resource "aws_vpc" "vpc_029" {
  cidr_block           = "10.29.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-029", Project = var.project }
}

resource "aws_vpc" "vpc_030" {
  cidr_block           = "10.30.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "bench-vpc-030", Project = var.project }
}

resource "aws_subnet" "subnet_001" {
  vpc_id            = "${aws_vpc.vpc_001.id}"
  cidr_block        = "10.1.1.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-001", Project = var.project }
}

resource "aws_subnet" "subnet_002" {
  vpc_id            = "${aws_vpc.vpc_002.id}"
  cidr_block        = "10.2.2.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-002", Project = var.project }
}

resource "aws_subnet" "subnet_003" {
  vpc_id            = "${aws_vpc.vpc_003.id}"
  cidr_block        = "10.3.3.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-003", Project = var.project }
}

resource "aws_subnet" "subnet_004" {
  vpc_id            = "${aws_vpc.vpc_004.id}"
  cidr_block        = "10.4.4.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-004", Project = var.project }
}

resource "aws_subnet" "subnet_005" {
  vpc_id            = "${aws_vpc.vpc_005.id}"
  cidr_block        = "10.5.5.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-005", Project = var.project }
}

resource "aws_subnet" "subnet_006" {
  vpc_id            = "${aws_vpc.vpc_006.id}"
  cidr_block        = "10.6.6.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-006", Project = var.project }
}

resource "aws_subnet" "subnet_007" {
  vpc_id            = "${aws_vpc.vpc_007.id}"
  cidr_block        = "10.7.7.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-007", Project = var.project }
}

resource "aws_subnet" "subnet_008" {
  vpc_id            = "${aws_vpc.vpc_008.id}"
  cidr_block        = "10.8.8.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-008", Project = var.project }
}

resource "aws_subnet" "subnet_009" {
  vpc_id            = "${aws_vpc.vpc_009.id}"
  cidr_block        = "10.9.9.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-009", Project = var.project }
}

resource "aws_subnet" "subnet_010" {
  vpc_id            = "${aws_vpc.vpc_010.id}"
  cidr_block        = "10.10.10.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-010", Project = var.project }
}

resource "aws_subnet" "subnet_011" {
  vpc_id            = "${aws_vpc.vpc_011.id}"
  cidr_block        = "10.11.11.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-011", Project = var.project }
}

resource "aws_subnet" "subnet_012" {
  vpc_id            = "${aws_vpc.vpc_012.id}"
  cidr_block        = "10.12.12.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-012", Project = var.project }
}

resource "aws_subnet" "subnet_013" {
  vpc_id            = "${aws_vpc.vpc_013.id}"
  cidr_block        = "10.13.13.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-013", Project = var.project }
}

resource "aws_subnet" "subnet_014" {
  vpc_id            = "${aws_vpc.vpc_014.id}"
  cidr_block        = "10.14.14.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-014", Project = var.project }
}

resource "aws_subnet" "subnet_015" {
  vpc_id            = "${aws_vpc.vpc_015.id}"
  cidr_block        = "10.15.15.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-015", Project = var.project }
}

resource "aws_subnet" "subnet_016" {
  vpc_id            = "${aws_vpc.vpc_016.id}"
  cidr_block        = "10.16.16.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-016", Project = var.project }
}

resource "aws_subnet" "subnet_017" {
  vpc_id            = "${aws_vpc.vpc_017.id}"
  cidr_block        = "10.17.17.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-017", Project = var.project }
}

resource "aws_subnet" "subnet_018" {
  vpc_id            = "${aws_vpc.vpc_018.id}"
  cidr_block        = "10.18.18.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-018", Project = var.project }
}

resource "aws_subnet" "subnet_019" {
  vpc_id            = "${aws_vpc.vpc_019.id}"
  cidr_block        = "10.19.19.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-019", Project = var.project }
}

resource "aws_subnet" "subnet_020" {
  vpc_id            = "${aws_vpc.vpc_020.id}"
  cidr_block        = "10.20.20.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-020", Project = var.project }
}

resource "aws_subnet" "subnet_021" {
  vpc_id            = "${aws_vpc.vpc_021.id}"
  cidr_block        = "10.21.21.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-021", Project = var.project }
}

resource "aws_subnet" "subnet_022" {
  vpc_id            = "${aws_vpc.vpc_022.id}"
  cidr_block        = "10.22.22.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-022", Project = var.project }
}

resource "aws_subnet" "subnet_023" {
  vpc_id            = "${aws_vpc.vpc_023.id}"
  cidr_block        = "10.23.23.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-023", Project = var.project }
}

resource "aws_subnet" "subnet_024" {
  vpc_id            = "${aws_vpc.vpc_024.id}"
  cidr_block        = "10.24.24.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-024", Project = var.project }
}

resource "aws_subnet" "subnet_025" {
  vpc_id            = "${aws_vpc.vpc_025.id}"
  cidr_block        = "10.25.25.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-025", Project = var.project }
}

resource "aws_subnet" "subnet_026" {
  vpc_id            = "${aws_vpc.vpc_026.id}"
  cidr_block        = "10.26.26.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-026", Project = var.project }
}

resource "aws_subnet" "subnet_027" {
  vpc_id            = "${aws_vpc.vpc_027.id}"
  cidr_block        = "10.27.27.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-027", Project = var.project }
}

resource "aws_subnet" "subnet_028" {
  vpc_id            = "${aws_vpc.vpc_028.id}"
  cidr_block        = "10.28.28.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-028", Project = var.project }
}

resource "aws_subnet" "subnet_029" {
  vpc_id            = "${aws_vpc.vpc_029.id}"
  cidr_block        = "10.29.29.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-029", Project = var.project }
}

resource "aws_subnet" "subnet_030" {
  vpc_id            = "${aws_vpc.vpc_030.id}"
  cidr_block        = "10.30.30.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-030", Project = var.project }
}

resource "aws_subnet" "subnet_031" {
  vpc_id            = "${aws_vpc.vpc_001.id}"
  cidr_block        = "10.1.31.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-031", Project = var.project }
}

resource "aws_subnet" "subnet_032" {
  vpc_id            = "${aws_vpc.vpc_002.id}"
  cidr_block        = "10.2.32.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-032", Project = var.project }
}

resource "aws_subnet" "subnet_033" {
  vpc_id            = "${aws_vpc.vpc_003.id}"
  cidr_block        = "10.3.33.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-033", Project = var.project }
}

resource "aws_subnet" "subnet_034" {
  vpc_id            = "${aws_vpc.vpc_004.id}"
  cidr_block        = "10.4.34.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-034", Project = var.project }
}

resource "aws_subnet" "subnet_035" {
  vpc_id            = "${aws_vpc.vpc_005.id}"
  cidr_block        = "10.5.35.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-035", Project = var.project }
}

resource "aws_subnet" "subnet_036" {
  vpc_id            = "${aws_vpc.vpc_006.id}"
  cidr_block        = "10.6.36.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-036", Project = var.project }
}

resource "aws_subnet" "subnet_037" {
  vpc_id            = "${aws_vpc.vpc_007.id}"
  cidr_block        = "10.7.37.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-037", Project = var.project }
}

resource "aws_subnet" "subnet_038" {
  vpc_id            = "${aws_vpc.vpc_008.id}"
  cidr_block        = "10.8.38.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-038", Project = var.project }
}

resource "aws_subnet" "subnet_039" {
  vpc_id            = "${aws_vpc.vpc_009.id}"
  cidr_block        = "10.9.39.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-039", Project = var.project }
}

resource "aws_subnet" "subnet_040" {
  vpc_id            = "${aws_vpc.vpc_010.id}"
  cidr_block        = "10.10.40.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-040", Project = var.project }
}

resource "aws_subnet" "subnet_041" {
  vpc_id            = "${aws_vpc.vpc_011.id}"
  cidr_block        = "10.11.41.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-041", Project = var.project }
}

resource "aws_subnet" "subnet_042" {
  vpc_id            = "${aws_vpc.vpc_012.id}"
  cidr_block        = "10.12.42.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-042", Project = var.project }
}

resource "aws_subnet" "subnet_043" {
  vpc_id            = "${aws_vpc.vpc_013.id}"
  cidr_block        = "10.13.43.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-043", Project = var.project }
}

resource "aws_subnet" "subnet_044" {
  vpc_id            = "${aws_vpc.vpc_014.id}"
  cidr_block        = "10.14.44.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-044", Project = var.project }
}

resource "aws_subnet" "subnet_045" {
  vpc_id            = "${aws_vpc.vpc_015.id}"
  cidr_block        = "10.15.45.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-045", Project = var.project }
}

resource "aws_subnet" "subnet_046" {
  vpc_id            = "${aws_vpc.vpc_016.id}"
  cidr_block        = "10.16.46.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-046", Project = var.project }
}

resource "aws_subnet" "subnet_047" {
  vpc_id            = "${aws_vpc.vpc_017.id}"
  cidr_block        = "10.17.47.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-047", Project = var.project }
}

resource "aws_subnet" "subnet_048" {
  vpc_id            = "${aws_vpc.vpc_018.id}"
  cidr_block        = "10.18.48.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-048", Project = var.project }
}

resource "aws_subnet" "subnet_049" {
  vpc_id            = "${aws_vpc.vpc_019.id}"
  cidr_block        = "10.19.49.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-049", Project = var.project }
}

resource "aws_subnet" "subnet_050" {
  vpc_id            = "${aws_vpc.vpc_020.id}"
  cidr_block        = "10.20.50.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-050", Project = var.project }
}

resource "aws_subnet" "subnet_051" {
  vpc_id            = "${aws_vpc.vpc_021.id}"
  cidr_block        = "10.21.51.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-051", Project = var.project }
}

resource "aws_subnet" "subnet_052" {
  vpc_id            = "${aws_vpc.vpc_022.id}"
  cidr_block        = "10.22.52.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-052", Project = var.project }
}

resource "aws_subnet" "subnet_053" {
  vpc_id            = "${aws_vpc.vpc_023.id}"
  cidr_block        = "10.23.53.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-053", Project = var.project }
}

resource "aws_subnet" "subnet_054" {
  vpc_id            = "${aws_vpc.vpc_024.id}"
  cidr_block        = "10.24.54.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-054", Project = var.project }
}

resource "aws_subnet" "subnet_055" {
  vpc_id            = "${aws_vpc.vpc_025.id}"
  cidr_block        = "10.25.55.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-055", Project = var.project }
}

resource "aws_subnet" "subnet_056" {
  vpc_id            = "${aws_vpc.vpc_026.id}"
  cidr_block        = "10.26.56.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-056", Project = var.project }
}

resource "aws_subnet" "subnet_057" {
  vpc_id            = "${aws_vpc.vpc_027.id}"
  cidr_block        = "10.27.57.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-057", Project = var.project }
}

resource "aws_subnet" "subnet_058" {
  vpc_id            = "${aws_vpc.vpc_028.id}"
  cidr_block        = "10.28.58.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-058", Project = var.project }
}

resource "aws_subnet" "subnet_059" {
  vpc_id            = "${aws_vpc.vpc_029.id}"
  cidr_block        = "10.29.59.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-059", Project = var.project }
}

resource "aws_subnet" "subnet_060" {
  vpc_id            = "${aws_vpc.vpc_030.id}"
  cidr_block        = "10.30.60.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "bench-subnet-060", Project = var.project }
}

resource "aws_security_group" "sg_001" {
  name   = "bench-sg-001"
  vpc_id = "${aws_vpc.vpc_001.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-001", Project = var.project }
}

resource "aws_security_group" "sg_002" {
  name   = "bench-sg-002"
  vpc_id = "${aws_vpc.vpc_002.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-002", Project = var.project }
}

resource "aws_security_group" "sg_003" {
  name   = "bench-sg-003"
  vpc_id = "${aws_vpc.vpc_003.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-003", Project = var.project }
}

resource "aws_security_group" "sg_004" {
  name   = "bench-sg-004"
  vpc_id = "${aws_vpc.vpc_004.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-004", Project = var.project }
}

resource "aws_security_group" "sg_005" {
  name   = "bench-sg-005"
  vpc_id = "${aws_vpc.vpc_005.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-005", Project = var.project }
}

resource "aws_security_group" "sg_006" {
  name   = "bench-sg-006"
  vpc_id = "${aws_vpc.vpc_006.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-006", Project = var.project }
}

resource "aws_security_group" "sg_007" {
  name   = "bench-sg-007"
  vpc_id = "${aws_vpc.vpc_007.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-007", Project = var.project }
}

resource "aws_security_group" "sg_008" {
  name   = "bench-sg-008"
  vpc_id = "${aws_vpc.vpc_008.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-008", Project = var.project }
}

resource "aws_security_group" "sg_009" {
  name   = "bench-sg-009"
  vpc_id = "${aws_vpc.vpc_009.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-009", Project = var.project }
}

resource "aws_security_group" "sg_010" {
  name   = "bench-sg-010"
  vpc_id = "${aws_vpc.vpc_010.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-010", Project = var.project }
}

resource "aws_security_group" "sg_011" {
  name   = "bench-sg-011"
  vpc_id = "${aws_vpc.vpc_011.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-011", Project = var.project }
}

resource "aws_security_group" "sg_012" {
  name   = "bench-sg-012"
  vpc_id = "${aws_vpc.vpc_012.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-012", Project = var.project }
}

resource "aws_security_group" "sg_013" {
  name   = "bench-sg-013"
  vpc_id = "${aws_vpc.vpc_013.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-013", Project = var.project }
}

resource "aws_security_group" "sg_014" {
  name   = "bench-sg-014"
  vpc_id = "${aws_vpc.vpc_014.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-014", Project = var.project }
}

resource "aws_security_group" "sg_015" {
  name   = "bench-sg-015"
  vpc_id = "${aws_vpc.vpc_015.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-015", Project = var.project }
}

resource "aws_security_group" "sg_016" {
  name   = "bench-sg-016"
  vpc_id = "${aws_vpc.vpc_016.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-016", Project = var.project }
}

resource "aws_security_group" "sg_017" {
  name   = "bench-sg-017"
  vpc_id = "${aws_vpc.vpc_017.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-017", Project = var.project }
}

resource "aws_security_group" "sg_018" {
  name   = "bench-sg-018"
  vpc_id = "${aws_vpc.vpc_018.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-018", Project = var.project }
}

resource "aws_security_group" "sg_019" {
  name   = "bench-sg-019"
  vpc_id = "${aws_vpc.vpc_019.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-019", Project = var.project }
}

resource "aws_security_group" "sg_020" {
  name   = "bench-sg-020"
  vpc_id = "${aws_vpc.vpc_020.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-020", Project = var.project }
}

resource "aws_security_group" "sg_021" {
  name   = "bench-sg-021"
  vpc_id = "${aws_vpc.vpc_021.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-021", Project = var.project }
}

resource "aws_security_group" "sg_022" {
  name   = "bench-sg-022"
  vpc_id = "${aws_vpc.vpc_022.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-022", Project = var.project }
}

resource "aws_security_group" "sg_023" {
  name   = "bench-sg-023"
  vpc_id = "${aws_vpc.vpc_023.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-023", Project = var.project }
}

resource "aws_security_group" "sg_024" {
  name   = "bench-sg-024"
  vpc_id = "${aws_vpc.vpc_024.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-024", Project = var.project }
}

resource "aws_security_group" "sg_025" {
  name   = "bench-sg-025"
  vpc_id = "${aws_vpc.vpc_025.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-025", Project = var.project }
}

resource "aws_security_group" "sg_026" {
  name   = "bench-sg-026"
  vpc_id = "${aws_vpc.vpc_026.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-026", Project = var.project }
}

resource "aws_security_group" "sg_027" {
  name   = "bench-sg-027"
  vpc_id = "${aws_vpc.vpc_027.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-027", Project = var.project }
}

resource "aws_security_group" "sg_028" {
  name   = "bench-sg-028"
  vpc_id = "${aws_vpc.vpc_028.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-028", Project = var.project }
}

resource "aws_security_group" "sg_029" {
  name   = "bench-sg-029"
  vpc_id = "${aws_vpc.vpc_029.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-029", Project = var.project }
}

resource "aws_security_group" "sg_030" {
  name   = "bench-sg-030"
  vpc_id = "${aws_vpc.vpc_030.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-030", Project = var.project }
}

resource "aws_security_group" "sg_031" {
  name   = "bench-sg-031"
  vpc_id = "${aws_vpc.vpc_001.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-031", Project = var.project }
}

resource "aws_security_group" "sg_032" {
  name   = "bench-sg-032"
  vpc_id = "${aws_vpc.vpc_002.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-032", Project = var.project }
}

resource "aws_security_group" "sg_033" {
  name   = "bench-sg-033"
  vpc_id = "${aws_vpc.vpc_003.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-033", Project = var.project }
}

resource "aws_security_group" "sg_034" {
  name   = "bench-sg-034"
  vpc_id = "${aws_vpc.vpc_004.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-034", Project = var.project }
}

resource "aws_security_group" "sg_035" {
  name   = "bench-sg-035"
  vpc_id = "${aws_vpc.vpc_005.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-035", Project = var.project }
}

resource "aws_security_group" "sg_036" {
  name   = "bench-sg-036"
  vpc_id = "${aws_vpc.vpc_006.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-036", Project = var.project }
}

resource "aws_security_group" "sg_037" {
  name   = "bench-sg-037"
  vpc_id = "${aws_vpc.vpc_007.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-037", Project = var.project }
}

resource "aws_security_group" "sg_038" {
  name   = "bench-sg-038"
  vpc_id = "${aws_vpc.vpc_008.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-038", Project = var.project }
}

resource "aws_security_group" "sg_039" {
  name   = "bench-sg-039"
  vpc_id = "${aws_vpc.vpc_009.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-039", Project = var.project }
}

resource "aws_security_group" "sg_040" {
  name   = "bench-sg-040"
  vpc_id = "${aws_vpc.vpc_010.id}"
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = { Name = "bench-sg-040", Project = var.project }
}

resource "aws_lb" "lb_001" {
  name               = "bench-lb-001"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_001.id}"]
  tags = { Name = "bench-lb-001", Project = var.project }
}

resource "aws_lb" "lb_002" {
  name               = "bench-lb-002"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_002.id}"]
  tags = { Name = "bench-lb-002", Project = var.project }
}

resource "aws_lb" "lb_003" {
  name               = "bench-lb-003"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_003.id}"]
  tags = { Name = "bench-lb-003", Project = var.project }
}

resource "aws_lb" "lb_004" {
  name               = "bench-lb-004"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_004.id}"]
  tags = { Name = "bench-lb-004", Project = var.project }
}

resource "aws_lb" "lb_005" {
  name               = "bench-lb-005"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_005.id}"]
  tags = { Name = "bench-lb-005", Project = var.project }
}

resource "aws_lb" "lb_006" {
  name               = "bench-lb-006"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_006.id}"]
  tags = { Name = "bench-lb-006", Project = var.project }
}

resource "aws_lb" "lb_007" {
  name               = "bench-lb-007"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_007.id}"]
  tags = { Name = "bench-lb-007", Project = var.project }
}

resource "aws_lb" "lb_008" {
  name               = "bench-lb-008"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_008.id}"]
  tags = { Name = "bench-lb-008", Project = var.project }
}

resource "aws_lb" "lb_009" {
  name               = "bench-lb-009"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_009.id}"]
  tags = { Name = "bench-lb-009", Project = var.project }
}

resource "aws_lb" "lb_010" {
  name               = "bench-lb-010"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_010.id}"]
  tags = { Name = "bench-lb-010", Project = var.project }
}

resource "aws_lb" "lb_011" {
  name               = "bench-lb-011"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_011.id}"]
  tags = { Name = "bench-lb-011", Project = var.project }
}

resource "aws_lb" "lb_012" {
  name               = "bench-lb-012"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_012.id}"]
  tags = { Name = "bench-lb-012", Project = var.project }
}

resource "aws_lb" "lb_013" {
  name               = "bench-lb-013"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_013.id}"]
  tags = { Name = "bench-lb-013", Project = var.project }
}

resource "aws_lb" "lb_014" {
  name               = "bench-lb-014"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_014.id}"]
  tags = { Name = "bench-lb-014", Project = var.project }
}

resource "aws_lb" "lb_015" {
  name               = "bench-lb-015"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_015.id}"]
  tags = { Name = "bench-lb-015", Project = var.project }
}

resource "aws_lb" "lb_016" {
  name               = "bench-lb-016"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_016.id}"]
  tags = { Name = "bench-lb-016", Project = var.project }
}

resource "aws_lb" "lb_017" {
  name               = "bench-lb-017"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_017.id}"]
  tags = { Name = "bench-lb-017", Project = var.project }
}

resource "aws_lb" "lb_018" {
  name               = "bench-lb-018"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_018.id}"]
  tags = { Name = "bench-lb-018", Project = var.project }
}

resource "aws_lb" "lb_019" {
  name               = "bench-lb-019"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_019.id}"]
  tags = { Name = "bench-lb-019", Project = var.project }
}

resource "aws_lb" "lb_020" {
  name               = "bench-lb-020"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["${aws_subnet.subnet_020.id}"]
  tags = { Name = "bench-lb-020", Project = var.project }
}
