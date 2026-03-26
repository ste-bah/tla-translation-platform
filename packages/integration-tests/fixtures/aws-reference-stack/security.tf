resource "aws_security_group" "web" {
  name        = "tla-ref-sg-web"
  description = "Security group for web tier - HTTP and HTTPS"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }

  tags = {
    Name    = "tla-ref-sg-web"
    Project = "tla-ref"
  }
}

resource "aws_security_group" "app" {
  name        = "tla-ref-sg-app"
  description = "Security group for application tier - port 8080"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }

  tags = {
    Name    = "tla-ref-sg-app"
    Project = "tla-ref"
  }
}

resource "aws_security_group" "db" {
  name        = "tla-ref-sg-db"
  description = "Security group for database tier - PostgreSQL"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }

  tags = {
    Name    = "tla-ref-sg-db"
    Project = "tla-ref"
  }
}

resource "aws_security_group" "bastion" {
  name        = "tla-ref-sg-bastion"
  description = "Security group for bastion host - SSH from corp network"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["203.0.113.0/24"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }

  tags = {
    Name    = "tla-ref-sg-bastion"
    Project = "tla-ref"
  }
}
