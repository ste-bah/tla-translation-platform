resource "aws_db_subnet_group" "main" {
  name       = "tla-ref-db-subnet-group"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]

  tags = {
    Name    = "tla-ref-db-subnet-group"
    Project = "tla-ref"
  }
}

resource "aws_db_instance" "postgres" {
  identifier             = "tla-ref-postgres"
  engine                 = "postgres"
  engine_version         = "15.4"
  instance_class         = "db.t3.medium"
  allocated_storage      = 20
  storage_type           = "gp2"
  db_name                = "appdb"
  username               = "appuser"
  password               = "PLACEHOLDER_REPLACED_AT_RUNTIME"
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  multi_az               = true
  publicly_accessible    = false
  skip_final_snapshot    = true

  tags = {
    Name    = "tla-ref-postgres"
    Project = "tla-ref"
  }
}
