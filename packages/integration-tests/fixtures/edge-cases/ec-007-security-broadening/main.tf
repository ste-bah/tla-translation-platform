resource "aws_security_group" "wide_open" {
  name        = "ec-007-wide-open"
  description = "Overly permissive SG — all ingress from 0.0.0.0/0 with protocol -1"

  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "ec-007-wide-open"
  }
}
