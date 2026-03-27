resource "aws_db_instance" "main" {
  engine               = "postgres"
  engine_version       = "15.4"
  instance_class       = "db.t3.medium"
  allocated_storage    = 100
  storage_encrypted    = true
  publicly_accessible  = false
  db_name             = "appdb"
  username            = "admin"
  tags = { Name = "main-db" }
}
